import { useCallback, useEffect, useMemo, useState } from 'react';
import { menus, permitida, type Page, type TrafficEvent } from './data';
import {
  api, aEvento, onSesionExpirada, puede, REVISABLES, ROL_UI, type Decision, type EventoDetalle, type Sesion,
} from './api';
import { useInterval } from './hooks';
import { Icon } from './components';
import { Landing } from './landing';
import { olvidarCuentaGoogle } from './google';
import { Login } from './login';
import { CambioContrasena } from './cuenta';
import { Users } from './usuarios';
import { Dashboard, DeteccionPlacas, Detail, Devices, EventsPage, Evidence, Monitor, Reports, Settings, type Ctx } from './pages';

type Theme = 'light' | 'dark';

const POLL_MS = 5000;
const PLACA_UI = /^[A-Z0-9]{3}-[A-Z0-9]{3}$/;
const PAGINAS_ADMIN: Page[] = ['device', 'settings', 'users'];

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
  const [page, setPage] = useState<Page>('landing');
  /** undefined = comprobando; null = sin sesión. */
  const [user, setUser] = useState<Sesion | null | undefined>(undefined);
  const [aviso, setAviso] = useState<string | undefined>();
  const [cambiando, setCambiando] = useState(false);
  const [menuPerfil, setMenuPerfil] = useState(false);
  const [raw, setRaw] = useState<TrafficEvent[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [online, setOnline] = useState(true);
  const [chosenId, setSelectedId] = useState<string>('');
  const [detail, setDetail] = useState<EventoDetalle | null>(null);
  const [frame, setFrame] = useState(0);
  const [paused, setPaused] = useState(false);
  const [sort, setSort] = useState<'asc' | 'desc' | null>(null);
  const [toasts, setToasts] = useState<{ id: number; t: string }[]>([]);
  const [now, setNow] = useState(() => new Date());
  const [menuOpen, setMenuOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(() => leer('argos-sidebar') === '1');
  // Tema del panel (no afecta a la página de inicio ni al acceso). Sin elección guardada: el del sistema.
  const [theme, setTheme] = useState<Theme>(() => {
    const guardado = leer('argos-tema-panel');
    if (guardado === 'light' || guardado === 'dark') return guardado;
    return window.matchMedia?.('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
  });

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

  const go = useCallback((p: Page) => {
    setPage(p);
    setMenuOpen(false);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }, []);

  /* ---------- Sesión ---------- */

  /** Borra todo dato de eventos de la memoria al salir o al expirar la sesión. */
  const olvidarDatos = useCallback(() => {
    setRaw([]);
    setDetail(null);
    setLoaded(false);
    setSelectedId('');
  }, []);

  // ¿Hay sesión abierta? (la cookie HttpOnly no es visible para JS: se pregunta al backend)
  useEffect(() => {
    api.yo().then(setUser).catch(() => setUser(null));
  }, []);

  // Cualquier 401 del backend (sesión vencida, cerrada o permisos cambiados) vuelve al acceso.
  useEffect(() => {
    onSesionExpirada(() => {
      setUser(null);
      olvidarDatos();
      setAviso('Tu sesión terminó. Vuelve a ingresar para continuar.');
      setPage('login');
    });
  }, [olvidarDatos]);

  const entrar = useCallback((s: Sesion) => {
    setUser(s);
    setAviso(undefined);
    setPage('dash');
  }, []);

  const salir = useCallback(async () => {
    await api.salir().catch(() => { /* aunque falle, se olvida localmente */ });
    olvidarCuentaGoogle();
    setUser(null);
    setMenuPerfil(false);
    setCambiando(false);
    olvidarDatos();
    go('landing');
    toast('Sesión cerrada');
  }, [go, olvidarDatos, toast]);

  /* ---------- Datos del backend (solo con sesión) ---------- */

  const refresh = useCallback(async (sondeo = false) => {
    try {
      const lista = (await api.eventos(500, sondeo)).map(aEvento);
      setRaw((prev) => {
        // Conserva el historial ya cargado desde el detalle de cada evento
        const hist = new Map(prev.map((e) => [e.id, e.history]));
        return lista.map((e) => ({ ...e, history: hist.get(e.id) ?? [] }));
      });
      setOnline(true);
      setLoaded(true);
    } catch (err) {
      if ((err as { status?: number }).status === 401) return; // lo maneja onSesionExpirada
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
      if ((err as { status?: number }).status !== 401) toast(`No se pudo cargar el evento: ${(err as Error).message}`);
    }
  }, [toast]);

  // Sondeo: marcado como automático para no mantener viva una sesión inactiva.
  const habilitado = !!user && !user.debe_cambiar;
  useInterval(() => { void refresh(true); }, POLL_MS, !paused && habilitado, true);

  // Sincroniza con el backend: el setState ocurre tras el await de la petición, no en el render.
  useEffect(() => {
    // oxlint-disable-next-line react/set-state-in-effect
    if (habilitado) void loadDetail(selectedId);
  }, [selectedId, loadDetail, habilitado]);

  /* ---------- Preferencias locales ---------- */

  useEffect(() => {
    const i = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(i);
  }, []);

  useEffect(() => {
    guardar('argos-sidebar', collapsed ? '1' : '0');
  }, [collapsed]);

  useEffect(() => {
    guardar('argos-tema-panel', theme);
  }, [theme]);

  const openEvent = useCallback((id: string) => {
    setSelectedId(id);
    setFrame(0);
    go('detail');
  }, [go]);

  /* ---------- Páginas públicas ---------- */

  if (page === 'landing') {
    return (
      <>
        <Landing onEnter={() => go(user ? 'dash' : 'login')} />
        <Toasts list={toasts} />
      </>
    );
  }

  if (user === undefined) {
    return <><div className="v5-auth-check" role="status">Comprobando sesión…</div></>;
  }

  if (!user || page === 'login') {
    if (user && page === 'login') {
      // Con sesión abierta, el acceso lleva directo al panel
      return <RedirigirPanel go={go} />;
    }
    return (
      <>
        <Login onSesion={entrar} onBack={() => go('landing')} aviso={aviso} />
        <Toasts list={toasts} />
      </>
    );
  }

  // Contraseña temporal: el backend no permite nada más hasta cambiarla
  if (user.debe_cambiar) {
    return (
      <>
        <div className="v5-cuenta-layout">
          <CambioContrasena
            user={user} obligatorio
            onListo={() => { setUser({ ...user, debe_cambiar: false }); toast('Contraseña guardada. Ya puedes usar el panel'); }}
            onCancelar={() => void salir()}
          />
        </div>
        <Toasts list={toasts} />
      </>
    );
  }

  /* ---------- Panel (con sesión) ---------- */

  const ctx: Ctx = {
    events,
    selected,
    detail,
    loaded,
    online,
    user,
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
      if (!puede.revisar(user.rol)) {
        toast('Tu rol no permite emitir dictámenes.');
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
        await api.revisar(e.id, decision, placa, notes);
      } catch (err) {
        if ((err as { status?: number }).status !== 401) toast(`No se guardó el dictamen: ${(err as Error).message}`);
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

  // Una página no permitida para el rol muestra el dashboard (el backend igual respondería 403)
  const vista: Page = permitida(page, user.rol) ? page : 'dash';
  const menu = menus.filter(([p]) => permitida(p, user.rol));
  const primeraAdmin = menu.find(([p]) => PAGINAS_ADMIN.includes(p))?.[0];
  const title = menus.find((m) => m[0] === vista)?.[1] ?? 'Detalle de evento';
  const pending = events.filter((e) => e.state === 'Pendiente').length;
  const revisa = puede.revisar(user.rol);

  const views: Record<string, () => React.ReactElement> = {
    dash: () => <Dashboard c={ctx} />,
    events: () => <EventsPage c={ctx} />,
    monitor: () => <Monitor c={ctx} />,
    detect: () => <DeteccionPlacas c={ctx} />,
    image: () => <Evidence c={ctx} />,
    review: () => <Detail c={ctx} review key="r" />,
    detail: () => <Detail c={ctx} review={false} key="d" />,
    reports: () => <Reports c={ctx} />,
    device: () => <Devices c={ctx} />,
    settings: () => <Settings c={ctx} />,
    users: () => <Users yo={user} toast={toast} onMiNombre={(nombre) => setUser({ ...user, nombre })} />,
  };

  return (
    <div className="v5-panel" data-theme={theme}>
      <div className="v5-panel-fondo" aria-hidden />
      <div className={`v5-layout ${collapsed ? 'sidebar-collapsed' : ''}`}>
        <aside className={`v5-sidebar ${menuOpen ? 'open' : ''}`}>
          <div className="sidebar-brand">
            <div className="brand-badge-icon">
              <img src="/argos-symbol.png" alt="Logo ARGOS" className="brand-logo-img" />
            </div>
            <div className="brand-text">
              ARGOS
              <small>v{__APP_VERSION__}</small>
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
            {menu.map((m) => (
              <div key={m[0]}>
                {m[0] === primeraAdmin && <div className="nav-section-title"><span>ADMINISTRACIÓN</span></div>}
                <button
                  id={`nav-${m[0]}`}
                  className={`v5-nav-btn ${vista === m[0] ? 'active' : ''}`}
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
            <button className="sidebar-access-btn" onClick={() => void salir()}>
              <span className="exit-ico">↪</span> <span className="exit-txt">Cerrar sesión</span>
            </button>
          </div>
        </aside>

        <div className="v5-main-content">
          <header className="v5-topbar">
            <div className="topbar-left">
              <button className="mobile-menu-btn" onClick={() => setMenuOpen(!menuOpen)}>
                ☰
              </button>
              <div className="page-breadcrumb">
                <span className="crumb-root">ARGOS</span>
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
                onClick={() => {
                  // Cambio instantáneo: sin esto cada elemento transiciona por su cuenta y el panel "destiñe"
                  const panel = document.querySelector('.v5-panel');
                  panel?.classList.add('v5-sin-transicion');
                  setTheme(theme === 'dark' ? 'light' : 'dark');
                  setTimeout(() => panel?.classList.remove('v5-sin-transicion'), 50);
                }}
              >
                {theme === 'dark' ? '☀' : '☾'}
              </button>

              <button
                id="btn-bell"
                className="icon-action-btn bell-btn"
                aria-label="Notificaciones"
                title={`${pending} eventos pendientes de revisión`}
                onClick={() => go(revisa ? 'review' : 'events')}
              >
                <Icon name="bell" />
                {pending > 0 && <span className="bell-badge">{pending}</span>}
              </button>

              <div>
                <button
                  className="profile-chip" aria-haspopup="menu" aria-expanded={menuPerfil}
                  onClick={() => setMenuPerfil(!menuPerfil)}
                >
                  <div className="profile-avatar">{iniciales(user.nombre)}</div>
                  <div className="profile-details">
                    <span className="profile-name">{user.nombre}</span>
                    <span className="profile-role">{ROL_UI[user.rol]}</span>
                  </div>
                </button>
              </div>
            </div>
          </header>

          <main key={vista} className="v5-page-container">
            {(views[vista] ?? views.dash)()}
            <footer className="v5-footer">
              <span>ARGOS v{__APP_VERSION__} — Sistema Inteligente de Visión Vial · Nuevo Chimbote</span>
              <span>Inspirado en la estética Glassmorphism Dashboard V5</span>
            </footer>
          </main>
        </div>
      </div>

      {/* Fuera de la barra superior: su vidrio recorta (overflow hidden) todo lo que sobresale */}
      {menuPerfil && (
        <div className="profile-menu-capa" onClick={() => setMenuPerfil(false)}>
          <div className="profile-menu" role="menu" onClick={(x) => x.stopPropagation()}>
            <div className="profile-menu-head">
              <b>{user.nombre}</b>
              <small>{user.email} · {ROL_UI[user.rol]}</small>
            </div>
            <button role="menuitem" onClick={() => { setMenuPerfil(false); setCambiando(true); }}>
              <Icon name="shield" /> Cambiar contraseña
            </button>
            <button role="menuitem" className="peligro" onClick={() => void salir()}>
              <span aria-hidden>↪</span> Cerrar sesión
            </button>
          </div>
        </div>
      )}

      {cambiando && (
        <div className="v5-modal-backdrop" onClick={() => setCambiando(false)}>
          <div onClick={(x) => x.stopPropagation()} style={{ width: '100%', padding: 16 }}>
            <CambioContrasena
              user={user} obligatorio={false}
              onListo={() => { setCambiando(false); toast('Contraseña actualizada'); }}
              onCancelar={() => setCambiando(false)}
            />
          </div>
        </div>
      )}

      <Toasts list={toasts} />
    </div>
  );
}

/** Con sesión abierta, la pantalla de acceso no tiene sentido: se pasa al dashboard. */
function RedirigirPanel({ go }: { go: (p: Page) => void }) {
  useEffect(() => { go('dash'); }, [go]);
  return null;
}

function iniciales(nombre?: string) {
  if (!nombre) return '··';
  return nombre.split(/[\s@.]+/).filter(Boolean).slice(0, 2).map((w) => w[0]?.toUpperCase() ?? '').join('');
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
