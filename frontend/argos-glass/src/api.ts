import type { EventState, TrafficEvent } from './data';

/* ---------- Tipos tal como los devuelve el backend (FastAPI) ---------- */

export type Estado =
  | 'EVIDENCIA_GUARDADA' | 'EN_COLA' | 'ANALIZADO' | 'EN_REVISION'
  | 'CONFIRMADO' | 'DESCARTADO' | 'INCIERTO';

export type Decision = 'CONFIRMAR' | 'DESCARTAR' | 'MARCAR_INCIERTO';

export type Rol = 'ADMINISTRADOR' | 'REVISOR' | 'OPERADOR';

/** Persona con sesión abierta (GET /api/auth/yo). */
export interface Sesion {
  tipo: 'usuario'; id: number; nombre: string; email: string; rol: Rol;
  /** Tiene contraseña temporal: el backend responde 403 a todo salvo cambiarla o salir. */
  debe_cambiar: boolean;
}

/** Cuenta que puede entrar al panel (GET /api/usuarios, solo ADMINISTRADOR). */
export interface Usuario {
  id: number; nombre: string; email: string; rol: Rol; activo: boolean;
  ultimo_acceso: string | null; creado_en: string;
  tiene_contrasena: boolean;
  debe_cambiar_contrasena: boolean;
  /** Bloqueada temporalmente por intentos fallidos. */
  bloqueado: boolean;
}

/** Respuesta al crear una cuenta o restablecer su contraseña: la temporal llega solo esta vez. */
export type UsuarioConClave = Usuario & { contrasena_temporal: string };

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

/* ---------- Cliente HTTP (mismo origen: nginx o el proxy de Vite reenvían /api) ----------
 * La sesión viaja en una cookie HttpOnly que el navegador envía sola: el código nunca ve el token.
 */

export class ErrorApi extends Error {
  readonly status: number;
  constructor(status: number, mensaje: string) {
    super(mensaje);
    this.status = status;
  }
}

let alExpirar: (() => void) | null = null;
/** App.tsx registra aquí qué hacer cuando el backend responde 401 (sesión vencida o cerrada). */
export function onSesionExpirada(fn: () => void) { alExpirar = fn; }

interface Opciones extends RequestInit {
  /** Consulta automática (sondeo): no cuenta como actividad del usuario para el cierre por inactividad. */
  sondeo?: boolean;
  /** No disparar onSesionExpirada en un 401 (p. ej. al comprobar si hay sesión al abrir el panel). */
  silencioso?: boolean;
}

async function pedir<T>(url: string, { sondeo, silencioso, ...opciones }: Opciones = {}): Promise<T> {
  const r = await fetch(url, {
    ...opciones,
    credentials: 'same-origin',
    headers: {
      'Content-Type': 'application/json',
      ...(sondeo ? { 'X-Argos-Sondeo': '1' } : {}),
      ...opciones.headers,
    },
  });
  if (!r.ok) {
    if (r.status === 401 && !silencioso) alExpirar?.();
    const cuerpo = await r.json().catch(() => ({}));
    const d = cuerpo.detail;
    throw new ErrorApi(r.status,
      typeof d === 'string' ? d : Array.isArray(d) ? d.map((x) => x.msg).join('; ') : `Error ${r.status}`);
  }
  return r.status === 204 ? (undefined as T) : r.json();
}

const json = (method: string, cuerpo: unknown): RequestInit => ({ method, body: JSON.stringify(cuerpo) });

export const api = {
  // Autenticación
  authConfig: () => pedir<{ google_client_id: string | null }>('/api/auth/config', { silencioso: true }),
  yo: () => pedir<Sesion>('/api/auth/yo', { silencioso: true }),
  /** 401 aquí significa credenciales incorrectas, no sesión vencida: silencioso. */
  ingresar: (email: string, contrasena: string) =>
    pedir<Sesion>('/api/auth/ingresar', { ...json('POST', { email, contrasena }), silencioso: true }),
  cambiarContrasena: (actual: string, nueva: string) =>
    pedir<void>('/api/auth/contrasena', json('POST', { actual, nueva })),
  /** Implementación futura: el backend responde 503 mientras no haya GOOGLE_CLIENT_ID. */
  entrarConGoogle: (credential: string) =>
    pedir<Sesion>('/api/auth/google', { ...json('POST', { credential }), silencioso: true }),
  salir: () => pedir<void>('/api/auth/salir', { method: 'POST', silencioso: true }),

  // Administración de usuarios (solo ADMINISTRADOR)
  usuarios: () => pedir<Usuario[]>('/api/usuarios'),
  crearUsuario: (email: string, rol: Rol, nombre: string) =>
    pedir<UsuarioConClave>('/api/usuarios', json('POST', { email, rol, nombre: nombre.trim() })),
  restablecerContrasena: (id: number) =>
    pedir<UsuarioConClave>(`/api/usuarios/${id}/contrasena`, { method: 'POST' }),
  modificarUsuario: (id: number, cambios: Partial<Pick<Usuario, 'nombre' | 'rol' | 'activo'>>) =>
    pedir<Usuario>(`/api/usuarios/${id}`, json('PATCH', cambios)),

  // Eventos
  eventos: (limite = 500, sondeo = false) => pedir<EventoResumen[]>(`/api/eventos?limite=${limite}`, { sondeo }),
  evento: (id: string) => pedir<EventoDetalle>(`/api/eventos/${id}`),
  /** El revisor no se envía: el backend lo toma de la sesión. */
  revisar: (id: string, decision: Decision, placaFinal: string | null, comentario: string) =>
    pedir<{ estado: Estado }>(`/api/eventos/${id}/revision`, json('POST', {
      decision,
      placa_final: placaFinal || null,
      comentario: comentario || null,
    })),
  urlEvidencia: (id: number) => `/api/evidencias/${id}/archivo`,
};

/** Qué puede hacer cada rol en el panel. La autorización real la aplica el backend; esto solo adapta la UI. */
export const puede = {
  revisar: (r?: Rol) => r === 'REVISOR' || r === 'ADMINISTRADOR',
  administrar: (r?: Rol) => r === 'ADMINISTRADOR',
  operar: (r?: Rol) => r === 'OPERADOR' || r === 'ADMINISTRADOR',
};

export const ROL_UI: Record<Rol, string> = {
  ADMINISTRADOR: 'Administrador',
  REVISOR: 'Revisor vial',
  OPERADOR: 'Operador de campo',
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
