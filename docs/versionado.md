# Versionado de ARGOS

ARGOS sigue [Semantic Versioning 2.0.0](https://semver.org/lang/es/) con **una sola versión para todo el sistema**
(backend, frontend y esquema de base de datos se publican juntos). El frontend y el backend dependen de un
contrato común (la API REST y los estados de un evento), así que no tiene sentido versionarlos por separado.

## Fase actual: alpha

```
1.0.0-alpha.N  →  1.0.0-beta.N  →  1.0.0-rc.N  →  1.0.0 (piloto)
   ▲ hoy
```

| Fase | Significa | Se pasa a la siguiente cuando… |
| --- | --- | --- |
| `alpha` | Funcionalidades incompletas; la API, el esquema y la UI pueden cambiar sin aviso. | Existen todas las piezas del piloto: inicio de sesión real, agente de captura real (ESP32 + RTSP), módulo de visión real. |
| `beta` | Funcionalidades completas; solo se corrigen errores y se ajusta la UX. No se rompe la API sin justificarlo en el CHANGELOG. | Pruebas de campo sin errores bloqueantes. |
| `rc` | Candidata a piloto: solo correcciones críticas. | El equipo aprueba la versión para el piloto. |
| `1.0.0` | Versión del piloto. Desde aquí rige SemVer estricto. | — |

**Durante una fase prerelease** solo se incrementa el número final: `1.0.0-alpha.1`, `1.0.0-alpha.2`, …
Cualquier cambio (incluso uno que rompa la API) es válido entre dos alphas, pero **debe quedar en el CHANGELOG**.

**Desde `1.0.0`**:

| Cambio | Incremento | Ejemplo |
| --- | --- | --- |
| Rompe la API, el esquema de BD sin migración, o un flujo del revisor | MAJOR | `1.4.2 → 2.0.0` |
| Agrega funcionalidad compatible | MINOR | `1.4.2 → 1.5.0` |
| Corrige un error sin cambiar el contrato | PATCH | `1.4.2 → 1.4.3` |

## Dónde vive la versión

La versión se declara en tres lugares que **deben coincidir**. No se editan a mano: se usa el script.

| Archivo | Uso |
| --- | --- |
| `frontend/argos-glass/package.json` (+ `package-lock.json`) | Se inyecta en la UI como `__APP_VERSION__` |
| `backend/app/main.py` (`VERSION`) | Aparece en `/docs` y en `GET /api/salud` |
| `CHANGELOG.md` | Encabezado `## [X.Y.Z] - AAAA-MM-DD` |

```bash
./scripts/version.sh 1.0.0-alpha.2   # actualiza package.json, package-lock.json y backend; verifica el CHANGELOG
./scripts/version.sh                 # sin argumentos: muestra las versiones actuales y si coinciden
```

El panel muestra la versión del frontend; `GET /api/salud` devuelve la del backend. Si no coinciden, la UI
desplegada y la API no son de la misma publicación.

## Commits: Conventional Commits

Los mensajes siguen [Conventional Commits](https://www.conventionalcommits.org/es/v1.0.0/). El tipo y el alcance
van en inglés (estándar de la convención); la descripción, en español e imperativo.

```
<tipo>(<alcance>): <descripción en imperativo>

[cuerpo opcional: qué y por qué, no cómo]

[BREAKING CHANGE: qué se rompe y cómo migrar]
```

| Tipo | Cuándo |
| --- | --- |
| `feat` | Nueva funcionalidad visible para un usuario o para otro servicio |
| `fix` | Corrección de un error |
| `refactor` | Cambio de código sin cambiar comportamiento |
| `style` | Solo CSS/estética (no formato de código) |
| `docs` | Documentación |
| `test` | Pruebas |
| `build` | Docker, dependencias, Vite, CI |
| `chore` | Mantenimiento (versión, limpieza) |

Alcances habituales: `frontend`, `landing`, `panel`, `backend`, `api`, `db`, `agente`, `docker`.

```
feat(panel): permite descartar eventos desde la estación de revisión
fix(api): rechaza dictámenes sobre eventos en estado final
build(docker): construye el frontend desde frontend/argos-glass
chore(release): 1.0.0-alpha.2
```

Un `feat!:` o un pie `BREAKING CHANGE:` obliga a documentarlo en la sección **Cambiado** del CHANGELOG.

## Ramas y publicación

- `main`: solo versiones publicadas. Cada merge a `main` lleva una etiqueta `vX.Y.Z[-pre.N]`.
- `develop`: integración. Las ramas de trabajo salen de aquí y vuelven aquí por pull request.
- Ramas de trabajo: `feat/<tema>`, `fix/<tema>`, `docs/<tema>` (ej. `feat/login-google`).

Publicar una versión:

1. En `develop`, mover lo de `## [Sin publicar]` del CHANGELOG a una sección nueva `## [X.Y.Z] - AAAA-MM-DD`.
2. `./scripts/version.sh X.Y.Z` y verificar que todo compile (`docker compose up -d --build`).
3. Commit `chore(release): X.Y.Z`, merge a `main`, etiqueta anotada `git tag -a vX.Y.Z -m "ARGOS X.Y.Z"`.
4. `git push origin main develop --tags`.
