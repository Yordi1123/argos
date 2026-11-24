# Changelog

Todos los cambios relevantes de ARGOS se documentan aquí.

El formato sigue [Keep a Changelog](https://keepachangelog.com/es-ES/1.1.0/) y el proyecto usa
[Semantic Versioning](https://semver.org/lang/es/). Política completa en [docs/versionado.md](docs/versionado.md).

Secciones por versión: **Agregado**, **Cambiado**, **Obsoleto**, **Eliminado**, **Corregido**, **Seguridad**.

## [Sin publicar]

## [1.0.0-alpha.1] - 2026-11-23

Primera versión alpha: el flujo completo funciona con el simulador, sin hardware real.

### Agregado
- Backend FastAPI con máquina de estados de eventos, decisión D1 (recalcula la velocidad) y D2 (prioridad de revisión).
- Verificación SHA-256 de evidencias al registrarlas y cada vez que se sirven.
- Auditoría de solo inserción protegida por trigger en PostgreSQL.
- Simulador del agente de captura y del módulo de visión (`agente/simulador.py`).
- Panel de revisión ARGOS Glass conectado a la API: cola priorizada, expediente con foto verificada, cadena de custodia y dictámenes (confirmar, corregir, descartar, marcar no verificable).
- Landing page pública con la descripción del sistema.
- Docker Compose con `db`, `backend` y `frontend` (nginx como proxy de `/api`).
- Script de respaldo de base de datos y evidencias.
- Versión visible en el panel y en `GET /api/salud`.

### Pendiente para beta
- Inicio de sesión real (hoy el revisor es el primer usuario con rol REVISOR).
- Agente de captura real (ESP32 + cámara RTSP) y módulo de visión real (YOLO + OCR).

[Sin publicar]: https://github.com/Yordi1123/argos/compare/v1.0.0-alpha.1...develop
[1.0.0-alpha.1]: https://github.com/Yordi1123/argos/releases/tag/v1.0.0-alpha.1
