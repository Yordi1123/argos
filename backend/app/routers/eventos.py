import hashlib
import re
from pathlib import Path
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, Response
from fastapi.responses import FileResponse

from ..auth import ADMIN, OPERADOR, REVISOR, ROLES_PERSONAS, VISION, Actor, requiere
from ..config import config
from ..db import auditar, pool, transaccion
from ..esquemas import EventoCreado, EventoNuevo, ResultadoAnalisis, RevisionNueva
from ..estados import cambiar_estado

router = APIRouter(prefix="/api", tags=["eventos"])

VELOCIDAD_MIN, VELOCIDAD_MAX = 5.0, 200.0
MAX_INTENTOS_ANALISIS = 3
FORMATO_PLACA = re.compile(r"^[A-Z0-9]{3}-?\d{3}$")  # ABC-123, A1B-234
RAIZ_EVIDENCIAS = Path(config.evidencias_dir).resolve()


def _ruta_segura(relativa: str) -> Path:
    ruta = (RAIZ_EVIDENCIAS / relativa).resolve()
    if not ruta.is_relative_to(RAIZ_EVIDENCIAS):
        raise HTTPException(422, "Ruta de evidencia fuera de la carpeta permitida")
    return ruta


def _sha256(ruta: Path) -> str:
    h = hashlib.sha256()
    with ruta.open("rb") as f:
        for bloque in iter(lambda: f.read(65536), b""):
            h.update(bloque)
    return h.hexdigest()


# ---------------------------------------------------------------- ingreso (agente)

@router.post("/eventos", status_code=201, response_model=EventoCreado)
def registrar_evento(datos: EventoNuevo, response: Response,
                     actor: Actor = Depends(requiere(OPERADOR, tipo="servicio"))):
    """El agente ya aplicó D1 y guardó la foto. Aquí se valida y se encola."""
    if datos.id is not None:
        with pool.connection() as conn:
            previo = conn.execute(
                "SELECT id, velocidad_kmh, estado FROM eventos WHERE id = %s", (datos.id,)
            ).fetchone()
        if previo:  # reenvío idempotente: mismo identificador, mismo evento
            response.status_code = 200
            return EventoCreado(id=previo["id"], velocidad_kmh=float(previo["velocidad_kmh"]),
                                estado=previo["estado"])

    for ev in datos.evidencias:
        ruta = _ruta_segura(ev.ruta)
        if not ruta.is_file():
            raise HTTPException(422, f"No existe la evidencia {ev.ruta}")
        if _sha256(ruta) != ev.sha256:
            raise HTTPException(422, f"El hash de {ev.ruta} no coincide")

    with transaccion() as conn:
        sesion = conn.execute(
            "SELECT * FROM sesiones WHERE id = %s", (datos.sesion_id,)
        ).fetchone()
        if sesion is None or sesion["cerrada_en"] is not None:
            raise HTTPException(409, "La sesión no existe o está cerrada")

        # La velocidad se recalcula aquí con la distancia calibrada de la sesión
        segundos = (datos.t2_us - datos.t1_us) / 1_000_000
        velocidad = round(float(sesion["distancia_m"]) / segundos * 3.6, 2)
        umbral = float(sesion["limite_kmh"]) + float(sesion["incertidumbre_kmh"])

        motivo = datos.motivo_incierto
        if not VELOCIDAD_MIN <= velocidad <= VELOCIDAD_MAX:
            motivo = motivo or f"Velocidad no plausible: {velocidad} km/h"
        elif velocidad <= umbral and not motivo:
            raise HTTPException(422, f"{velocidad} km/h no supera el umbral de {umbral} km/h")

        evento = conn.execute(
            """INSERT INTO eventos (id, sesion_id, t1_us, t2_us, velocidad_kmh,
                                    duracion_corte_ms, ocurrido_en)
               VALUES (COALESCE(%s, gen_random_uuid()), %s, %s, %s, %s, %s, %s)
               ON CONFLICT (id) DO NOTHING RETURNING id""",
            (datos.id, datos.sesion_id, datos.t1_us, datos.t2_us, velocidad,
             datos.duracion_corte_ms, datos.ocurrido_en),
        ).fetchone()
        if evento is None:  # otro reenvío simultáneo ganó la carrera
            raise HTTPException(409, "El evento ya fue registrado")
        eid = evento["id"]
        for ev in datos.evidencias:
            conn.execute(
                """INSERT INTO evidencias (evento_id, tipo, ruta, sha256, capturada_en)
                   VALUES (%s, %s, %s, %s, %s)""",
                (eid, ev.tipo, ev.ruta, ev.sha256, ev.capturada_en),
            )
        auditar(conn, eid, "EVENTO_REGISTRADO", actor.etiqueta, None, "EVIDENCIA_GUARDADA",
                {"velocidad_kmh": velocidad, "umbral_kmh": umbral})

        if motivo:
            conn.execute("UPDATE eventos SET motivo_incierto = %s WHERE id = %s", (motivo, eid))
            estado = "INCIERTO"
        else:
            estado = "EN_COLA"
        cambiar_estado(conn, eid, estado, actor.etiqueta, {"motivo": motivo} if motivo else None)

    return EventoCreado(id=eid, velocidad_kmh=velocidad, estado=estado)


# ---------------------------------------------------------------- análisis (visión)

@router.get("/cola")
def siguiente_en_cola(limite: int = Query(5, ge=1, le=50),
                      _: Actor = Depends(requiere(VISION, tipo="servicio"))):
    with pool.connection() as conn:
        return conn.execute(
            """SELECT e.id, e.velocidad_kmh, ev.id AS evidencia_id, ev.ruta
               FROM eventos e
               JOIN LATERAL (SELECT id, ruta FROM evidencias
                             WHERE evento_id = e.id AND tipo = 'FOTO'
                             ORDER BY id LIMIT 1) ev ON TRUE
               WHERE e.estado = 'EN_COLA'
               ORDER BY e.creado_en LIMIT %s""",
            (limite,),
        ).fetchall()


@router.post("/eventos/{evento_id}/analisis")
def registrar_analisis(evento_id: UUID, datos: ResultadoAnalisis,
                       actor: Actor = Depends(requiere(VISION, tipo="servicio"))):
    with transaccion() as conn:
        evento = conn.execute(
            """SELECT e.estado, e.velocidad_kmh, s.limite_kmh
               FROM eventos e JOIN sesiones s ON s.id = e.sesion_id
               WHERE e.id = %s FOR UPDATE OF e""",
            (evento_id,),
        ).fetchone()
        if evento is None:
            raise HTTPException(404, "Evento no encontrado")
        if evento["estado"] != "EN_COLA":
            raise HTTPException(409, f"El evento está en {evento['estado']}, no en cola")

        intento = conn.execute(
            "SELECT COALESCE(MAX(intento), 0) + 1 AS n FROM analisis WHERE evento_id = %s",
            (evento_id,),
        ).fetchone()["n"]

        placa = datos.placa_candidata.strip().upper() if datos.placa_candidata else None
        puntaje = None
        if not datos.error:
            # D2 · utilidad: confianza de la placa + margen sobre el límite
            limite, vel = float(evento["limite_kmh"]), float(evento["velocidad_kmh"])
            margen = max(0.0, min(1.0, (vel - limite) / limite))
            puntaje = 0.6 * (datos.confianza or 0) + 0.4 * margen
            if not (placa and FORMATO_PLACA.match(placa)):
                puntaje *= 0.5
            puntaje = round(puntaje, 3)

        conn.execute(
            """INSERT INTO analisis (evento_id, intento, placa_candidata, confianza,
                                     puntaje_utilidad, modelo_version, error)
               VALUES (%s, %s, %s, %s, %s, %s, %s)""",
            (evento_id, intento, placa, datos.confianza, puntaje,
             datos.modelo_version, datos.error),
        )

        if datos.error:
            auditar(conn, evento_id, "ANALISIS_FALLIDO", actor.etiqueta,
                    detalle={"intento": intento, "error": datos.error})
            if intento >= MAX_INTENTOS_ANALISIS:
                conn.execute(
                    "UPDATE eventos SET motivo_incierto = %s WHERE id = %s",
                    (f"Análisis falló {intento} veces", evento_id),
                )
                cambiar_estado(conn, evento_id, "INCIERTO", actor.etiqueta)
                return {"estado": "INCIERTO", "intento": intento}
            return {"estado": "EN_COLA", "intento": intento}

        cambiar_estado(conn, evento_id, "ANALIZADO", actor.etiqueta,
                       {"placa": placa, "confianza": datos.confianza})
        # La decisión final siempre es humana: D2 solo prioriza la revisión
        cambiar_estado(conn, evento_id, "EN_REVISION", actor.etiqueta, {"puntaje": puntaje})
    return {"estado": "EN_REVISION", "intento": intento, "puntaje_utilidad": puntaje}


# ---------------------------------------------------------------- revisión humana

DECISION_A_ESTADO = {
    "CONFIRMAR": "CONFIRMADO",
    "DESCARTAR": "DESCARTADO",
    "MARCAR_INCIERTO": "INCIERTO",
}


@router.post("/eventos/{evento_id}/revision")
def revisar_evento(evento_id: UUID, datos: RevisionNueva,
                   revisor: Actor = Depends(requiere(REVISOR, ADMIN, tipo="usuario"))):
    """El revisor es quien tiene la sesión abierta: nunca se toma del cuerpo de la petición."""
    placa = datos.placa_final.strip().upper() if datos.placa_final else None
    nuevo = DECISION_A_ESTADO[datos.decision]
    with transaccion() as conn:
        # Primero la transición (404 si no existe, 409 si no está en revisión); luego el dictamen
        cambiar_estado(conn, evento_id, nuevo, revisor.etiqueta,
                       {"placa_final": placa, "comentario": datos.comentario})
        conn.execute(
            """INSERT INTO revisiones (evento_id, revisor_id, decision, placa_final, comentario)
               VALUES (%s, %s, %s, %s, %s)""",
            (evento_id, revisor.id, datos.decision, placa, datos.comentario),
        )
    return {"estado": nuevo}


# ---------------------------------------------------------------- consulta (panel)

@router.get("/eventos")
def listar_eventos(
    estado: str | None = None,
    sesion_id: int | None = None,
    limite: int = Query(50, ge=1, le=500),
    desplazamiento: int = Query(0, ge=0),
    _: Actor = Depends(requiere(*ROLES_PERSONAS, tipo="usuario")),
):
    with pool.connection() as conn:
        return conn.execute(
            """SELECT e.id, e.sesion_id, e.velocidad_kmh, e.estado, e.motivo_incierto,
                      e.ocurrido_en, s.limite_kmh,
                      a.placa_candidata, a.confianza, a.puntaje_utilidad,
                      (SELECT id FROM evidencias WHERE evento_id = e.id AND tipo = 'FOTO'
                       ORDER BY id LIMIT 1) AS foto_id
               FROM eventos e
               JOIN sesiones s ON s.id = e.sesion_id
               LEFT JOIN LATERAL (SELECT placa_candidata, confianza, puntaje_utilidad
                                  FROM analisis WHERE evento_id = e.id AND error IS NULL
                                  ORDER BY intento DESC LIMIT 1) a ON TRUE
               WHERE (%(estado)s::estado_evento IS NULL OR e.estado = %(estado)s::estado_evento)
                 AND (%(sesion)s::int IS NULL OR e.sesion_id = %(sesion)s::int)
               ORDER BY a.puntaje_utilidad DESC NULLS LAST, e.ocurrido_en DESC
               LIMIT %(limite)s OFFSET %(desp)s""",
            {"estado": estado, "sesion": sesion_id, "limite": limite, "desp": desplazamiento},
        ).fetchall()


@router.get("/eventos/{evento_id}")
def detalle_evento(evento_id: UUID, _: Actor = Depends(requiere(*ROLES_PERSONAS, tipo="usuario"))):
    with pool.connection() as conn:
        evento = conn.execute(
            """SELECT e.*, s.ubicacion, s.distancia_m, s.limite_kmh, s.incertidumbre_kmh
               FROM eventos e JOIN sesiones s ON s.id = e.sesion_id WHERE e.id = %s""",
            (evento_id,),
        ).fetchone()
        if evento is None:
            raise HTTPException(404, "Evento no encontrado")
        q = lambda sql: conn.execute(sql, (evento_id,)).fetchall()  # noqa: E731
        evento["evidencias"] = q("SELECT * FROM evidencias WHERE evento_id = %s ORDER BY id")
        evento["analisis"] = q("SELECT * FROM analisis WHERE evento_id = %s ORDER BY intento")
        evento["revisiones"] = q(
            """SELECT r.*, u.nombre AS revisor FROM revisiones r
               JOIN usuarios u ON u.id = r.revisor_id WHERE evento_id = %s ORDER BY r.id""")
        evento["auditoria"] = q("SELECT * FROM auditoria WHERE evento_id = %s ORDER BY id")
    return evento


@router.get("/evidencias/{evidencia_id}/archivo")
def descargar_evidencia(evidencia_id: int, _: Actor = Depends(requiere(*ROLES_PERSONAS, tipo="usuario"))):
    with pool.connection() as conn:
        ev = conn.execute(
            "SELECT ruta, sha256 FROM evidencias WHERE id = %s", (evidencia_id,)
        ).fetchone()
    if ev is None:
        raise HTTPException(404, "Evidencia no encontrada")
    ruta = _ruta_segura(ev["ruta"])
    if not ruta.is_file():
        raise HTTPException(410, "El archivo de evidencia ya no existe")
    if _sha256(ruta) != ev["sha256"]:
        raise HTTPException(409, "La evidencia fue alterada: el hash no coincide")
    return FileResponse(ruta)
