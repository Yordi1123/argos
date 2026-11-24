import { useEffect, useRef, useState } from 'react';
import { api, type Sesion } from './api';
import { cargarGis } from './google';
import { Glass, Icon } from './components';
import './login.css';

/** Logo oficial "G" de Google (permitido en botones de "Continuar con Google"). */
function LogoGoogle() {
  return (
    <svg viewBox="0 0 48 48" className="lg-g-logo" aria-hidden>
      <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z" />
      <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z" />
      <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z" />
      <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z" />
    </svg>
  );
}

/**
 * Acceso al panel. Método vigente: correo + contraseña emitida por un administrador.
 * Google es implementación futura: el botón es ilustrativo salvo que el servidor tenga GOOGLE_CLIENT_ID,
 * en cuyo caso se muestra el botón real de Google Identity Services.
 */
export function Login({ onSesion, onBack, aviso }: { onSesion: (s: Sesion) => void; onBack: () => void; aviso?: string }) {
  const [email, setEmail] = useState('');
  const [clave, setClave] = useState('');
  const [ver, setVer] = useState(false);
  const [mayus, setMayus] = useState(false);
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [googleListo, setGoogleListo] = useState(false);
  const botonGoogle = useRef<HTMLDivElement>(null);

  // Solo si el servidor ya tiene Google configurado se carga su script; si no, el botón queda ilustrativo.
  useEffect(() => {
    let vivo = true;
    api.authConfig()
      .then(async ({ google_client_id }) => {
        if (!google_client_id) return;
        const gis = await cargarGis();
        if (!vivo || !botonGoogle.current) return;
        gis.initialize({
          client_id: google_client_id, ux_mode: 'popup', auto_select: false,
          callback: ({ credential }) => {
            setError(null);
            api.entrarConGoogle(credential).then(onSesion).catch((e: Error) => setError(e.message));
          },
        });
        gis.renderButton(botonGoogle.current, {
          type: 'standard', theme: 'outline', size: 'large', shape: 'rectangular',
          text: 'continue_with', locale: 'es-419', width: 360,
        });
        setGoogleListo(true);
      })
      .catch(() => { /* sin Google: queda el botón ilustrativo */ });
    return () => { vivo = false; };
  }, [onSesion]);

  const enviar = async (ev: React.FormEvent) => {
    ev.preventDefault();
    setEnviando(true);
    setError(null);
    try {
      onSesion(await api.ingresar(email.trim(), clave));
    } catch (e) {
      const err = e as Error & { status?: number };
      setError(err.status === undefined || err.status >= 500
        ? 'No se pudo contactar con el servidor ARGOS. Revisa que el sistema esté en marcha.'
        : err.message);
      setClave('');
      setEnviando(false);
    }
  };

  const detectarMayus = (e: React.KeyboardEvent) => setMayus(e.getModifierState?.('CapsLock') ?? false);

  return (
    <div className="v5-login-layout">
      <button className="glass-btn sm login-back-btn" onClick={onBack}>
        ← Volver al inicio
      </button>

      <div className="login-visual-panel">
        <div className="login-brand-suite">
          <div className="brand-badge-icon large">
            <img src="/argos-symbol.png" alt="Logo ARGOS" className="brand-logo-img" />
          </div>
          <div>
            <div className="login-brand-main">ARGOS</div>
            <div className="login-brand-sub">SISTEMA INTELIGENTE DE VISIÓN VIAL</div>
          </div>
        </div>

        <div className="eyebrow-tag" style={{ marginTop: 40 }}>
          <span className="live-dot-pulse" /> PANEL DE REVISIÓN HUMANA
        </div>
        <h1>Una mirada precisa.<br />Una ciudad más segura.</h1>
        <p className="muted" style={{ maxWidth: 460 }}>
          La visión artificial propone; una persona decide. Cada dictamen queda firmado y auditado a tu nombre.
        </p>

        <ul className="lg-garantias">
          <li><span className="lg-garantia-ico"><Icon name="shield" /></span>
            <div><b>Evidencia íntegra</b><small>Cada foto se verifica con SHA-256 antes de mostrarse.</small></div></li>
          <li><span className="lg-garantia-ico"><Icon name="users" /></span>
            <div><b>Decisión humana</b><small>Solo un revisor autorizado confirma o descarta un evento.</small></div></li>
          <li><span className="lg-garantia-ico"><Icon name="hash" /></span>
            <div><b>Trazabilidad completa</b><small>Ingresos, dictámenes y cambios quedan en una auditoría inalterable.</small></div></li>
        </ul>
      </div>

      <Glass className="v5-login-card">
        <div className="login-card-header">
          <span className="card-security-pill">
            <span className="live-dot-pulse green" /> Acceso restringido · personal autorizado
          </span>
          <h1 className="login-card-title">Iniciar sesión</h1>
          <p className="login-card-sub">Usa la cuenta que te asignó el administrador de ARGOS.</p>
        </div>

        {aviso && !error && <div className="lg-alerta info" role="status">{aviso}</div>}
        {error && <div className="lg-alerta error" role="alert">{error}</div>}

        <form className="login-fields-list" onSubmit={enviar} noValidate={false}>
          <div className="login-input-group">
            <label className="login-label" htmlFor="lg-email">Correo electrónico</label>
            <div className="login-glass-input-box">
              <span className="lg-campo-ico" aria-hidden>@</span>
              <input
                id="lg-email" className="login-glass-input" type="email" required autoFocus
                autoComplete="username" placeholder="nombre@gmail.com" maxLength={254}
                value={email} onChange={(e) => setEmail(e.target.value)}
              />
            </div>
          </div>

          <div className="login-input-group">
            <label className="login-label" htmlFor="lg-clave">Contraseña</label>
            <div className="login-glass-input-box">
              <span className="lg-campo-ico" aria-hidden>
                <svg viewBox="0 0 24 24"><rect x="5" y="11" width="14" height="10" rx="2" /><path d="M8 11V8a4 4 0 0 1 8 0v3" /></svg>
              </span>
              <input
                id="lg-clave" className="login-glass-input" type={ver ? 'text' : 'password'} required
                autoComplete="current-password" placeholder="Tu contraseña" maxLength={256}
                value={clave} onChange={(e) => setClave(e.target.value)}
                onKeyUp={detectarMayus} onKeyDown={detectarMayus}
              />
              <button
                type="button" className="lg-ver-btn" onClick={() => setVer(!ver)}
                aria-label={ver ? 'Ocultar contraseña' : 'Mostrar contraseña'} aria-pressed={ver}
              >
                {ver ? 'Ocultar' : 'Mostrar'}
              </button>
            </div>
            {mayus && <small className="lg-mayus">⇪ Bloq Mayús está activado</small>}
          </div>

          <button className="login-submit-btn" type="submit" disabled={enviando || !email || !clave}>
            {enviando ? 'Verificando…' : <>Ingresar al panel <span className="btn-arrow-icon">→</span></>}
          </button>
        </form>

        <div className="lg-separador"><span>o</span></div>

        <div ref={botonGoogle} className="lg-google-real" hidden={!googleListo} />
        {!googleListo && (
          <button
            type="button" className="lg-google-btn" disabled aria-disabled
            title="Próximamente: inicio de sesión con cuentas de Google autorizadas"
          >
            <LogoGoogle />
            <span>Continuar con Google</span>
            <span className="lg-pronto">Próximamente</span>
          </button>
        )}

        <p className="lg-ayuda">
          ¿Olvidaste tu contraseña o se bloqueó tu cuenta? Pide a un administrador que la restablezca.
        </p>

        <div className="login-footer-info">
          <span className="security-icon-dot">🛡️</span>
          <span>Conexión local · Sesión de una jornada · v{__APP_VERSION__}</span>
        </div>
      </Glass>
    </div>
  );
}
