"""Inicio y cierre de sesión de personas.

Método vigente: correo + contraseña (`POST /api/auth/ingresar`).
Google (`POST /api/auth/google`) queda listo como implementación futura: sin GOOGLE_CLIENT_ID responde 503
y el panel muestra su botón solo como ilustrativo.
"""
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException, Request, Response
from google.auth.transport import requests as google_requests
from google.oauth2 import id_token
from pydantic import BaseModel, Field

from ..auth import COOKIE, ROLES_PERSONAS, Actor, abrir_sesion, actor_actual, cerrar_sesion, email_canonico, sha256
from ..config import config
from ..contrasenas import MAX_INTENTOS, MINUTOS_BLOQUEO, hashear, necesita_rehash, validar_nueva, verificar
from ..db import auditar, transaccion

router = APIRouter(prefix="/api/auth", tags=["autenticación"])

_transporte = google_requests.Request()


class CredencialGoogle(BaseModel):
    credential: str


class Ingreso(BaseModel):
    email: str = Field(max_length=254)
    contrasena: str = Field(max_length=256)


class CambioContrasena(BaseModel):
    actual: str = Field(max_length=256)
    nueva: str = Field(max_length=256)


GENERICO = "Correo o contraseña incorrectos"


def _respuesta(u, debe_cambiar: bool) -> dict:
    return {"tipo": "usuario", "id": u["id"], "nombre": u["nombre"], "email": u["email"], "rol": u["rol"],
            "debe_cambiar": debe_cambiar}


@router.post("/ingresar")
def ingresar(datos: Ingreso, request: Request, response: Response):
    """Correo + contraseña. El mensaje de error es el mismo exista o no la cuenta."""
    email = datos.email.strip().lower()
    ahora = datetime.now(timezone.utc)
    error: tuple[int, str] | None = None
    with transaccion() as conn:
        u = conn.execute(
            """SELECT id, nombre, email, rol, activo, contrasena_hash, debe_cambiar_contrasena,
                      intentos_fallidos, bloqueado_hasta
               FROM usuarios WHERE email_canonico = %s FOR UPDATE""",
            (email_canonico(email),),
        ).fetchone()

        if u and u["bloqueado_hasta"] and u["bloqueado_hasta"] > ahora:
            minutos = max(1, round((u["bloqueado_hasta"] - ahora).total_seconds() / 60))
            error = (429, f"Demasiados intentos fallidos. Vuelve a intentarlo en {minutos} min "
                          "o pide a un administrador que restablezca tu contraseña.")
            auditar(conn, None, "ACCESO_DENEGADO", email, detalle={"motivo": "Cuenta bloqueada"})
        elif not verificar(u["contrasena_hash"] if u else None, datos.contrasena):
            error = (401, GENERICO)
            detalle = {"motivo": "Credenciales incorrectas"}
            if u:
                intentos = u["intentos_fallidos"] + 1
                if intentos >= MAX_INTENTOS:
                    conn.execute(
                        "UPDATE usuarios SET intentos_fallidos = 0, bloqueado_hasta = %s WHERE id = %s",
                        (ahora + timedelta(minutes=MINUTOS_BLOQUEO), u["id"]),
                    )
                    detalle["bloqueo_minutos"] = MINUTOS_BLOQUEO
                else:
                    conn.execute("UPDATE usuarios SET intentos_fallidos = %s WHERE id = %s", (intentos, u["id"]))
            auditar(conn, None, "ACCESO_DENEGADO", email, detalle=detalle)
        elif not u["activo"] or u["rol"] not in ROLES_PERSONAS:
            error = (403, "Tu cuenta está desactivada. Pide acceso a un administrador.")
            auditar(conn, None, "ACCESO_DENEGADO", email, detalle={"motivo": "Usuario desactivado"})
        else:
            nuevo_hash = hashear(datos.contrasena) if necesita_rehash(u["contrasena_hash"]) else u["contrasena_hash"]
            conn.execute(
                """UPDATE usuarios SET intentos_fallidos = 0, bloqueado_hasta = NULL, ultimo_acceso = now(),
                          contrasena_hash = %s WHERE id = %s""",
                (nuevo_hash, u["id"]),
            )
            anterior = request.cookies.get(COOKIE)
            if anterior:
                cerrar_sesion(conn, anterior, "Nuevo inicio de sesión")
            abrir_sesion(conn, u["id"], response)
            auditar(conn, None, "INICIO_SESION", u["email"], detalle={"metodo": "contraseña"})

    if error:  # fuera de la transacción: la auditoría y el contador de intentos deben quedar guardados
        raise HTTPException(*error)
    return _respuesta(u, u["debe_cambiar_contrasena"])


@router.post("/contrasena", status_code=204)
def cambiar_contrasena(datos: CambioContrasena, request: Request, actor: Actor = Depends(actor_actual)):
    """La persona con sesión cambia su contraseña (obligatorio si tiene una temporal)."""
    if actor.tipo != "usuario":
        raise HTTPException(403, "Solo para personas")
    incorrecta = False
    with transaccion() as conn:
        u = conn.execute(
            "SELECT contrasena_hash FROM usuarios WHERE id = %s FOR UPDATE", (actor.id,)
        ).fetchone()
        if not verificar(u["contrasena_hash"], datos.actual):
            incorrecta = True
            auditar(conn, None, "CONTRASENA_RECHAZADA", actor.etiqueta, detalle={"motivo": "Actual incorrecta"})
        else:
            validar_nueva(datos.nueva, actor.email or "", datos.actual)
            conn.execute(
                """UPDATE usuarios SET contrasena_hash = %s, debe_cambiar_contrasena = FALSE
                   WHERE id = %s""",
                (hashear(datos.nueva), actor.id),
            )
            # Cierra las demás sesiones de la persona; la actual sigue abierta
            conn.execute(
                """UPDATE sesiones_acceso SET cerrada_en = now(), motivo_cierre = 'Cambio de contraseña'
                   WHERE usuario_id = %s AND cerrada_en IS NULL AND token_hash <> %s""",
                (actor.id, sha256(request.cookies.get(COOKIE, ""))),
            )
            auditar(conn, None, "CONTRASENA_CAMBIADA", actor.etiqueta)
    if incorrecta:
        raise HTTPException(400, "La contraseña actual no es correcta")


@router.get("/config")
def configuracion():
    """Datos públicos que el panel necesita para mostrar el botón de Google."""
    return {"google_client_id": config.google_client_id or None}


@router.post("/google")
def iniciar_sesion(datos: CredencialGoogle, request: Request, response: Response):
    if not config.google_client_id:
        raise HTTPException(503, "Falta configurar GOOGLE_CLIENT_ID en el servidor")
    try:
        # Verifica firma, emisor (accounts.google.com), audiencia (nuestro Client ID) y expiración
        info = id_token.verify_oauth2_token(datos.credential, _transporte, config.google_client_id)
    except ValueError:
        raise HTTPException(401, "La credencial de Google no es válida o expiró")
    if not info.get("email_verified"):
        raise HTTPException(401, "El email de la cuenta de Google no está verificado")

    email, sub = info["email"].lower(), info["sub"]
    denegado = None
    with transaccion() as conn:
        u = conn.execute(
            """SELECT id, nombre, email, rol, activo, google_sub FROM usuarios
               WHERE google_sub = %s OR (google_sub IS NULL AND email_canonico = %s)
               ORDER BY (google_sub = %s) DESC NULLS LAST LIMIT 1""",
            (sub, email_canonico(email), sub),
        ).fetchone()
        if u is None:
            denegado = "Cuenta no autorizada"
        elif not u["activo"]:
            denegado = "Usuario desactivado"
        elif u["rol"] not in ROLES_PERSONAS:
            denegado = "Rol sin acceso al panel"

        if denegado:
            auditar(conn, None, "ACCESO_DENEGADO", email, detalle={"motivo": denegado})
        else:
            # Primer ingreso: fija la identidad de Google y, si el admin no puso nombre, usa el de Google
            u = conn.execute(
                """UPDATE usuarios SET google_sub = %s, ultimo_acceso = now(),
                          nombre = CASE WHEN nombre = email THEN COALESCE(%s, nombre) ELSE nombre END
                   WHERE id = %s RETURNING id, nombre, email, rol""",
                (sub, info.get("name"), u["id"]),
            ).fetchone()
            anterior = request.cookies.get(COOKIE)
            if anterior:
                cerrar_sesion(conn, anterior, "Nuevo inicio de sesión")
            abrir_sesion(conn, u["id"], response)
            auditar(conn, None, "INICIO_SESION", u["email"])

    if denegado:  # fuera de la transacción para no revertir la auditoría
        raise HTTPException(403, "Tu cuenta de Google no está autorizada en ARGOS. Pide acceso a un administrador.")
    return _respuesta(u, False)


@router.get("/yo")
def yo(actor: Actor = Depends(actor_actual)):
    return {"tipo": actor.tipo, "id": actor.id, "nombre": actor.nombre, "email": actor.email, "rol": actor.rol,
            "debe_cambiar": actor.debe_cambiar}


@router.post("/salir", status_code=204)
def salir(request: Request, response: Response):
    token = request.cookies.get(COOKIE)
    if token:
        with transaccion() as conn:
            fila = conn.execute(
                """SELECT u.email FROM sesiones_acceso a JOIN usuarios u ON u.id = a.usuario_id
                   WHERE a.token_hash = %s AND a.cerrada_en IS NULL""",
                (sha256(token),),
            ).fetchone()
            cerrar_sesion(conn, token, "Cierre por el usuario")
            if fila:
                auditar(conn, None, "CIERRE_SESION", fila["email"], detalle={"motivo": "Cierre por el usuario"})
    response.delete_cookie(COOKIE, path="/api", httponly=True, samesite="strict", secure=config.cookie_segura)
