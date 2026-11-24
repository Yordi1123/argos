from datetime import datetime
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, Field, model_validator


class SesionNueva(BaseModel):
    ubicacion: str
    distancia_m: float = Field(gt=0, le=50)
    limite_kmh: float = Field(gt=0, le=150)
    incertidumbre_kmh: float = Field(default=1.0, ge=0, le=10)
    latencia_camara_ms: float | None = None


class EvidenciaEntrada(BaseModel):
    tipo: Literal["FOTO", "CLIP"] = "FOTO"
    ruta: str = Field(description="Ruta relativa dentro de la carpeta de evidencias")
    sha256: str = Field(pattern=r"^[0-9a-f]{64}$")
    capturada_en: datetime


class EventoNuevo(BaseModel):
    """Lo envía el agente de captura DESPUÉS de guardar la evidencia en disco.

    El agente genera el `id`: si reenvía el mismo evento, no se duplica.
    """
    id: UUID | None = None
    sesion_id: int
    t1_us: int = Field(ge=0)
    t2_us: int = Field(ge=0)
    ocurrido_en: datetime
    duracion_corte_ms: float | None = None
    motivo_incierto: str | None = None
    evidencias: list[EvidenciaEntrada] = Field(min_length=1)

    @model_validator(mode="after")
    def orden_barreras(self):
        if self.t2_us <= self.t1_us:
            raise ValueError("t2 debe ser mayor que t1 (barrera 1 antes que barrera 2)")
        return self


class ResultadoAnalisis(BaseModel):
    """Lo envía el módulo de visión (YOLO + OCR) al terminar un intento."""
    placa_candidata: str | None = None
    confianza: float | None = Field(default=None, ge=0, le=1)
    modelo_version: str | None = None
    error: str | None = None


class RevisionNueva(BaseModel):
    """El revisor no viene aquí: se toma de la sesión (auth.requiere)."""
    decision: Literal["CONFIRMAR", "DESCARTAR", "MARCAR_INCIERTO"]
    placa_final: str | None = Field(default=None, max_length=10)
    comentario: str | None = Field(default=None, max_length=1000)


class EventoCreado(BaseModel):
    id: UUID
    velocidad_kmh: float
    estado: str
