import json
import urllib.error
import urllib.request

from fastapi import APIRouter, Depends, HTTPException

from ..auth import ROLES_PERSONAS, Actor, requiere
from ..config import config
from ..db import pool
from ..esquemas import PruebaVisionEntrada

router = APIRouter(prefix="/api/vision", tags=["vision"])


@router.get("/estado")
def estado_vision(_: Actor = Depends(requiere(*ROLES_PERSONAS, tipo="usuario"))):
    """Consulta el estado del servicio YOLOv11s + OCR y el tamaño de la cola pendiente."""
    with pool.connection() as conn:
        cola = conn.execute(
            "SELECT COUNT(*) AS n FROM eventos WHERE estado = 'EN_COLA'"
        ).fetchone()["n"]

    url = f"{config.vision_url.rstrip('/')}/salud"
    try:
        with urllib.request.urlopen(url, timeout=3) as r:
            remoto = json.loads(r.read().decode("utf-8"))
    except Exception:
        return {
            "disponible": False,
            "estado": "desconectado",
            "modelo_version": None,
            "dispositivo": None,
            "imgsz": None,
            "procesados": 0,
            "ultimo_evento_en": None,
            "cola_pendiente": cola,
            "error": "El servicio de visión no responde",
        }

    return {
        "disponible": bool(remoto.get("modelo_cargado")),
        "estado": remoto.get("estado", "ok"),
        "modelo_version": remoto.get("modelo_version"),
        "dispositivo": remoto.get("dispositivo"),
        "imgsz": remoto.get("imgsz"),
        "procesados": remoto.get("procesados", 0),
        "ultimo_evento_en": remoto.get("ultimo_evento_en"),
        "cola_pendiente": cola,
        "error": remoto.get("error"),
    }


@router.post("/detectar")
def detectar_placa(
    datos: PruebaVisionEntrada,
    _: Actor = Depends(requiere(*ROLES_PERSONAS, tipo="usuario")),
):
    """Ejecuta YOLOv11s + OCR en memoria sobre una imagen de prueba sin almacenarla en disco."""
    cuerpo = json.dumps({"imagen_base64": datos.imagen_base64}).encode("utf-8")
    req = urllib.request.Request(
        f"{config.vision_url.rstrip('/')}/detectar",
        data=cuerpo,
        method="POST",
        headers={"Content-Type": "application/json"},
    )
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            return json.loads(r.read().decode("utf-8"))
    except urllib.error.HTTPError as exc:
        try:
            detalle = json.loads(exc.read().decode("utf-8")).get("detail")
        except Exception:
            detalle = None
        raise HTTPException(exc.code, detalle or "Error al procesar la imagen en el módulo de visión")
    except urllib.error.URLError:
        raise HTTPException(
            503,
            "El servicio de visión (YOLOv11s) no está disponible. Verifica que el contenedor 'vision' esté activo.",
        )
