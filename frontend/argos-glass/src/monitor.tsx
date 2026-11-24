import { useEffect, useRef, useState } from 'react';
import { useInterval } from './hooks';
import { hhmmss, reducirMovimiento, type LecturaRadar } from './radar';
import './monitor.css';

/** Cámara del punto de control: video en vivo con HUD, reloj y la última lectura del radar. */
export function CamaraEnVivo({ pausado, lectura, limite }: { pausado: boolean; lectura: LecturaRadar; limite: number }) {
  const video = useRef<HTMLVideoElement>(null);
  const [ahora, setAhora] = useState(() => new Date());
  useInterval(() => setAhora(new Date()), 1000, !pausado);

  useEffect(() => {
    const v = video.current;
    if (!v) return;
    if (pausado || reducirMovimiento()) v.pause();
    else void v.play().catch(() => { /* el navegador puede bloquear la reproducción automática */ });
  }, [pausado]);

  const exceso = lectura.velocidad > limite;
  return (
    <div className="camera-view mon-camara">
      <div className="reticle top-left" />
      <div className="reticle top-right" />
      <div className="reticle bottom-left" />
      <div className="reticle bottom-right" />

      <video
        ref={video} className="mon-video" src="/monitoreo.mp4" poster="/monitoreo.webp"
        muted loop playsInline autoPlay={!reducirMovimiento()} preload="auto" aria-label="Cámara CAM-01"
      />
      <div className="scanline" />

      <div className="cam-top">
        <div className="hud-pill">
          <span className={`live-dot ${pausado ? 'mon-detenido' : ''}`} />
          <b>CAM-01</b> · AV. PACÍFICO KM 4.2
        </div>
        <div className="glass-tag mon-reloj">{pausado ? 'EN PAUSA' : `● REC ${hhmmss(ahora)}`}</div>
      </div>

      <div className="cam-bottom">
        <div className="glass-tag">1080p · 30 FPS · HDR</div>
        {lectura.n > 0 && (
          <div key={lectura.n} className={`glass-tag mon-radar-tag ${exceso ? 'exceso' : ''}`}>
            RADAR {lectura.velocidad.toFixed(1)} km/h
          </div>
        )}
      </div>
    </div>
  );
}

/** Últimas lecturas como barras: rojas las que superan el límite. */
export function HistorialLecturas({ valores, limite }: { valores: number[]; limite: number }) {
  const max = Math.max(limite * 1.6, ...valores);
  return (
    <div className="mon-historial" aria-label="Últimas lecturas">
      {Array.from({ length: 16 }, (_, i) => valores[valores.length - 16 + i]).map((v, i) => (
        <span
          key={i}
          className={v == null ? 'vacia' : v > limite ? 'exceso' : ''}
          style={{ height: v == null ? '8%' : `${Math.max(8, (v / max) * 100)}%` }}
          title={v == null ? undefined : `${v.toFixed(1)} km/h`}
        />
      ))}
      <i style={{ bottom: `${(limite / max) * 100}%` }} />
    </div>
  );
}

