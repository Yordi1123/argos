"""Detector de placas vehiculares peruanas con YOLOv11s + OCR (RapidOCR/ONNX).

Flujo de inferencia:
  1. YOLOv11s (`yolov11s_placas.pt`, entrenado a imgsz=800 sobre placas peruanas)
     localiza el recuadro de la placa en la fotografía sin modificar el archivo original.
  2. Se recorta la región de interés (ROI) en memoria, se escala si es pequeña y
     se ejecuta OCR offline (`rapidocr_onnxruntime`).
  3. Se filtra la leyenda superior 'PERU' y se normaliza al formato SIIV peruano
     (`ABC-123` / `A1B-234`), corrigiendo confusiones ópticas comunes en los dígitos.
"""
from __future__ import annotations

import base64
import os
import re
import threading
import time
from dataclasses import asdict, dataclass
from pathlib import Path

os.environ.setdefault("YOLO_CONFIG_DIR", "/tmp/Ultralytics")

import cv2
import numpy as np

MODELO_VERSION_DEFECTO = "yolov11s-pe+ocr"
IMGSZ_DEFECTO = 800
UMBRAL_CONF_DEFECTO = 0.25

FORMATO_PLACA_SIIV = re.compile(r"^[A-Z0-9]{3}-\d{3}$")
ENCABEZADOS_IGNORADOS = {"PERU", "PERÚ", "PE", "DELPERU", "REPUBLICADELPERU"}
MAPA_DIGITO_OCR = str.maketrans({
    "O": "0",
    "Q": "0",
    "D": "0",
    "I": "1",
    "L": "1",
    "Z": "2",
    "S": "5",
    "G": "6",
    "B": "8",
})


@dataclass
class CajaPlaca:
    x1: int
    y1: int
    x2: int
    y2: int
    ancho_img: int
    alto_img: int


@dataclass
class ResultadoDeteccion:
    detectada: bool
    placa_candidata: str | None = None
    texto_ocr: str | None = None
    confianza: float | None = None
    confianza_deteccion: float | None = None
    confianza_ocr: float | None = None
    caja: CajaPlaca | None = None
    recorte_base64: str | None = None
    tiempo_ms: float = 0.0
    modelo_version: str = MODELO_VERSION_DEFECTO
    error: str | None = None

    def a_diccionario(self) -> dict:
        d = asdict(self)
        if self.caja is None:
            d["caja"] = None
        return d


def _limpiar_fragmento(texto: str) -> str:
    limpio = re.sub(r"[^A-Z0-9]", "", texto.upper())
    if limpio in ENCABEZADOS_IGNORADOS:
        return ""
    if limpio.startswith("PERU") and len(limpio) >= 9:
        limpio = limpio[4:]
    return limpio


def normalizar_placa_peru(lineas: list[tuple[str, float]]) -> tuple[str | None, str | None, float]:
    """Recibe pares (texto, confianza) del OCR y devuelve (placa_normalizada, texto_crudo, confianza_ocr)."""
    if not lineas:
        return None, None, 0.0

    utiles: list[tuple[str, float]] = []
    crudos: list[str] = []
    for txt, conf in lineas:
        crudos.append(txt.strip())
        limpio = _limpiar_fragmento(txt)
        if limpio:
            utiles.append((limpio, float(conf)))

    texto_crudo = " ".join(crudos).strip() or None
    if not utiles:
        return None, texto_crudo, 0.0

    # Candidatos: cada línea individual y la unión de fragmentos consecutivos (p. ej. "A1B" + "234")
    candidatos: list[tuple[str, float]] = list(utiles)
    if len(utiles) > 1:
        unido = "".join(t for t, _ in utiles)
        conf_media = sum(c for _, c in utiles) / len(utiles)
        candidatos.append((unido, conf_media))

    # 1) Priorizar coincidencia exacta de 6 caracteres SIIV: 3 alfanuméricos + 3 dígitos
    for cand, conf in candidatos:
        for inicio in range(0, max(1, len(cand) - 5)):
            sub = cand[inicio:inicio + 6]
            if len(sub) != 6:
                continue
            prefijo = sub[:3]
            sufijo = sub[3:].translate(MAPA_DIGITO_OCR)
            formateada = f"{prefijo}-{sufijo}"
            if FORMATO_PLACA_SIIV.match(formateada):
                return formateada, texto_crudo, conf

    # 2) Respaldo: mejor lectura de 5 a 8 caracteres (motos, placas antiguas o lectura parcial para revisión humana)
    mejor_txt, mejor_conf = max(candidatos, key=lambda x: (4 <= len(x[0]) <= 8, x[1]))
    if len(mejor_txt) < 4:
        return None, texto_crudo, 0.0
    if len(mejor_txt) == 6:
        return f"{mejor_txt[:3]}-{mejor_txt[3:]}", texto_crudo, mejor_conf
    return mejor_txt[:10], texto_crudo, mejor_conf


def _preparar_para_ocr(recorte_bgr: np.ndarray, mejorar_contraste: bool = False) -> np.ndarray:
    img = recorte_bgr
    alto, ancho = img.shape[:2]
    if alto < 96 and alto > 0 and ancho > 0:
        escala = 112.0 / float(alto)
        img = cv2.resize(img, (max(1, round(ancho * escala)), 112), interpolation=cv2.INTER_CUBIC)
    if mejorar_contraste:
        lab = cv2.cvtColor(img, cv2.COLOR_BGR2LAB)
        canal_l, canal_a, canal_b = cv2.split(lab)
        clahe = cv2.createCLAHE(clipLimit=2.2, tileGridSize=(4, 4))
        img = cv2.cvtColor(cv2.merge((clahe.apply(canal_l), canal_a, canal_b)), cv2.COLOR_LAB2BGR)
    return cv2.copyMakeBorder(img, 8, 8, 8, 8, cv2.BORDER_REPLICATE)


def _codificar_png_base64(img_bgr: np.ndarray) -> str | None:
    ok, buf = cv2.imencode(".png", img_bgr)
    if not ok:
        return None
    return "data:image/png;base64," + base64.b64encode(buf.tobytes()).decode("ascii")


class DetectorPlacas:
    """Ejecuta YOLOv11s + RapidOCR de forma segura entre hilos."""

    def __init__(
        self,
        ruta_modelo: Path,
        imgsz: int = IMGSZ_DEFECTO,
        umbral_conf: float = UMBRAL_CONF_DEFECTO,
        dispositivo: str = "cpu",
        modelo_version: str = MODELO_VERSION_DEFECTO,
    ) -> None:
        from rapidocr_onnxruntime import RapidOCR
        from ultralytics import YOLO

        if not ruta_modelo.is_file():
            raise FileNotFoundError(f"No se encontró el modelo YOLOv11s en {ruta_modelo}")

        self.ruta_modelo = ruta_modelo
        self.imgsz = imgsz
        self.umbral_conf = umbral_conf
        self.dispositivo = dispositivo
        self.modelo_version = modelo_version
        self._candado = threading.Lock()
        self._yolo = YOLO(str(ruta_modelo))
        self._ocr = RapidOCR()

    def analizar_archivo(self, ruta: Path, incluir_recorte: bool = False) -> ResultadoDeteccion:
        if not ruta.is_file():
            return ResultadoDeteccion(
                detectada=False,
                modelo_version=self.modelo_version,
                error=f"No existe el archivo de evidencia: {ruta.name}",
            )
        return self.analizar_bytes(ruta.read_bytes(), incluir_recorte=incluir_recorte)

    def analizar_bytes(self, datos: bytes, incluir_recorte: bool = False) -> ResultadoDeteccion:
        inicio = time.perf_counter()
        arreglo = np.frombuffer(datos, dtype=np.uint8)
        img_bgr = cv2.imdecode(arreglo, cv2.IMREAD_COLOR)
        if img_bgr is None:
            return ResultadoDeteccion(
                detectada=False,
                modelo_version=self.modelo_version,
                tiempo_ms=round((time.perf_counter() - inicio) * 1000, 1),
                error="No se pudo decodificar la imagen",
            )

        alto_img, ancho_img = img_bgr.shape[:2]
        with self._candado:
            predicciones = self._yolo.predict(
                img_bgr,
                imgsz=self.imgsz,
                conf=self.umbral_conf,
                device=self.dispositivo,
                verbose=False,
            )

            cajas = predicciones[0].boxes if predicciones else None
            if cajas is None or len(cajas) == 0:
                return ResultadoDeteccion(
                    detectada=False,
                    modelo_version=self.modelo_version,
                    tiempo_ms=round((time.perf_counter() - inicio) * 1000, 1),
                    error="Sin placa detectada por YOLOv11s",
                )

            # Evaluar hasta las 3 cajas con mayor confianza de detección
            indices = sorted(range(len(cajas)), key=lambda i: float(cajas.conf[i].item()), reverse=True)[:3]
            mejor_parcial: ResultadoDeteccion | None = None

            for idx in indices:
                conf_yolo = float(cajas.conf[idx].item())
                rx1, ry1, rx2, ry2 = cajas.xyxy[idx].tolist()
                x1 = max(0, min(ancho_img - 1, int(round(rx1))))
                y1 = max(0, min(alto_img - 1, int(round(ry1))))
                x2 = max(x1 + 1, min(ancho_img, int(round(rx2))))
                y2 = max(y1 + 1, min(alto_img, int(round(ry2))))

                # Margen ligero para no cortar bordes de los caracteres en el OCR
                pad_x = max(2, int((x2 - x1) * 0.06))
                pad_y = max(2, int((y2 - y1) * 0.10))
                cx1 = max(0, x1 - pad_x)
                cy1 = max(0, y1 - pad_y)
                cx2 = min(ancho_img, x2 + pad_x)
                cy2 = min(alto_img, y2 + pad_y)
                recorte = img_bgr[cy1:cy2, cx1:cx2]

                placa: str | None = None
                texto_crudo: str | None = None
                conf_ocr = 0.0

                for contraste in (False, True):
                    preparada = _preparar_para_ocr(recorte, mejorar_contraste=contraste)
                    salida_ocr, _ = self._ocr(preparada)
                    if not salida_ocr:
                        continue
                    # Ordenar líneas de arriba hacia abajo y de izquierda a derecha
                    ordenadas = sorted(
                        salida_ocr,
                        key=lambda item: (float(item[0][0][1]), float(item[0][0][0])),
                    )
                    lineas = [(str(item[1]), float(item[2])) for item in ordenadas if item[1]]
                    placa_cand, crudo_cand, conf_cand = normalizar_placa_peru(lineas)
                    if placa_cand and FORMATO_PLACA_SIIV.match(placa_cand):
                        placa, texto_crudo, conf_ocr = placa_cand, crudo_cand, conf_cand
                        break
                    if placa is None and placa_cand is not None:
                        placa, texto_crudo, conf_ocr = placa_cand, crudo_cand, conf_cand
                    elif texto_crudo is None:
                        texto_crudo = crudo_cand

                if placa and FORMATO_PLACA_SIIV.match(placa):
                    confianza_global = round(min(1.0, 0.65 * conf_yolo + 0.35 * conf_ocr), 3)
                elif placa:
                    confianza_global = round(min(1.0, 0.50 * conf_yolo + 0.50 * conf_ocr), 3)
                else:
                    # Placa localizada por YOLOv11s pero ilegible para OCR: pasa a revisión humana con prioridad baja
                    confianza_global = round(min(1.0, conf_yolo * 0.50), 3)

                candidato = ResultadoDeteccion(
                    detectada=True,
                    placa_candidata=placa,
                    texto_ocr=texto_crudo,
                    confianza=confianza_global,
                    confianza_deteccion=round(conf_yolo, 3),
                    confianza_ocr=round(conf_ocr, 3) if placa else None,
                    caja=CajaPlaca(x1=x1, y1=y1, x2=x2, y2=y2, ancho_img=ancho_img, alto_img=alto_img),
                    recorte_base64=_codificar_png_base64(recorte) if incluir_recorte else None,
                    tiempo_ms=round((time.perf_counter() - inicio) * 1000, 1),
                    modelo_version=self.modelo_version,
                )

                if placa and FORMATO_PLACA_SIIV.match(placa):
                    return candidato
                if mejor_parcial is None or (candidato.placa_candidata and not mejor_parcial.placa_candidata):
                    mejor_parcial = candidato

            assert mejor_parcial is not None
            mejor_parcial.tiempo_ms = round((time.perf_counter() - inicio) * 1000, 1)
            return mejor_parcial
