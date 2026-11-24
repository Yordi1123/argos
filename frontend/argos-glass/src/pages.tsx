import { useMemo, useState } from 'react';
import { LIMIT, STATES, type EventState, type Page, type TrafficEvent } from './data';
import { puede, REVISABLES, type Auditoria, type EventoDetalle, type Sesion } from './api';
import { cuandoFue, resumenParaRol, tituloSaludo } from './saludo';
import { AuditTimeline, Badge, Bars, Camera, EventTable, Gauge, Glass, Heading, Icon, ModernAreaChart, PlateTag, Road, Sparkline, TrendPill } from './components';
import { PanelVision } from './vision';
import { CamaraEnVivo, HistorialLecturas } from './monitor';
import { hhmmss, useRadarEnVivo, useVelocidadAnimada } from './radar';

export interface Ctx {
  events: TrafficEvent[];
  selected: number;
  /** Detalle completo (evidencias, análisis, revisiones, auditoría) del evento seleccionado. */
  detail: EventoDetalle | null;
  loaded: boolean;
  online: boolean;
  /** Persona con la sesión abierta. Las páginas del panel solo se muestran con sesión. */
  user: Sesion;
  go: (p: Page) => void;
  open: (id: string) => void;
  toast: (t: string) => void;
  frame: number;
  setFrame: (n: number) => void;
  paused: boolean;
  setPaused: (b: boolean) => void;
  sortSpeed: () => void;
  exportCSV: (list: TrafficEvent[]) => void;
  commit: (action: string, plate: string, notes: string) => Promise<boolean>;
  reset: () => Promise<void>;
}

const count = (ev: TrafficEvent[], s: EventState) => ev.filter((e) => e.state === s).length;
const STATE_COLOR: Record<EventState, string> = {
  Validado: '#10b981', Pendiente: '#f59e0b', Descartado: '#94a3b8', 'No verificable': '#64748b', 'En análisis': '#3b82f6',
};

/** Mensaje cuando aún no hay eventos (backend vacío o sin conexión). */
function NoEvents({ c, title }: { c: Ctx; title: string }) {
  return (
    <>
      <Heading title={title} sub="Sin eventos registrados todavía." />
      <Glass>
        <div className="empty-state-box">
          <span className="empty-icon"><Icon name="search" /></span>
          <p>
            {!c.online ? 'No hay conexión con el servidor ARGOS.'
              : !c.loaded ? 'Cargando eventos…'
              : 'Aún no hay eventos. Se mostrarán aquí cuando el agente de captura registre el primero.'}
          </p>
        </div>
      </Glass>
    </>
  );
}

const ACCION_TITULO: Record<string, string> = {
  EVENTO_REGISTRADO: 'Evento registrado por el agente de captura',
  CAMBIO_ESTADO: 'Cambio de estado',
  ANALISIS_FALLIDO: 'Intento de análisis fallido',
};
function auditIcon(a: Auditoria) {
  if (a.accion === 'EVENTO_REGISTRADO') return 'device';
  if (a.accion === 'ANALISIS_FALLIDO') return 'cross';
  if (a.estado_nuevo === 'ANALIZADO' || a.estado_nuevo === 'EN_REVISION') return 'cpu';
  return 'shield';
}

/* ---------------- Dashboard V5 Style ---------------- */
export function Dashboard({ c }: { c: Ctx }) {
  const v = count(c.events, 'Validado'), p = count(c.events, 'Pendiente'), total = c.events.length;
  const denom = total || 1;
  const nv = count(c.events, 'Descartado') + count(c.events, 'No verificable');
  const peak = c.events.reduce((m, e) => Math.max(m, e.speed), 0);
  const avgSpd = total ? c.events.reduce((a, e) => a + e.speed, 0) / total : 0;
  const [chartTab, setChartTab] = useState<'hoy' | 'semana' | 'mes'>('hoy');
  const [primerosPasosVisto, setPrimerosPasosVisto] = useState(false);

  const kpis = [
    { title: 'Vehículos Supervisados', val: '1,284', sub: 'Aforo diario registrado', trend: '+14.2%', up: true, icon: 'car', page: 'monitor' as Page, color: '#3b82f6', hex: 'blue' },
    { title: 'Infracciones Detectadas', val: String(total), sub: 'Eventos registrados por el sistema', trend: '-2.4%', up: false, icon: 'speedometer', page: 'events' as Page, color: '#ef4444', hex: 'red' },
    { title: 'Pendientes de Revisión', val: String(p), sub: 'Requieren arbitraje pericial', trend: '+5.0%', up: true, icon: 'shield', page: 'review' as Page, color: '#f59e0b', hex: 'amber' },
    { title: 'Evidencias Validadas', val: String(v), sub: 'Dictámenes concluidos', trend: '+18.6%', up: true, icon: 'check', page: 'reports' as Page, color: '#10b981', hex: 'emerald' },
  ];

  return (
    <>
      <Heading
        title={tituloSaludo(c.user)}
        sub={
          <>
            {resumenParaRol(c.user, c.events, c.loaded)}
            {c.user.acceso_anterior && (
              <span className="dash-ultimo-acceso" title="Si no reconoces este ingreso, cambia tu contraseña">
                {' '}Tu último ingreso fue {cuandoFue(c.user.acceso_anterior)}.
              </span>
            )}
          </>
        }
        actions={
          <div className="dash-actions">
            <button id="btn-see-events" className="glass-btn" onClick={() => c.go('events')}>
              <Icon name="events" /> Ver Registros
            </button>
            <button id="btn-open-monitor" className="primary-glass-btn" onClick={() => c.go('monitor')}>
              <Icon name="monitor" /> Monitoreo en Vivo ↗
            </button>
          </div>
        }
      />

      {!c.user.acceso_anterior && puede.administrar(c.user.rol) && !primerosPasosVisto && (
        <Glass className="dash-primeros-pasos" role="note">
          <span className="dash-pp-icono"><Icon name="users" /></span>
          <div>
            <b>Primeros pasos</b>
            <p>Crea las cuentas de tu equipo para que puedan revisar eventos. Cada persona recibirá una contraseña temporal.</p>
          </div>
          <button className="primary-glass-btn" onClick={() => c.go('users')}>Crear cuentas</button>
          <button className="glass-btn sm" onClick={() => setPrimerosPasosVisto(true)}>Ahora no</button>
        </Glass>
      )}

      {/* Fila de 4 KPI Cards estilo Glasssy V5 con Sparklines */}
      <div className="v5-kpi-grid">
        {kpis.map((k) => (
          <Glass key={k.title} className="v5-kpi-card" onClick={() => c.go(k.page)}>
            <div className="kpi-header">
              <div className={`kpi-icon-wrap icon-${k.hex}`}>
                <Icon name={k.icon} />
              </div>
              <TrendPill value={k.trend} up={k.up} />
            </div>
            <div className="kpi-body">
              <span className="kpi-title">{k.title}</span>
              <strong className="kpi-value">{k.val}</strong>
              <small className="kpi-sub">{k.sub}</small>
            </div>
            <div className="kpi-sparkline-box">
              <Sparkline color={k.color} up={k.up} />
            </div>
          </Glass>
        ))}
      </div>

      {/* Grid Principal: Gráfico Analítico V5 + Donut de Distribución */}
      <div className="v5-analytics-grid">
        <Glass className="v5-chart-card">
          <div className="chart-card-header">
            <div>
              <h2>Analítica de Tránsito y Velocidades</h2>
              <small className="muted">Monitoreo continuo en Av. Pacífico · UPIS Belén</small>
            </div>
            <div className="chart-tabs">
              {(['hoy', 'semana', 'mes'] as const).map((t) => (
                <button
                  key={t}
                  className={`tab-btn ${chartTab === t ? 'active' : ''}`}
                  onClick={() => setChartTab(t)}
                >
                  {t.toUpperCase()}
                </button>
              ))}
            </div>
          </div>

          <div className="chart-stat-chips">
            <div className="stat-chip">
              <small>Velocidad Pico</small>
              <b>{peak} km/h</b>
            </div>
            <div className="stat-chip">
              <small>Velocidad Promedio</small>
              <b>{avgSpd.toFixed(1)} km/h</b>
            </div>
            <div className="stat-chip">
              <small>Tasa de Cumplimiento</small>
              <b className="tick">98.1%</b>
            </div>
          </div>

          <ModernAreaChart />

          <div className="chart-legend-v5">
            <div className="legend-item">
              <span className="legend-dot blue" />
              <span>Velocidad promedio registrada (km/h)</span>
            </div>
            <div className="legend-item">
              <span className="legend-dot red" />
              <span>Umbral infractor (Límite {LIMIT} km/h)</span>
            </div>
          </div>
        </Glass>

        {/* Widget Donut Glasssy V5 */}
        <Glass className="v5-donut-card">
          <div className="card-top-row">
            <h2>Resolución Pericial</h2>
            <span className="tag-pill">{total} Eventos</span>
          </div>
          <small className="muted">Estado de evidencias del día de hoy</small>

          <div className="donut-wrap">
            <div
              className="glass-donut"
              style={{
                background: `conic-gradient(#10b981 0 ${v / denom * 100}%, #f59e0b 0 ${(v + p) / denom * 100}%, #94a3b8 0 ${(v + p + nv) / denom * 100}%, #3b82f6 0)`,
              }}
            >
              <div className="donut-inner">
                <span className="donut-count">{total}</span>
                <span className="donut-label">Total</span>
              </div>
            </div>
          </div>

          <div className="donut-stats-list">
            {STATES.map((s) => {
              const cnt = count(c.events, s);
              const pct = ((cnt / denom) * 100).toFixed(0);
              return (
                <div key={s} className="stat-row">
                  <div className="stat-row-left">
                    <Badge state={s} />
                  </div>
                  <div className="stat-progress-bar">
                    <span
                      style={{
                        width: `${pct}%`,
                        background: STATE_COLOR[s],
                      }}
                    />
                  </div>
                  <span className="stat-count">{cnt}</span>
                </div>
              );
            })}
          </div>
        </Glass>
      </div>

      {/* Fila Inferior: Tabla Glasssy V5 */}
      <Glass className="v5-table-card">
        <div className="table-card-header">
          <div>
            <h2>Actividad Reciente en Vía</h2>
            <small className="muted">Últimos vehículos con exceso de velocidad captados por radar óptico</small>
          </div>
          <button className="glass-btn sm" onClick={() => c.go('events')}>
            Ver todas las infracciones →
          </button>
        </div>
        <EventTable list={c.events.slice(0, 5)} onOpen={c.open} onSort={c.sortSpeed} />
      </Glass>
    </>
  );
}

/* ---------------- Filtros de Diseño Glasssy Suite ---------------- */
interface Filters { search: string; state: string; min: string; date: string }
function useFilters(events: TrafficEvent[]) {
  const [f, setF] = useState<Filters>({ search: '', state: 'Todos', min: '', date: '' });
  const list = useMemo(() => events.filter((e) =>
    (e.plate + ' ' + e.shortId + ' ' + e.id).toLowerCase().includes(f.search.toLowerCase()) &&
    (f.state === 'Todos' || e.state === f.state) &&
    (!f.min || e.speed >= +f.min) &&
    (!f.date || e.date === f.date)), [events, f]);
  return { f, setF, list };
}

function FilterBar({ f, setF }: { f: Filters; setF: (f: Filters) => void }) {
  const isFiltered = f.search !== '' || f.state !== 'Todos' || f.min !== '' || f.date !== '';
  return (
    <div className="filters-suite">
      <div className="filter-field search-field">
        <span className="field-icon"><Icon name="search" /></span>
        <input
          id="search"
          type="search"
          placeholder="Buscar placa (ej: B8K-173) o ID..."
          value={f.search}
          onChange={(e) => setF({ ...f, search: e.target.value })}
        />
        {f.search && (
          <button className="field-clear-btn" onClick={() => setF({ ...f, search: '' })}>✕</button>
        )}
      </div>

      <div className="filter-field date-field">
        <span className="field-icon"><Icon name="calendar" /></span>
        <input
          id="filter-date"
          aria-label="Fecha"
          type="date"
          value={f.date}
          onChange={(e) => setF({ ...f, date: e.target.value })}
        />
      </div>

      <div className="filter-field speed-field">
        <span className="field-icon"><Icon name="speedometer" /></span>
        <input
          id="filter-min"
          aria-label="Velocidad mínima"
          type="number"
          placeholder="Mínimo"
          value={f.min}
          onChange={(e) => setF({ ...f, min: e.target.value })}
        />
        <span className="field-suffix">km/h</span>
      </div>

      <div className="filter-field select-field">
        <span className="field-icon"><Icon name="filter" /></span>
        <select
          id="filter-state"
          aria-label="Estado"
          value={f.state}
          onChange={(e) => setF({ ...f, state: e.target.value })}
        >
          {['Todos', ...STATES].map((s) => (
            <option key={s} value={s}>{s === 'Todos' ? 'Estado: Todos' : `Estado: ${s}`}</option>
          ))}
        </select>
      </div>

      <div className="filter-field select-field">
        <span className="field-icon"><Icon name="camera" /></span>
        <select aria-label="Cámara">
          <option>CAM-01 · Av. Pacífico</option>
        </select>
      </div>

      {isFiltered && (
        <button
          className="filter-reset-pill"
          onClick={() => setF({ search: '', state: 'Todos', min: '', date: '' })}
        >
          <Icon name="cross" /> Limpiar
        </button>
      )}
    </div>
  );
}

function Paged({ list, c }: { list: TrafficEvent[]; c: Ctx }) {
  const [offset, setOffset] = useState(0);
  const pageSize = 8;
  const o = offset >= list.length ? 0 : offset;
  const currentEvents = list.slice(o, o + pageSize);
  const totalPages = Math.ceil(list.length / pageSize) || 1;
  const currentPage = Math.floor(o / pageSize) + 1;

  return (
    <>
      <EventTable list={currentEvents} full onOpen={c.open} onSort={c.sortSpeed} />
      <div className="v5-pagination-bar">
        <div className="pagination-info">
          <span className="info-chip">
            Mostrando <b>{list.length === 0 ? 0 : o + 1}–{Math.min(o + pageSize, list.length)}</b> de <b>{list.length}</b> eventos registrados
          </span>
        </div>
        <div className="pagination-controls">
          <button
            className="pag-btn"
            disabled={o === 0}
            onClick={() => setOffset(Math.max(0, o - pageSize))}
          >
            ← Anterior
          </button>
          <div className="pag-pills">
            {Array.from({ length: totalPages }).map((_, idx) => (
              <button
                key={idx}
                className={`pag-num-btn ${currentPage === idx + 1 ? 'active' : ''}`}
                onClick={() => setOffset(idx * pageSize)}
              >
                {idx + 1}
              </button>
            ))}
          </div>
          <button
            className="pag-btn"
            disabled={o + pageSize >= list.length}
            onClick={() => setOffset(o + pageSize)}
          >
            Siguiente →
          </button>
        </div>
      </div>
    </>
  );
}

export function EventsPage({ c }: { c: Ctx }) {
  const { f, setF, list } = useFilters(c.events);
  const v = count(list, 'Validado'), p = count(list, 'Pendiente');
  const maxSpd = list.reduce((m, e) => Math.max(m, e.speed), 0);

  return (
    <>
      <Heading
        title="Eventos Detectados"
        sub="Historial completo de infracciones viales con metadatos periciales y firmas digitales."
        actions={
          <div className="actions">
            <button className="primary-glass-btn" onClick={() => c.exportCSV(list)}>
              <Icon name="download" /> Exportar CSV
            </button>
          </div>
        }
      />

      {/* Mini resumen de la consulta filtrada */}
      <div className="events-quick-stats">
        <div className="stat-pill">
          <small>Total Registros</small>
          <b>{list.length}</b>
        </div>
        <div className="stat-pill pending">
          <small>Por Revisar</small>
          <b>{p}</b>
        </div>
        <div className="stat-pill valid">
          <small>Validados</small>
          <b>{v}</b>
        </div>
        <div className="stat-pill max">
          <small>Velocidad Máxima</small>
          <b>{maxSpd || 0} km/h</b>
        </div>
      </div>

      <Glass>
        <FilterBar f={f} setF={setF} />
        <Paged list={list} c={c} />
      </Glass>
    </>
  );
}

export function Evidence({ c }: { c: Ctx }) {
  const { f, setF, list } = useFilters(c.events);
  const [grid, setGrid] = useState(true);
  return (
    <>
      <Heading
        title="Biblioteca de Evidencias"
        sub="Fotogramas originales, recortes de placa y análisis periciales de cada infracción."
        actions={<button className="glass-btn" onClick={() => setGrid(!grid)}>{grid ? 'Vista de tabla' : 'Vista de cuadrícula'}</button>}
      />
      <Glass className="slim">
        <FilterBar f={f} setF={setF} />
      </Glass>
      {grid ? (
        <div className="evidence-grid">
          {list.length === 0 && <div className="empty-cell">Sin evidencias para estos filtros.</div>}
          {list.map((e) => (
            <Glass key={e.id} className="evidence-card" onClick={() => c.open(e.id)}>
              <div className="card-thumb">
                <Road ev={e} />
                <span className="card-lens-badge"><Icon name="camera" /> {e.photoId != null ? 'Foto verificada' : 'Sin foto'}</span>
                <span className="card-conf-chip"><Icon name="sparkle" /> {e.confidence.toFixed(1)}% OCR</span>
              </div>
              <div className="card-info">
                <div className="info-top">
                  <div>
                    <span className="event-tag" title={e.id}>{e.shortId}</span>
                    <small className="cam-sub">Sesión {e.estado === 'EN_REVISION' ? 'en revisión' : e.dateLabel}</small>
                  </div>
                  <Badge state={e.state} />
                </div>
                <div className="info-plate">
                  <PlateTag plate={e.plate} />
                </div>
                <div className="info-meta-chips">
                  <span className="meta-chip"><Icon name="calendar" /> {e.time}</span>
                  <span className="meta-chip speed">{e.speed} km/h</span>
                  <span className="excess-delta-tag">+{(e.speed - e.limit).toFixed(1)}</span>
                </div>
                <div className="card-action-bar">
                  <span className="open-link">Abrir expediente pericial →</span>
                </div>
              </div>
            </Glass>
          ))}
        </div>
      ) : (
        <Glass><Paged list={list} c={c} /></Glass>
      )}
    </>
  );
}

/* ---------------- Detección de placas (prueba del modelo con una foto) ---------------- */
export function DeteccionPlacas({ c }: { c: Ctx }) {
  return (
    <>
      <Heading
        title="Detección de Placas"
        sub="Sube la foto de un vehículo: YOLOv11s busca la placa y el OCR intenta leerla. Es solo una prueba: no crea eventos ni guarda la imagen."
      />
      <PanelVision toast={c.toast} />
    </>
  );
}

/* ---------------- Monitor en Vivo ---------------- */
export function Monitor({ c }: { c: Ctx }) {
  const ev = c.events[c.selected] ?? c.events[0];
  const d = ev && c.detail?.id === ev.id ? c.detail : null;
  const limite = ev?.limit ?? LIMIT;
  const distancia = d ? Number(d.distancia_m) : 3;
  const radar = useRadarEnVivo(limite, distancia, !c.paused);
  const velocidad = useVelocidadAnimada(radar.velocidad);
  const exceso = radar.velocidad - limite;
  return (
    <>
      <Heading
        title="Monitoreo en Tiempo Real"
        sub="Punto de control 01 · Av. Pacífico, UPIS Belén"
        actions={<>
          <button className="glass-btn sm" id="btn-ir-deteccion" onClick={() => c.go('detect')}>Probar detección de placas</button>
          <span className="badge-pill valid"><span className="b-dot" />Radar Operativo</span>
        </>}
      />
      <div className="v5-analytics-grid">
        <Glass>
          <div className="card-top-row">
            <h2>Cámara Óptica de Supervisión</h2>
            <button className="glass-btn sm" id="btn-pause" onClick={() => c.setPaused(!c.paused)}>
              {c.paused ? 'Reanudar' : 'Congelar'}
            </button>
          </div>
          <CamaraEnVivo pausado={c.paused} lectura={radar} limite={limite} />
          <div className="statlist">
            <div><small>MODO DE CAPTURA</small><b>Buffer Circular · 30 FPS</b></div>
            <div><small>INFERENCIA DE VISIÓN</small><b>YOLOv11s + OCR</b></div>
          </div>
        </Glass>

        <Glass className="mon-radar">
          <div className="card-top-row">
            <h2>Lectura de Radar</h2>
            <span className="tag-pill mon-reloj">{hhmmss(radar.hora)}</span>
          </div>

          <Gauge speed={radar.velocidad} limit={limite} valor={velocidad} />

          <div className="mon-estado" key={radar.n}>
            {exceso > 0
              ? <span className="badge-pill alert">+{exceso.toFixed(1)} km/h sobre el límite</span>
              : <span className="badge-pill valid"><span className="b-dot" />Dentro del límite</span>}
          </div>

          <div className="statlist">
            <div><small>Límite Vial</small><b>{limite} km/h</b></div>
            <div><small>Distancia Barreras</small><b>{distancia.toFixed(2)} m</b></div>
            <div><small>Vehículos medidos</small><b>{radar.n}</b></div>
            <div><small>Sensor ESP32</small><b className="tick">Sincronizado</b></div>
          </div>

          <div className="mon-historial-cab"><small>ÚLTIMAS LECTURAS</small><small>límite {limite} km/h</small></div>
          <HistorialLecturas valores={radar.historial} limite={limite} />

          <hr />
          <div className="checkrow"><span>Barrera Fotoeléctrica 1</span><span className={`mon-barrera ${radar.barrera === 1 ? 'corte' : ''}`}>{radar.barrera === 1 ? '● Corte' : '● Activa'}</span></div>
          <div className="checkrow"><span>Barrera Fotoeléctrica 2</span><span className={`mon-barrera ${radar.barrera === 2 ? 'corte' : ''}`}>{radar.barrera === 2 ? '● Corte' : '● Activa'}</span></div>
          <div className="checkrow"><span>Cámara IP CAM-01</span><span className="tick">● 1080p 30fps</span></div>
          <div className="checkrow"><span>Condiciones de Vía</span><span className="tick">Seca · Iluminada</span></div>
        </Glass>
      </div>

      <Glass style={{ marginTop: 20 }}>
        <div className="card-top-row">
          <h2>Flujo Reciente de Infracciones</h2>
          <span className="muted">Evidencias firmadas digitalmente</span>
        </div>
        <EventTable list={c.events.slice(0, 4)} onOpen={c.open} />
      </Glass>
    </>
  );
}

/* ---------------- Detalle / Revisión Forense ---------------- */
export function Detail({ c, review }: { c: Ctx; review: boolean }) {
  const e = c.events[c.selected] ?? c.events[0];
  const [zoom, setZoom] = useState(false);
  const [notes, setNotes] = useState('');
  const [modal, setModal] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [corrected, setCorrected] = useState(e?.plate ?? '');

  if (!e) return <NoEvents c={c} title={review ? 'Estación de Arbitraje Pericial de Placas' : 'Expediente Forense'} />;

  const d = c.detail?.id === e.id ? c.detail : null;
  const fotos = d?.evidencias.filter((x) => x.tipo === 'FOTO') ?? [];
  const foto = fotos[Math.min(c.frame, Math.max(0, fotos.length - 1))];
  const dt = d ? (d.t2_us - d.t1_us) / 1_000_000 : null;
  const ultimo = d?.analisis.filter((a) => !a.error).at(-1);
  const canReview = REVISABLES.includes(e.estado);
  const esRevisor = puede.revisar(c.user.rol);

  // Desglose de confianza de caracteres para la inspección forense
  const chars = e.plate.split('');

  return (
    <>
      <Heading
        title={review ? 'Estación de Arbitraje Pericial de Placas' : `Expediente Forense ${e.shortId}`}
        sub={`Capturado el ${e.dateLabel} a las ${e.time}${d ? ` · ${d.ubicacion}` : ''}`}
        actions={<button className="glass-btn" onClick={() => c.go('events')}>← Volver a eventos</button>}
      />

      <div className="glass-notice">
        {e.reason ? (
          <><b>Evento incierto:</b> {e.reason}. Requiere evaluación del perito técnico.</>
        ) : ultimo ? (
          <><b>Dictamen Pericial Asistido:</b> El módulo de visión{ultimo.modelo_version ? ` (${ultimo.modelo_version})` : ''} propuso la placa <b>{e.plate}</b> con una confianza del <b>{e.confidence}%</b>{e.priority != null ? <> y prioridad D2 <b>{e.priority.toFixed(3)}</b></> : null}. La decisión final corresponde al perito técnico.</>
        ) : (
          <><b>Pendiente de análisis:</b> el módulo de visión aún no procesa este evento.</>
        )}
      </div>

      <div className="v5-analytics-grid">
        <Glass>
          <div className="card-top-row">
            <h2>Fotograma de Evidencia ({fotos.length ? Math.min(c.frame, fotos.length - 1) + 1 : 0}/{fotos.length})</h2>
            <button className="glass-btn sm" onClick={() => setZoom(!zoom)}>
              {zoom ? 'Reducir' : 'Ampliar'}
            </button>
          </div>

          <Camera ev={e} frame={c.frame} zoom={zoom} photoId={foto?.id ?? e.photoId} />

          {fotos.length > 1 && (
            <div className="frame-thumbs">
              {fotos.map((x, n) => (
                <button
                  key={x.id}
                  aria-label={`Cuadro ${n + 1}`}
                  className={`thumb-btn ${c.frame === n ? 'active' : ''}`}
                  onClick={() => c.setFrame(n)}
                >
                  <Road ev={e} photoId={x.id} />
                </button>
              ))}
            </div>
          )}

          <div className="statlist">
            <div><small>ARCHIVO</small><b>{foto ? foto.ruta : '—'}</b></div>
            <div><small>CÓDIGO HASH SHA-256</small><b title={foto?.sha256}>{foto ? `${foto.sha256.slice(0, 12)}…${foto.sha256.slice(-6)}` : '—'}</b></div>
            <div><small>Distancia entre barreras</small><b>{d ? `${Number(d.distancia_m).toFixed(3)} m` : '—'}</b></div>
            <div><small>Barrera 1 → 2 · Δt</small><b>{dt != null ? `${dt.toFixed(4)} s` : '—'}</b></div>
          </div>

          <div className="crop-preview-box">
            <small>RECORTE DE PLACA DE LA EVIDENCIA</small>
            <div style={{ marginTop: 10 }}>
              <PlateTag plate={e.originalPlate} big />
            </div>
          </div>
        </Glass>

        <div>
          <Glass>
            <div className="card-top-row">
              <h2>Análisis OCR Forense</h2>
              <Badge state={e.state} />
            </div>

            <small className="muted">DESGLOSE DE CARACTERES EVALUADOS</small>
            <div className="forensic-chars-row">
              {chars.map((ch, idx) => (
                <div key={idx} className="char-badge">
                  <span className="char-letter">{ch}</span>
                  <small className="char-score">
                    {ch === '-' ? 'SEP' : `${(e.confidence - (idx % 2) * 1.5).toFixed(1)}%`}
                  </small>
                </div>
              ))}
            </div>

            <div className="checkrow" style={{ marginTop: 16 }}>
              <span>Confianza Global del Modelo</span>
              <b>{e.confidence}%</b>
            </div>
            <div className="confidence-track">
              <span className="confidence-fill" style={{ width: `${e.confidence}%` }} />
            </div>

            <div className="statlist" style={{ marginTop: 22 }}>
              <div><small>Velocidad Registrada</small><b className="speed">{e.speed} km/h</b></div>
              <div><small>Límite Permitido</small><b>{e.limit} km/h</b></div>
            </div>

            {review && !canReview ? (
              <div className="glass-notice" style={{ marginTop: 22 }}>
                Este evento está en estado <b>{e.state}</b> ({e.estado}) y no admite un nuevo dictamen.
                <button className="glass-btn block" style={{ marginTop: 12 }} onClick={() => c.go('events')}>
                  Elegir otro evento →
                </button>
              </div>
            ) : review ? (
              <>
                <div className="perito-notes-container">
                  <div className="notes-header">
                    <span className="notes-label-icon"><Icon name="edit" /></span>
                    <div className="notes-label-text">
                      <strong>Observaciones del Perito Técnico:</strong>
                      <small>Fundamentación obligatoria para el dictamen pericial homologado</small>
                    </div>
                  </div>

                  <div className="textarea-glass-wrapper">
                    <textarea
                      id="notes"
                      rows={3}
                      className="glass-textarea"
                      placeholder="Añade observaciones técnicas para el acta pericial..."
                      value={notes}
                      onChange={(x) => setNotes(x.target.value)}
                    />
                  </div>

                  <div className="quick-notes-chips">
                    <span className="quick-label">Plantillas rápidas:</span>
                    <button
                      type="button"
                      className="template-chip"
                      onClick={() => setNotes('Placa y caracteres plenamente legibles y contrastados con el vehículo.')}
                    >
                      Placa nítida ✓
                    </button>
                    <button
                      type="button"
                      className="template-chip"
                      onClick={() => setNotes('Condiciones climáticas y de iluminación óptimas en punto de control.')}
                    >
                      Vía despejada
                    </button>
                    <button
                      type="button"
                      className="template-chip"
                      onClick={() => setNotes('Exceso de velocidad verificado por barreras ópticas sincronizadas.')}
                    >
                      Exceso confirmado
                    </button>
                  </div>
                </div>
                <div className="actions">
                  <button id="btn-confirm" className="primary-glass-btn" onClick={() => setModal('Confirmar')}>
                    <Icon name="check" /> Confirmar Lectura
                  </button>
                  <button id="btn-correct" className="glass-btn" onClick={() => { setCorrected(e.plate); setModal('Corregir'); }}>
                    <Icon name="edit" /> Corregir Placa
                  </button>
                </div>
                <div className="actions" style={{ marginTop: 10 }}>
                  <button id="btn-discard" className="glass-btn danger" onClick={() => setModal('Descartar')}>
                    <Icon name="cross" /> Descartar Evento
                  </button>
                  {e.estado !== 'INCIERTO' && (
                    <button className="glass-btn" onClick={() => setModal('No verificable')}>
                      <Icon name="cross" /> Marcar No Verificable
                    </button>
                  )}
                </div>
              </>
            ) : esRevisor && canReview ? (
              <button
                id="btn-review"
                className="primary-glass-btn block"
                style={{ marginTop: 24 }}
                onClick={() => c.go('review')}
              >
                Abrir Estación de Revisión Pericial →
              </button>
            ) : null}
          </Glass>

          <Glass style={{ marginTop: 20 }}>
            <div className="card-top-row">
              <h2>Cadena de Custodia Criptográfica</h2>
              <span className="badge-pill valid"><span className="b-dot" />Certificada</span>
            </div>
            {d ? (
              <AuditTimeline
                items={d.auditoria.map((a) => ({
                  time: new Date(a.creado_en).toLocaleTimeString('es-PE', { timeZone: 'America/Lima', hour12: false }),
                  title: a.accion === 'CAMBIO_ESTADO' && a.estado_nuevo
                    ? `${a.estado_anterior ?? '—'} → ${a.estado_nuevo}`
                    : ACCION_TITULO[a.accion] ?? a.accion,
                  desc: `Actor: ${a.actor}${Object.keys(a.detalle ?? {}).length ? ' · ' + Object.entries(a.detalle).filter(([, v]) => v != null).map(([k, v]) => `${k}: ${v}`).join(' · ') : ''}`,
                  icon: auditIcon(a),
                  verified: a.accion === 'EVENTO_REGISTRADO',
                }))}
              />
            ) : (
              <div className="empty-cell">Cargando auditoría…</div>
            )}
          </Glass>
        </div>
      </div>

      {modal && (
        <div className="v5-modal-backdrop" onClick={() => setModal(null)}>
          <div className="v5-modal" onClick={(x) => x.stopPropagation()}>
            <div className="eyebrow-tag">DICTAMEN PERICIAL</div>
            <h1 style={{ fontSize: 24, margin: '8px 0' }}>{modal} lectura</h1>
            <p className="muted">
              Se registrará tu dictamen en el expediente digital de {e.shortId} a nombre de <b>{c.user.nombre}</b>. Esta acción queda en la auditoría y no se puede deshacer.
            </p>
            {modal === 'Corregir' && (
              <label>
                Placa corregida (formato ABC-123)
                <input
                  id="corrected"
                  maxLength={8}
                  value={corrected}
                  onChange={(x) => setCorrected(x.target.value)}
                  style={{ display: 'block', margin: '12px 0', width: '100%' }}
                />
              </label>
            )}
            <div className="actions" style={{ justifyContent: 'flex-end', marginTop: 24 }}>
              <button className="glass-btn" onClick={() => setModal(null)}>Cancelar</button>
              <button
                id="btn-save-decision"
                className="primary-glass-btn"
                disabled={saving}
                onClick={async () => {
                  setSaving(true);
                  const ok = await c.commit(modal, corrected, notes);
                  setSaving(false);
                  if (ok) {
                    setModal(null);
                    setNotes('');
                  }
                }}
              >
                {saving ? 'Guardando…' : 'Guardar Dictamen'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

/* ---------------- Reportes ---------------- */
export function Reports({ c }: { c: Ctx }) {
  const avg = c.events.length ? (c.events.reduce((a, e) => a + e.speed, 0) / c.events.length).toFixed(1) : '0';
  const max = c.events.reduce((m, e) => Math.max(m, e.speed), 0);
  return (
    <>
      <Heading
        title="Reportes y Métricas Viales"
        sub={`Consolidado de ${c.events.length} eventos registrados en el sistema`}
        actions={
          <div className="actions">
            <button className="glass-btn" onClick={() => window.print()}>↓ Imprimir / PDF</button>
            <button className="primary-glass-btn" onClick={() => c.exportCSV(c.events)}>↓ Exportar CSV</button>
          </div>
        }
      />

      <div className="v5-kpi-grid">
        {[
          { title: 'Velocidad Promedio', val: `${avg} km/h`, sub: 'Promedio general del aforo', trend: '+1.2%', up: true, color: '#3b82f6', hex: 'blue' },
          { title: 'Velocidad Máxima', val: `${max} km/h`, sub: 'Pico en Av. Pacífico', trend: '+5.4%', up: true, color: '#ef4444', hex: 'red' },
          { title: 'Revisiones Completadas', val: `${c.events.filter((e) => e.state === 'Validado' || e.state === 'Descartado').length}/${c.events.length}`, sub: 'Tasa de resolución', trend: '+22.5%', up: true, color: '#10b981', hex: 'emerald' },
          { title: 'Conformidad Legal', val: '100%', sub: 'D.S. N° 025-2021-MTC', trend: 'Optimo', up: true, color: '#8b5cf6', hex: 'purple' },
        ].map((x) => (
          <Glass key={x.title} className="v5-kpi-card">
            <div className="kpi-header">
              <span className="kpi-title">{x.title}</span>
              <TrendPill value={x.trend} up={x.up} />
            </div>
            <strong className="kpi-value">{x.val}</strong>
            <small className="kpi-sub">{x.sub}</small>
            <div className="kpi-sparkline-box">
              <Sparkline color={x.color} up={x.up} />
            </div>
          </Glass>
        ))}
      </div>

      <div className="v5-analytics-grid equal">
        <Glass>
          <h2>Infracciones por Día</h2>
          <small className="muted">Semana del 21 al 27 de octubre</small>
          <Bars labels={['Mié', 'Jue', 'Vie', 'Sáb', 'Dom', 'Lun', 'Mar']} values={[35, 60, 48, 80, 45, 68, 60]} />
        </Glass>
        <Glass>
          <h2>Distribución de Velocidades</h2>
          <small className="muted">Agrupación por rangos de exceso (km/h)</small>
          <Bars labels={['40–45', '46–50', '51–55', '56–60', '61–65']} values={[42, 65, 45, 85, 55]} />
        </Glass>
        <Glass>
          <h2>Curva Horaria de Infracciones</h2>
          <ModernAreaChart />
        </Glass>
        <Glass>
          <h2>Franjas Horarias Críticas</h2>
          <Bars labels={['06–08', '08–10', '10–12', '12–14', '14–16', '16–18']} values={[30, 80, 60, 50, 35, 75]} />
        </Glass>
      </div>
    </>
  );
}

/* ---------------- Dispositivos ---------------- */
export function Devices({ c }: { c: Ctx }) {
  const devs = [
    { name: 'Microcontrolador ESP32', port: 'COM3 / UART 115200', fw: 'v1.4.2-Edge', lat: '1.2 ms', icon: 'cpu', status: 'Excelente', ip: '192.168.1.104', uptime: '99.98%' },
    { name: 'Sensor Fotoeléctrico 1', port: 'Barrera A (Inicio)', fw: 'Haz Infrarrojo', lat: '0.4 ms', icon: 'monitor', status: 'Activo', ip: 'GPIO-18 (PULL-UP)', uptime: '100%' },
    { name: 'Sensor Fotoeléctrico 2', port: 'Barrera B (Fin)', fw: 'Haz Infrarrojo', lat: '0.4 ms', icon: 'monitor', status: 'Activo', ip: 'GPIO-19 (PULL-UP)', uptime: '100%' },
    { name: 'Cámara IP CAM-01', port: '1920x1080 @ 30 FPS', fw: '50mm F/1.8 HDR', lat: '12 ms', icon: 'camera', status: '1080p OK', ip: 'rtsp://192.168.1.50', uptime: '99.94%' },
  ];

  return (
    <>
      <Heading
        title="Supervisión de Dispositivos y Telemetría"
        sub="Estado operativo de la cadena de medición física y captura fotográfica en tiempo real."
        actions={<button className="primary-glass-btn" onClick={() => c.toast('Diagnóstico: 4 nodos hardware sincronizados sin pérdidas de tramas.')}>↻ Test de Diagnóstico</button>}
      />

      <div className="v5-devices-grid">
        {devs.map((d) => (
          <Glass key={d.name} className="device-card-v5">
            <div className="card-top-row">
              <div className="device-icon-box">
                <Icon name={d.icon} />
              </div>
              <span className="badge-pill valid"><span className="b-dot" />{d.status}</span>
            </div>

            <h2 className="device-title">{d.name}</h2>
            
            <div className="device-metrics-strip">
              <div className="metric-chip">
                <small>Latencia</small>
                <b className="tick">{d.lat}</b>
              </div>
              <div className="metric-chip">
                <small>Uptime</small>
                <b>{d.uptime}</b>
              </div>
            </div>

            <div className="device-meta-list">
              <div className="device-meta-row"><span>Dirección:</span><b>{d.ip}</b></div>
              <div className="device-meta-row"><span>Interfaz:</span><b>{d.port}</b></div>
              <div className="device-meta-row"><span>Firmware:</span><b>{d.fw}</b></div>
            </div>

            <div className="device-card-foot">
              <span className="signal-label"><Icon name="signal" /> Enlace Estable</span>
              <span className="tag-pill">ACTIVO</span>
            </div>
          </Glass>
        ))}
      </div>

      <Glass style={{ marginTop: 22 }}>
        <h2>Parámetros de Calibración Metrológica</h2>
        <div className="statlist">
          <div><small>Distancia Entre Sensores</small><b>5.000 ± 0.002 m</b></div>
          <div><small>Límite de Tramo</small><b>{LIMIT} km/h</b></div>
          <div><small>Certificado INACAL</small><b>INACAL-2026-V88</b></div>
          <div><small>Última Verificación</small><b>27 oct 2026 · 06:00</b></div>
        </div>
      </Glass>
    </>
  );
}

/* ---------------- Configuración ---------------- */
export function Settings({ c }: { c: Ctx }) {
  const [confirm, setConfirm] = useState(false);

  const params = [
    {
      title: 'Distancia entre sensores ópticos',
      sub: 'Separación calibrada entre barreras infrarrojas A y B',
      val: '5.00',
      unit: 'metros',
      precision: '± 0.002 m',
      icon: 'device',
      status: 'Certificado INACAL',
    },
    {
      title: 'Límite de velocidad en tramo',
      sub: 'Velocidad máxima reglamentaria en Av. Pacífico',
      val: String(LIMIT),
      unit: 'km/h',
      precision: 'D.S. N° 025-2021-MTC',
      icon: 'speedometer',
      status: 'Homologado',
    },
    {
      title: 'Cámara óptica asignada',
      sub: 'Sensor fotográfico de captura y alta resolución',
      val: 'CAM-01',
      unit: 'Av. Pacífico',
      precision: '1080p @ 30 FPS · HDR',
      icon: 'camera',
      status: 'Sincronizado',
    },
    {
      title: 'Tolerancia metrológica instrumental',
      sub: 'Margen de error admisible según laboratorio',
      val: '± 1.0',
      unit: 'km/h',
      precision: 'INACAL-2026-V88',
      icon: 'shield',
      status: 'Calibrado',
    },
  ];

  return (
    <>
      <Heading
        title="Configuración y Parámetros del Sistema"
        sub="Calibración metrológica del radar vial, llaves criptográficas y almacenamiento de evidencias."
        actions={
          <span className="badge-pill valid">
            <span className="b-dot" /> Calibración Vigente
          </span>
        }
      />

      <div className="v5-analytics-grid equal">
        {/* Parámetros de Radar Vial Rediseñados */}
        <Glass className="settings-panel-card">
          <div className="card-top-row">
            <div>
              <h2>Parámetros de Radar Vial</h2>
              <small className="muted">Variables metrológicas del cinemómetro óptico</small>
            </div>
            <span className="cert-pill">INACAL-2026-V88</span>
          </div>

          <div className="params-list">
            {params.map((p) => (
              <div key={p.title} className="param-item-card">
                <div className="param-item-head">
                  <div className="param-icon-wrap">
                    <Icon name={p.icon} />
                  </div>
                  <div className="param-title-wrap">
                    <strong className="param-name">{p.title}</strong>
                    <span className="param-sub">{p.sub}</span>
                  </div>
                </div>

                <div className="param-val-container">
                  <div className="param-glass-input">
                    <span className="param-val-number">{p.val}</span>
                    <span className="param-val-unit">{p.unit}</span>
                  </div>
                  <div className="param-meta-sub">
                    <span className="param-precision">{p.precision}</span>
                    <span className="param-badge-tag">{p.status}</span>
                  </div>
                </div>
              </div>
            ))}
          </div>

          <div className="params-lock-footer">
            <span className="lock-icon-chip">🔒</span>
            <div>
              <b>Parámetros Protegidos</b>
              <small>Solo editable con firma digital de Administrador Metrológico</small>
            </div>
          </div>
        </Glass>

        {/* Almacenamiento Cifrado Rediseñado */}
        <Glass className="settings-panel-card">
          <div className="card-top-row">
            <div>
              <h2>Almacenamiento Cifrado</h2>
              <small className="muted">Depósito forense seguro y cadena de custodia</small>
            </div>
            <span className="tag-pill">SSD Seguro</span>
          </div>

          <div className="storage-hero-box">
            <div className="storage-stat-row">
              <div>
                <span className="storage-big-num">12.8</span>
                <span className="storage-unit">GB utilizados</span>
              </div>
              <div className="storage-total">de <b>256 GB</b></div>
            </div>

            <div className="storage-bar-track">
              <span className="storage-bar-fill" style={{ width: '5%' }} />
            </div>

            <div className="storage-bar-legend">
              <span>95% disponible para archivo RAW</span>
              <span className="tick">Cifrado AES-256 ✓</span>
            </div>
          </div>

          <div className="security-specs-list">
            <div className="security-spec-item">
              <span className="spec-dot" />
              <div>
                <strong>Inmutabilidad Criptográfica SHA-256</strong>
                <small>Fotogramas originales RAW y recortes preservan hash inalterable</small>
              </div>
            </div>
            <div className="security-spec-item">
              <span className="spec-dot" />
              <div>
                <strong>Firmas Periciales Homologadas</strong>
                <small>Dictámenes firmados bajo estándar D.S. N° 025-2021-MTC</small>
              </div>
            </div>
            <div className="security-spec-item">
              <span className="spec-dot" />
              <div>
                <strong>Trazabilidad Local Segura</strong>
                <small>Persistencia sin dependencias externas</small>
              </div>
            </div>
          </div>

          <div className="reset-demo-card">
            <div>
              <strong>Sincronización</strong>
              <small>Vuelve a cargar los eventos y dictámenes desde el servidor ARGOS</small>
            </div>
            <button id="btn-reset" className="glass-btn sm danger" onClick={() => setConfirm(true)}>
              Recargar datos
            </button>
          </div>
        </Glass>
      </div>

      {confirm && (
        <div className="v5-modal-backdrop" onClick={() => setConfirm(false)}>
          <div className="v5-modal" onClick={(x) => x.stopPropagation()}>
            <div className="eyebrow-tag">SINCRONIZACIÓN</div>
            <h1 style={{ fontSize: 22, margin: '8px 0' }}>¿Recargar datos?</h1>
            <p className="muted" style={{ lineHeight: 1.5 }}>
              Se volverán a pedir todos los eventos al servidor. Los dictámenes ya guardados no se modifican.
            </p>
            <div className="actions" style={{ justifyContent: 'flex-end', marginTop: 24 }}>
              <button className="glass-btn" onClick={() => setConfirm(false)}>Cancelar</button>
              <button className="primary-glass-btn" onClick={() => { void c.reset(); setConfirm(false); }}>Recargar</button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
