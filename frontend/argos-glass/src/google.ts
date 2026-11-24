/* Google Identity Services: única dependencia externa permitida (ver AGENTS.md → Privacidad).
 * Se carga solo en la pantalla de acceso y solo entrega un ID token que el backend verifica. */
const GIS_URL = 'https://accounts.google.com/gsi/client';

interface GoogleId {
  initialize(o: { client_id: string; callback: (r: { credential: string }) => void; ux_mode: 'popup'; auto_select: boolean }): void;
  renderButton(el: HTMLElement, o: Record<string, string | number>): void;
  disableAutoSelect(): void;
}
declare global {
  interface Window { google?: { accounts: { id: GoogleId } } }
}

let cargaGis: Promise<GoogleId> | null = null;
export function cargarGis(): Promise<GoogleId> {
  cargaGis ??= new Promise((ok, falla) => {
    if (window.google) return ok(window.google.accounts.id);
    const s = document.createElement('script');
    s.src = GIS_URL;
    s.async = true;
    s.onload = () => (window.google ? ok(window.google.accounts.id) : falla(new Error('Google no respondió')));
    s.onerror = () => { cargaGis = null; falla(new Error('No se pudo contactar con Google')); };
    document.head.appendChild(s);
  });
  return cargaGis;
}

/** Evita que Google vuelva a elegir la cuenta sola tras cerrar sesión. */
export function olvidarCuentaGoogle() {
  window.google?.accounts.id.disableAutoSelect();
}
