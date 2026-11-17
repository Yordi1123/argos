"""Máquina de estados de un evento ARGOS.

EVIDENCIA_GUARDADA → EN_COLA → ANALIZADO → EN_REVISION → CONFIRMADO | DESCARTADO
Cualquier estado no final puede pasar a INCIERTO; un INCIERTO vuelve a revisión humana.
"""
from fastapi import HTTPException

from .db import auditar

TRANSICIONES = {
    "EVIDENCIA_GUARDADA": {"EN_COLA", "INCIERTO"},
    "EN_COLA": {"ANALIZADO", "INCIERTO"},
    "ANALIZADO": {"EN_REVISION", "INCIERTO"},
    "EN_REVISION": {"CONFIRMADO", "DESCARTADO", "INCIERTO"},
    "INCIERTO": {"EN_REVISION", "CONFIRMADO", "DESCARTADO"},
    "CONFIRMADO": set(),
    "DESCARTADO": set(),
}


def cambiar_estado(conn, evento_id, nuevo: str, actor: str, detalle: dict | None = None) -> str:
    fila = conn.execute(
        "SELECT estado FROM eventos WHERE id = %s FOR UPDATE", (evento_id,)
    ).fetchone()
    if fila is None:
        raise HTTPException(404, "Evento no encontrado")
    actual = fila["estado"]
    if nuevo not in TRANSICIONES[actual]:
        raise HTTPException(409, f"Transición no permitida: {actual} → {nuevo}")
    conn.execute(
        "UPDATE eventos SET estado = %s, actualizado_en = now() WHERE id = %s",
        (nuevo, evento_id),
    )
    auditar(conn, evento_id, "CAMBIO_ESTADO", actor, actual, nuevo, detalle)
    return actual
