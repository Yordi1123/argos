import { useEffect, useState } from 'react';
import { DEMO_EVENT } from './data';
import { Glass, Icon, Road } from './components';
import './landing.css';

const NAV = [
  ['como-funciona', 'Cómo funciona'],
  ['decisiones', 'Decisiones'],
  ['garantias', 'Garantías'],
  ['tecnologia', 'Tecnología'],
] as const;

const STEPS = [
  {
    icon: 'speedometer',
    title: 'Medición por barreras',
    desc: 'Dos barreras láser conectadas a un ESP32 registran el instante de cruce con precisión de microsegundos. La velocidad sale de la distancia calibrada de la sesión.',
  },
  {
    icon: 'camera',
    title: 'Evidencia primero',
    desc: 'La cámara captura el vehículo y la foto se guarda en disco antes de registrar el evento. Su huella SHA-256 queda asociada desde el primer momento.',
  },
  {
    icon: 'cpu',
    title: 'Análisis de placa',
    desc: 'El módulo de visión propone una placa candidata con su nivel de confianza. Si falla tres veces, el evento pasa a revisión como incierto.',
  },
  {
    icon: 'shield',
    title: 'Revisión humana',
    desc: 'Un revisor autorizado examina la evidencia y confirma, corrige o descarta. Ningún evento se da por válido sin una persona.',
  },
];

const DECISIONS = [
  {
    tag: 'D1 · En campo',
    title: 'Filtro de medición',
    desc: 'El agente de captura solo envía mediciones que superan el límite más la incertidumbre. El servidor vuelve a calcular la velocidad y rechaza las que no alcanzan el umbral.',
  },
  {
    tag: 'D2 · En servidor',
    title: 'Prioridad de revisión',
    desc: 'Combina la confianza de la placa (60 %) y el margen sobre el límite (40 %), y reduce el puntaje a la mitad si la placa no tiene un formato válido. Solo ordena la cola: no decide.',
  },
  {
    tag: 'Decisión final',
    title: 'Siempre una persona',
    desc: 'Solo los usuarios con rol de revisor o administrador pueden confirmar o descartar. Cada dictamen queda firmado con su autor en la auditoría.',
    highlight: true,
  },
];

const GUARANTEES = [
  { icon: 'camera', title: 'La evidencia existe antes del análisis', desc: 'El servidor verifica que el archivo esté en disco antes de aceptar el evento.' },
  { icon: 'hash', title: 'La evidencia no fue alterada', desc: 'Se calcula SHA-256 al registrar y otra vez cada vez que se muestra. Si no coincide, no se entrega.' },
  { icon: 'check', title: 'Sin eventos duplicados', desc: 'El agente asigna el identificador: reenviar un evento devuelve el existente.' },
  { icon: 'signal', title: 'Nada se pierde sin conexión', desc: 'Si el servidor no responde, el agente conserva el evento y lo reenvía después.' },
  { icon: 'events', title: 'Historial inalterable', desc: 'La tabla de auditoría bloquea cualquier modificación o borrado a nivel de base de datos.' },
  { icon: 'shield', title: 'Transiciones controladas', desc: 'Una máquina de estados impide saltos inválidos; los estados finales no cambian.' },
];

const STACK = [
  { name: 'ESP32', role: 'Barreras láser' },
  { name: 'Cámara IP', role: 'Captura RTSP' },
  { name: 'FastAPI', role: 'API y reglas' },
  { name: 'PostgreSQL 16', role: 'Datos y auditoría' },
  { name: 'React + TypeScript', role: 'Panel de revisión' },
  { name: 'Docker Compose', role: 'Despliegue local' },
];

const FLOW = ['EVIDENCIA_GUARDADA', 'EN_COLA', 'ANALIZADO', 'EN_REVISION', 'CONFIRMADO · DESCARTADO'];

export function Landing({ onEnter }: { onEnter: () => void }) {
  const [scrolled, setScrolled] = useState(false);
  const [menu, setMenu] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 12);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  const goTo = (id: string) => {
    setMenu(false);
    document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  return (
    <div className="lp">
      {/* ---------------- Navegación ---------------- */}
      <header className={`lp-nav ${scrolled ? 'scrolled' : ''}`}>
        <div className="lp-nav-inner">
          <button className="lp-brand" onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })} aria-label="Ir al inicio">
            <span className="brand-badge-icon"><img src="/argos-symbol.png" alt="" className="brand-logo-img" /></span>
            <span className="lp-brand-text">ARGOS</span>
          </button>

          <nav className={`lp-links ${menu ? 'open' : ''}`} aria-label="Secciones">
            {NAV.map(([id, label]) => (
              <button key={id} onClick={() => goTo(id)}>{label}</button>
            ))}
            <button className="primary-glass-btn lp-links-cta" onClick={onEnter}>Ingresar al panel</button>
          </nav>

          <div className="lp-nav-actions">
            <button className="primary-glass-btn" onClick={onEnter}>
              Ingresar <Icon name="arrow" />
            </button>
            <button className="lp-burger" aria-label="Menú" aria-expanded={menu} onClick={() => setMenu(!menu)}>☰</button>
          </div>
        </div>
      </header>

      <main>
        {/* ---------------- Hero ---------------- */}
        <section className="lp-hero lp-wrap">
          <div className="lp-hero-copy">
            <span className="lp-chip"><span className="live-dot-pulse" /> Prototipo experimental · UNS 2026-II</span>
            <h1>
              Una mirada precisa.<br />
              <span className="lp-grad">Una decisión siempre humana.</span>
            </h1>
            <p className="lp-lead">
              ARGOS detecta posibles excesos de velocidad con barreras láser, guarda evidencia fotográfica
              verificable y propone una placa candidata para que una persona autorizada tome la decisión final.
            </p>
            <div className="lp-hero-ctas">
              <button className="primary-glass-btn lp-btn-lg" onClick={onEnter}>
                Ingresar al panel <Icon name="arrow" />
              </button>
              <button className="glass-btn lp-btn-lg" onClick={() => goTo('como-funciona')}>
                Conocer el sistema
              </button>
            </div>
            <ul className="lp-hero-points">
              <li><Icon name="check" /> Evidencia con huella SHA-256</li>
              <li><Icon name="check" /> Auditoría que no se puede reescribir</li>
              <li><Icon name="check" /> Funciona en una laptop de campo</li>
            </ul>
          </div>

          <div className="lp-hero-visual">
            <Glass className="lp-hero-frame">
              <div className="lp-frame-bar">
                <span className="lp-dots"><i /><i /><i /></span>
                <span>Vista ilustrativa · punto de control</span>
              </div>
              <div className="lp-frame-img"><Road ev={DEMO_EVENT} /></div>
            </Glass>
            <div className="lp-float lp-float-a">
              <Icon name="speedometer" />
              <div><small>Medición</small><b>Barrera 1 → 2</b></div>
            </div>
            <div className="lp-float lp-float-b">
              <Icon name="hash" />
              <div><small>Integridad</small><b>SHA-256 verificado</b></div>
            </div>
            <div className="lp-float lp-float-c">
              <Icon name="shield" />
              <div><small>Dictamen</small><b>Revisor humano</b></div>
            </div>
          </div>
        </section>

        {/* ---------------- Franja de hechos ---------------- */}
        <section className="lp-wrap">
          <Glass className="lp-facts">
            <div><b>2</b><span>barreras láser sincronizadas por ESP32</span></div>
            <div><b>µs</b><span>resolución del tiempo de cruce</span></div>
            <div><b>3</b><span>intentos de análisis antes de marcar incierto</span></div>
            <div><b>100 %</b><span>de los dictámenes tomados por una persona</span></div>
          </Glass>
        </section>

        {/* ---------------- Cómo funciona ---------------- */}
        <section id="como-funciona" className="lp-section lp-wrap">
          <SectionHead eyebrow="Cómo funciona" title="Del cruce del vehículo al dictamen" sub="Cuatro etapas, cada una registrada en la auditoría del evento." />
          <div className="lp-steps">
            {STEPS.map((s, i) => (
              <Glass key={s.title} className="lp-step">
                <div className="lp-step-top">
                  <span className="lp-step-icon"><Icon name={s.icon} /></span>
                  <span className="lp-step-num">0{i + 1}</span>
                </div>
                <h3>{s.title}</h3>
                <p>{s.desc}</p>
              </Glass>
            ))}
          </div>
          <div className="lp-flow" aria-label="Ciclo de vida de un evento">
            {FLOW.map((f, i) => (
              <span key={f} className="lp-flow-item">
                <code>{f}</code>
                {i < FLOW.length - 1 && <span className="lp-flow-arrow">→</span>}
              </span>
            ))}
          </div>
        </section>

        {/* ---------------- Capas de decisión ---------------- */}
        <section id="decisiones" className="lp-section lp-wrap">
          <SectionHead eyebrow="Capas de decisión" title="La tecnología filtra y ordena. La persona decide." sub="Ninguna regla automática confirma una infracción." />
          <div className="lp-decisions">
            {DECISIONS.map((d) => (
              <Glass key={d.tag} className={`lp-decision ${d.highlight ? 'highlight' : ''}`}>
                <span className="lp-tag">{d.tag}</span>
                <h3>{d.title}</h3>
                <p>{d.desc}</p>
              </Glass>
            ))}
          </div>
        </section>

        {/* ---------------- Garantías ---------------- */}
        <section id="garantias" className="lp-section lp-wrap">
          <SectionHead eyebrow="Trazabilidad" title="Garantías integradas en el diseño" sub="No dependen de la buena voluntad del operador: las aplica el sistema." />
          <div className="lp-guarantees">
            {GUARANTEES.map((g) => (
              <Glass key={g.title} className="lp-guarantee">
                <span className="lp-g-icon"><Icon name={g.icon} /></span>
                <div>
                  <h3>{g.title}</h3>
                  <p>{g.desc}</p>
                </div>
              </Glass>
            ))}
          </div>
        </section>

        {/* ---------------- Tecnología ---------------- */}
        <section id="tecnologia" className="lp-section lp-wrap">
          <div className="lp-tech">
            <div>
              <SectionHead eyebrow="Tecnología" title="Arquitectura local y abierta" sub="Todo corre en una laptop de campo. El agente de captura trabaja fuera de Docker para acceder al puerto USB del ESP32 y a la cámara con baja latencia." left />
              <div className="lp-privacy">
                <Icon name="shield" />
                <p>
                  Las evidencias permanecen en el equipo de campo y el servidor las monta en solo lectura.
                  El tratamiento de datos personales se rige por la <b>Ley N.° 29733</b>.
                </p>
              </div>
            </div>
            <Glass className="lp-stack">
              {STACK.map((s) => (
                <div key={s.name} className="lp-stack-item">
                  <b>{s.name}</b>
                  <span>{s.role}</span>
                </div>
              ))}
            </Glass>
          </div>
        </section>

        {/* ---------------- Llamado final ---------------- */}
        <section className="lp-section lp-wrap">
          <Glass className="lp-cta">
            <div>
              <h2>¿Eres parte del equipo de revisión?</h2>
              <p>Ingresa al panel para revisar la cola de eventos priorizada y emitir dictámenes.</p>
            </div>
            <button className="primary-glass-btn lp-btn-lg" onClick={onEnter}>
              Ingresar al panel <Icon name="arrow" />
            </button>
          </Glass>
        </section>
      </main>

      <footer className="lp-footer lp-wrap">
        <div className="lp-footer-brand">
          <span className="brand-badge-icon"><img src="/argos-symbol.png" alt="" className="brand-logo-img" /></span>
          <div>
            <b>ARGOS</b>
            <small>Sistema de detección de exceso de velocidad</small>
          </div>
        </div>
        <div className="lp-footer-links">
          {NAV.map(([id, label]) => (
            <button key={id} onClick={() => goTo(id)}>{label}</button>
          ))}
        </div>
        <small className="lp-footer-note">
          Prototipo académico · Ingeniería de Software II · Universidad Nacional del Santa · Nuevo Chimbote, 2026
        </small>
      </footer>
    </div>
  );
}

function SectionHead({ eyebrow, title, sub, left = false }: { eyebrow: string; title: string; sub: string; left?: boolean }) {
  return (
    <div className={`lp-head ${left ? 'left' : ''}`}>
      <span className="lp-eyebrow">{eyebrow}</span>
      <h2>{title}</h2>
      <p>{sub}</p>
    </div>
  );
}
