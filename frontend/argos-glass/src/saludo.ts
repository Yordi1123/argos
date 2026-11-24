/* Textos del saludo del panel. Funciones puras: todo dato que muestran es real (sesión y eventos). */
import { fechaISO, puede, type Sesion } from './api';
import type { TrafficEvent } from './data';

const LIMA = 'America/Lima';

const horaLima = (d: Date) =>
  Number(new Intl.DateTimeFormat('en-GB', { timeZone: LIMA, hour: '2-digit', hour12: false }).format(d)) % 24;

export function saludoSegunHora(d = new Date()): string {
  const h = horaLima(d);
  return h < 5 ? 'Buenas noches' : h < 12 ? 'Buenos días' : h < 19 ? 'Buenas tardes' : 'Buenas noches';
}

/** Nombre de pila, o null si la cuenta aún no tiene nombre (solo el correo). */
export function nombreDePila(nombre: string): string | null {
  const limpio = nombre.trim();
  if (!limpio || limpio.includes('@')) return null;
  return limpio.split(/\s+/)[0];
}

/** "hoy a las 23:20", "ayer a las 08:05", "el 20 de noviembre a las 10:05". */
export function cuandoFue(iso: string, ahora = new Date()): string {
  const d = new Date(iso);
  const hhmm = d.toLocaleTimeString('es-PE', { timeZone: LIMA, hour: '2-digit', minute: '2-digit', hour12: false });
  const dia = fechaISO(d);
  if (dia === fechaISO(ahora)) return `hoy a las ${hhmm}`;
  if (dia === fechaISO(new Date(ahora.getTime() - 864e5))) return `ayer a las ${hhmm}`;
  return `el ${d.toLocaleDateString('es-PE', { timeZone: LIMA, day: 'numeric', month: 'long' })} a las ${hhmm}`;
}

export function tituloSaludo(user: Sesion): string {
  const nombre = nombreDePila(user.nombre);
  const base = user.acceso_anterior ? saludoSegunHora() : 'Te damos la bienvenida a ARGOS';
  return nombre ? `${base}, ${nombre}` : base;
}

/** Lo más útil para el rol, con datos reales del backend. */
export function resumenParaRol(user: Sesion, eventos: TrafficEvent[], cargado: boolean): string {
  if (!cargado) return 'Consultando la actividad del punto de control…';
  if (puede.revisar(user.rol)) {
    const n = eventos.filter((e) => e.state === 'Pendiente').length;
    if (n === 0) return 'No hay eventos esperando dictamen. Todo al día.';
    return n === 1 ? 'Tienes 1 evento esperando tu dictamen.' : `Tienes ${n} eventos esperando tu dictamen.`;
  }
  const hoy = fechaISO(new Date());
  const n = eventos.filter((e) => e.date === hoy).length;
  if (n === 0) return 'Hoy todavía no se han registrado eventos.';
  return n === 1 ? 'Hoy se registró 1 evento.' : `Hoy se registraron ${n} eventos.`;
}
