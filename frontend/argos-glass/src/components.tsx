import type { ReactNode } from 'react';
import { LIMIT, type EventState, type TrafficEvent } from './data';
import { api } from './api';

const iconPaths: Record<string, string> = {
  dash: 'M4 4h6v6H4zm10 0h6v6h-6zM4 14h6v6H4zm10 0h6v6h-6z',
  monitor: 'M3 4h18a1 1 0 0 1 1 1v12a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1zm5 16h8m-4-2v2',
  events: 'M5 3h14a1 1 0 0 1 1 1v16a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1zm3 5h8m-8 4h8m-8 4h5',
  image: 'M3 4a1 1 0 0 1 1-1h16a1 1 0 0 1 1 1v16a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V4zm1 14 6-6 4 4 3-3 5 5M8.5 8.5a1 1 0 1 0 0-2 1 1 0 0 0 0 2z',
  review: 'M9 12l2 2 4-4m-3-7 8 3v6c0 5-8 9-8 9s-8-4-8-9V6z',
  reports: 'M4 20V10m6 10V4m6 10V8m6 12H2',
  device: 'M6 6h12v12H6zm3-4v4m6-4v4m-6 12v4m6-4v4M2 9h4m-4 6h4m12-6h4m-4 6h4',
  settings: 'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zm7.4-2.8a1 1 0 0 0 .2-1.1l-1.3-2.3a1 1 0 0 0-1-.5l-1.3.3a6.8 6.8 0 0 0-1.2-.7l-.4-1.3a1 1 0 0 0-.9-.7h-2.6a1 1 0 0 0-.9.7l-.4 1.3a6.8 6.8 0 0 0-1.2.7l-1.3-.3a1 1 0 0 0-1 .5L3.4 10a1 1 0 0 0 .2 1.1l1.1.9c0 .4 0 .7 0 1.1l-1.1.9a1 1 0 0 0-.2 1.1l1.3 2.3a1 1 0 0 0 1 .5l1.3-.3c.4.3.8.5 1.2.7l.4 1.3a1 1 0 0 0 .9.7h2.6a1 1 0 0 0 .9-.7l.4-1.3c.4-.2.8-.4 1.2-.7l1.3.3a1 1 0 0 0 1-.5l1.3-2.3a1 1 0 0 0-.2-1.1l-1.1-.9c0-.4 0-.7 0-1.1z',
  users: 'M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2m7-8a4 4 0 1 0 0-8 4 4 0 0 0 0 8zm11 8v-2a4 4 0 0 0-3-3.87m-4-7.87a4 4 0 0 1 0 7.75',
  arrow: 'M5 12h14m-6-6l6 6-6 6',
  bell: 'M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9zm-4.27 13a2 2 0 0 1-3.46 0',
  trendUp: 'M23 6l-9.5 9.5-5-5L1 18m22-12h-6m6 0v6',
  trendDown: 'M23 18l-9.5-9.5-5 5L1 6m22 12h-6m6 0v-6',
  car: 'M5 17h14M5 17a2 2 0 1 1-4 0 2 2 0 0 1 4 0zm14 0a2 2 0 1 1-4 0 2 2 0 0 1 4 0zm-15-5l2-6h12l2 6M2 12h20v5H2v-5z',
  check: 'M20 6L9 17l-5-5',
  edit: 'M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z',
  cross: 'M18 6L6 18M6 6l12 12',
  shield: 'M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z',
  speedometer: 'M12 14v-4m7.07-2.07A10 10 0 1 0 4.93 7.93m14.14 0a10 10 0 0 1 0 8.14M4.93 7.93a10 10 0 0 0 0 8.14',
  search: 'M21 21l-4.35-4.35M19 11a8 8 0 1 1-16 0 8 8 0 0 1 16 0z',
  calendar: 'M19 4H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6a2 2 0 0 0-2-2zM16 2v4M8 2v4M3 10h18',
  filter: 'M22 3H2l8 9.46V19l4 2v-8.54L22 3z',
  download: 'M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4m4-5l5 5 5-5m-5 5V3',
  hash: 'M4 9h16M4 15h16M10 3L8 21M16 3l-2 18',
  cpu: 'M4 4h16v16H4zm5-4v4m6-4v4m-6 16v4m6-4v4M0 9h4m-4 6h4m16-6h4m-4 6h4',
  signal: 'M2 20h2m4-4v4m6-8v8m6-12v12',
  camera: 'M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2zM12 17a4 4 0 1 0 0-8 4 4 0 0 0 0 8z',
  sparkle: 'M12 2l2.4 7.2L22 12l-7.6 2.8L12 22l-2.4-7.2L2 12l7.6-2.8z',
  printer: 'M6 9V2h12v7M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2m-12 0v4h12v-4',
};

export function Icon({ name }: { name: string }) {
  return (
    <svg className="icon-svg" viewBox="0 0 24 24" aria-hidden>
      <path d={iconPaths[name] ?? iconPaths.events} />
    </svg>
  );
}

export function Glass({ children, className = '', ...rest }: { children: ReactNode; className?: string } & React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={`glass-card ${className}`} {...rest}>
      <span className="glass-glare" aria-hidden />
      {children}
    </div>
  );
}

export function TrendPill({ value, up = true }: { value: string; up?: boolean }) {
  return (
    <span className={`trend-pill ${up ? 'up' : 'down'}`}>
      <svg viewBox="0 0 24 24" className="trend-icon"><path d={iconPaths[up ? 'trendUp' : 'trendDown']} /></svg>
      {value}
    </span>
  );
}

export function Badge({ state }: { state: EventState | string }) {
  const cls = state === 'Validado' ? 'valid' : state === 'Pendiente' ? 'pending' : state === 'alert' ? 'alert' : 'discard';
  return (
    <span className={`badge-pill ${cls}`}>
      <span className="b-dot" />
      {state}
    </span>
  );
}

export function Heading({ title, sub, actions }: { title: string; sub: string; actions?: ReactNode }) {
  return (
    <div className="dash-heading">
      <div>
        <div className="eyebrow-tag">
          <span className="live-dot-pulse" /> SISTEMA DE CONTROL VIAL · NUEVO CHIMBOTE
        </div>
        <h1>{title}</h1>
        <p className="subtitle">{sub}</p>
      </div>
      {actions && <div className="actions">{actions}</div>}
    </div>
  );
}

export function Sparkline({ color = '#3b82f6', up = true }: { color?: string; up?: boolean }) {
  const d = up
    ? 'M0 24 C15 22, 25 18, 40 14 C55 10, 65 15, 80 8 C95 2, 105 10, 120 4'
    : 'M0 6 C15 8, 25 14, 40 12 C55 18, 65 16, 80 20 C95 24, 105 22, 120 26';
  return (
    <svg className="sparkline-svg" viewBox="0 0 120 30" aria-hidden>
      <defs>
        <linearGradient id={`spark-${color}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.35" />
          <stop offset="100%" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={`${d} L120 30 L0 30 Z`} fill={`url(#spark-${color})`} />
      <path d={d} fill="none" stroke={color} strokeWidth="2.2" strokeLinecap="round" />
    </svg>
  );
}

export function PlateTag({ plate, big = false }: { plate: string; big?: boolean }) {
  return (
    <div className={`plate-badge ${big ? 'big' : ''}`}>
      <span className="plate-screw top-left" aria-hidden />
      <span className="plate-screw top-right" aria-hidden />
      <span className="plate-screw bottom-left" aria-hidden />
      <span className="plate-screw bottom-right" aria-hidden />
      <div className="plate-header">
        <div className="peru-brand">
          <span className="peru-flag" aria-hidden />
          <span className="peru-tag">PERÚ</span>
        </div>
        <span className="hologram-chip" title="Sello holográfico de seguridad MTC" />
      </div>
      <div className="plate-num">{plate}</div>
    </div>
  );
}

export function Road({ ev, frame = 0, photoId }: { ev: TrafficEvent; frame?: number; photoId?: number | null }) {
  // Evidencia real: el backend la entrega solo si su SHA-256 coincide con el registrado
  const foto = photoId !== undefined ? photoId : ev.photoId;
  if (foto != null) {
    return (
      <img
        src={api.urlEvidencia(foto)}
        alt={`Evidencia fotográfica del evento ${ev.shortId}`}
        className="road-svg"
        loading="lazy"
        style={{ display: 'block', width: '100%', height: '100%', objectFit: 'cover', background: '#0b1329' }}
      />
    );
  }
  const offset = frame * 12;
  return (
    <svg viewBox="0 0 800 390" role="img" aria-label="Simulación de radar vial y vehículo" className="road-svg">
      <defs>
        <linearGradient id="skyGrad" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#0b1329" />
          <stop offset="60%" stopColor="#1e293b" />
          <stop offset="100%" stopColor="#334155" />
        </linearGradient>
        <linearGradient id="roadGrad" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#1e293b" />
          <stop offset="100%" stopColor="#0a0f1d" />
        </linearGradient>
        <linearGradient id="carPaint" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#f8fafc" />
          <stop offset="50%" stopColor="#94a3b8" />
          <stop offset="100%" stopColor="#475569" />
        </linearGradient>
        <radialGradient id="sunGlow" cx="0.85" cy="0.15" r="0.6">
          <stop offset="0%" stopColor="#38bdf8" stopOpacity="0.3" />
          <stop offset="100%" stopColor="#38bdf8" stopOpacity="0" />
        </radialGradient>
      </defs>
      <rect width="800" height="390" fill="url(#skyGrad)" />
      <rect width="800" height="390" fill="url(#sunGlow)" />
      <path d="M0 180V90h45v90h30V65h85v115h30V80h90v100h160V75h95v105h25V70h110v110h90v210H0z" fill="#0f172a" opacity="0.75" />
      <path d="M0 186h260L100 390H0zm800 0H510l180 204h110" fill="#1e293b" opacity="0.85" />
      <path d="M290 166h200L760 390H45z" fill="url(#roadGrad)" />
      <path d="M345 167h4L220 390h-16zm95 0h4l120 223h-16z" fill="#f8fafc" opacity="0.9" />
      <path d="M397 178h5v22h-6zm-2 39h7v35h-9zm-5 64h11v60h-14z" fill="#facc15" opacity="0.95" />

      {/* Vehículo en movimiento */}
      <g transform={`translate(${offset} 0)`}>
        <ellipse cx="510" cy="305" rx="76" ry="15" fill="#000" opacity="0.45" />
        <path d="M445 238l16-52c3-10 12-11 24-11h58c12 0 20 2 24 11l17 52 6 48H438z" fill="url(#carPaint)" />
        <path d="M468 186h72l12 45H456z" fill="#0a0f1d" />
        <path d="M472 190l40 38h14l-38-38z" fill="#ffffff" opacity="0.25" />
        <path d="M444 246h134v32H444z" fill="#334155" />
        <rect x="444" y="284" width="24" height="18" rx="4" fill="#0a0f1d" />
        <rect x="554" y="284" width="24" height="18" rx="4" fill="#0a0f1d" />
        <path d="M446 253h26v8h-26zm106 0h26v8h-26z" fill="#ef4444" />
        
        {/* Placa patente */}
        <rect x="488" y="262" width="46" height="15" rx="3" fill="#ffffff" stroke="#94a3b8" strokeWidth="1" />
        <text x="511" y="273" fontSize="9.5" fontWeight="800" fontFamily="monospace" textAnchor="middle" fill="#0a0f1d" letterSpacing="1">
          {ev.originalPlate}
        </text>
      </g>
    </svg>
  );
}

export function Camera({ ev, frame, zoom, photoId }: { ev: TrafficEvent; frame: number; zoom?: boolean; photoId?: number | null }) {
  return (
    <div className={`camera-view ${zoom ? 'zoomed' : ''}`}>
      <div className="reticle top-left" />
      <div className="reticle top-right" />
      <div className="reticle bottom-left" />
      <div className="reticle bottom-right" />

      <div className="cam-top">
        <div className="hud-pill">
          <span className="live-dot" />
          <b>CAM-01</b> · AV. PACÍFICO KM 4.2
        </div>
        <div className="glass-tag">
          {ev.dateLabel.toUpperCase()} · {ev.time}
        </div>
      </div>

      <Road ev={ev} frame={frame} photoId={photoId} />
      <div className="scanline" />

      <div className="cam-bottom">
        <div className="glass-tag">LENTE 50mm HDR · BARRERA FOTOELÉCTRICA</div>
        <div className="glass-tag">{(photoId ?? ev.photoId) != null ? 'FIRMA SHA-256 VALIDADA ✓' : 'SIN EVIDENCIA FOTOGRÁFICA'}</div>
      </div>
    </div>
  );
}

/** Gráfico de Doble Curva estilo Dashboard V5 (Flujo vehicular y Velocidades) */
export function ModernAreaChart() {
  const points: [string, number, number][] = [
    ['06:00', 32, 110],
    ['08:00', 58, 280],
    ['10:00', 63, 340],
    ['12:00', 44, 210],
    ['14:00', 56, 260],
    ['16:00', 61, 310],
    ['18:00', 49, 290],
    ['20:00', 38, 140],
  ];

  const w = 680, h = 230, padX = 40, padY = 25;
  const maxSpd = 80;
  const stepX = (w - padX * 2) / (points.length - 1);

  const getSpdY = (spd: number) => h - padY - (spd / maxSpd) * (h - padY * 2);
  const limitY = getSpdY(LIMIT);

  const spdCoords = points.map((p, i) => [padX + i * stepX, getSpdY(p[1])]);
  const spdPath = 'M ' + spdCoords.map((c) => `${c[0]},${c[1]}`).join(' L ');
  const spdArea = `${spdPath} L ${spdCoords[spdCoords.length - 1][0]},${h - padY} L ${spdCoords[0][0]},${h - padY} Z`;

  return (
    <svg className="modern-chart-svg" viewBox={`0 0 ${w} ${h}`} role="img" aria-label="Analítica de flujo y velocidad">
      <defs>
        <linearGradient id="spdGrad" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#3b82f6" stopOpacity="0.45" />
          <stop offset="60%" stopColor="#3b82f6" stopOpacity="0.1" />
          <stop offset="100%" stopColor="#3b82f6" stopOpacity="0" />
        </linearGradient>
        <linearGradient id="lineGrad" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%" stopColor="#60a5fa" />
          <stop offset="50%" stopColor="#3b82f6" />
          <stop offset="100%" stopColor="#8b5cf6" />
        </linearGradient>
      </defs>

      {/* Guías horizontales discretas */}
      {[20, 40, 60, 80].map((v) => {
        const y = getSpdY(v);
        return (
          <g key={v}>
            <line x1={padX} y1={y} x2={w - padX} y2={y} stroke="rgba(148, 163, 184, 0.15)" strokeDasharray="3 3" />
            <text x={padX - 8} y={y + 3.5} textAnchor="end" fontSize="10" fill="#94a3b8" fontFamily="inherit">{v}</text>
          </g>
        );
      })}

      {/* Línea de límite vial */}
      <line x1={padX} y1={limitY} x2={w - padX} y2={limitY} stroke="#ef4444" strokeWidth="1.5" strokeDasharray="4 4" opacity="0.85" />
      <text x={w - padX - 4} y={limitY - 8} textAnchor="end" fontSize="10" fill="#ef4444" fontWeight="700">Límite {LIMIT} km/h</text>

      {/* Relleno translúcido de cristal */}
      <path d={spdArea} fill="url(#spdGrad)" />
      <path d={spdPath} fill="none" stroke="url(#lineGrad)" strokeWidth="3.2" strokeLinecap="round" strokeLinejoin="round" />

      {/* Puntos destacados con resplandor */}
      {points.map((p, i) => {
        const [cx, cy] = spdCoords[i];
        const isExcess = p[1] > LIMIT;
        return (
          <g key={i}>
            <circle cx={cx} cy={cy} r={isExcess ? 5.5 : 4} fill={isExcess ? '#ef4444' : '#3b82f6'} stroke="#ffffff" strokeWidth="2" />
          </g>
        );
      })}

      {/* Etiquetas Eje X */}
      {points.map((p, i) => (
        <text key={p[0]} x={padX + i * stepX} y={h - 6} textAnchor="middle" fontSize="10.5" fill="#94a3b8" fontFamily="inherit">{p[0]}</text>
      ))}
    </svg>
  );
}

/** Velocímetro estilo Glasssy Dashboard V5 */
export function Gauge({ speed = 58, limit = LIMIT }: { speed?: number; limit?: number }) {
  const max = Math.max(80, limit * 2);
  const k = Math.min(1, Math.max(0, speed / max));
  const arcLength = Math.PI * 96;
  const isOver = speed > limit;

  return (
    <div className={`gauge-box ${isOver ? 'over' : ''}`}>
      <div className="gauge-dial">
        <svg viewBox="0 0 240 145">
          <defs>
            <linearGradient id="gaugeArc" x1="0" y1="0" x2="1" y2="0">
              <stop offset="0%" stopColor="#10b981" />
              <stop offset="50%" stopColor="#f59e0b" />
              <stop offset="100%" stopColor="#ef4444" />
            </linearGradient>
            <radialGradient id="gaugeCenterGlow" cx="0.5" cy="0.9" r="0.8">
              <stop offset="0%" stopColor={isOver ? 'rgba(239, 68, 68, 0.25)' : 'rgba(59, 130, 246, 0.2)'} />
              <stop offset="100%" stopColor="transparent" />
            </radialGradient>
          </defs>

          <rect width="240" height="145" fill="url(#gaugeCenterGlow)" />
          <path d="M24 130 A 96 96 0 0 1 216 130" fill="none" stroke="rgba(148, 163, 184, 0.16)" strokeWidth="14" strokeLinecap="round" />
          <path
            d="M24 130 A 96 96 0 0 1 216 130"
            fill="none"
            stroke="url(#gaugeArc)"
            strokeWidth="14"
            strokeLinecap="round"
            strokeDasharray={arcLength}
            strokeDashoffset={arcLength * (1 - k)}
          />
          <line x1="120" y1="18" x2="120" y2="38" stroke="#ef4444" strokeWidth="2.5" strokeLinecap="round" />
        </svg>

        <div className="g-center">
          <span className="g-val-num">{speed}</span>
          <span className="g-unit">km/h</span>
        </div>
      </div>
      <div className="g-sub">Punto de Control Av. Pacífico</div>
    </div>
  );
}

export function Bars({ labels, values }: { labels: string[]; values: number[] }) {
  return (
    <div className="glass-bars">
      {labels.map((l, i) => (
        <div key={l} className="g-bar-col">
          <div className="g-bar-track">
            <div className="g-bar-fill" style={{ height: `${values[i]}%` }}>
              <span className="g-bar-val">{values[i]}</span>
            </div>
          </div>
          <span className="g-bar-label">{l}</span>
        </div>
      ))}
    </div>
  );
}

export function AuditTimeline({ items }: { items: { time: string; title: string; desc: string; icon: string; verified?: boolean }[] }) {
  return (
    <div className="crypto-timeline">
      {items.map((it, idx) => (
        <div key={idx} className="timeline-step">
          <div className="timeline-node">
            <span className="node-icon"><Icon name={it.icon} /></span>
            {idx < items.length - 1 && <span className="node-stem" />}
          </div>
          <div className="timeline-content">
            <div className="timeline-meta">
              <span className="timeline-time">{it.time}</span>
              {it.verified && <span className="timeline-seal">SHA-256 ✓</span>}
            </div>
            <strong className="timeline-title">{it.title}</strong>
            <p className="timeline-desc">{it.desc}</p>
          </div>
        </div>
      ))}
    </div>
  );
}

export function EventTable({
  list,
  full = false,
  onOpen,
  onSort,
}: {
  list: TrafficEvent[];
  full?: boolean;
  onOpen: (id: string) => void;
  onSort?: () => void;
}) {
  return (
    <div className="table-responsive">
      <table className="glass-table">
        <thead>
          <tr>
            <th><div className="th-cell"><Icon name="hash" /> ID Evento</div></th>
            <th><div className="th-cell"><Icon name="calendar" /> Hora</div></th>
            <th>
              <div className="th-cell cursor-pointer" onClick={onSort}>
                <Icon name="speedometer" /> Velocidad
                {onSort && <span className="sort-indicator">↕</span>}
              </div>
            </th>
            <th><div className="th-cell">Límite</div></th>
            {full && <th><div className="th-cell">Exceso</div></th>}
            <th><div className="th-cell"><Icon name="camera" /> Placa Registrada</div></th>
            <th><div className="th-cell"><Icon name="sparkle" /> Confianza AI</div></th>
            {full && <th><div className="th-cell"><Icon name="cpu" /> Inferencia</div></th>}
            <th><div className="th-cell"><Icon name="shield" /> Dictamen</div></th>
            <th style={{ textAlign: 'right' }}><div className="th-cell justify-end">Acción</div></th>
          </tr>
        </thead>
        <tbody>
          {list.length === 0 && (
            <tr>
              <td colSpan={10} className="empty-cell">
                <div className="empty-state-box">
                  <span className="empty-icon"><Icon name="search" /></span>
                  <p>No se encontraron infracciones con los filtros seleccionados.</p>
                </div>
              </td>
            </tr>
          )}
          {list.map((e) => {
            const isExcess = e.speed > e.limit;
            return (
              <tr key={e.id} onClick={() => onOpen(e.id)} className="table-row-hover">
                <td>
                  <div className="event-cell">
                    <span className="event-icon"><Icon name="car" /></span>
                    <div>
                      <span className="event-tag" title={e.id}>{e.shortId}</span>
                      <small className="cam-sub">CAM-01</small>
                    </div>
                  </div>
                </td>
                <td>
                  <div className="time-block">
                    <span className="time-date">{e.dateLabel}</span>
                    <strong className="time-clock">{e.time}</strong>
                  </div>
                </td>
                <td>
                  <div className={`speed-pill ${isExcess ? 'excess' : 'normal'}`}>
                    <span className="speed-val">{e.speed}</span>
                    <span className="speed-unit">km/h</span>
                  </div>
                </td>
                <td>
                  <span className="limit-tag">{e.limit} km/h</span>
                </td>
                {full && (
                  <td>
                    <span className="excess-delta-tag">+{(e.speed - e.limit).toFixed(1)} km/h</span>
                  </td>
                )}
                <td>
                  <PlateTag plate={e.plate} />
                </td>
                <td>
                  <div className="ai-score-cell">
                    <div className="ai-score-track">
                      <span
                        className="ai-score-fill"
                        style={{
                          width: `${e.confidence}%`,
                          background: e.confidence >= 80 ? 'linear-gradient(90deg, #06b6d4, #10b981)' : 'linear-gradient(90deg, #f59e0b, #3b82f6)',
                        }}
                      />
                    </div>
                    <span className="ai-score-text">{e.confidence.toFixed(1)}%</span>
                  </div>
                </td>
                {full && (
                  <td>
                    <span className="ai-engine-chip">
                      <span className="ai-pulse-dot" /> YOLOv8
                    </span>
                  </td>
                )}
                <td>
                  <Badge state={e.state} />
                </td>
                <td style={{ textAlign: 'right' }}>
                  <button className="row-action-btn" aria-label={`Inspeccionar ${e.shortId}`} id={`open-${e.id}`}>
                    <Icon name="arrow" />
                  </button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
