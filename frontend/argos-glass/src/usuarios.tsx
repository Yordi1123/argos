import { useCallback, useEffect, useState } from 'react';
import { api, ROL_UI, type Rol, type Sesion, type Usuario, type UsuarioConClave } from './api';
import { Glass, Heading, Icon } from './components';
import './usuarios.css';

const ROLES: Rol[] = ['REVISOR', 'OPERADOR', 'ADMINISTRADOR'];

const MATRIZ: [Rol, string, string][] = [
  ['REVISOR', 'Examina la evidencia y emite el dictamen final de cada evento', 'Revisión y dictamen'],
  ['OPERADOR', 'Abre y cierra jornadas de captura; consulta eventos sin decidir', 'Monitoreo (lectura)'],
  ['ADMINISTRADOR', 'Autoriza cuentas, asigna roles y también puede revisar', 'Control total'],
];

const fecha = (iso: string | null) =>
  iso ? new Date(iso).toLocaleString('es-PE', { timeZone: 'America/Lima', dateStyle: 'medium', timeStyle: 'short' }) : 'Nunca';

/** Contraseña temporal recién generada: se muestra una sola vez y debe entregarse en persona. */
function ClaveTemporal({ u, onCerrar }: { u: UsuarioConClave; onCerrar: () => void }) {
  const [copiada, setCopiada] = useState(false);
  const copiar = () => {
    navigator.clipboard?.writeText(u.contrasena_temporal).then(() => setCopiada(true)).catch(() => { /* copia manual */ });
  };
  return (
    <div className="v5-modal-backdrop">
      <div className="v5-modal usr-clave-modal" role="dialog" aria-labelledby="usr-clave-titulo">
        <span className="card-security-pill"><span className="live-dot-pulse green" /> Credencial generada</span>
        <h2 id="usr-clave-titulo">Contraseña temporal de {u.nombre}</h2>
        <p className="muted">Entrégala en persona. <b>No se volverá a mostrar</b>: si se pierde, restablécela otra vez.</p>
        <dl className="usr-credencial">
          <dt>Correo</dt><dd>{u.email}</dd>
          <dt>Contraseña temporal</dt><dd className="usr-clave">{u.contrasena_temporal}</dd>
        </dl>
        <p className="muted usr-note">Al ingresar, ARGOS le pedirá crear su propia contraseña.</p>
        <div className="usr-modal-acciones">
          <button className="glass-btn" onClick={copiar}>{copiada ? '✓ Copiada' : 'Copiar contraseña'}</button>
          <button className="primary-glass-btn" onClick={onCerrar}>Ya la entregué</button>
        </div>
      </div>
    </div>
  );
}

/**
 * Administración de cuentas. Datos propios de la página: los pide a api.ts directamente
 * (no son estado global). La autorización real la aplica el backend (403 si no eres ADMINISTRADOR).
 */
export function Users({ yo, toast, onMiNombre }: {
  yo: Sesion; toast: (t: string) => void; onMiNombre: (nombre: string) => void;
}) {
  const [lista, setLista] = useState<Usuario[] | null>(null);
  const [form, setForm] = useState({ email: '', nombre: '', rol: 'REVISOR' as Rol });
  const [enviando, setEnviando] = useState(false);
  const [ocupado, setOcupado] = useState<number | null>(null);
  const [credencial, setCredencial] = useState<UsuarioConClave | null>(null);
  const [editando, setEditando] = useState<{ id: number; nombre: string } | null>(null);

  const guardarNombre = async () => {
    if (!editando) return;
    const nombre = editando.nombre.trim();
    if (!nombre) { toast('El nombre no puede quedar vacío'); return; }
    setOcupado(editando.id);
    try {
      await api.modificarUsuario(editando.id, { nombre });
      if (editando.id === yo.id) onMiNombre(nombre);
      toast('Nombre actualizado');
      setEditando(null);
      cargar();
    } catch (e) {
      toast((e as Error).message);
    } finally {
      setOcupado(null);
    }
  };

  const cargar = useCallback(() => {
    api.usuarios().then(setLista).catch((e: Error) => toast(e.message));
  }, [toast]);

  useEffect(() => { cargar(); }, [cargar]);

  const autorizar = async (ev: React.FormEvent) => {
    ev.preventDefault();
    setEnviando(true);
    try {
      const u = await api.crearUsuario(form.email.trim(), form.rol, form.nombre);
      setCredencial(u);
      setForm({ email: '', nombre: '', rol: form.rol });
      cargar();
    } catch (e) {
      toast((e as Error).message);
    } finally {
      setEnviando(false);
    }
  };

  const cambiar = async (u: Usuario, cambios: Partial<Pick<Usuario, 'rol' | 'activo'>>, mensaje: string) => {
    setOcupado(u.id);
    try {
      await api.modificarUsuario(u.id, cambios);
      toast(mensaje);
      cargar();
    } catch (e) {
      toast((e as Error).message);
    } finally {
      setOcupado(null);
    }
  };

  const restablecer = async (u: Usuario) => {
    if (!window.confirm(`¿Generar una contraseña temporal nueva para ${u.email}? Se cerrarán sus sesiones abiertas.`)) return;
    setOcupado(u.id);
    try {
      setCredencial(await api.restablecerContrasena(u.id));
      cargar();
    } catch (e) {
      toast((e as Error).message);
    } finally {
      setOcupado(null);
    }
  };

  const estado = (u: Usuario): [string, string] =>
    !u.activo ? ['discard', 'Desactivado']
      : u.bloqueado ? ['alert', 'Bloqueado por intentos']
        : u.debe_cambiar_contrasena ? ['pending', 'Contraseña temporal']
          : ['valid', 'Activo'];

  const activos = lista?.filter((u) => u.activo).length ?? 0;

  return (
    <>
      <Heading
        title="Administración de Accesos"
        sub="Solo las cuentas creadas aquí pueden entrar al panel. Cada dictamen queda firmado por quien lo emite."
        actions={<span className="tag-pill">{activos} cuenta{activos === 1 ? '' : 's'} activa{activos === 1 ? '' : 's'}</span>}
      />

      <div className="v5-analytics-grid equal">
        <Glass>
          <h2>Crear una cuenta</h2>
          <small className="muted">ARGOS genera una contraseña temporal que la persona cambiará en su primer ingreso.</small>
          <form className="usr-form" onSubmit={autorizar}>
            <label>
              <span>Correo</span>
              <input
                type="email" required placeholder="nombre@gmail.com" autoComplete="off"
                value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })}
              />
            </label>
            <label>
              <span>Nombre y apellido</span>
              <input
                type="text" required maxLength={120} placeholder="Como aparecerá en los dictámenes"
                value={form.nombre} onChange={(e) => setForm({ ...form, nombre: e.target.value })}
              />
            </label>
            <label>
              <span>Rol</span>
              <select value={form.rol} onChange={(e) => setForm({ ...form, rol: e.target.value as Rol })}>
                {ROLES.map((r) => <option key={r} value={r}>{ROL_UI[r]}</option>)}
              </select>
            </label>
            <button className="primary-glass-btn" type="submit" disabled={enviando}>
              <Icon name="check" /> {enviando ? 'Creando…' : 'Crear cuenta'}
            </button>
          </form>
        </Glass>

        <Glass>
          <h2>Roles y facultades</h2>
          <div className="table-responsive">
            <table className="glass-table usr-matriz">
              <thead><tr><th>Rol</th><th>Responsabilidad</th><th>Acceso</th></tr></thead>
              <tbody>
                {MATRIZ.map(([rol, resp, acceso]) => (
                  <tr key={rol}>
                    <td><b>{ROL_UI[rol]}</b></td>
                    <td>{resp}</td>
                    <td><span className="tag-pill">{acceso}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="muted usr-note">
            Cambiar el rol, desactivar una cuenta o restablecer su contraseña cierra sus sesiones al instante.
            Tras 5 intentos fallidos la cuenta se bloquea 15 min; restablecer la contraseña la desbloquea.
            Las cuentas no se eliminan: sus dictámenes deben seguir atribuidos a ellas.
          </p>
        </Glass>
      </div>

      <Glass style={{ marginTop: 20 }}>
        <div className="card-top-row">
          <h2>Cuentas</h2>
          <button className="glass-btn sm" onClick={cargar}>↻ Actualizar</button>
        </div>
        <div className="table-responsive">
          <table className="glass-table">
            <thead>
              <tr><th>Persona</th><th>Rol</th><th>Estado</th><th>Último acceso</th><th style={{ textAlign: 'right' }}>Acciones</th></tr>
            </thead>
            <tbody>
              {lista === null && <tr><td colSpan={5} className="empty-cell">Cargando…</td></tr>}
              {lista?.length === 0 && <tr><td colSpan={5} className="empty-cell">No hay cuentas.</td></tr>}
              {lista?.map((u) => {
                const soyYo = u.id === yo.id;
                return (
                  <tr key={u.id} className={u.activo ? '' : 'usr-inactivo'}>
                    <td>
                      {editando?.id === u.id ? (
                        <form className="usr-nombre-edit" onSubmit={(e) => { e.preventDefault(); void guardarNombre(); }}>
                          <input
                            autoFocus maxLength={120} aria-label={`Nombre de ${u.email}`} value={editando.nombre}
                            onChange={(e) => setEditando({ id: u.id, nombre: e.target.value })}
                            onKeyDown={(e) => { if (e.key === 'Escape') setEditando(null); }}
                          />
                          <button className="glass-btn sm" type="submit" disabled={ocupado === u.id}>Guardar</button>
                          <button className="glass-btn sm" type="button" onClick={() => setEditando(null)}>Cancelar</button>
                        </form>
                      ) : (
                        <>
                          <b>{u.nombre.includes('@') ? <span className="muted">Sin nombre</span> : u.nombre}</b>
                          {soyYo && <span className="tag-pill usr-tu">Tú</span>}
                          <button
                            className="usr-editar" title="Editar nombre" aria-label={`Editar nombre de ${u.email}`}
                            onClick={() => setEditando({ id: u.id, nombre: u.nombre.includes('@') ? '' : u.nombre })}
                          >
                            <Icon name="edit" />
                          </button>
                        </>
                      )}
                      <small className="usr-email">{u.email}</small>
                    </td>
                    <td>
                      <select
                        aria-label={`Rol de ${u.email}`}
                        value={u.rol}
                        disabled={soyYo || !u.activo || ocupado === u.id}
                        onChange={(e) => {
                          const rol = e.target.value as Rol;
                          void cambiar(u, { rol }, `${u.email} ahora es ${ROL_UI[rol]}`);
                        }}
                      >
                        {ROLES.map((r) => <option key={r} value={r}>{ROL_UI[r]}</option>)}
                      </select>
                    </td>
                    <td>
                      <span className={`badge-pill ${estado(u)[0]}`}>
                        <span className="b-dot" />{estado(u)[1]}
                      </span>
                    </td>
                    <td><small>{fecha(u.ultimo_acceso)}</small></td>
                    <td className="usr-acciones">
                      {!soyYo && u.activo && (
                        <button className="glass-btn sm" disabled={ocupado === u.id} onClick={() => void restablecer(u)}>
                          Restablecer contraseña
                        </button>
                      )}
                      {!soyYo && (
                        <button
                          className={`glass-btn sm ${u.activo ? 'danger' : ''}`}
                          disabled={ocupado === u.id}
                          onClick={() => void cambiar(u, { activo: !u.activo },
                            u.activo ? `${u.email} desactivado: ya no puede entrar` : `${u.email} reactivado`)}
                        >
                          {u.activo ? 'Desactivar' : 'Reactivar'}
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Glass>

      {credencial && <ClaveTemporal u={credencial} onCerrar={() => setCredencial(null)} />}
    </>
  );
}
