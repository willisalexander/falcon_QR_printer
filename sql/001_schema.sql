-- ============================================================
-- PRINT QR SYSTEM — Schema Principal
-- Ejecutar en Supabase SQL Editor en este orden:
-- 001_schema.sql → 002_functions.sql → 003_rls.sql → 004_seed.sql
-- ============================================================

-- Habilitar extensiones necesarias
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ============================================================
-- ENUM TYPES
-- ============================================================

CREATE TYPE print_type AS ENUM ('bw', 'color');

CREATE TYPE job_status AS ENUM (
  'uploaded',
  'pending_approval',
  'approved',
  'printing',
  'printed',
  'rejected',
  'paid',
  'failed'
);

CREATE TYPE user_role AS ENUM ('admin', 'operator');

-- ============================================================
-- TABLE: profiles
-- Extiende auth.users de Supabase Auth
-- ============================================================

CREATE TABLE profiles (
  id          UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email       TEXT NOT NULL UNIQUE,
  full_name   TEXT NOT NULL,
  role        user_role NOT NULL DEFAULT 'operator',
  is_active   BOOLEAN NOT NULL DEFAULT true,
  avatar_url  TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_profiles_email    ON profiles(email);
CREATE INDEX idx_profiles_role     ON profiles(role);
CREATE INDEX idx_profiles_active   ON profiles(is_active);

-- ============================================================
-- TABLE: qr_tokens
-- Tokens seguros para acceso público por QR
-- ============================================================

CREATE TABLE qr_tokens (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  token       TEXT NOT NULL UNIQUE DEFAULT encode(gen_random_bytes(32), 'hex'),
  label       TEXT NOT NULL DEFAULT 'QR Principal',
  is_active   BOOLEAN NOT NULL DEFAULT true,
  created_by  UUID REFERENCES profiles(id) ON DELETE SET NULL,
  expires_at  TIMESTAMPTZ,
  last_used_at TIMESTAMPTZ,
  use_count   INTEGER NOT NULL DEFAULT 0,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_qr_tokens_token    ON qr_tokens(token);
CREATE INDEX idx_qr_tokens_active   ON qr_tokens(is_active);

-- ============================================================
-- TABLE: printers
-- Impresoras registradas en el sistema
-- ============================================================

CREATE TABLE printers (
  id               UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name             TEXT NOT NULL,
  system_name      TEXT NOT NULL,  -- Nombre del sistema OS (ej: "HP LaserJet Pro")
  print_type       print_type NOT NULL,
  is_active        BOOLEAN NOT NULL DEFAULT true,
  is_default_bw    BOOLEAN NOT NULL DEFAULT false,
  is_default_color BOOLEAN NOT NULL DEFAULT false,
  location         TEXT,
  notes            TEXT,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT one_default_bw    CHECK (
    NOT (is_default_bw = true AND print_type != 'bw')
  ),
  CONSTRAINT one_default_color CHECK (
    NOT (is_default_color = true AND print_type != 'color')
  )
);

CREATE INDEX idx_printers_type    ON printers(print_type);
CREATE INDEX idx_printers_active  ON printers(is_active);

-- ============================================================
-- TABLE: settings
-- Configuración general del sistema (clave-valor)
-- ============================================================

CREATE TABLE settings (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  key         TEXT NOT NULL UNIQUE,
  value       TEXT NOT NULL,
  description TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_settings_key ON settings(key);

-- ============================================================
-- TABLE: print_jobs
-- Trabajos de impresión — tabla central del sistema
-- ============================================================

CREATE TABLE print_jobs (
  id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  correlative       TEXT NOT NULL UNIQUE,   -- IMP-YYYYMMDD-001
  client_name       TEXT NOT NULL,
  print_type        print_type NOT NULL,
  page_count        INTEGER NOT NULL CHECK (page_count > 0),
  copy_count        INTEGER NOT NULL DEFAULT 1 CHECK (copy_count > 0),
  images_per_page   INTEGER CHECK (images_per_page IN (1, 2, 4, 6, 9)),
  price_per_page_bw    NUMERIC(10, 2) NOT NULL DEFAULT 0,
  price_per_page_color NUMERIC(10, 2) NOT NULL DEFAULT 0,
  total_price       NUMERIC(10, 2) NOT NULL DEFAULT 0,
  status            job_status NOT NULL DEFAULT 'uploaded',
  file_path         TEXT,                   -- Ruta en Supabase Storage
  original_file_name TEXT,
  thumbnail_path    TEXT,                   -- Ruta de miniatura en Storage
  printer_id        UUID REFERENCES printers(id) ON DELETE SET NULL,
  qr_token_id       UUID REFERENCES qr_tokens(id) ON DELETE SET NULL,
  approved_by       UUID REFERENCES profiles(id) ON DELETE SET NULL,
  approved_at       TIMESTAMPTZ,
  rejected_reason   TEXT,
  client_ip         TEXT,
  notes             TEXT,
  paid_at           TIMESTAMPTZ,
  printed_at        TIMESTAMPTZ,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_print_jobs_status      ON print_jobs(status);
CREATE INDEX idx_print_jobs_correlative ON print_jobs(correlative);
CREATE INDEX idx_print_jobs_created_at  ON print_jobs(created_at DESC);
CREATE INDEX idx_print_jobs_client_name ON print_jobs(client_name);
CREATE INDEX idx_print_jobs_print_type  ON print_jobs(print_type);
CREATE INDEX idx_print_jobs_date        ON print_jobs(created_at);

-- ============================================================
-- TABLE: print_job_events
-- Historial de eventos por trabajo (timeline)
-- ============================================================

CREATE TABLE print_job_events (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  print_job_id  UUID NOT NULL REFERENCES print_jobs(id) ON DELETE CASCADE,
  event_type    TEXT NOT NULL,  -- ej: 'status_change', 'error', 'note'
  description   TEXT NOT NULL,
  old_status    job_status,
  new_status    job_status,
  user_id       UUID REFERENCES profiles(id) ON DELETE SET NULL,
  metadata      JSONB,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_job_events_job_id    ON print_job_events(print_job_id);
CREATE INDEX idx_job_events_created_at ON print_job_events(created_at DESC);

-- ============================================================
-- TABLE: audit_logs
-- Registro de auditoría general del sistema
-- ============================================================

CREATE TABLE audit_logs (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id     UUID REFERENCES profiles(id) ON DELETE SET NULL,
  action      TEXT NOT NULL,
  table_name  TEXT,
  record_id   UUID,
  old_values  JSONB,
  new_values  JSONB,
  ip_address  TEXT,
  user_agent  TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_audit_logs_user_id   ON audit_logs(user_id);
CREATE INDEX idx_audit_logs_action    ON audit_logs(action);
CREATE INDEX idx_audit_logs_created_at ON audit_logs(created_at DESC);
CREATE INDEX idx_audit_logs_table     ON audit_logs(table_name);
