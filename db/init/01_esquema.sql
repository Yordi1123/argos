-- ARGOS · Esquema de base de datos (PostgreSQL 16)
-- Se ejecuta una sola vez, al crear el volumen de datos por primera vez.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- Estados del ciclo de vida de un evento
CREATE TYPE estado_evento AS ENUM (
  'EVIDENCIA_GUARDADA',  -- D1 aprobó y la foto ya está en disco
  'EN_COLA',             -- esperando análisis de placa
  'ANALIZADO',           -- el modelo propuso una placa
  'EN_REVISION',         -- D2 lo envió al revisor humano
  'CONFIRMADO',          -- decisión humana: exceso válido
  'DESCARTADO',          -- decisión humana o D2: no procede
  'INCIERTO'             -- medición dudosa (dos vehículos, orden invertido, etc.)
);

CREATE TYPE rol_usuario AS ENUM ('ADMINISTRADOR', 'REVISOR', 'OPERADOR', 'VALIDACION_IA');
CREATE TYPE tipo_evidencia AS ENUM ('FOTO', 'CLIP');
CREATE TYPE decision_revision AS ENUM ('CONFIRMAR', 'DESCARTAR', 'MARCAR_INCIERTO');

CREATE TABLE usuarios (
  id          SERIAL PRIMARY KEY,
  nombre      TEXT NOT NULL,
  email       TEXT NOT NULL UNIQUE,
  rol         rol_usuario NOT NULL,
  activo      BOOLEAN NOT NULL DEFAULT TRUE,
  creado_en   TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Una sesión = una jornada de captura en campo, con su calibración
CREATE TABLE sesiones (
  id                  SERIAL PRIMARY KEY,
  ubicacion           TEXT NOT NULL,
  distancia_m         NUMERIC(5,3) NOT NULL CHECK (distancia_m > 0),
  limite_kmh          NUMERIC(5,1) NOT NULL CHECK (limite_kmh > 0),
  incertidumbre_kmh   NUMERIC(4,2) NOT NULL DEFAULT 1.0,
  latencia_camara_ms  NUMERIC(7,2),
  operador_id         INT REFERENCES usuarios(id),
  iniciada_en         TIMESTAMPTZ NOT NULL DEFAULT now(),
  cerrada_en          TIMESTAMPTZ
);

CREATE TABLE eventos (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sesion_id          INT NOT NULL REFERENCES sesiones(id),
  t1_us              BIGINT NOT NULL,
  t2_us              BIGINT NOT NULL CHECK (t2_us > t1_us),
  velocidad_kmh      NUMERIC(6,2) NOT NULL,
  duracion_corte_ms  NUMERIC(8,2),
  estado             estado_evento NOT NULL DEFAULT 'EVIDENCIA_GUARDADA',
  motivo_incierto    TEXT,
  ocurrido_en        TIMESTAMPTZ NOT NULL,
  creado_en          TIMESTAMPTZ NOT NULL DEFAULT now(),
  actualizado_en     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_eventos_estado ON eventos(estado);
CREATE INDEX idx_eventos_sesion ON eventos(sesion_id, ocurrido_en);

CREATE TABLE evidencias (
  id            SERIAL PRIMARY KEY,
  evento_id     UUID NOT NULL REFERENCES eventos(id),
  tipo          tipo_evidencia NOT NULL,
  ruta          TEXT NOT NULL,              -- relativa a la carpeta de evidencias
  sha256        CHAR(64) NOT NULL,          -- integridad: se verifica al servirla
  capturada_en  TIMESTAMPTZ NOT NULL,
  UNIQUE (evento_id, ruta)
);

-- Cada intento de análisis queda registrado (reintentos con el mismo evento_id)
CREATE TABLE analisis (
  id               SERIAL PRIMARY KEY,
  evento_id        UUID NOT NULL REFERENCES eventos(id),
  intento          INT NOT NULL,
  placa_candidata  TEXT,
  confianza        NUMERIC(4,3) CHECK (confianza BETWEEN 0 AND 1),
  puntaje_utilidad NUMERIC(5,3),
  modelo_version   TEXT,
  error            TEXT,
  creado_en        TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (evento_id, intento)
);

CREATE TABLE revisiones (
  id           SERIAL PRIMARY KEY,
  evento_id    UUID NOT NULL REFERENCES eventos(id),
  revisor_id   INT NOT NULL REFERENCES usuarios(id),
  decision     decision_revision NOT NULL,
  placa_final  TEXT,
  comentario   TEXT,
  creado_en    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Auditoría de solo inserción: nadie puede modificar ni borrar el historial
CREATE TABLE auditoria (
  id               BIGSERIAL PRIMARY KEY,
  evento_id        UUID REFERENCES eventos(id),
  accion           TEXT NOT NULL,
  estado_anterior  estado_evento,
  estado_nuevo     estado_evento,
  actor            TEXT NOT NULL,
  detalle          JSONB NOT NULL DEFAULT '{}',
  creado_en        TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_auditoria_evento ON auditoria(evento_id, creado_en);

CREATE FUNCTION auditoria_inmutable() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'La tabla auditoria es de solo inserción';
END; $$ LANGUAGE plpgsql;

CREATE TRIGGER trg_auditoria_inmutable
  BEFORE UPDATE OR DELETE ON auditoria
  FOR EACH ROW EXECUTE FUNCTION auditoria_inmutable();

-- Sin usuarios iniciales: el primer administrador se crea al arrancar el backend
-- a partir de ARGOS_ADMIN_EMAIL (.env). Ver 02_autenticacion.sql.
