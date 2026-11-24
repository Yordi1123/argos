import { useCallback, useEffect, useRef, useState } from 'react';
import { api, type DeteccionPlaca, type EstadoVision } from './api';
import { Glass, Icon, PlateTag } from './components';
import { useInterval } from './hooks';
import './vision.css';

const LIMITE_DIRECTO_BYTES = 650_000;
const LADO_MAX_PX = 1600;

function leerComoDataUrl(archivo: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const lector = new FileReader();
    lector.onload = () => resolve(String(lector.result ?? ''));
    lector.onerror = () => reject(new Error('No se pudo leer el archivo seleccionado'));
    lector.readAsDataURL(archivo);
  });
}

async function prepararImagenBase64(archivo: File): Promise<string> {
  const original = await leerComoDataUrl(archivo);
  if (archivo.size <= LIMITE_DIRECTO_BYTES) return original;

  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const escala = Math.min(1, LADO_MAX_PX / Math.max(img.naturalWidth, img.naturalHeight, 1));
      const ancho = Math.max(1, Math.round(img.naturalWidth * escala));
      const alto = Math.max(1, Math.round(img.naturalHeight * escala));
      const lienzo = document.createElement('canvas');
      lienzo.width = ancho;
      lienzo.height = alto;
      const ctx = lienzo.getContext('2d');
      if (!ctx) {
        resolve(original);
        return;
      }
      ctx.drawImage(img, 0, 0, ancho, alto);
      resolve(lienzo.toDataURL('image/jpeg', 0.88));
    };
    img.onerror = () => reject(new Error('El archivo no es una imagen válida'));
    img.src = original;
  });
}

const reducirMovimiento = () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;

/** Cuenta de 0 al valor (≈0,65 s, desacelerando). El componente se monta de nuevo con cada resultado (key). */
function useConteo(objetivo: number | null, ms = 650) {
  const [progreso, setProgreso] = useState(0);
  const animar = objetivo != null && !reducirMovimiento();
  useEffect(() => {
    if (!animar) return;
    let cuadro = 0;
    const inicio = performance.now();
    const paso = (t: number) => {
      const p = Math.min(1, (t - inicio) / ms);
      setProgreso(1 - (1 - p) ** 3);
      if (p < 1) cuadro = requestAnimationFrame(paso);
    };
    cuadro = requestAnimationFrame(paso);
    return () => cancelAnimationFrame(cuadro);
  }, [animar, ms]);
  if (objetivo == null) return 0;
  return animar ? objetivo * progreso : objetivo;
}

/** Placa revelada carácter a carácter, como la va leyendo el OCR (se monta de nuevo con cada resultado). */
function PlacaEscrita({ placa }: { placa: string | null }) {
  const [n, setN] = useState(0);
  const animar = !!placa && !reducirMovimiento();
  useEffect(() => {
    if (!animar || !placa) return;
    const id = window.setInterval(() => {
      setN((k) => {
        if (k + 1 >= placa.length) window.clearInterval(id);
        return Math.min(placa.length, k + 1);
      });
    }, 70);
    return () => window.clearInterval(id);
  }, [animar, placa]);
  if (!placa) return <PlateTag plate="???-???" big />;
  const visibles = animar ? n : placa.length;
  return <PlateTag plate={placa.slice(0, visibles) + placa.slice(visibles).replace(/[A-Z0-9]/g, '·')} big />;
}

const nivel = (v: number) => (v >= 0.75 ? 'alta' : v >= 0.45 ? 'media' : 'baja');

function Medidor({ etiqueta, valor, vacio = '—', orden }: { etiqueta: string; valor: number | null; vacio?: string; orden: number }) {
  const animado = useConteo(valor);
  return (
    <div className="vis-medidor vis-revela" style={{ '--i': orden } as React.CSSProperties}>
      <small>{etiqueta}</small>
      <b>{valor == null ? vacio : `${(animado * 100).toFixed(1)}%`}</b>
      <div className="vis-barra" aria-hidden>
        {valor != null && <span className={nivel(valor)} style={{ width: `${Math.max(2, valor * 100)}%` }} />}
      </div>
    </div>
  );
}

export function PanelVision({ toast }: { toast: (t: string) => void }) {
  const [estado, setEstado] = useState<EstadoVision | null>(null);
  const [vistaPrevia, setVistaPrevia] = useState<string | null>(null);
  const [nombreArchivo, setNombreArchivo] = useState<string>('');
  const [resultado, setResultado] = useState<DeteccionPlaca | null>(null);
  const [analizando, setAnalizando] = useState(false);
  const [arrastrando, setArrastrando] = useState(false);
  const [intento, setIntento] = useState(0);
  const inputRef = useRef<HTMLInputElement | null>(null);

  const consultarEstado = useCallback(async (sondeo = false) => {
    try {
      const e = await api.visionEstado(sondeo);
      setEstado(e);
    } catch {
      // Si la sesión expiró lo maneja api.ts; otros fallos transitorios no interrumpen la pantalla
    }
  }, []);

  useInterval(() => { void consultarEstado(true); }, 6000, true, true);

  const procesarArchivo = async (archivo: File | undefined) => {
    if (!archivo) return;
    if (!archivo.type.startsWith('image/')) {
      toast('Selecciona una imagen JPG, PNG o WebP');
      return;
    }
    setAnalizando(true);
    setResultado(null);
    setNombreArchivo(archivo.name);
    try {
      const dataUrl = await prepararImagenBase64(archivo);
      setVistaPrevia(dataUrl);
      const r = await api.detectarPlaca(dataUrl);
      setResultado(r);
      setIntento((k) => k + 1);
      if (!r.detectada) {
        toast(r.error ?? 'YOLOv11s no detectó ninguna placa en la imagen');
      }
    } catch (err) {
      toast((err as Error).message);
    } finally {
      setAnalizando(false);
    }
  };

  const limpiar = () => {
    setVistaPrevia(null);
    setResultado(null);
    setNombreArchivo('');
    if (inputRef.current) inputRef.current.value = '';
  };

  const activo = estado?.disponible === true;
  const caja = resultado?.caja;

  return (
    <Glass className="vis-panel">
      <div className="card-top-row">
        <div>
          <h2>Prueba con una fotografía · YOLOv11s + OCR</h2>
          <small className="muted">
            Procesa automáticamente la cola de evidencias y permite verificar el modelo con fotografías de vehículos.
          </small>
        </div>
        <span className={`badge-pill ${activo ? 'valid' : 'discard'}`}>
          <span className="b-dot" />
          {estado == null ? 'Consultando…' : activo ? 'YOLOv11s Activo' : 'Servicio desconectado'}
        </span>
      </div>

      <div className="vis-status-strip">
        <div className="vis-metric">
          <small>Modelo Cargado</small>
          <b>{estado?.modelo_version ?? 'yolov11s-pe+ocr'}</b>
        </div>
        <div className="vis-metric">
          <small>Resolución / Motor</small>
          <b>{estado?.imgsz ? `${estado.imgsz}×${estado.imgsz} px · ${(estado.dispositivo ?? 'cpu').toUpperCase()}` : '—'}</b>
        </div>
        <div className="vis-metric">
          <small>Cola Pendiente (EN_COLA)</small>
          <b>{estado ? `${estado.cola_pendiente} evento(s)` : '—'}</b>
        </div>
        <div className="vis-metric">
          <small>Analizados desde el arranque</small>
          <b>{estado ? `${estado.procesados} evento(s)` : '—'}</b>
        </div>
      </div>

      <div className="vis-grid">
        <div>
          <input
            ref={inputRef}
            type="file"
            accept="image/jpeg,image/png,image/webp"
            className="vis-input-oculto"
            onChange={(e) => void procesarArchivo(e.target.files?.[0])}
          />

          {!vistaPrevia ? (
            <div
              className={`vis-dropzone ${arrastrando ? 'activa' : ''}`}
              onDragOver={(e) => { e.preventDefault(); setArrastrando(true); }}
              onDragLeave={() => setArrastrando(false)}
              onDrop={(e) => {
                e.preventDefault();
                setArrastrando(false);
                void procesarArchivo(e.dataTransfer.files?.[0]);
              }}
            >
              <Icon name="camera" />
              <p>Prueba interactiva de detección de placa</p>
              <small>Arrastra la fotografía de un vehículo aquí o selecciónala desde tu equipo (JPG, PNG, WebP)</small>
              <button
                type="button"
                className="primary-glass-btn"
                disabled={analizando}
                onClick={() => inputRef.current?.click()}
              >
                {analizando ? 'Ejecutando YOLOv11s…' : 'Seleccionar imagen'}
              </button>
            </div>
          ) : (
            <div>
              <div className="vis-preview-wrap">
                <div className="vis-stage">
                  <img src={vistaPrevia} alt={`Vista previa ${nombreArchivo}`} />
                  {analizando && (
                    <div className="vis-escaneo" aria-hidden>
                      <span className="vis-escaneo-linea" />
                    </div>
                  )}
                  {analizando && <div className="vis-escaneo-estado" role="status"><span className="vis-giro" /> Analizando con YOLOv11s + OCR…</div>}
                  {caja && caja.ancho_img > 0 && caja.alto_img > 0 && (
                    <div
                      key={intento}
                      className="vis-bbox"
                      style={{
                        left: `${(caja.x1 / caja.ancho_img) * 100}%`,
                        top: `${(caja.y1 / caja.alto_img) * 100}%`,
                        width: `${((caja.x2 - caja.x1) / caja.ancho_img) * 100}%`,
                        height: `${((caja.y2 - caja.y1) / caja.alto_img) * 100}%`,
                      }}
                    >
                      <span className="vis-bbox-tag">
                        {resultado?.placa_candidata ?? 'Placa'} · {((resultado?.confianza_deteccion ?? 0) * 100).toFixed(1)}%
                      </span>
                    </div>
                  )}
                </div>
              </div>
              <div className="vis-actions">
                <button
                  type="button"
                  className="primary-glass-btn"
                  disabled={analizando}
                  onClick={() => inputRef.current?.click()}
                >
                  {analizando ? 'Analizando…' : 'Probar otra imagen'}
                </button>
                <button type="button" className="glass-btn" disabled={analizando} onClick={limpiar}>
                  Limpiar
                </button>
              </div>
            </div>
          )}
        </div>

        <div className="vis-result-box">
          <div className="card-top-row">
            <small className="muted">RESULTADO DE INFERENCIA</small>
            {resultado && <span className="tag-pill">{resultado.tiempo_ms.toFixed(0)} ms</span>}
          </div>

          {analizando ? (
            <div className="vis-esqueleto" aria-label="Analizando imagen">
              <span style={{ width: '62%', height: 54 }} />
              <span style={{ width: '45%' }} />
              <span style={{ width: '90%' }} />
              <span style={{ width: '75%' }} />
            </div>
          ) : !resultado ? (
            <div className="empty-cell">
              Carga una fotografía para visualizar el recuadro detectado por YOLOv11s, el recorte de la placa y la lectura OCR.
            </div>
          ) : !resultado.detectada ? (
            <div className="glass-notice vis-revela" key={intento}>
              <b>Sin detección:</b> {resultado.error ?? 'No se encontró ninguna placa en la fotografía con el umbral actual.'}
            </div>
          ) : (
            <div key={intento}>
              <div className="vis-revela" style={{ margin: '12px 0', '--i': 0 } as React.CSSProperties}>
                <PlacaEscrita placa={resultado.placa_candidata} />
              </div>

              {resultado.recorte_base64 && (
                <div className="vis-revela" style={{ marginBottom: 14, '--i': 1 } as React.CSSProperties}>
                  <small className="muted">RECORTE EXTRAÍDO POR YOLOV11S</small>
                  <img src={resultado.recorte_base64} alt="Recorte de placa detectada" className="vis-crop-img" />
                </div>
              )}

              <div className="statlist">
                <Medidor orden={2} etiqueta="Confianza YOLOv11s (Caja)" valor={resultado.confianza_deteccion} />
                <Medidor orden={3} etiqueta="Confianza OCR (Texto)" valor={resultado.confianza_ocr} vacio="Ilegible" />
                <Medidor orden={4} etiqueta="Confianza Combinada" valor={resultado.confianza} />
                <div className="vis-revela" style={{ '--i': 5 } as React.CSSProperties}>
                  <small>Lectura OCR Cruda</small>
                  <b>{resultado.texto_ocr ?? '—'}</b>
                </div>
              </div>
            </div>
          )}

          <p className="vis-privacy-note">
            Verificación en memoria RAM: las fotografías subidas aquí no se guardan en disco ni alteran las evidencias registradas (Ley N.° 29733).
          </p>
        </div>
      </div>
    </Glass>
  );
}
