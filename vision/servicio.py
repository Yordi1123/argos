#!/usr/bin/env python3
"""Servicio del módulo de visión ARGOS (YOLOv11s + OCR).

Funciones:
  1. Consumidor de cola: consulta `GET /api/cola`, abre cada foto en solo lectura desde
     `EVIDENCIAS_DIR`, ejecuta YOLOv11s + OCR y envía el resultado a `POST /api/eventos/{id}/analisis`
     autenticándose con `X-Api-Key: $ARGOS_CLAVE_VISION` (rol `VALIDACION_IA`).
  2. Servidor HTTP interno (`:8001`): expone `GET /salud` (healthcheck y telemetría del panel)
     y `POST /detectar` (prueba interactiva en memoria desde el panel web sin escribir en disco).

Uso local:
  python vision/servicio.py                        # servidor + consumidor continuo
  python vision/servicio.py --una-vez              # procesa la cola actual y termina
  python vision/servicio.py --imagen ruta/foto.jpg # prueba local sobre una imagen
"""
from __future__ import annotations

import argparse
import base64
import binascii
import json
import logging
import os
import threading
import time
import urllib.error
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

try:
    from .detector import IMGSZ_DEFECTO, MODELO_VERSION_DEFECTO, UMBRAL_CONF_DEFECTO, DetectorPlacas
except ImportError:
    from detector import IMGSZ_DEFECTO, MODELO_VERSION_DEFECTO, UMBRAL_CONF_DEFECTO, DetectorPlacas  # type: ignore[no-redef]

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s [vision] %(message)s")
log = logging.getLogger("argos.vision")

CARPETA_VISION = Path(__file__).resolve().parent
RAIZ_REPO = CARPETA_VISION.parent
ENV_ARCHIVO = RAIZ_REPO / ".env"
MAX_BYTES_IMAGEN = 10 * 1024 * 1024


def _leer_env(nombre: str, defecto: str = "") -> str:
    valor = os.environ.get(nombre)
    if valor is not None and valor.strip() != "":
        return valor.strip()
    if ENV_ARCHIVO.is_file():
        for linea in ENV_ARCHIVO.read_text(encoding="utf-8", errors="ignore").splitlines():
            texto = linea.strip()
            if not texto or texto.startswith("#") or "=" not in texto:
                continue
            clave, _, val = texto.partition("=")
            if clave.strip() == nombre:
                return val.strip().strip('"').strip("'")
    return defecto


def _ruta_evidencia_segura(raiz_evidencias: Path, relativa: str) -> Path:
    ruta = (raiz_evidencias / relativa).resolve()
    if not ruta.is_relative_to(raiz_evidencias):
        raise ValueError(f"Ruta fuera de la carpeta de evidencias: {relativa}")
    return ruta


def _llamar_api(api_url: str, clave_vision: str, metodo: str, ruta: str, cuerpo: dict | None = None) -> dict | list:
    datos = json.dumps(cuerpo).encode("utf-8") if cuerpo is not None else None
    req = urllib.request.Request(
        api_url.rstrip("/") + ruta,
        data=datos,
        method=metodo,
        headers={
            "Content-Type": "application/json",
            "X-Api-Key": clave_vision,
        },
    )
    with urllib.request.urlopen(req, timeout=15) as resp:
        return json.loads(resp.read().decode("utf-8"))


class EstadoServicio:
    def __init__(self, detector: DetectorPlacas | None, error_carga: str | None) -> None:
        self.detector = detector
        self.error_carga = error_carga
        self.procesados = 0
        self.ultimo_evento_en: str | None = None


def procesar_cola(
    detector: DetectorPlacas,
    api_url: str,
    clave_vision: str,
    raiz_evidencias: Path,
    estado: EstadoServicio | None = None,
) -> int:
    cola = _llamar_api(api_url, clave_vision, "GET", "/api/cola?limite=20")
    if not isinstance(cola, list) or not cola:
        return 0

    procesados = 0
    for ev in cola:
        eid = str(ev["id"])
        relativa = str(ev["ruta"])
        try:
            archivo = _ruta_evidencia_segura(raiz_evidencias, relativa)
            res = detector.analizar_archivo(archivo, incluir_recorte=False)
        except Exception as exc:
            log.exception("Fallo inesperado al analizar %s", eid[:8])
            cuerpo = {"error": f"Error interno de visión: {exc}", "modelo_version": detector.modelo_version}
        else:
            if res.error:
                cuerpo = {"error": res.error, "modelo_version": res.modelo_version}
            else:
                cuerpo = {
                    "placa_candidata": res.placa_candidata,
                    "confianza": res.confianza,
                    "modelo_version": res.modelo_version,
                }

        try:
            r = _llamar_api(api_url, clave_vision, "POST", f"/api/eventos/{eid}/analisis", cuerpo)
            procesados += 1
            if estado is not None:
                estado.procesados += 1
                estado.ultimo_evento_en = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
            if "error" in cuerpo:
                log.warning("Evento %s sin placa (%s) -> intento %s, estado %s",
                            eid[:8], cuerpo["error"], r.get("intento"), r.get("estado"))
            else:
                log.info("Evento %s -> placa=%s conf=%s estado=%s prioridad=%s",
                         eid[:8], cuerpo.get("placa_candidata") or "???-???",
                         cuerpo.get("confianza"), r.get("estado"), r.get("puntaje_utilidad"))
        except urllib.error.HTTPError as exc:
            detalle = exc.read().decode("utf-8", errors="ignore")
            log.warning("Backend rechazó análisis de %s (%s): %s", eid[:8], exc.code, detalle)
    return procesados


def _bucle_consumidor(
    estado: EstadoServicio,
    api_url: str,
    raiz_evidencias: Path,
    intervalo_s: float,
    detener: threading.Event,
) -> None:
    aviso_clave_emitido = False
    while not detener.is_set():
        clave_vision = _leer_env("ARGOS_CLAVE_VISION")
        if estado.detector is None:
            detener.wait(10.0)
            continue
        if not clave_vision:
            if not aviso_clave_emitido:
                log.warning(
                    "ARGOS_CLAVE_VISION no está definida. El servicio HTTP sigue activo, pero la cola "
                    "no se procesará hasta crear la clave con: "
                    "docker compose exec backend python -m app.claves crear vision VALIDACION_IA"
                )
                aviso_clave_emitido = True
            detener.wait(5.0)
            continue

        aviso_clave_emitido = False
        try:
            procesar_cola(estado.detector, api_url, clave_vision, raiz_evidencias, estado)
        except urllib.error.HTTPError as exc:
            detalle = exc.read().decode("utf-8", errors="ignore")
            log.error("Error HTTP %s al consultar cola: %s", exc.code, detalle)
            detener.wait(max(5.0, intervalo_s))
            continue
        except urllib.error.URLError as exc:
            log.warning("Backend no disponible en %s (%s). Reintentando…", api_url, exc.reason)
            detener.wait(max(3.0, intervalo_s))
            continue
        except Exception:
            log.exception("Error inesperado en el bucle de visión")
            detener.wait(max(3.0, intervalo_s))
            continue

        detener.wait(intervalo_s)


def _crear_manejador(estado: EstadoServicio):
    class ManejadorVision(BaseHTTPRequestHandler):
        def log_message(self, format: str, *args) -> None:  # noqa: A002
            return  # evita ruido por cada healthcheck

        def _responder(self, codigo: int, cuerpo: dict) -> None:
            datos = json.dumps(cuerpo).encode("utf-8")
            self.send_response(codigo)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Content-Length", str(len(datos)))
            self.end_headers()
            self.wfile.write(datos)

        def do_GET(self) -> None:  # noqa: N802
            if self.path.rstrip("/") in ("", "/salud"):
                det = estado.detector
                self._responder(200, {
                    "estado": "ok" if det is not None else "sin_modelo",
                    "modelo_cargado": det is not None,
                    "modelo_version": det.modelo_version if det else None,
                    "dispositivo": det.dispositivo if det else None,
                    "imgsz": det.imgsz if det else None,
                    "procesados": estado.procesados,
                    "ultimo_evento_en": estado.ultimo_evento_en,
                    "error": estado.error_carga,
                })
                return
            self._responder(404, {"detail": "Ruta no encontrada"})

        def do_POST(self) -> None:  # noqa: N802
            if self.path.rstrip("/") != "/detectar":
                self._responder(404, {"detail": "Ruta no encontrada"})
                return
            if estado.detector is None:
                self._responder(503, {"detail": estado.error_carga or "Modelo YOLOv11s no disponible"})
                return

            try:
                longitud = int(self.headers.get("Content-Length", "0"))
            except ValueError:
                self._responder(400, {"detail": "Content-Length inválido"})
                return
            if longitud <= 0 or longitud > MAX_BYTES_IMAGEN * 2:
                self._responder(413, {"detail": "La imagen supera el tamaño máximo permitido (10 MB)"})
                return

            try:
                carga = json.loads(self.rfile.read(longitud).decode("utf-8"))
                b64 = str(carga.get("imagen_base64") or "")
                if "," in b64 and b64.lstrip().startswith("data:"):
                    b64 = b64.split(",", 1)[1]
                datos_img = base64.b64decode(b64, validate=True)
            except (ValueError, json.JSONDecodeError, binascii.Error):
                self._responder(422, {"detail": "Formato imagen_base64 inválido"})
                return

            if len(datos_img) > MAX_BYTES_IMAGEN:
                self._responder(413, {"detail": "La imagen supera los 10 MB permitidos"})
                return

            resultado = estado.detector.analizar_bytes(datos_img, incluir_recorte=True)
            self._responder(200, resultado.a_diccionario())

    return ManejadorVision


def main() -> None:
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--api", default=_leer_env("API_URL", "http://localhost:8000"))
    p.add_argument("--evidencias", default=_leer_env("EVIDENCIAS_DIR", str(RAIZ_REPO / "data" / "evidencias")))
    p.add_argument("--modelo", default=_leer_env("MODELO_RUTA", str(CARPETA_VISION / "modelos" / "yolov11s_placas.pt")))
    p.add_argument("--imgsz", type=int, default=int(_leer_env("MODELO_IMGSZ", str(IMGSZ_DEFECTO))))
    p.add_argument("--umbral", type=float, default=float(_leer_env("MODELO_UMBRAL", str(UMBRAL_CONF_DEFECTO))))
    p.add_argument("--dispositivo", default=_leer_env("MODELO_DISPOSITIVO", "cpu"))
    p.add_argument("--modelo-version", default=_leer_env("MODELO_VERSION", MODELO_VERSION_DEFECTO))
    p.add_argument("--intervalo", type=float, default=float(_leer_env("INTERVALO_COLA_S", "2.0")))
    p.add_argument("--host", default=_leer_env("VISION_HOST", "0.0.0.0"))
    p.add_argument("--puerto", type=int, default=int(_leer_env("VISION_PUERTO", "8001")))
    p.add_argument("--una-vez", action="store_true", help="Procesa la cola pendiente una sola vez y termina")
    p.add_argument("--imagen", type=Path, help="Ejecuta YOLOv11s + OCR sobre una imagen local e imprime el JSON")
    args = p.parse_args()

    ruta_modelo = Path(args.modelo).resolve()
    detector: DetectorPlacas | None = None
    error_carga: str | None = None
    try:
        log.info("Cargando YOLOv11s desde %s (imgsz=%s, dispositivo=%s)…", ruta_modelo, args.imgsz, args.dispositivo)
        detector = DetectorPlacas(
            ruta_modelo=ruta_modelo,
            imgsz=args.imgsz,
            umbral_conf=args.umbral,
            dispositivo=args.dispositivo,
            modelo_version=args.modelo_version,
        )
        log.info("Modelo %s listo.", detector.modelo_version)
    except Exception as exc:
        error_carga = str(exc)
        log.error("No se pudo cargar el modelo: %s", error_carga)
        if args.imagen or args.una_vez:
            raise SystemExit(1) from exc

    if args.imagen:
        assert detector is not None
        res = detector.analizar_archivo(args.imagen.resolve(), incluir_recorte=False)
        print(json.dumps(res.a_diccionario(), ensure_ascii=False, indent=2))
        return

    raiz_evidencias = Path(args.evidencias).resolve()
    if args.una_vez:
        assert detector is not None
        clave_vision = _leer_env("ARGOS_CLAVE_VISION")
        if not clave_vision:
            raise SystemExit("✗ Falta ARGOS_CLAVE_VISION en el entorno o en .env")
        n = procesar_cola(detector, args.api, clave_vision, raiz_evidencias)
        log.info("Cola procesada (%d evento(s)).", n)
        return

    estado = EstadoServicio(detector=detector, error_carga=error_carga)
    detener = threading.Event()
    hilo = threading.Thread(
        target=_bucle_consumidor,
        args=(estado, args.api, raiz_evidencias, args.intervalo, detener),
        daemon=True,
    )
    hilo.start()

    servidor = ThreadingHTTPServer((args.host, args.puerto), _crear_manejador(estado))
    log.info("Servicio HTTP de visión escuchando en http://%s:%d (API=%s)", args.host, args.puerto, args.api)
    try:
        servidor.serve_forever()
    except KeyboardInterrupt:
        log.info("Deteniendo servicio de visión…")
    finally:
        detener.set()
        servidor.server_close()


if __name__ == "__main__":
    main()
