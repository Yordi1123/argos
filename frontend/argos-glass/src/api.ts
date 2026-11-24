import type { EventState, TrafficEvent } from './data';

/* ---------- Tipos tal como los devuelve el backend (FastAPI) ---------- */

export type Estado =
  | 'EVIDENCIA_GUARDADA' | 'EN_COLA' | 'ANALIZADO' | 'EN_REVISION'
  | 'CONFIRMADO' | 'DESCARTADO' | 'INCIERTO';

export type Decision = 'CONFIRMAR' | 'DESCARTAR' | 'MARCAR_INCIERTO';

export interface Usuario { id: number; nombre: string; email: string; rol: string }

/** Postgres NUMERIC llega como string en el JSON. */
type Num = string | number;

export interface EventoResumen {
  id: string;
  sesion_id: number;
  velocidad_kmh: Num;
  limite_kmh: Num;
  estado: Estado;
  motivo_incierto: string | null;
  ocurrido_en: string;
  placa_candidata: string | null;
  confianza: Num | null;
  puntaje_utilidad: Num | null;
  foto_id: number | null;
}

export interface Evidencia { id: number; tipo: 'FOTO' | 'CLIP'; ruta: string; sha256: string; capturada_en: string }
export interface Analisis {
  intento: number; placa_candidata: string | null; confianza: Num | null;
  puntaje_utilidad: Num | null; modelo_version: string | null; error: string | null; creado_en: string;
}
export interface Revision {
  decision: Decision; placa_final: string | null; comentario: string | null; revisor: string; creado_en: string;
}
export interface Auditoria {
  id: number; accion: string; estado_anterior: Estado | null; estado_nuevo: Estado | null;
  actor: string; detalle: Record<string, unknown>; creado_en: string;
}

export interface EventoDetalle {
  id: string; sesion_id: number; estado: Estado; motivo_incierto: string | null;
  velocidad_kmh: Num; t1_us: number; t2_us: number; duracion_corte_ms: Num | null; ocurrido_en: string;
  ubicacion: string; distancia_m: Num; limite_kmh: Num; incertidumbre_kmh: Num;
  evidencias: Evidencia[]; analisis: Analisis[]; revisiones: Revision[]; auditoria: Auditoria[];
}

/* ---------- Cliente HTTP (mismo origen: nginx o el proxy de Vite reenvían /api) ---------- */

async function pedir<T>(url: string, opciones?: RequestInit): Promise<T> {
  const r = await fetch(url, {
    ...opciones,
    headers: { 'Content-Type': 'application/json', ...opciones?.headers },
  });
  if (!r.ok) {
    const cuerpo = await r.json().catch(() => ({}));
    const d = cuerpo.detail;
    throw new Error(typeof d === 'string' ? d : Array.isArray(d) ? d.map((x) => x.msg).join('; ') : `Error ${r.status}`);
  }
  return r.json();
}

export const api = {
  usuarios: () => pedir<Usuario[]>('/api/usuarios'),
  eventos: (limite = 500) => pedir<EventoResumen[]>(`/api/eventos?limite=${limite}`),
  evento: (id: string) => pedir<EventoDetalle>(`/api/eventos/${id}`),
  revisar: (id: string, revisorId: number, decision: Decision, placaFinal: string | null, comentario: string) =>
    pedir<{ estado: Estado }>(`/api/eventos/${id}/revision`, {
      method: 'POST',
      body: JSON.stringify({
        revisor_id: revisorId,
        decision,
        placa_final: placaFinal || null,
        comentario: comentario || null,
      }),
    }),
  urlEvidencia: (id: number) => `/api/evidencias/${id}/archivo`,
};

/* ---------- Adaptación al modelo de la interfaz ---------- */

/** Estados en los que un revisor puede emitir dictamen (ver backend/app/estados.py). */
export const REVISABLES: Estado[] = ['EN_REVISION', 'INCIERTO'];

export function estadoUI(e: Estado): EventState {
  switch (e) {
    case 'EN_REVISION': return 'Pendiente';
    case 'CONFIRMADO': return 'Validado';
    case 'DESCARTADO': return 'Descartado';
    case 'INCIERTO': return 'No verificable';
    default: return 'En análisis'; // EVIDENCIA_GUARDADA, EN_COLA, ANALIZADO
  }
}

const LIMA = 'America/Lima';
/** YYYY-MM-DD en hora de Lima (para el filtro de fecha). */
export const fechaISO = (d: Date) => d.toLocaleDateString('en-CA', { timeZone: LIMA });
export const hora = (d: Date) => d.toLocaleTimeString('es-PE', { timeZone: LIMA, hour12: false });
export const fechaLarga = (d: Date) =>
  d.toLocaleDateString('es-PE', { timeZone: LIMA, day: 'numeric', month: 'short', year: 'numeric' });

const n1 = (x: Num) => Math.round(Number(x) * 10) / 10;

export function aEvento(r: EventoResumen): TrafficEvent {
  const d = new Date(r.ocurrido_en);
  const plate = r.placa_candidata ?? '???-???';
  return {
    id: r.id,
    shortId: `ARG-${r.id.slice(0, 8).toUpperCase()}`,
    date: fechaISO(d),
    dateLabel: fechaLarga(d),
    time: hora(d),
    speed: n1(r.velocidad_kmh),
    limit: n1(r.limite_kmh),
    plate,
    originalPlate: plate,
    confidence: r.confianza == null ? 0 : n1(Number(r.confianza) * 100),
    state: estadoUI(r.estado),
    estado: r.estado,
    priority: r.puntaje_utilidad == null ? null : Number(r.puntaje_utilidad),
    photoId: r.foto_id,
    reason: r.motivo_incierto,
    history: [],
  };
}
