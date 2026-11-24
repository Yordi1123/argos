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

Frontend (`frontend/argos-glass/`, React 19 + Vite 8 + TS 7, oxlint): `npm ci`, `npm run dev`, `npm run build`, `npm run lint` (must pass with 0 warnings).

Versioning (SemVer, one version for the whole system, currently `1.0.0-alpha.N`): `./scripts/version.sh` shows/checks versions, `./scripts/version.sh X.Y.Z[-alpha.N]` syncs `frontend/argos-glass/package.json` and `VERSION` in `backend/app/main.py`. Never bump by hand. Policy, Conventional Commits, branching and release steps: `docs/versionado.md`. Log user-visible changes under `## [Sin publicar]` in `CHANGELOG.md`.

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
- **Auth (`app/auth.py`)**: every endpoint except `/api/salud` and `/api/auth/{config,google}` declares `Depends(requiere(*roles, tipo=...))`, which returns an `Actor`. People log in with email + password (`POST /api/auth/ingresar`; Argon2id hashes in `usuarios.contrasena_hash` via `app/contrasenas.py`; same generic error whether or not the account exists; 5 failures → 15 min lock). Admins create accounts and get a one-time temporary password; `debe_cambiar_contrasena` makes `requiere()` return 403 until the user changes it via `POST /api/auth/contrasena`. Emergency/first admin: `python -m app.cuentas admin|restablecer|listar`. Google login (`POST /api/auth/google`) is kept as a future option: 503 without `GOOGLE_CLIENT_ID`, and the panel shows its button as "Próximamente". Users are matched by `email_canonico` (Gmail ignores dots/`+tag`). Both methods get a server-side session (`sesiones_acceso`, SHA-256 of the token) in an `HttpOnly`/`SameSite=Strict` cookie, 8 h max / 30 min idle. Requests with header `X-Argos-Sondeo: 1` (panel polling) don't refresh idle time. Services use `X-Api-Key` (`claves_servicio`, managed with `python -m app.claves`). **Identity always comes from the `Actor`, never from the request body** (no `revisor_id`/`operador_id`/`X-Actor`); audit `actor` is `actor.etiqueta` (email or `servicio:<name>`).
- When raising an `HTTPException` after writing audit rows (denied login, expired session), raise it **outside** `with transaccion()`, or the audit insert is rolled back.
- Role changes/deactivation close the user's sessions (`cerrar_sesiones_de`). The "at least one active admin" check locks the target plus all admins in one `ORDER BY id FOR UPDATE` query to avoid races and deadlocks.
- No users are seeded. At startup the backend only logs a warning if no active admin has a password; the first admin is created with `docker compose exec backend python -m app.cuentas admin <email> "<Name>"`.
- Schema changes for existing databases go in a new idempotent `db/init/NN_*.sql` (applied manually with `psql -f` on existing volumes; automatically on fresh ones).
- Config via `pydantic-settings` (`config.py`): `DATABASE_URL`, `EVIDENCIAS_DIR`, `CORS_ORIGENES` (comma-separated).
- A "sesión" is one field-capture day with its calibration (distance, limit, uncertainty, camera latency); events can only be registered into an open session.

### Frontend (`frontend/argos-glass/`)

**Read `frontend/argos-glass/AGENTS.md` before changing the frontend** — it is the team's tool-agnostic contract (architecture, backend contract, privacy, honesty of UI content, styling tokens, done-checklist, known debt). Key points:

- `src/api.ts` is the only place that calls `fetch`; `aEvento()`/`estadoUI()` adapt backend data to the UI model in `src/data.ts`. `REVISABLES` must match `backend/app/estados.py`.
- `App.tsx` owns all state (polls `GET /api/eventos` every 5 s, loads the selected event's detail, posts reviews) and passes a `Ctx` to `pages.tsx`. Navigation is a `Page` union state, not a router: landing → login → dashboard.
- Business rules (speed, D2, valid transitions) are never duplicated client-side; the backend is the source of truth.
- The public landing never shows real events/evidence; event data is never stored in `localStorage`.

## Pending before pilot (from README)

Real authentication (replace `X-Actor`/user picker with JWT or sessions), real capture agent (ESP32 serial, RTSP ring buffer, D1), real vision module (YOLO + OCR via `GET /api/cola` + `POST /api/eventos/{id}/analisis`, can be a 4th Docker service), replace demo users, define evidence retention period (Ley N.° 29733).
