# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

ARGOS is an experimental speed-enforcement prototype (UNS, Ingeniería de Software II, 2026-II): two laser barriers + an ESP32 measure speed, a camera captures evidence, a vision module proposes a candidate plate, and **a human reviewer always makes the final decision**. All code, identifiers, DB columns, API paths and messages are in Spanish — keep new code consistent with that.

## Commands

Full stack (Docker Compose: `db`, `backend`, `frontend`):

```bash
docker compose up -d --build        # requires POSTGRES_PASSWORD in .env (compose fails without it)
docker compose ps
docker compose logs -f backend
```

- Panel: http://localhost:8080 · API docs (Swagger): http://localhost:8000/docs · health: `GET /api/salud`
- Setup: `cp .env.example .env` and set `POSTGRES_PASSWORD`. `.env` is git-ignored.
- `db/init/01_esquema.sql` only runs when the `pgdata` volume is first created. After schema changes: `docker compose down -v && docker compose up -d --build` (destroys data).

Exercise the pipeline without hardware (stdlib-only Python, runs on the host, not in Docker):

```bash
python agente/simulador.py --eventos 8 --analizar   # creates a session, synthetic PNGs, events, simulated vision results
python agente/simulador.py --reenviar               # resend pending .json sidecars
python agente/simulador.py --sesion <id> --api http://localhost:8000
```

Backup (needs `.env` and running `db`): `./scripts/respaldo.sh [dest]` → `respaldos/argos_<timestamp>/` with pg_dump, evidence tarball, `SHA256SUMS`.

Backend locally (outside Docker): `cd backend && pip install -r requirements.txt && DATABASE_URL=postgresql://... EVIDENCIAS_DIR=../data/evidencias uvicorn app.main:app --reload`.

Frontend (`frontend/argos-glass/`, React 19 + Vite 8 + TS 7, oxlint):

```bash
cd frontend/argos-glass
npm install
npm run dev       # Vite dev server
npm run build     # tsc -b && vite build
npm run lint      # oxlint
```

There is no test suite in the repo (no pytest/vitest configured).

## Architecture

```
capture agent (host, USB serial + RTSP) ──writes──► data/evidencias/  ◄──read-only mount── backend (FastAPI :8000) ──► Postgres 16
        └──────────────── POST /api/eventos ──────────────────────────────────────────────────┘        ▲
                                                                          frontend (nginx :8080, proxies /api/ → backend:8000)
```

- The capture agent runs **outside Docker** (needs USB serial to the ESP32). `agente/simulador.py` is the reference contract for the real agent: save photo to `data/evidencias/` **first**, write a `.json` sidecar, then POST; the agent generates the event UUID so resends are idempotent (same ID → backend returns existing event with 200).
- The backend mounts evidence **read-only** and never modifies it. It verifies SHA-256 both at registration (422 on mismatch/missing file) and every time a file is served (`GET /api/evidencias/{id}/archivo` → 409 if tampered, 410 if gone). Paths are confined via `_ruta_segura` in `routers/eventos.py`.

### Backend (`backend/app/`)

- Raw SQL via `psycopg` 3 + `psycopg_pool` with `dict_row` — no ORM. `db.transaccion()` is the write context manager (commit/rollback); read-only endpoints use `pool.connection()` directly.
- **Every state change must go through `estados.cambiar_estado()`**, which locks the row (`FOR UPDATE`), validates against `TRANSICIONES`, updates, and writes an audit row. Other auditable actions call `db.auditar()`. The `auditoria` table has a trigger blocking UPDATE/DELETE — it is insert-only by design.
- Event lifecycle: `EVIDENCIA_GUARDADA → EN_COLA → ANALIZADO → EN_REVISION → CONFIRMADO | DESCARTADO`; any non-final state can go to `INCIERTO`, which returns to human review. `CONFIRMADO`/`DESCARTADO` are terminal. The `estado_evento` Postgres enum in `db/init/01_esquema.sql` must stay in sync with `TRANSICIONES`.
- Decision layers:
  - **D1** (agent): only sends measurements above `limite + incertidumbre`. The backend **recalculates** speed from the session's calibrated `distancia_m` and `t1_us/t2_us`, rejecting (422) below threshold or marking `INCIERTO` if implausible (outside 5–200 km/h) or if the agent sent `motivo_incierto`.
  - **D2** (backend, `POST /api/eventos/{id}/analisis`): priority score `0.6·confianza + 0.4·margen`, halved if the plate doesn't match `FORMATO_PLACA`. It only orders the review queue (`GET /api/eventos` sorts by `puntaje_utilidad`); it never decides. After `MAX_INTENTOS_ANALISIS` (3) failed attempts → `INCIERTO`.
  - **Human review** (`POST /api/eventos/{id}/revision`): only users with role `REVISOR` or `ADMINISTRADOR`.
- Actor identity currently comes from the `X-Actor` header (or `revisor_id` in the body) — there is no authentication yet; demo users are seeded in the SQL init script.
- Config via `pydantic-settings` (`config.py`): `DATABASE_URL`, `EVIDENCIAS_DIR`, `CORS_ORIGENES` (comma-separated).
- A "sesión" is one field-capture day with its calibration (distance, limit, uncertainty, camera latency); events can only be registered into an open session.

### Frontend — in transition

- The original panel (`frontend/src/*`) was replaced by `frontend/argos-glass/`, which Compose builds (own Dockerfile + nginx.conf proxying `/api/` → `backend:8000`; Vite dev server proxies `/api` → `localhost:8000`).
- Data flow: `src/api.ts` holds the backend types, the fetch client, and `aEvento()`, which adapts `EventoResumen` → the UI's `TrafficEvent` (`src/data.ts`). Backend states map to UI labels in `estadoUI()`: `EN_REVISION`→Pendiente, `CONFIRMADO`→Validado, `DESCARTADO`→Descartado, `INCIERTO`→No verificable, everything earlier→En análisis. Only `REVISABLES` (`EN_REVISION`, `INCIERTO`) accept a review.
- `App.tsx` owns all state: polls `GET /api/eventos` every 5 s, loads `GET /api/eventos/{id}` for the selected event (`ctx.detail`: evidence hashes, Δt, audit trail), and `commit()` posts reviews (Confirmar/Corregir→`CONFIRMAR` with `placa_final`, Descartar→`DESCARTAR`, No verificable→`MARCAR_INCIERTO`). It passes a `Ctx` object to the page components in `pages.tsx`. Navigation is a `Page` union state, not a router.
- Entry page is the public landing (`src/landing.tsx` + `src/landing.css`, page `'landing'`) → login → dashboard. The landing must not show real event data or evidence (privacy); its content reflects only what the system actually does.
- Evidence images are `<img src="/api/evidencias/{id}/archivo">` (rendered by `Road` in `components.tsx` when the event has a `photoId`); the synthetic SVG road is only a fallback and the login illustration.
- The acting reviewer is the first `REVISOR` user from `GET /api/usuarios`, a stand-in until real auth exists.
- Still static/decorative (no backend source yet): dashboard trend %, sparklines and area chart, Reports bar charts, Devices page, Settings calibration values, Users role matrix, login form.
- `localStorage` is only used for UI preferences (theme, sidebar), never for event data.

## Pending before pilot (from README)

Real authentication (replace `X-Actor`/user picker with JWT or sessions), real capture agent (ESP32 serial, RTSP ring buffer, D1), real vision module (YOLO + OCR via `GET /api/cola` + `POST /api/eventos/{id}/analisis`, can be a 4th Docker service), replace demo users, define evidence retention period (Ley N.° 29733).
