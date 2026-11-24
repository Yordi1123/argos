import { puede, type Estado, type Rol } from './api';

/** Estado visible en la interfaz (derivado del estado del backend en api.ts). */
export type EventState = 'Pendiente' | 'Validado' | 'Descartado' | 'No verificable' | 'En análisis';

export const STATES: EventState[] = ['Pendiente', 'Validado', 'Descartado', 'No verificable', 'En análisis'];

export interface TrafficEvent {
  /** UUID del backend. */
  id: string;
  /** Identificador corto para mostrar (ARG-XXXXXXXX). */
  shortId: string;
  /** Fecha YYYY-MM-DD en hora de Lima. */
  date: string;
  dateLabel: string;
  time: string;
  speed: number;
  limit: number;
  plate: string;
  originalPlate: string;
  /** 0–100 */
  confidence: number;
  state: EventState;
  estado: Estado;
  /** Puntaje D2 (0–1): solo ordena la cola, no decide. */
  priority: number | null;
  photoId: number | null;
  reason: string | null;
  history: string[];
}

export type Page =
  | 'landing' | 'login' | 'dash' | 'monitor' | 'events' | 'image' | 'review'
  | 'reports' | 'device' | 'settings' | 'users' | 'detail';

/** Límite por defecto para gráficos decorativos; cada evento trae el de su sesión. */
export const LIMIT = 40;

export const menus: [Page, string][] = [
  ['dash', 'Dashboard'],
  ['monitor', 'Monitoreo en tiempo real'],
  ['events', 'Eventos detectados'],
  ['image', 'Evidencias'],
  ['review', 'Revisión de placas'],
  ['reports', 'Reportes y estadísticas'],
  ['device', 'Dispositivos'],
  ['settings', 'Configuración'],
  ['users', 'Administración de usuarios'],
];

/** Páginas públicas: no requieren sesión. */
export const PUBLICAS: Page[] = ['landing', 'login'];

/** Qué páginas del panel ve cada rol (la autorización real la aplica el backend). */
export function permitida(p: Page, rol?: Rol): boolean {
  if (PUBLICAS.includes(p)) return true;
  if (!rol) return false;
  if (p === 'review') return puede.revisar(rol);
  if (p === 'users') return puede.administrar(rol);
  if (p === 'device' || p === 'settings') return puede.operar(rol);
  return true; // dash, monitor, events, image, reports, detail: cualquier rol con sesión
}

/** Vehículo ilustrativo para la pantalla de acceso (no muestra evidencia real antes de ingresar). */
export const DEMO_EVENT: TrafficEvent = {
  id: 'demo', shortId: 'ARG-DEMO', date: '', dateLabel: '', time: '', speed: 0, limit: LIMIT,
  plate: 'ARG-000', originalPlate: 'ARG-000', confidence: 0, state: 'Pendiente', estado: 'EN_REVISION',
  priority: null, photoId: null, reason: null, history: [],
};
