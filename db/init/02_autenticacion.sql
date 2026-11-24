-- ARGOS · Autenticación (1.0.0-alpha): Google para personas, claves de API para servicios.
-- Idempotente: en una base nueva se ejecuta tras 01_esquema.sql; en una existente se aplica con
--   docker compose exec -T db psql -U argos -d argos -v ON_ERROR_STOP=1 < db/init/02_autenticacion.sql

-- Usuarios: identidad de Google ------------------------------------------------
ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS email_canonico TEXT;
ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS google_sub     TEXT;
ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS ultimo_acceso  TIMESTAMPTZ;

-- Gmail ignora puntos y sufijos "+algo": juan.perez+x@gmail.com = juanperez@gmail.com
CREATE OR REPLACE FUNCTION email_canonico(e TEXT) RETURNS TEXT AS $$
  SELECT CASE
    WHEN split_part(lower(trim(e)), '@', 2) IN ('gmail.com', 'googlemail.com') THEN
      replace(split_part(split_part(lower(trim(e)), '@', 1), '+', 1), '.', '') || '@gmail.com'
    ELSE lower(trim(e))
  END
$$ LANGUAGE sql IMMUTABLE;

UPDATE usuarios SET email_canonico = email_canonico(email) WHERE email_canonico IS NULL;
ALTER TABLE usuarios ALTER COLUMN email_canonico SET NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS ux_usuarios_email_canonico ON usuarios(email_canonico);
CREATE UNIQUE INDEX IF NOT EXISTS ux_usuarios_google_sub ON usuarios(google_sub) WHERE google_sub IS NOT NULL;

-- Sesiones de acceso al panel (no confundir con `sesiones`, que son jornadas de captura)
CREATE TABLE IF NOT EXISTS sesiones_acceso (
  id                BIGSERIAL PRIMARY KEY,
  token_hash        CHAR(64) NOT NULL UNIQUE,      -- SHA-256 del token de la cookie; el token no se guarda
  usuario_id        INT NOT NULL REFERENCES usuarios(id),
  creada_en         TIMESTAMPTZ NOT NULL DEFAULT now(),
  ultima_actividad  TIMESTAMPTZ NOT NULL DEFAULT now(),
  cerrada_en        TIMESTAMPTZ,
  motivo_cierre     TEXT
);
CREATE INDEX IF NOT EXISTS idx_sesiones_acceso_usuario ON sesiones_acceso(usuario_id) WHERE cerrada_en IS NULL;

-- Claves de API de servicios (agente de captura, módulo de visión) -------------
CREATE TABLE IF NOT EXISTS claves_servicio (
  id          SERIAL PRIMARY KEY,
  nombre      TEXT NOT NULL UNIQUE,
  rol         rol_usuario NOT NULL CHECK (rol IN ('OPERADOR', 'VALIDACION_IA')),
  clave_hash  CHAR(64) NOT NULL UNIQUE,            -- SHA-256 de la clave; la clave solo se muestra al crearla
  activa      BOOLEAN NOT NULL DEFAULT TRUE,
  creada_en   TIMESTAMPTZ NOT NULL DEFAULT now(),
  ultimo_uso  TIMESTAMPTZ
);

-- Usuarios demo (@argos.local): no pueden iniciar sesión con Google -------------
-- Se borran si no tienen registros; si firmaron algo, se desactivan para conservar la trazabilidad.
DELETE FROM usuarios u
 WHERE u.email LIKE '%@argos.local'
   AND NOT EXISTS (SELECT 1 FROM revisiones r WHERE r.revisor_id = u.id)
   AND NOT EXISTS (SELECT 1 FROM sesiones s WHERE s.operador_id = u.id)
   AND NOT EXISTS (SELECT 1 FROM sesiones_acceso a WHERE a.usuario_id = u.id);
UPDATE usuarios SET activo = FALSE WHERE email LIKE '%@argos.local';
