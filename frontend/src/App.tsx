import { useCallback, useEffect, useState } from "react";
import { api } from "./api";
import type { Decision, Estado, EventoDetalle, EventoResumen, Usuario } from "./tipos";

const FILTROS: { valor: Estado | ""; texto: string }[] = [
  { valor: "EN_REVISION", texto: "Por revisar" },
  { valor: "INCIERTO", texto: "Inciertos" },
  { valor: "EN_COLA", texto: "En cola" },
  { valor: "CONFIRMADO", texto: "Confirmados" },
  { valor: "DESCARTADO", texto: "Descartados" },
  { valor: "", texto: "Todos" },
];

const ETIQUETA: Record<Estado, string> = {
  EVIDENCIA_GUARDADA: "Evidencia guardada",
  EN_COLA: "En cola",
  ANALIZADO: "Analizado",
  EN_REVISION: "Por revisar",
  CONFIRMADO: "Confirmado",
  DESCARTADO: "Descartado",
  INCIERTO: "Incierto",
};

const hora = (iso: string) =>
  new Date(iso).toLocaleString("es-PE", { dateStyle: "short", timeStyle: "medium" });
const pct = (v: string | null) => (v == null ? "—" : `${Math.round(Number(v) * 100)} %`);

export default function App() {
  const [usuarios, setUsuarios] = useState<Usuario[]>([]);
  const [revisorId, setRevisorId] = useState<number | null>(null);
  const [filtro, setFiltro] = useState<Estado | "">("EN_REVISION");
  const [eventos, setEventos] = useState<EventoResumen[]>([]);
  const [seleccion, setSeleccion] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.usuarios().then((us) => {
      const revisores = us.filter((u) => u.rol === "REVISOR" || u.rol === "ADMINISTRADOR");
      setUsuarios(revisores);
      setRevisorId(revisores.find((u) => u.rol === "REVISOR")?.id ?? revisores[0]?.id ?? null);
    }).catch((e) => setError(e.message));
  }, []);

  const recargar = useCallback(() => {
    api.eventos(filtro || undefined)
      .then((evs) => { setEventos(evs); setError(null); })
      .catch((e) => setError(e.message));
  }, [filtro]);

  useEffect(() => {
    recargar();
    const t = setInterval(recargar, 5000);
    return () => clearInterval(t);
  }, [recargar]);

  return (
    <div className="app">
      <header>
        <div className="marca">ARGOS <span>· Panel de revisión</span></div>
        <label className="revisor">
          Revisor
          <select value={revisorId ?? ""} onChange={(e) => setRevisorId(Number(e.target.value))}>
            {usuarios.map((u) => <option key={u.id} value={u.id}>{u.nombre}</option>)}
          </select>
        </label>
      </header>

      {error && <div className="aviso">{error}</div>}

      <nav className="filtros">
        {FILTROS.map((f) => (
          <button key={f.texto} className={filtro === f.valor ? "activo" : ""}
            onClick={() => { setFiltro(f.valor); setSeleccion(null); }}>
            {f.texto}
          </button>
        ))}
      </nav>

      <main>
        <section className="lista">
          {eventos.length === 0 ? (
            <p className="vacio">No hay eventos en este estado.</p>
          ) : (
            <table>
              <thead>
                <tr><th>Hora</th><th>Velocidad</th><th>Placa candidata</th><th>Confianza</th><th>Prioridad</th><th>Estado</th></tr>
              </thead>
              <tbody>
                {eventos.map((ev) => (
                  <tr key={ev.id} className={seleccion === ev.id ? "sel" : ""} onClick={() => setSeleccion(ev.id)}>
                    <td>{hora(ev.ocurrido_en)}</td>
                    <td className="num">
                      <strong>{Number(ev.velocidad_kmh).toFixed(1)}</strong> / {Number(ev.limite_kmh)} km/h
                    </td>
                    <td className="placa">{ev.placa_candidata ?? "—"}</td>
                    <td className="num">{pct(ev.confianza)}</td>
                    <td className="num">{ev.puntaje_utilidad ?? "—"}</td>
                    <td><span className={`estado e-${ev.estado}`}>{ETIQUETA[ev.estado]}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>

        {seleccion && (
          <Detalle key={seleccion} id={seleccion} revisorId={revisorId}
            alDecidir={() => { recargar(); setSeleccion(null); }} />
        )}
      </main>
    </div>
  );
}

function Detalle({ id, revisorId, alDecidir }: { id: string; revisorId: number | null; alDecidir: () => void }) {
  const [ev, setEv] = useState<EventoDetalle | null>(null);
  const [placa, setPlaca] = useState("");
  const [comentario, setComentario] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.evento(id).then((d) => {
      setEv(d);
      const ultimo = [...d.analisis].reverse().find((a) => !a.error);
      setPlaca(ultimo?.placa_candidata ?? "");
    }).catch((e) => setError(e.message));
  }, [id]);

  if (!ev) return <aside className="detalle">{error ?? "Cargando…"}</aside>;

  const foto = ev.evidencias.find((e) => e.tipo === "FOTO");
  const puedeRevisar = ev.estado === "EN_REVISION" || ev.estado === "INCIERTO";

  const decidir = async (decision: Decision) => {
    if (revisorId == null) return setError("Selecciona un revisor");
    if (decision === "CONFIRMAR" && !placa.trim()) {
      return setError("Escribe la placa antes de confirmar");
    }
    setEnviando(true);
    try {
      await api.revisar(ev.id, revisorId, decision, placa.trim(), comentario.trim());
      alDecidir();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setEnviando(false);
    }
  };

  return (
    <aside className="detalle">
      {foto ? <img src={api.urlEvidencia(foto.id)} alt="Evidencia del vehículo" /> : <div className="sinfoto">Sin foto</div>}

      <dl>
        <dt>Velocidad</dt><dd><strong>{Number(ev.velocidad_kmh).toFixed(2)} km/h</strong> (límite {Number(ev.limite_kmh)} ± {Number(ev.incertidumbre_kmh)})</dd>
        <dt>Tiempo de paso</dt><dd>{((ev.t2_us - ev.t1_us) / 1000).toFixed(1)} ms en {Number(ev.distancia_m)} m</dd>
        <dt>Ubicación</dt><dd>{ev.ubicacion}</dd>
        <dt>Hora</dt><dd>{hora(ev.ocurrido_en)}</dd>
        <dt>Estado</dt><dd><span className={`estado e-${ev.estado}`}>{ETIQUETA[ev.estado]}</span></dd>
        {ev.motivo_incierto && (<><dt>Motivo</dt><dd>{ev.motivo_incierto}</dd></>)}
        {foto && (<><dt>SHA-256</dt><dd className="hash">{foto.sha256}</dd></>)}
      </dl>

      {puedeRevisar && (
        <div className="revision">
          <label>Placa
            <input value={placa} maxLength={10} onChange={(e) => { setPlaca(e.target.value.toUpperCase()); setError(null); }} placeholder="ABC-123" />
          </label>
          <label>Comentario
            <textarea value={comentario} onChange={(e) => setComentario(e.target.value)} rows={2} />
          </label>
          {error && <p className="error">{error}</p>}
          <div className="botones">
            <button className="confirmar" disabled={enviando} onClick={() => decidir("CONFIRMAR")}>Confirmar</button>
            <button disabled={enviando} onClick={() => decidir("MARCAR_INCIERTO")}>Incierto</button>
            <button className="descartar" disabled={enviando} onClick={() => decidir("DESCARTAR")}>Descartar</button>
          </div>
        </div>
      )}

      {ev.revisiones.length > 0 && (
        <>
          <h3>Revisiones</h3>
          <ul className="historial">
            {ev.revisiones.map((r, i) => (
              <li key={i}>{hora(r.creado_en)} · {r.revisor}: {r.decision}{r.placa_final ? ` · ${r.placa_final}` : ""}{r.comentario ? ` · “${r.comentario}”` : ""}</li>
            ))}
          </ul>
        </>
      )}

      <h3>Trazabilidad</h3>
      <ul className="historial">
        {ev.auditoria.map((a) => (
          <li key={a.id}>
            {hora(a.creado_en)} · {a.actor} · {a.accion}
            {a.estado_nuevo && ` → ${ETIQUETA[a.estado_nuevo]}`}
          </li>
        ))}
      </ul>
    </aside>
  );
}
