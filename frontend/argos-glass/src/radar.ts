import { useEffect, useState } from 'react';
import { useCountUp } from './hooks';

/*
 * Vista en vivo del punto de control (Monitoreo en tiempo real).
 * Demostración: el video es una grabación en bucle y las lecturas del radar se generan en el
 * navegador (no vienen del ESP32 ni se guardan). Cuando exista el agente real, este hook se
 * reemplaza por su telemetría. Los eventos de la tabla y del resto del panel sí son reales.
 */

export const reducirMovimiento = () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;

/** Velocidad plausible de un vehículo urbano: la mayoría bajo el límite, ~1 de cada 4 por encima. */
function nuevaLectura(limite: number) {
  const exceso = Math.random() < 0.27;
  const v = exceso ? limite + 1 + Math.random() * limite * 0.5 : limite * (0.55 + Math.random() * 0.42);
  return Math.round(v * 10) / 10;
}

export interface LecturaRadar {
  velocidad: number;
  hora: Date;
  historial: number[];
  /** 0 = sin corte · 1 = cortando barrera 1 · 2 = cortando barrera 2 */
  barrera: 0 | 1 | 2;
  n: number;
}

/** Ciclo por vehículo: corte de barrera 1 → (distancia / velocidad) → corte de barrera 2 → lectura. */
export function useRadarEnVivo(limite: number, distanciaM: number, activo: boolean): LecturaRadar {
  const [lectura, setLectura] = useState(() => ({
    velocidad: Math.round(limite * 0.82 * 10) / 10, hora: new Date(), historial: [] as number[], n: 0,
  }));
  const [barrera, setBarrera] = useState<0 | 1 | 2>(0);

  useEffect(() => {
    if (!activo) return;
    let timers: number[] = [];
    const ciclo = () => {
      timers = [];
      const v = nuevaLectura(limite);
      const dt = Math.max(140, Math.min(420, (distanciaM / (v / 3.6)) * 1000));
      setBarrera(1);
      timers.push(window.setTimeout(() => {
        setBarrera(2);
        setLectura((l) => ({ velocidad: v, hora: new Date(), historial: [...l.historial, v].slice(-16), n: l.n + 1 }));
      }, dt));
      timers.push(window.setTimeout(() => setBarrera(0), dt + 380));
      timers.push(window.setTimeout(ciclo, dt + 1500 + Math.random() * 2600));
    };
    timers.push(window.setTimeout(ciclo, 800));
    return () => timers.forEach((t) => window.clearTimeout(t));
  }, [limite, distanciaM, activo]);

  return { ...lectura, barrera };
}

export const hhmmss = (d: Date) => d.toLocaleTimeString('es-PE', { hour12: false, timeZone: 'America/Lima' });

/** Número del velocímetro: recorre suavemente desde la lectura anterior. */
export function useVelocidadAnimada(velocidad: number) {
  return useCountUp(velocidad, reducirMovimiento() ? 1 : 600, 1);
}

