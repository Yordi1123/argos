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
`docker compose up -d` y luego `python3 agente/simulador.py --eventos 5 --analizar` para generar eventos
(requiere las claves de servicio en `.env`; ver README raíz → "Inicio de sesión y claves").

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
| `src/api.ts` | Tipos del backend, cliente HTTP, adaptadores al modelo de UI, permisos por rol (`puede`) | **Único lugar con `fetch`.** Ningún componente llama a `fetch`. |
| `src/data.ts` | Modelo de la UI (`TrafficEvent`, `EventState`, `Page`), menús, constantes | Sin lógica de red ni de estado. |
| `src/App.tsx` | Estado global: sesión, eventos, sondeo cada 5 s, acciones (`commit`, `reset`), protección de páginas | Las páginas reciben `Ctx`; no crean estado global propio. |
| `src/pages.tsx` | Páginas del panel que trabajan con eventos | Leen `c.events`, `c.detail`; actúan solo mediante funciones de `Ctx`. |
| `src/login.tsx` · `src/cuenta.tsx` | Pantalla de acceso; cambio de contraseña (obligatorio o desde el perfil) | Nunca guardan credenciales: solo las envían a `api.ingresar` / `api.cambiarContrasena`. |
| `src/google.ts` | Carga de Google Identity Services (implementación futura) | Único lugar que toca `window.google`. Solo se usa si el backend tiene `GOOGLE_CLIENT_ID`. |
| `src/usuarios.tsx` | Administración de cuentas (solo ADMINISTRADOR) | Página con datos propios: llama a funciones de `api.ts`, nunca a `fetch`. |
| `src/components.tsx` | Componentes visuales reutilizables | Presentacionales: sin red, sin estado de negocio. |
| `src/landing.tsx` + `landing.css` | Landing pública | Ver "Privacidad". |
| `src/hooks.ts` | Hooks genéricos | Sin conocimiento del dominio. |

La navegación es un estado `Page` en `App.tsx`, no un router. Para una página nueva: agrega el valor a `Page`
(`data.ts`), la entrada en `menus` si va en la barra lateral, su regla en `permitida()` (qué roles la ven), la
función en `pages.tsx` (o su propio archivo si tiene datos propios) y su línea en `views`.

## Sesión y roles

- **Personas:** inician sesión con correo y contraseña (`api.ingresar`); el backend entrega una cookie
  `HttpOnly` + `SameSite=Strict`. **El frontend nunca ve, guarda ni envía tokens** y nunca guarda contraseñas
  (ni en `localStorage` ni en estado que sobreviva al formulario): el navegador manda la cookie solo.
- **Contraseña temporal:** si `Sesion.debe_cambiar` es `true`, `App.tsx` solo muestra `CambioContrasena`
  (el backend responde 403 a todo lo demás). No agregues pantallas que se salten esa comprobación.
- **Google:** implementación futura. El botón es ilustrativo ("Próximamente") salvo que `/api/auth/config`
  devuelva un `google_client_id`; no lo quites ni lo presentes como funcional.
- **Identidad:** quién firma un dictamen lo decide el backend desde la sesión. Nunca envíes `revisor_id`,
  `operador_id` ni un "actor" en el cuerpo o en encabezados.
- **401 = sesión terminada** (vencida, cerrada o permisos cambiados): `pedir` llama a `onSesionExpirada`, que
  borra los datos de memoria y vuelve al acceso. No lo manejes caso por caso; solo evita mostrar un toast extra.
  Excepción: en `api.ingresar` un 401 es "credenciales incorrectas", por eso va con `silencioso: true`.
- **Sondeo:** las consultas automáticas usan `{ sondeo: true }` (`X-Argos-Sondeo: 1`) para no mantener viva una
  sesión inactiva. Una acción del usuario nunca lleva esa marca.
- **Roles en la UI:** `puede.*` y `permitida()` solo ocultan lo que el rol no puede usar. La autorización real
  la aplica el backend (403); nunca confíes solo en ocultar un botón.

| Rol | Ve | Puede |
| --- | --- | --- |
| `REVISOR` | Panel, eventos, evidencias, reportes | Emitir dictámenes |
| `OPERADOR` | Panel, eventos, evidencias, reportes, dispositivos, configuración | Solo lectura de eventos |
| `ADMINISTRADOR` | Todo | Dictámenes y administración de cuentas |

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
  de campo sin internet. **Única excepción permitida (futura):** el script de Google Identity Services
  (`accounts.google.com/gsi/client`), cargado desde `google.ts` solo en la pantalla de acceso y solo si el
  backend tiene `GOOGLE_CLIENT_ID`. Sin él, el panel no hace ninguna petición externa para el acceso. (Excepción
  heredada aún pendiente: Google Fonts en `index.css`; ver "Deuda conocida".)
- Al cerrar o perder la sesión se borran de memoria los eventos y el detalle (`olvidarDatos`). No dejes datos de
  eventos en estado que sobreviva a la sesión.

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

- **Temas:** el tema claro/oscuro solo existe dentro de `<div class="v5-panel" data-theme>`; la página de inicio y el
  acceso tienen identidad fija. Nunca pongas `data-theme` en `<html>`. Variables y ajustes del modo claro en `src/tema.css`.
- **Movimiento:** solo comunica algo. Al pasar el mouse nada se desplaza, crece ni gira (solo color, borde, sombra);
  al presionar, `scale(0.98)`. Transiciones de 150–200 ms `ease-out`. Respeta `prefers-reduced-motion`.

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
- [ ] Probado con cada rol que puede ver la pantalla; un rol sin permiso no ve la opción (y el backend da 403).
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
- Monitoreo en tiempo real (decisión del equipo para demostraciones, sin rótulo en la UI): el video
  `public/monitoreo.mp4` es una grabación en bucle y las lecturas del radar, cortes de barrera y "Vehículos
  medidos" se generan en el navegador (`src/radar.ts`). Reemplazar por la telemetría del agente real.
  "CAM-01", "30 FPS", "1080p" siguen fijos en el código.
- `index.css` importa Google Fonts: sin internet cae a la fuente del sistema. Debe servirse localmente.
- `public/forest-bg.jpg` ya no se usa.
