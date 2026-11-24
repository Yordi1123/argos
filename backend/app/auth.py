"""Autenticación y autorización de ARGOS.

- Personas: inician sesión con correo y contraseña (hash Argon2id en `usuarios`); solo entran las cuentas
  que un administrador creó. Google queda como implementación futura (`routers/auth.py`, sin GOOGLE_CLIENT_ID
  responde 503). El backend crea una sesión propia (tabla `sesiones_acceso`) en una cookie HttpOnly.
- Servicios (agente de captura, módulo de visión): encabezado `X-Api-Key` (tabla `claves_servicio`).

La identidad de quien actúa SIEMPRE sale de aquí, nunca del cuerpo de la petición.
"""
import hashlib
import logging
import secrets
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone

from fastapi import Depends, Header, HTTPException, Request, Response

from .config import config
from .db import auditar, pool, transaccion

COOKIE = "argos_sesion"
# Las consultas automáticas del panel (sondeo) envían este encabezado y no cuentan como actividad.
ENCABEZADO_SONDEO = "x-argos-sondeo"
METODOS_SEGUROS = {"GET", "HEAD", "OPTIONS"}

ADMIN, REVISOR, OPERADOR, VISION = "ADMINISTRADOR", "REVISOR", "OPERADOR", "VALIDACION_IA"
ROLES_PERSONAS = (ADMIN, REVISOR, OPERADOR)


@dataclass(frozen=True)
class Actor:
    tipo: str            # "usuario" | "servicio"
    id: int
    nombre: str
    rol: str
    email: str | None = None
    debe_cambiar: bool = False   # contraseña temporal: solo puede cambiarla o cerrar sesión

    @property
    def etiqueta(self) -> str:
        """Cómo aparece en la auditoría."""
        return self.email if self.email else f"servicio:{self.nombre}"


def sha256(texto: str) -> str:
    return hashlib.sha256(texto.encode()).hexdigest()


def email_canonico(email: str) -> str:
    """Misma regla que la función SQL email_canonico(): Gmail ignora puntos y sufijos +algo."""
    local, _, dominio = email.strip().lower().partition("@")
    if dominio in ("gmail.com", "googlemail.com"):
        return local.split("+", 1)[0].replace(".", "") + "@gmail.com"
    return f"{local}@{dominio}"


# ---------------------------------------------------------------- resolución del actor

def _actor_servicio(clave: str) -> Actor:
    with pool.connection() as conn:
        fila = conn.execute(
            """UPDATE claves_servicio SET ultimo_uso = now()
               WHERE clave_hash = %s AND activa RETURNING id, nombre, rol""",
            (sha256(clave),),
        ).fetchone()
    if fila is None:
        raise HTTPException(401, "Clave de servicio inválida o revocada")
    return Actor("servicio", fila["id"], fila["nombre"], fila["rol"])


def _actor_sesion(request: Request, token: str) -> Actor:
    ahora = datetime.now(timezone.utc)
    with transaccion() as conn:
        s = conn.execute(
            """SELECT a.id, a.creada_en, a.ultima_actividad,
                      u.id AS uid, u.nombre, u.email, u.rol, u.activo, u.debe_cambiar_contrasena
               FROM sesiones_acceso a JOIN usuarios u ON u.id = a.usuario_id
               WHERE a.token_hash = %s AND a.cerrada_en IS NULL""",
            (sha256(token),),
        ).fetchone()
        if s is None:
            raise HTTPException(401, "Sesión no válida")

        motivo = None
        if not s["activo"]:
            motivo = "Usuario desactivado"
        elif ahora - s["creada_en"] > timedelta(hours=config.sesion_horas_max):
            motivo = "Duración máxima alcanzada"
        elif ahora - s["ultima_actividad"] > timedelta(minutes=config.sesion_minutos_inactividad):
            motivo = "Inactividad"
        if motivo:
            conn.execute(
                "UPDATE sesiones_acceso SET cerrada_en = now(), motivo_cierre = %s WHERE id = %s",
                (motivo, s["id"]),
            )
            auditar(conn, None, "CIERRE_SESION", s["email"], detalle={"motivo": motivo})
        elif request.headers.get(ENCABEZADO_SONDEO) != "1":
            conn.execute("UPDATE sesiones_acceso SET ultima_actividad = now() WHERE id = %s", (s["id"],))
    # Fuera de la transacción: si se lanzara dentro, se revertiría el cierre y su auditoría.
    if motivo:
        raise HTTPException(401, f"Sesión expirada: {motivo.lower()}")
    return Actor("usuario", s["uid"], s["nombre"], s["rol"], s["email"], s["debe_cambiar_contrasena"])


def _verificar_origen(request: Request) -> None:
    """Defensa CSRF adicional a SameSite=Strict: las escrituras con cookie deben venir del panel."""
    if request.method in METODOS_SEGUROS:
        return
    origen = request.headers.get("origin")
    if origen and origen not in config.origenes:
        raise HTTPException(403, "Origen no permitido")


def actor_actual(request: Request, x_api_key: str | None = Header(default=None)) -> Actor:
    if x_api_key:
        return _actor_servicio(x_api_key)
    token = request.cookies.get(COOKIE)
    if not token:
        raise HTTPException(401, "Inicia sesión para continuar")
    _verificar_origen(request)
    return _actor_sesion(request, token)


def requiere(*roles: str, tipo: str | None = None):
    """Dependencia de FastAPI: exige un actor autenticado con uno de los roles dados.

    `tipo="servicio"` o `tipo="usuario"` restringe además quién puede ser (p. ej. solo el agente
    registra eventos; solo una persona emite dictámenes).
    """
    def dependencia(actor: Actor = Depends(actor_actual)) -> Actor:
        if actor.debe_cambiar:
            raise HTTPException(403, "Debes cambiar tu contraseña temporal antes de continuar")
        if actor.rol not in roles or (tipo and actor.tipo != tipo):
            raise HTTPException(403, "No tienes permiso para esta acción")
        return actor
    return dependencia


# ---------------------------------------------------------------- sesiones

def abrir_sesion(conn, usuario_id: int, response: Response) -> None:
    token = secrets.token_urlsafe(32)
    conn.execute(
        "INSERT INTO sesiones_acceso (token_hash, usuario_id) VALUES (%s, %s)",
        (sha256(token), usuario_id),
    )
    response.set_cookie(
        COOKIE, token,
        max_age=int(config.sesion_horas_max * 3600),
        httponly=True, samesite="strict", secure=config.cookie_segura, path="/api",
    )


def cerrar_sesion(conn, token: str, motivo: str) -> None:
    conn.execute(
        """UPDATE sesiones_acceso SET cerrada_en = now(), motivo_cierre = %s
           WHERE token_hash = %s AND cerrada_en IS NULL""",
        (motivo, sha256(token)),
    )


def cerrar_sesiones_de(conn, usuario_id: int, motivo: str) -> None:
    conn.execute(
        """UPDATE sesiones_acceso SET cerrada_en = now(), motivo_cierre = %s
           WHERE usuario_id = %s AND cerrada_en IS NULL""",
        (motivo, usuario_id),
    )


def asegurar_admin_inicial() -> None:
    """Al arrancar: avisa en el log si nadie puede administrar ARGOS (no crea cuentas ni contraseñas solo)."""
    with pool.connection() as conn:
        hay = conn.execute(
            """SELECT 1 FROM usuarios
               WHERE rol = 'ADMINISTRADOR' AND activo AND contrasena_hash IS NOT NULL LIMIT 1"""
        ).fetchone()
    if not hay:
        logging.getLogger("argos").warning(
            "No hay administradores con contraseña. Crea uno con: "
            "docker compose exec backend python -m app.cuentas admin <correo> \"<Nombre Apellido>\""
        )
