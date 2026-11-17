export type Estado =
  | "EVIDENCIA_GUARDADA" | "EN_COLA" | "ANALIZADO" | "EN_REVISION"
  | "CONFIRMADO" | "DESCARTADO" | "INCIERTO";

export interface Usuario { id: number; nombre: string; email: string; rol: string }

export interface EventoResumen {
  id: string;
  sesion_id: number;
  velocidad_kmh: string;
  limite_kmh: string;
  estado: Estado;
  motivo_incierto: string | null;
  ocurrido_en: string;
  placa_candidata: string | null;
  confianza: string | null;
  puntaje_utilidad: string | null;
  foto_id: number | null;
}

export interface Evidencia { id: number; tipo: string; ruta: string; sha256: string; capturada_en: string }
export interface Analisis {
  intento: number; placa_candidata: string | null; confianza: string | null;
  puntaje_utilidad: string | null; modelo_version: string | null; error: string | null; creado_en: string;
}
export interface Revision { decision: string; placa_final: string | null; comentario: string | null; revisor: string; creado_en: string }
export interface Auditoria { id: number; accion: string; estado_anterior: Estado | null; estado_nuevo: Estado | null; actor: string; creado_en: string }

export interface EventoDetalle extends Omit<EventoResumen, "placa_candidata" | "confianza" | "puntaje_utilidad" | "foto_id"> {
  t1_us: number; t2_us: number; duracion_corte_ms: string | null;
  ubicacion: string; distancia_m: string; incertidumbre_kmh: string;
  evidencias: Evidencia[]; analisis: Analisis[]; revisiones: Revision[]; auditoria: Auditoria[];
}

export type Decision = "CONFIRMAR" | "DESCARTAR" | "MARCAR_INCIERTO";
