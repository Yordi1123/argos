import { useState } from 'react';
import { api, type Sesion } from './api';
import { Glass } from './components';

const MIN = 10;

/**
 * Cambio de contraseña. `obligatorio`: tras ingresar con una contraseña temporal (el backend bloquea todo lo
 * demás hasta cambiarla). Si no, se abre desde el menú del perfil y puede cancelarse.
 */
export function CambioContrasena({ user, obligatorio, onListo, onCancelar }: {
  user: Sesion; obligatorio: boolean; onListo: () => void; onCancelar: () => void;
}) {
  const [actual, setActual] = useState('');
  const [nueva, setNueva] = useState('');
  const [repite, setRepite] = useState('');
  const [ver, setVer] = useState(false);
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reglas = [
    { ok: nueva.length >= MIN, txt: `Al menos ${MIN} caracteres (una frase es más fácil de recordar)` },
    { ok: !!nueva && nueva !== actual, txt: 'Distinta de la contraseña actual' },
    { ok: !!nueva && nueva.toLowerCase() !== user.email.toLowerCase(), txt: 'Distinta de tu correo' },
    { ok: !!nueva && nueva === repite, txt: 'Ambas contraseñas coinciden' },
  ];
  const valida = !!actual && reglas.every((r) => r.ok);

  const enviar = async (ev: React.FormEvent) => {
    ev.preventDefault();
    setEnviando(true);
    setError(null);
    try {
      await api.cambiarContrasena(actual, nueva);
      onListo();
    } catch (e) {
      setError((e as Error).message);
      setEnviando(false);
    }
  };

  const campo = (id: string, label: string, valor: string, set: (v: string) => void, auto: string) => (
    <div className="login-input-group">
      <label className="login-label" htmlFor={id}>{label}</label>
      <div className="login-glass-input-box">
        <input
          id={id} className="login-glass-input" type={ver ? 'text' : 'password'} required maxLength={128}
          autoComplete={auto} value={valor} onChange={(e) => set(e.target.value)}
        />
      </div>
    </div>
  );

  return (
    <Glass className="v5-login-card" role="dialog" aria-labelledby="cc-titulo">
      <div className="login-card-header">
        <span className="card-security-pill">
          <span className="live-dot-pulse green" /> {user.email}
        </span>
        <h1 className="login-card-title" id="cc-titulo">
          {obligatorio ? 'Crea tu contraseña' : 'Cambiar contraseña'}
        </h1>
        <p className="login-card-sub">
          {obligatorio
            ? 'Ingresaste con una contraseña temporal. Antes de usar el panel, elige una contraseña personal que solo tú conozcas.'
            : 'Al cambiarla se cerrarán tus sesiones abiertas en otros navegadores.'}
        </p>
      </div>

      {error && <div className="lg-alerta error" role="alert">{error}</div>}

      <form className="login-fields-list" onSubmit={enviar}>
        {campo('cc-actual', obligatorio ? 'Contraseña temporal' : 'Contraseña actual', actual, setActual, 'current-password')}
        {campo('cc-nueva', 'Nueva contraseña', nueva, setNueva, 'new-password')}
        {campo('cc-repite', 'Repite la nueva contraseña', repite, setRepite, 'new-password')}

        <ul className="lg-requisitos" aria-live="polite">
          {reglas.map((r) => <li key={r.txt} className={r.ok ? 'ok' : ''}>{r.txt}</li>)}
        </ul>
        <label className="login-label" style={{ cursor: 'pointer' }}>
          <input type="checkbox" checked={ver} onChange={(e) => setVer(e.target.checked)} /> Mostrar contraseñas
        </label>

        <div className="lg-acciones">
          <button type="button" className="glass-btn" onClick={onCancelar}>
            {obligatorio ? 'Cerrar sesión' : 'Cancelar'}
          </button>
          <button className="login-submit-btn" type="submit" disabled={!valida || enviando}>
            {enviando ? 'Guardando…' : 'Guardar contraseña'}
          </button>
        </div>
      </form>
    </Glass>
  );
}
