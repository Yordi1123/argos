# Changelog

Todos los cambios relevantes de ARGOS se documentan aquí.

El formato sigue [Keep a Changelog](https://keepachangelog.com/es-ES/1.1.0/) y el proyecto usa
[Semantic Versioning](https://semver.org/lang/es/). Política completa en [docs/versionado.md](docs/versionado.md).

Secciones por versión: **Agregado**, **Cambiado**, **Obsoleto**, **Eliminado**, **Corregido**, **Seguridad**.

## [Sin publicar]

### Agregado
- Landing: video de vehículos circulando en el recuadro "Vista ilustrativa · punto de control" (720p, 4,3 MB, sin sonido, en bucle; respeta "reducir movimiento" del sistema y vuelve a la ilustración si el video no carga).
- Inicio de sesión con correo y contraseña. Las contraseñas se guardan solo como hash Argon2id.
- Cuentas creadas por un administrador con contraseña temporal (se muestra una vez) que se cambia obligatoriamente en el primer ingreso.
- Bloqueo de 15 min tras 5 intentos fallidos; el mensaje de error no revela si la cuenta existe.
- "Restablecer contraseña" en la administración de cuentas y "Cambiar contraseña" en el menú del perfil.
- Consola de cuentas: `python -m app.cuentas admin|restablecer|listar` para el primer administrador o emergencias.
- Sesiones del panel en el servidor con cookie `HttpOnly`/`SameSite=Strict`: 8 h máximo y cierre tras 30 min sin actividad; el sondeo automático no cuenta como actividad.
- Página real de administración de cuentas: crear, cambiar rol, desactivar y reactivar. Siempre queda al menos un administrador activo.
- Claves de API para servicios (`python -m app.claves crear|listar|rotar|revocar`).
- Menú y acciones según el rol (REVISOR, OPERADOR, ADMINISTRADOR), menú de perfil y cierre de sesión.
- Auditoría de ingresos, accesos denegados, cambios de contraseña y cambios de cuentas.
- Inicio de sesión con Google preparado como implementación futura: el panel muestra el botón como "Próximamente" mientras no haya `GOOGLE_CLIENT_ID`.

### Cambiado
- **Rompe la API:** `POST /api/eventos/{id}/revision` ya no acepta `revisor_id`; el revisor es quien tiene la sesión abierta.
- **Rompe la API:** se elimina el encabezado `X-Actor`; el agente y el módulo de visión deben enviar `X-Api-Key`.
- **Rompe la API:** `POST /api/sesiones` ya no acepta `operador_id`; se toma de la sesión.
- **Rompe la API:** `GET/POST /api/usuarios` requieren rol ADMINISTRADOR; crear exige `nombre` y devuelve `contrasena_temporal`.
- La pantalla de acceso tiene un formulario real en lugar de campos ilustrativos.
- `agente/simulador.py` lee `ARGOS_CLAVE_AGENTE` y `ARGOS_CLAVE_VISION`.

### Eliminado
- Usuarios de demostración `@argos.local`: los que firmaron dictámenes quedan desactivados.

### Corregido
- Un espacio invisible al inicio o al final de la contraseña (al copiar y pegar) impedía entrar; ahora se ignoran al guardarla y al ingresar.
- Una contraseña con tildes o ñ podía no coincidir si el teclado las enviaba como letra + tilde combinada; ahora se normaliza (Unicode NFKC) antes de guardarla y de compararla.
- Un dictamen sobre un evento inexistente respondía 500; ahora 404. Un identificador mal formado responde 422.

### Seguridad
- Todos los endpoints de eventos, evidencias, cola y análisis exigen autenticación; antes eran públicos, incluidas las fotos de evidencia.
- Cada clave de servicio solo puede hacer lo suyo: el agente no lee eventos ni emite dictámenes, y la visión no registra eventos.
- Las escrituras con cookie se rechazan si vienen de un origen distinto al panel (defensa CSRF además de `SameSite`).

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
