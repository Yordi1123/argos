# AGENTS.md — Frontend ARGOS Glass

Contrato de desarrollo del panel y la landing de ARGOS. Aplica a personas y a agentes de codificación
(Claude Code, Codex, Cursor, Copilot, Gemini, etc.). Si una instrucción de una tarea contradice este archivo,
pregunta antes de romperlo.

ARGOS detecta posibles excesos de velocidad y **una persona autorizada toma siempre la decisión final**.
El frontend muestra evidencia y registra dictámenes; nunca decide por su cuenta.

Versión actual: ver `package.json` · Fase: **alpha** · Política: [`../../docs/versionado.md`](../../docs/versionado.md)

## Comandos

```bash
npm ci              # instalar (respeta package-lock.json; no uses npm install salvo para agregar dependencias)
npm run dev         # Vite en :5173, con proxy /api → http://localhost:8000
npm run build       # tsc -b && vite build   ← debe pasar sin errores
npm run lint        # oxlint                 ← debe pasar con 0 advertencias
```

Requiere Node ≥ 22.12 (Vite 8). El backend debe estar arriba para ver datos: desde la raíz del repo,
`docker compose up -d` y luego `python3 agente/simulador.py --eventos 5 --analizar` para generar eventos.

Desplegar el frontend en Docker: `docker compose up -d --build frontend` (desde la raíz).

Si `tsc` u `oxlint` dan `Permission denied`, la carpeta `node_modules` se copió sin permisos de ejecución:
bórrala y corre `npm ci`. Nunca copies `node_modules` entre equipos.

## Arquitectura (no la rompas)

```
backend (FastAPI) ──JSON──► src/api.ts ──aEvento()──► TrafficEvent ──► App.tsx (estado) ──Ctx──► pages.tsx / landing.tsx
                                                                                                   └─► components.tsx
```

| Archivo | Responsabilidad | Regla |
| --- | --- | --- |
| `src/api.ts` | Tipos del backend, cliente HTTP, adaptadores al modelo de UI | **Único lugar con `fetch`.** Ningún componente llama a la red. |
| `src/data.ts` | Modelo de la UI (`TrafficEvent`, `EventState`, `Page`), menús, constantes | Sin lógica de red ni de estado. |
| `src/App.tsx` | Todo el estado de la aplicación, sondeo cada 5 s, acciones (`commit`, `reset`) | Las páginas reciben `Ctx`; no crean estado global propio. |
| `src/pages.tsx` | Una función por página del panel | Leen `c.events`, `c.detail`; actúan solo mediante funciones de `Ctx`. |
| `src/components.tsx` | Componentes visuales reutilizables | Presentacionales: sin red, sin estado de negocio. |
| `src/landing.tsx` + `landing.css` | Landing pública | Ver "Privacidad". |
| `src/hooks.ts` | Hooks genéricos | Sin conocimiento del dominio. |

La navegación es un estado `Page` en `App.tsx`, no un router. Para una página nueva: agrega el valor a `Page`
(`data.ts`), la entrada en `menus` si va en la barra lateral, la función en `pages.tsx` y su línea en `views`.

## Contrato con el backend

El backend es la **fuente de verdad**. El frontend adapta, no reinterpreta.

1. **Tipos espejo.** Las interfaces de `api.ts` (`EventoResumen`, `EventoDetalle`, …) reflejan exactamente las
   respuestas de `backend/app/routers/*.py`. Los `NUMERIC` de Postgres llegan como `string`: conviértelos en el
   adaptador (`aEvento`), no en los componentes.
2. **Estados.** La traducción backend → UI vive solo en `estadoUI()`. `REVISABLES` debe coincidir con las
   transiciones a `CONFIRMADO`/`DESCARTADO` de `backend/app/estados.py`. Si cambias uno, cambia el otro en el mismo PR.
3. **Las reglas de negocio no se duplican.** No calcules en el cliente la velocidad, el umbral, el puntaje D2 ni
   si una transición es válida. Muestra lo que devuelve la API y deja que el backend rechace (409/422); muestra
   el `detail` del error en un toast.
4. **Dictámenes.** Solo por `api.revisar()`. Mapeo fijo: Confirmar/Corregir → `CONFIRMAR` (con `placa_final`),
   Descartar → `DESCARTAR`, No verificable → `MARCAR_INCIERTO`. Un dictamen es irreversible: siempre con modal
   de confirmación.
5. **Evidencias.** Solo como `<img src={api.urlEvidencia(id)}>`. Ese endpoint verifica el SHA-256 antes de
   entregar el archivo; no lo saltes ni guardes copias en el cliente.
6. **Cambios de API.** Si una tarea necesita un campo o endpoint nuevo, se cambia primero el backend (y su
   esquema). El frontend nunca inventa campos que la API no envía.

## Privacidad y seguridad (Ley N.° 29733)

- **Nada de datos de eventos en `localStorage`/`sessionStorage`/IndexedDB.** Solo preferencias de UI (tema,
  barra lateral), y siempre dentro de `try/catch`.
- **La landing es pública:** no muestra eventos, placas, fotos ni conteos reales. Solo contenido estático.
- No registres placas, rutas de evidencias ni datos de usuarios en `console.*`.
- Sin peticiones a terceros: nada de analítica, CDNs ni APIs externas. El sistema debe funcionar en una laptop
  de campo sin internet. (Excepción heredada: Google Fonts en `index.css`; ver "Deuda conocida".)
- El revisor activo hoy es el primer usuario `REVISOR` de `/api/usuarios`, como sustituto del login real.
  No construyas permisos encima de eso: llegará la autenticación.

## Honestidad del contenido

ARGOS es un prototipo académico que producirá evidencia de infracciones. La UI **no puede afirmar cosas que el
sistema no hace**.

- No agregues cifras, certificaciones, normas, cifrados ni hardware que no existan en el código o en la
  configuración real.
- Un dato que aún no viene del backend se marca como ilustrativo (como en la landing: "Vista ilustrativa") o
  se omite.
- Al tocar una pantalla con contenido decorativo de la lista de "Deuda conocida", conéctalo a datos reales o
  elimínalo; no lo extiendas.

## Estilos

- **Tokens, no colores sueltos.** Colores de marca y acento desde variables de `:root` en `index.css`:
  `--accent` / `--accent-rgb` (cian), `--accent-warm` (ámbar), `--primary`, `--text-main`, `--text-sub`,
  `--text-muted`, `--divider`, `--card-*`. Para transparencias: `rgba(var(--accent-rgb), 0.2)`.
- **Reutiliza las piezas de vidrio:** `.glass-card` (vía `<Glass>`), `.glass-btn`, `.primary-glass-btn`,
  `.badge-pill`, `.tag-pill`, `.brand-badge-icon`, `.live-dot-pulse`. No crees otra variante de tarjeta o botón.
- **Prefijos:** `v5-*` y clases existentes del panel en `index.css`; `lp-*` para la landing en `landing.css`.
  Una funcionalidad grande nueva lleva su propio `*.css` importado desde su `*.tsx`.
- **Texto siempre legible sobre el fondo fotográfico:** texto blanco con `--text-*`; comprueba el contraste
  sobre las zonas claras de la imagen.
- **Responsivo:** puntos de corte 1100 / 900 / 600 px; prueba a 390 px de ancho. En media queries usa
  `padding-left`/`padding-right`, no el atajo `padding: 0 Xpx` (borra el padding vertical de las secciones).
- Animaciones con `@media (prefers-reduced-motion: reduce)`.
- Íconos: el componente `<Icon name=…>` de `components.tsx`. Si falta uno, agrégalo ahí (trazo SVG 24×24).

## Código

- **TypeScript estricto.** Sin `any`, sin `as` para silenciar errores, sin `!` sobre datos de la API.
- **Estados vacíos obligatorios.** Toda vista que lea `c.events[...]` maneja: cargando, sin conexión y lista
  vacía (usa `<NoEvents>` en `pages.tsx`). Nunca asumas que existe `events[0]`.
- **Hooks antes de cualquier `return` temprano** (regla de hooks de React).
- **Asíncrono:** las acciones que llaman a la API devuelven `Promise`; los botones se deshabilitan mientras
  esperan y los errores se muestran con `c.toast()`.
- **Lint:** 0 advertencias. Para desactivar una regla en una línea: `// oxlint-disable-next-line <regla>` con
  un comentario encima que explique por qué es correcto.
- **Idioma:** textos de la UI en español (Perú); fechas y horas en `America/Lima` con los helpers de `api.ts`
  (`fechaISO`, `hora`, `fechaLarga`). Identificadores que reflejan la API (`estado`, `placa_candidata`) en
  español como en el backend; el resto sigue la convención del archivo que editas.
- **Dependencias:** no agregues paquetes sin justificarlo en el PR. Nada de librerías de UI o CSS-in-JS: el
  sistema visual es propio.

## Versión y changelog

- Todo cambio visible para el usuario se anota en `## [Sin publicar]` de [`../../CHANGELOG.md`](../../CHANGELOG.md)
  en el mismo PR (Agregado / Cambiado / Corregido / Eliminado / Seguridad).
- **No cambies `version` en `package.json` a mano.** Se publica con `./scripts/version.sh X.Y.Z` desde la
  raíz (sincroniza frontend y backend). La UI la muestra mediante `__APP_VERSION__`.
- Commits en [Conventional Commits](https://www.conventionalcommits.org/es/v1.0.0/):
  `feat(panel): …`, `fix(landing): …`, `style(frontend): …`. Detalles en `docs/versionado.md`.

## Antes de dar una tarea por terminada

- [ ] `npm run build` sin errores y `npm run lint` con 0 advertencias.
- [ ] Probado contra el backend real con eventos del simulador (no solo compilado).
- [ ] Revisado a 1440 px y a 390 px de ancho.
- [ ] Estados vacío, cargando y sin conexión funcionan (detén el backend y mira la UI).
- [ ] Sin datos reales en la landing ni en `localStorage`; sin `console.log` olvidados.
- [ ] CHANGELOG actualizado si el cambio es visible.
- [ ] Si cambió el contrato con el backend, ambos lados están en el mismo PR.

## No tocar

- `dist/`, `node_modules/`: generados.
- `package-lock.json` a mano: solo vía `npm`.
- `nginx.conf` y `Dockerfile`: solo si la tarea es de despliegue (el proxy `/api/` es parte del contrato).
- `public/argos-*.png`: logos oficiales.

## Deuda conocida (alpha)

Contenido heredado del diseño que **aún no corresponde al sistema real**. No lo amplíes; al tocarlo, conéctalo
a datos reales o elimínalo:

- Dashboard: porcentajes de tendencia, sparklines, gráfico de área y "Vehículos supervisados 1,284".
- Reportes: los cuatro gráficos de barras y "Conformidad legal 100 % / D.S. N° 025-2021-MTC".
- Dispositivos: toda la página (IP, firmware, latencias y uptime de ejemplo).
- Configuración: valores de calibración fijos, "Certificado INACAL", "12.8 GB", "Cifrado AES-256" (no existe
  cifrado en reposo).
- Login: campos de solo lectura, "Token criptográfico RSA-4096" (no hay autenticación todavía).
- Monitor y tablas: "YOLOv8", "CAM-01", "30 FPS", "1080p" fijos en el código.
- `index.css` importa Google Fonts: sin internet cae a la fuente del sistema. Debe servirse localmente.
- `public/forest-bg.jpg` ya no se usa.
