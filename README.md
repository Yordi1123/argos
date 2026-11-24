# ARGOS · Sistema de detección de exceso de velocidad

Prototipo experimental (Ingeniería de Software II, UNS 2026-II). Detecta posibles excesos
de velocidad con dos barreras láser y un ESP32, guarda evidencia trazable y propone una
placa candidata para que **una persona autorizada tome la decisión final**.

## Arquitectura

```
                   Laptop de campo
┌────────────────────────────────────────────────────────────────┐
│  FUERA de Docker                    Docker Compose              │
│  ┌──────────────────┐   HTTP   ┌─────────┐  SQL  ┌──────────┐   │
│  │ Agente captura   │ ───────► │ backend │ ────► │    db    │   │
│  │ ESP32 (serial)   │ :8000    │ FastAPI │       │ Postgres │   │
│  │ Cámara (RTSP)    │          └────▲────┘       └──────────┘   │
│  └────────┬─────────┘               │ /api                      │
│           │ escribe            ┌────┴─────┐                     │
│           ▼                    │ frontend │ ◄── Revisor :8080   │
│   data/evidencias/ ──(lectura)─┤  nginx   │                     │
│                                └──────────┘                     │
└────────────────────────────────────────────────────────────────┘
```

| Servicio | Tecnología | Responsabilidad | Puerto |
| --- | --- | --- | --- |
| `db` | PostgreSQL 16 | Eventos, estados, evidencias (con SHA-256), análisis, revisiones, auditoría inmutable | 127.0.0.1:5432 |
| `backend` | Python 3.12 + FastAPI | API REST, máquina de estados, decisión D2, verificación de integridad | 127.0.0.1:8000 |
| `vision` | Python 3.12 + YOLOv11s + RapidOCR | Detección de placas peruanas desde la cola (`EN_COLA`) y prueba en memoria | solo red interna |
| `frontend` | React + TypeScript + nginx | Panel de revisión humana | 127.0.0.1:8080 |

**¿Por qué el agente de captura no está en Docker?** Necesita el puerto USB serial del ESP32
y baja latencia con la cámara. Docker Desktop en Windows y macOS no expone dispositivos USB a
los contenedores. El agente corre directamente en la laptop, guarda la foto en
`data/evidencias/` **antes** de llamar al backend, y el backend monta esa carpeta en solo lectura.

## Puesta en marcha

Requisitos: Docker Desktop (o Docker Engine + Compose v2) y Python 3.10+ para el agente.

```bash
cp .env.example .env          # cambiar POSTGRES_PASSWORD
docker compose up -d --build
docker compose ps             # los cuatro servicios deben estar "healthy" (vision necesita vision/modelos/yolov11s_placas.pt)

# Primer administrador (una sola vez): imprime una contraseña temporal que se cambia al ingresar
docker compose exec backend python -m app.cuentas admin tu@gmail.com "Nombre Apellido"

# Claves de los servicios (una sola vez): copia cada línea ARGOS_CLAVE_... que se imprime a tu .env
docker compose exec backend python -m app.claves crear agente OPERADOR
docker compose exec backend python -m app.claves crear vision VALIDACION_IA
```

- Panel: http://localhost:8080 (ingresa con el correo y la contraseña temporal del paso anterior)
- Documentación interactiva de la API: http://localhost:8000/docs

### Probar sin hardware

```bash
python agente/simulador.py --eventos 8 --analizar   # usa ARGOS_CLAVE_AGENTE y ARGOS_CLAVE_VISION del .env
python agente/simulador.py --foto ruta/fotos/       # fotos reales: las analiza el servicio vision (sin --analizar)
```

Crea una sesión, genera fotos sintéticas, registra los eventos y simula el módulo de visión.
Los eventos aparecen en el panel en la pestaña **Por revisar**.

## Inicio de sesión y claves

Las personas entran con **correo y contraseña** de una cuenta que creó un administrador en
*Administración de usuarios*. Los servicios (agente de captura, módulo de visión) usan una clave de API cada uno.

| Quién | Cómo se autentica | Qué puede hacer |
| --- | --- | --- |
| `ADMINISTRADOR` | Correo + contraseña | Todo, incluida la gestión de cuentas |
| `REVISOR` | Correo + contraseña | Ver eventos y emitir dictámenes |
| `OPERADOR` | Correo + contraseña | Ver eventos (solo lectura), abrir y cerrar jornadas |
| Agente de captura | `X-Api-Key` (rol `OPERADOR`) | Abrir jornadas y registrar eventos |
| Módulo de visión | `X-Api-Key` (rol `VALIDACION_IA`) | Leer la cola y registrar análisis |

- **Contraseñas:** solo se guarda su hash Argon2id. Mínimo 10 caracteres y distinta del correo.
- **Cuentas nuevas:** el administrador las crea y ARGOS genera una contraseña temporal que se muestra **una vez**
  y se entrega en persona. En el primer ingreso el panel exige cambiarla; hasta entonces el backend no permite nada más.
- **Olvido o bloqueo:** tras 5 intentos fallidos la cuenta se bloquea 15 min. Un administrador puede
  *Restablecer contraseña* (genera otra temporal, desbloquea y cierra sus sesiones).
- **Sesión:** cookie `HttpOnly` que dura una jornada (8 h) y se cierra tras 30 min sin actividad. Cambiar el rol,
  desactivar una cuenta o restablecer su contraseña cierra sus sesiones al instante.
- **Firma:** quien emite un dictamen es siempre la persona con la sesión abierta; el backend ignora cualquier
  identidad enviada en la petición.
- **Sin acceso de administrador** (p. ej. se olvidó la única contraseña de admin):
  `docker compose exec backend python -m app.cuentas restablecer <correo>` o `... admin <correo> "Nombre"`.
  `python -m app.cuentas listar` muestra las cuentas.

### Google (implementación futura)

El panel muestra *Continuar con Google* como **próximamente**. El código ya existe (`POST /api/auth/google`):
si algún día se completa `GOOGLE_CLIENT_ID` en `.env`, el botón se vuelve funcional para las cuentas ya creadas
por un administrador. Pasos en Google Cloud cuando se retome:

1. <https://console.cloud.google.com/> → crear proyecto → **Google Auth Platform** → *Branding* (nombre y email de soporte).
2. *Audience* → **External** → **Publish app** (con `openid`, `email` y `profile` no exige verificación).
3. *Clients* → **Web application** con orígenes `http://localhost`, `http://localhost:8080` y `http://localhost:5173`.
4. Copiar el **Client ID** a `GOOGLE_CLIENT_ID` y `docker compose up -d backend`.

### Claves de servicio

```bash
docker compose exec backend python -m app.claves listar
docker compose exec backend python -m app.claves rotar agente     # nueva clave, invalida la anterior
docker compose exec backend python -m app.claves revocar vision
```

La clave se muestra una sola vez; en la base solo queda su SHA-256.

### Base de datos existente

`db/init/` solo se ejecuta al crear el volumen. Para aplicar la autenticación a una base que ya tenía datos:

```bash
docker compose exec -T db psql -U argos -d argos -v ON_ERROR_STOP=1 < db/init/02_autenticacion.sql
docker compose exec -T db psql -U argos -d argos -v ON_ERROR_STOP=1 < db/init/03_contrasenas.sql
```

## Ciclo de vida de un evento

```
EVIDENCIA_GUARDADA → EN_COLA → ANALIZADO → EN_REVISION → CONFIRMADO | DESCARTADO
                        └─ (3 fallos de análisis) ─────► INCIERTO ─► revisión humana
```

- **D1 (agente, en línea):** solo se envían mediciones válidas que superan límite + incertidumbre.
  El backend recalcula la velocidad con la distancia calibrada de la sesión y rechaza las que no superan el umbral.
- **D2 (backend, diferida):** con la placa y su confianza calcula un puntaje de prioridad
  (`0.6·confianza + 0.4·margen sobre el límite`, a la mitad si la placa no tiene formato válido).
  **No decide**: solo ordena la cola del revisor.
- **Decisión humana:** solo usuarios con rol `REVISOR` o `ADMINISTRADOR`.

## Garantías de trazabilidad

| Garantía | Cómo se cumple |
| --- | --- |
| La evidencia existe antes del análisis | El agente guarda la foto y luego registra; el backend verifica que el archivo exista |
| La evidencia no fue alterada | SHA-256 al registrar y de nuevo cada vez que se sirve; si no coincide, responde 409 |
| No hay eventos duplicados | El agente genera el ID; reenviar el mismo evento devuelve el existente |
| Nada se pierde si el backend cae | El agente deja un `.json` junto a la foto; `--reenviar` lo envía después |
| El historial no se puede reescribir | La tabla `auditoria` tiene un trigger que bloquea UPDATE y DELETE |
| Transiciones válidas | Máquina de estados en `backend/app/estados.py`; estados finales no cambian |

## API principal

| Método | Ruta | Quién (autenticación) |
| --- | --- | --- |
| `GET` | `/api/salud` | Público: estado y versión |
| `POST` | `/api/auth/ingresar` | Público: correo + contraseña → sesión |
| `POST` | `/api/auth/contrasena` | Sesión: cambiar la propia contraseña |
| `GET` | `/api/auth/yo` · `POST` `/api/auth/salir` | Sesión |
| `GET` · `POST` | `/api/auth/config` · `/api/auth/google` | Público · futuro: Google (503 sin `GOOGLE_CLIENT_ID`) |
| `GET` `POST` `PATCH` | `/api/usuarios` | ADMINISTRADOR (crear devuelve la contraseña temporal) |
| `POST` | `/api/usuarios/{id}/contrasena` | ADMINISTRADOR: restablecer contraseña |
| `POST` | `/api/sesiones` · `/api/sesiones/{id}/cerrar` | Agente u OPERADOR/ADMINISTRADOR: jornada con distancia, límite y latencia |
| `POST` | `/api/eventos` | Agente de captura (clave `OPERADOR`) |
| `GET` | `/api/cola` | Módulo de visión (clave `VALIDACION_IA`) |
| `POST` | `/api/eventos/{id}/analisis` | Módulo de visión |
| `GET` | `/api/eventos?estado=` · `/api/eventos/{id}` | Personas con sesión (cualquier rol) |
| `POST` | `/api/eventos/{id}/revision` | REVISOR o ADMINISTRADOR (el revisor sale de la sesión) |
| `GET` | `/api/evidencias/{id}/archivo` | Personas con sesión: foto verificada por hash |

## Respaldo al cierre de cada sesión

```bash
./scripts/respaldo.sh            # crea respaldos/argos_AAAAMMDD_HHMMSS/
```

Incluye el volcado de la base, las evidencias comprimidas y un `SHA256SUMS`.

## Estructura

```
argos/
├── docker-compose.yml
├── .env.example
├── db/init/01_esquema.sql     # esquema, estados, auditoría inmutable, usuarios demo
├── backend/                   # FastAPI
│   └── app/{main,config,db,estados,esquemas}.py, routers/
├── frontend/                  # React + TS → nginx (proxy /api → backend)
├── agente/simulador.py        # contrato de referencia para el agente real
├── scripts/respaldo.sh
└── data/evidencias/           # fotos (fuera de git)
```

## Pendiente antes del piloto

- [x] **Autenticación.** Correo + contraseña (Argon2id) para personas, claves de API para servicios.
- [x] **Módulo de visión real (`vision/`).** YOLOv11s entrenado para placas peruanas + OCR offline usando `GET /api/cola` y `POST /api/eventos/{id}/analisis`.
- [ ] Inicio de sesión con Google (código listo; falta configurar Google Cloud).
- [ ] Agente de captura real: lectura serial del ESP32, buffer circular de cuadros RTSP, D1.
- [ ] Cambiar la contraseña de `.env` y rotar las claves de servicio en la laptop del piloto.
- [ ] Definir el plazo de conservación de evidencias (Ley N.° 29733).
