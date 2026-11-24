from fastapi import APIRouter, Depends, HTTPException

from ..auth import ADMIN, OPERADOR, ROLES_PERSONAS, Actor, requiere

from ..db import auditar, pool, transaccion
from ..esquemas import SesionNueva

router = APIRouter(prefix="/api/sesiones", tags=["sesiones"])


@router.post("", status_code=201)
def crear_sesion(datos: SesionNueva, actor: Actor = Depends(requiere(OPERADOR, ADMIN))):
    # El operador es quien abre la jornada; si la abre el agente (servicio), queda sin operador humano
    valores = {**datos.model_dump(), "operador_id": actor.id if actor.tipo == "usuario" else None}
    with transaccion() as conn:
        sesion = conn.execute(
            """INSERT INTO sesiones (ubicacion, distancia_m, limite_kmh, incertidumbre_kmh,
                                     latencia_camara_ms, operador_id)
               VALUES (%(ubicacion)s, %(distancia_m)s, %(limite_kmh)s, %(incertidumbre_kmh)s,
                       %(latencia_camara_ms)s, %(operador_id)s)
               RETURNING *""",
            valores,
        ).fetchone()
        auditar(conn, None, "SESION_ABIERTA", actor.etiqueta, detalle=sesion)
    return sesion


@router.get("")
def listar_sesiones(_: Actor = Depends(requiere(*ROLES_PERSONAS))):
    with pool.connection() as conn:
        return conn.execute("SELECT * FROM sesiones ORDER BY iniciada_en DESC").fetchall()


@router.post("/{sesion_id}/cerrar")
def cerrar_sesion(sesion_id: int, actor: Actor = Depends(requiere(OPERADOR, ADMIN))):
    with transaccion() as conn:
        sesion = conn.execute(
            """UPDATE sesiones SET cerrada_en = now()
               WHERE id = %s AND cerrada_en IS NULL RETURNING *""",
            (sesion_id,),
        ).fetchone()
        if sesion is None:
            raise HTTPException(409, "La sesión no existe o ya está cerrada")
        auditar(conn, None, "SESION_CERRADA", actor.etiqueta, detalle={"sesion_id": sesion_id})
    return sesion
