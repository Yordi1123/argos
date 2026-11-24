"""Gestión de las cuentas que pueden entrar al panel (solo ADMINISTRADOR).

El administrador crea la cuenta y ARGOS genera una contraseña temporal que se muestra UNA vez; la persona
debe cambiarla al primer ingreso. Los usuarios no se borran: sus dictámenes y su auditoría deben seguir
atribuidos a ellos.
"""
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, EmailStr, Field

from ..auth import ADMIN, Actor, cerrar_sesiones_de, email_canonico, requiere
from ..contrasenas import hashear, temporal
from ..db import auditar, pool, transaccion

router = APIRouter(prefix="/api/usuarios", tags=["usuarios"])

RolPersona = Literal["ADMINISTRADOR", "REVISOR", "OPERADOR"]
COLUMNAS = """id, nombre, email, rol, activo, ultimo_acceso, creado_en,
    (contrasena_hash IS NOT NULL) AS tiene_contrasena, debe_cambiar_contrasena,
    (bloqueado_hasta IS NOT NULL AND bloqueado_hasta > now()) AS bloqueado"""


class UsuarioNuevo(BaseModel):
    email: EmailStr
    rol: RolPersona
    nombre: str = Field(min_length=1, max_length=120)


class UsuarioCambio(BaseModel):
    nombre: str | None = Field(default=None, min_length=1, max_length=120)
    rol: RolPersona | None = None
    activo: bool | None = None


@router.get("")
def listar(_: Actor = Depends(requiere(ADMIN))):
    with pool.connection() as conn:
        return conn.execute(
            f"SELECT {COLUMNAS} FROM usuarios ORDER BY activo DESC, rol, nombre"
        ).fetchall()


@router.post("", status_code=201)
def autorizar(datos: UsuarioNuevo, actor: Actor = Depends(requiere(ADMIN))):
    email = datos.email.lower()
    nombre = datos.nombre.strip()
    if not nombre:
        raise HTTPException(422, "El nombre es obligatorio")
    clave = temporal()
    with transaccion() as conn:
        existe = conn.execute(
            "SELECT email FROM usuarios WHERE email_canonico = %s", (email_canonico(email),)
        ).fetchone()
        if existe:
            raise HTTPException(409, f"Ya existe un usuario con esa cuenta ({existe['email']})")
        u = conn.execute(
            f"""INSERT INTO usuarios (nombre, email, email_canonico, rol, contrasena_hash, debe_cambiar_contrasena)
                VALUES (%s, %s, %s, %s, %s, TRUE) RETURNING {COLUMNAS}""",
            (nombre, email, email_canonico(email), datos.rol, hashear(clave)),
        ).fetchone()
        auditar(conn, None, "USUARIO_AUTORIZADO", actor.etiqueta, detalle={"email": email, "rol": datos.rol})
    # La contraseña temporal solo viaja en esta respuesta; en la base queda su hash
    return {**u, "contrasena_temporal": clave}


@router.post("/{usuario_id}/contrasena")
def restablecer_contrasena(usuario_id: int, actor: Actor = Depends(requiere(ADMIN))):
    """Genera una contraseña temporal nueva, desbloquea la cuenta y cierra sus sesiones."""
    if usuario_id == actor.id:
        raise HTTPException(409, "Para tu propia cuenta usa «Cambiar contraseña»")
    clave = temporal()
    with transaccion() as conn:
        u = conn.execute(
            f"""UPDATE usuarios SET contrasena_hash = %s, debe_cambiar_contrasena = TRUE,
                       intentos_fallidos = 0, bloqueado_hasta = NULL
                WHERE id = %s RETURNING {COLUMNAS}""",
            (hashear(clave), usuario_id),
        ).fetchone()
        if u is None:
            raise HTTPException(404, "Usuario no encontrado")
        cerrar_sesiones_de(conn, usuario_id, "Contraseña restablecida por un administrador")
        auditar(conn, None, "CONTRASENA_RESTABLECIDA", actor.etiqueta, detalle={"email": u["email"]})
    return {**u, "contrasena_temporal": clave}


@router.patch("/{usuario_id}")
def modificar(usuario_id: int, datos: UsuarioCambio, actor: Actor = Depends(requiere(ADMIN))):
    cambios = datos.model_dump(exclude_none=True)
    if not cambios:
        raise HTTPException(422, "No hay cambios")
    if usuario_id == actor.id and ("rol" in cambios or "activo" in cambios):
        raise HTTPException(409, "No puedes cambiar tu propio rol ni desactivarte")

    with transaccion() as conn:
        # Bloquea en una sola consulta y SIEMPRE en el mismo orden (por id) al usuario objetivo y a todos los
        # administradores activos. Si dos admins se quitan el rol mutuamente a la vez, el segundo espera al
        # primero y reevalúa: nunca queda el sistema sin administradores y no hay deadlock.
        filas = conn.execute(
            """SELECT id, email, rol, activo FROM usuarios
               WHERE id = %s OR (rol = 'ADMINISTRADOR' AND activo)
               ORDER BY id FOR UPDATE""", (usuario_id,)
        ).fetchall()
        u = next((f for f in filas if f["id"] == usuario_id), None)
        if u is None:
            raise HTTPException(404, "Usuario no encontrado")

        deja_de_ser_admin = u["rol"] == ADMIN and u["activo"] and (
            cambios.get("rol", ADMIN) != ADMIN or cambios.get("activo") is False
        )
        otros_admins = [f for f in filas if f["id"] != usuario_id and f["rol"] == ADMIN and f["activo"]]
        if deja_de_ser_admin and not otros_admins:
            raise HTTPException(409, "Debe quedar al menos un administrador activo")

        asignaciones = ", ".join(f"{k} = %({k})s" for k in cambios)
        nuevo = conn.execute(
            f"UPDATE usuarios SET {asignaciones} WHERE id = %(id)s RETURNING {COLUMNAS}",
            {**cambios, "id": usuario_id},
        ).fetchone()
        # Un cambio de permisos invalida las sesiones abiertas: el usuario vuelve a entrar con su nuevo rol
        if "rol" in cambios or cambios.get("activo") is False:
            cerrar_sesiones_de(conn, usuario_id, "Permisos modificados por un administrador")
        auditar(conn, None, "USUARIO_MODIFICADO", actor.etiqueta,
                detalle={"email": u["email"], **cambios})
    return nuevo
