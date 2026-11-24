import { useCallback, useEffect, useMemo, useState } from 'react';
import { menus, type Page, type TrafficEvent } from './data';
import { api, aEvento, REVISABLES, type Decision, type EventoDetalle, type Usuario } from './api';
import { useInterval } from './hooks';
import { Icon } from './components';
import { Dashboard, Detail, Devices, EventsPage, Evidence, Login, Monitor, Reports, Settings, Users, type Ctx } from './pages';

type Theme = 'light' | 'dark';

const POLL_MS = 5000;
const PLACA_UI = /^[A-Z0-9]{3}-[A-Z0-9]{3}$/;

const ACCION_A_DECISION: Record<string, Decision> = {
  Confirmar: 'CONFIRMAR',
  Corregir: 'CONFIRMAR',
  Descartar: 'DESCARTAR',
  'No verificable': 'MARCAR_INCIERTO',
};

function leer(clave: string): string | null {
  try { return localStorage.getItem(clave); } catch { return null; }
}
function guardar(clave: string, valor: string) {
  try { localStorage.setItem(clave, valor); } catch { /* modo privado */ }
}

export default function App() {
  const [page, setPage] = useState<Page>('dash');
  const [raw, setRaw] = useState<TrafficEvent[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [online, setOnline] = useState(true);
  const [chosenId, setSelectedId] = useState<string>('');
  const [detail, setDetail] = useState<EventoDetalle | null>(null);
  const [reviewer, setReviewer] = useState<Usuario | null>(null);
  const [frame, setFrame] = useState(0);
  const [paused, setPaused] = useState(false);
  const [sort, setSort] = useState<'asc' | 'desc' | null>(null);
  const [toasts, setToasts] = useState<{ id: number; t: string }[]>([]);
  const [now, setNow] = useState(() => new Date());
  const [menuOpen, setMenuOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(() => leer('argos-sidebar') === '1');
  const [theme, setTheme] = useState<Theme>(() => (leer('argos-theme') as Theme) || 'light');

  // Orden: por defecto el del backend (prioridad D2); el usuario puede ordenar por velocidad.
  const events = useMemo(
    () => (sort ? [...raw].sort((a, b) => (sort === 'asc' ? a.speed - b.speed : b.speed - a.speed)) : raw),
    [raw, sort],
  );
  // Sin selección explícita: el evento revisable de mayor prioridad D2 (el backend ya los ordena así).
  const selectedId = chosenId || (raw.find((e) => REVISABLES.includes(e.estado)) ?? raw[0])?.id || '';
  const selected = Math.max(0, events.findIndex((e) => e.id === selectedId));

  const toast = useCallback((t: string) => {
    const id = Date.now() + Math.random();
    setToasts((x) => [...x.slice(-2), { id, t }]);
    setTimeout(() => setToasts((x) => x.filter((y) => y.id !== id)), 3400);
  }, []);

  /* ---------- Datos del backend ---------- */

  const refresh = useCallback(async () => {
    try {
      const lista = (await api.eventos()).map(aEvento);
      setRaw((prev) => {
        // Conserva el historial ya cargado desde el detalle de cada evento
        const hist = new Map(prev.map((e) => [e.id, e.history]));
        return lista.map((e) => ({ ...e, history: hist.get(e.id) ?? [] }));
      });
      setOnline(true);
      setLoaded(true);
    } catch {
      setOnline((was) => {
        if (was) toast('Sin conexión con el servidor ARGOS');
        return false;
      });
    }
  }, [toast]);

  const loadDetail = useCallback(async (id: string) => {
    if (!id) return;
    try {
      const d = await api.evento(id);
      setDetail(d);
      const history = d.revisiones.map((r) =>
        `${r.revisor} · ${new Date(r.creado_en).toLocaleString('es-PE', { timeZone: 'America/Lima' })} · ${r.decision}` +
        `${r.placa_final ? ' · ' + r.placa_final : ''}${r.comentario ? ' · ' + r.comentario : ''}`);
      setRaw((ev) => ev.map((e) => (e.id === id ? { ...e, history } : e)));
    } catch (err) {
      toast(`No se pudo cargar el evento: ${(err as Error).message}`);
    }
  }, [toast]);

  useInterval(() => { void refresh(); }, POLL_MS, !paused, true);

  // Revisor activo: hasta tener inicio de sesión, el primer usuario con rol REVISOR (o ADMINISTRADOR).
  useEffect(() => {
    api.usuarios()
      .then((us) => setReviewer(us.find((u) => u.rol === 'REVISOR') ?? us.find((u) => u.rol === 'ADMINISTRADOR') ?? null))
      .catch(() => { /* se informa vía refresh */ });
  }, []);

  // Sincroniza con el backend: el setState ocurre tras el await de la petición, no en el render.
  useEffect(() => {
    // oxlint-disable-next-line react/set-state-in-effect
    void loadDetail(selectedId);
  }, [selectedId, loadDetail]);

  /* ---------- Preferencias locales ---------- */

  useEffect(() => {
    const i = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(i);
  }, []);

  useEffect(() => {
    guardar('argos-sidebar', collapsed ? '1' : '0');
  }, [collapsed]);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    guardar('argos-theme', theme);
  }, [theme]);

  const go = useCallback((p: Page) => {
    setPage(p);
    setMenuOpen(false);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }, []);

  const openEvent = useCallback((id: string) => {
    setSelectedId(id);
    setFrame(0);
    go('detail');
  }, [go]);

  const ctx: Ctx = {
    events,
    selected,
    detail,
    loaded,
    online,
    reviewer,
    go,
    open: openEvent,
    toast,
    frame,
    setFrame,
    paused,
    setPaused,
    sortSpeed: () => setSort((s) => (s === 'desc' ? 'asc' : 'desc')),
    exportCSV: (list) => {
      const rows = [
        ['Evento', 'UUID', 'Fecha', 'Hora', 'Velocidad km/h', 'Límite km/h', 'Placa candidata', 'Confianza', 'Revisión', 'Estado backend'],
        ...list.map((e) => [e.shortId, e.id, e.date, e.time, e.speed, e.limit, e.plate, `${e.confidence}%`, e.state, e.estado]),
      ];
      const blob = new Blob(['﻿' + rows.map((r) => r.join(',')).join('\n')], { type: 'text/csv;charset=utf-8' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = 'ARGOS_infracciones_viales.csv';
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    },
    commit: async (action, plate, notes) => {
      const e = events[selected];
      if (!e) return false;
      if (!reviewer) {
        toast('No hay un usuario revisor activo en el sistema.');
        return false;
      }
      if (!REVISABLES.includes(e.estado)) {
        toast(`El evento está en ${e.estado}: no admite dictamen.`);
        return false;
      }
      const decision = ACCION_A_DECISION[action];
      let placa: string | null = null;
      if (decision === 'CONFIRMAR') {
        placa = (action === 'Corregir' ? plate : e.plate).toUpperCase().trim();
        if (!PLACA_UI.test(placa)) {
          toast('Formato de placa inválido. Usa ABC-123.');
          return false;
        }
      }
      try {
        await api.revisar(e.id, reviewer.id, decision, placa, notes);
      } catch (err) {
        toast(`No se guardó el dictamen: ${(err as Error).message}`);
        return false;
      }
      toast('Dictamen pericial guardado correctamente');
      await Promise.all([refresh(), loadDetail(e.id)]);
      return true;
    },
    reset: async () => {
      await refresh();
      await loadDetail(selectedId);
      toast('Datos recargados desde el servidor');
    },
  };

  const bg = (
    <div className="v5-bg" aria-hidden>
      <div className="v5-orb orb-1" />
      <div className="v5-orb orb-2" />
      <div className="v5-orb orb-3" />
      <div className="v5-orb orb-4" />
      <div className="v5-grid-pattern" />
    </div>
  );

  if (page === 'login') {
    return (
      <>
        {bg}
        <Login c={ctx} />
        <Toasts list={toasts} />
      </>
    );
  }

  const title = menus.find((m) => m[0] === page)?.[1] ?? 'Detalle de evento';
  const pending = events.filter((e) => e.state === 'Pendiente').length;

  const views: Record<string, () => React.ReactElement> = {
    dash: () => <Dashboard c={ctx} />,
    events: () => <EventsPage c={ctx} />,
    monitor: () => <Monitor c={ctx} />,
    image: () => <Evidence c={ctx} />,
    review: () => <Detail c={ctx} review key="r" />,
    detail: () => <Detail c={ctx} review={false} key="d" />,
    reports: () => <Reports c={ctx} />,
    device: () => <Devices c={ctx} />,
    settings: () => <Settings c={ctx} />,
    users: () => <Users c={ctx} />,
  };

  return (
    <>
      {bg}
      <div className={`v5-layout ${collapsed ? 'sidebar-collapsed' : ''}`}>
        {/* Sidebar Glasssy V5 */}
        <aside className={`v5-sidebar ${menuOpen ? 'open' : ''}`}>
          <div className="sidebar-brand">
            <div className="brand-badge-icon">
              <img src="/argos-symbol.png" alt="Logo ARGOS" className="brand-logo-img" />
            </div>
            <div className="brand-text">
              ARGOS
              <small>VISION DASHBOARD V5</small>
            </div>
            <button
              id="btn-collapse"
              className="collapse-btn"
              aria-label={collapsed ? 'Expandir barra lateral' : 'Contraer barra lateral'}
              aria-expanded={!collapsed}
              title={collapsed ? 'Expandir' : 'Contraer'}
              onClick={() => setCollapsed(!collapsed)}
            >
              <svg viewBox="0 0 24 24" className="icon-svg" aria-hidden>
                <path d="M15 6l-6 6 6 6" />
              </svg>
            </button>
          </div>

          <nav className="v5-nav">
            <div className="nav-section-title"><span>OPERACIÓN</span></div>
            {menus.map((m, i) => (
              <div key={m[0]}>
                {i === 6 && <div className="nav-section-title"><span>ADMINISTRACIÓN</span></div>}
                <button
                  id={`nav-${m[0]}`}
                  className={`v5-nav-btn ${page === m[0] ? 'active' : ''}`}
                  title={collapsed ? m[1] : undefined}
                  onClick={() => go(m[0])}
                >
                  <span className="nav-icon"><Icon name={m[0]} /></span>
                  <span className="nav-label">{m[1]}</span>
                  {m[0] === 'review' && pending > 0 && (
                    <span className="nav-badge-count">{pending}</span>
                  )}
                </button>
              </div>
            ))}
          </nav>

          <div className="sidebar-bottom-card">
            <div className="control-point-status" title={online ? 'Servidor ARGOS conectado' : 'Sin conexión con el servidor'}>
              <span className="live-dot-pulse" style={online ? undefined : { background: '#ef4444' }} />
              <div>
                <b>{online ? 'Servidor ARGOS conectado' : 'Sin conexión'}</b>
                <small>{online ? `${events.length} eventos · actualiza cada ${POLL_MS / 1000} s` : 'Reintentando…'}</small>
              </div>
            </div>
            <button className="sidebar-access-btn" onClick={() => go('login')}>
              <span className="exit-ico">↪</span> <span className="exit-txt">Salir a pantalla de acceso</span>
            </button>
          </div>
        </aside>

        {/* Contenedor Principal */}
        <div className="v5-main-content">
          {/* Topbar Glasssy V5 */}
          <header className="v5-topbar">
            <div className="topbar-left">
              <button className="mobile-menu-btn" onClick={() => setMenuOpen(!menuOpen)}>
                ☰
              </button>
              <div className="page-breadcrumb">
                <span className="crumb-root">ARGOS V5</span>
                <span className="crumb-sep">/</span>
                <span className="crumb-current">{title}</span>
              </div>
            </div>

            <div className="topbar-search">
              <span className="search-icon">🔍</span>
              <input type="text" placeholder="Buscar por placa, evento o sensor..." onClick={() => go('events')} readOnly />
            </div>

            <div className="topbar-right">
              <div className="time-pill">
                <span className="time-icon">🕒</span>
                <span>
                  {now.toLocaleString('es-PE', {
                    timeZone: 'America/Lima',
                    hour: '2-digit',
                    minute: '2-digit',
                    second: '2-digit',
                  })}
                </span>
              </div>

              <button
                id="btn-theme"
                className="icon-action-btn"
                aria-label="Cambiar tema"
                title={theme === 'dark' ? 'Modo Claro' : 'Modo Oscuro'}
                onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
              >
                {theme === 'dark' ? '☀' : '☾'}
              </button>

              <button
                id="btn-bell"
                className="icon-action-btn bell-btn"
                aria-label="Notificaciones"
                title={`${pending} revisiones pendientes`}
                onClick={() => go('review')}
              >
                <Icon name="bell" />
                {pending > 0 && <span className="bell-badge">{pending}</span>}
              </button>

              <div className="profile-chip" onClick={() => go('login')}>
                <div className="profile-avatar">{iniciales(reviewer?.nombre)}</div>
                <div className="profile-details">
                  <span className="profile-name">{reviewer?.nombre ?? 'Sin revisor'}</span>
                  <span className="profile-role">{reviewer ? rolUI(reviewer.rol) : '—'}</span>
                </div>
              </div>
            </div>
          </header>

          <main key={page} className="v5-page-container">
            {(views[page] ?? views.dash)()}
            <footer className="v5-footer">
              <span>ARGOS V5 — Sistema Inteligente de Visión Vial · Nuevo Chimbote</span>
              <span>Inspirado en la estética Glassmorphism Dashboard V5</span>
            </footer>
          </main>
        </div>
      </div>

      <Toasts list={toasts} />
    </>
  );
}

function iniciales(nombre?: string) {
  if (!nombre) return '··';
  return nombre.split(/\s+/).slice(0, 2).map((w) => w[0]?.toUpperCase() ?? '').join('');
}

function rolUI(rol: string) {
  return ({ REVISOR: 'Revisor Vial', ADMINISTRADOR: 'Administrador', OPERADOR: 'Operador Vial' } as Record<string, string>)[rol] ?? rol;
}

function Toasts({ list }: { list: { id: number; t: string }[] }) {
  return (
    <div className="v5-toast-container">
      {list.map((x) => (
        <div key={x.id} className="v5-toast">
          {x.t}
        </div>
      ))}
    </div>
  );
}
