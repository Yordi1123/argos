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
| `frontend` | React + TypeScript + nginx | Panel de revisión humana | 127.0.0.1:8080 |

**¿Por qué el agente de captura no está en Docker?** Necesita el puerto USB serial del ESP32
y baja latencia con la cámara. Docker Desktop en Windows y macOS no expone dispositivos USB a
los contenedores. El agente corre directamente en la laptop, guarda la foto en
`data/evidencias/` **antes** de llamar al backend, y el backend monta esa carpeta en solo lectura.

## Puesta en marcha

Requisitos: Docker Desktop (o Docker Engine + Compose v2) y Python 3.10+ para el agente.

```bash
cp .env.example .env          # y cambiar POSTGRES_PASSWORD
docker compose up -d --build
docker compose ps             # los tres servicios deben estar "healthy"/"running"
```

- Panel: http://localhost:8080
- Documentación interactiva de la API: http://localhost:8000/docs

### Probar sin hardware

```bash
python agente/simulador.py --eventos 8 --analizar
```

Crea una sesión, genera fotos sintéticas, registra los eventos y simula el módulo de visión.
Los eventos aparecen en el panel en la pestaña **Por revisar**.

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

| Método | Ruta | Quién la usa |
| --- | --- | --- |
| `POST` | `/api/sesiones` | Operador: abre una jornada con distancia, límite y latencia calibrada |
| `POST` | `/api/sesiones/{id}/cerrar` | Operador |
| `POST` | `/api/eventos` | Agente de captura |
| `GET` | `/api/cola` | Módulo de visión: eventos pendientes de analizar |
| `POST` | `/api/eventos/{id}/analisis` | Módulo de visión: resultado o error de un intento |
| `GET` | `/api/eventos?estado=` | Panel |
| `GET` | `/api/eventos/{id}` | Panel: detalle, análisis, revisiones y auditoría |
| `POST` | `/api/eventos/{id}/revision` | Revisor |
| `GET` | `/api/evidencias/{id}/archivo` | Panel: foto verificada por hash |

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

- [ ] **Autenticación.** El panel elige al revisor de una lista (usuarios demo). Antes del
      piloto, reemplazar por inicio de sesión (JWT o sesión) y tomar el actor del token, no de `X-Actor`.
- [ ] Agente de captura real: lectura serial del ESP32, buffer circular de cuadros RTSP, D1.
- [ ] Módulo de visión real (YOLO + OCR) usando `GET /api/cola` y `POST /api/eventos/{id}/analisis`.
      Puede ser un cuarto servicio Docker: no necesita USB.
- [ ] Cambiar los usuarios demo y la contraseña de `.env`.
- [ ] Definir el plazo de conservación de evidencias (Ley N.° 29733).
