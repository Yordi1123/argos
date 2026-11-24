-- ARGOS · Credenciales propias (1.0.0-alpha): correo + contraseña con hash Argon2id.
-- Google queda como implementación futura (sigue en el código, desactivado sin GOOGLE_CLIENT_ID).
-- Idempotente: en una base nueva corre tras 02_autenticacion.sql; en una existente:
--   docker compose exec -T db psql -U argos -d argos -v ON_ERROR_STOP=1 < db/init/03_contrasenas.sql

ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS contrasena_hash         TEXT;      -- Argon2id; NULL = sin contraseña asignada
ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS debe_cambiar_contrasena BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS intentos_fallidos       INT NOT NULL DEFAULT 0;
ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS bloqueado_hasta         TIMESTAMPTZ;
