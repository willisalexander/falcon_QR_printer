-- =============================================================
-- 008_local_reception.sql — Recepción local por carpeta (El Arrecife)
--
-- Solo METADATOS administrativos. Ningún documento, PDF, miniatura,
-- vista previa ni texto extraído se guarda en Supabase: los archivos
-- viven únicamente en la computadora del negocio.
--
-- Es aditiva e idempotente: no modifica ni borra datos existentes.
-- Haga un respaldo antes de ejecutarla en producción.
-- Ejecutar en: Supabase Dashboard → SQL Editor (después de 007).
-- =============================================================

-- ── Impresoras: capacidades declaradas por el administrador ──
ALTER TABLE printers
  ADD COLUMN IF NOT EXISTS supports_color  BOOLEAN,
  ADD COLUMN IF NOT EXISTS supports_duplex BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS paper_sizes     TEXT[]  NOT NULL DEFAULT ARRAY['carta']::TEXT[],
  ADD COLUMN IF NOT EXISTS trays           JSONB   NOT NULL DEFAULT '{}'::JSONB,
  ADD COLUMN IF NOT EXISTS priority        INTEGER NOT NULL DEFAULT 100,
  ADD COLUMN IF NOT EXISTS capabilities_checked_at TIMESTAMPTZ;

UPDATE printers SET supports_color = (print_type = 'color') WHERE supports_color IS NULL;
ALTER TABLE printers ALTER COLUMN supports_color SET DEFAULT false;
ALTER TABLE printers ALTER COLUMN supports_color SET NOT NULL;

DO $$ BEGIN
  ALTER TABLE printers ADD CONSTRAINT printers_paper_sizes_valid
    CHECK (paper_sizes <@ ARRAY['carta','a4','oficio2','legal']::TEXT[]);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ── Reglas de asignación de impresora ─────────────────────────
CREATE TABLE IF NOT EXISTS printer_rules (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name        TEXT NOT NULL,
  priority    INTEGER NOT NULL DEFAULT 100,           -- menor número = se evalúa primero
  enabled     BOOLEAN NOT NULL DEFAULT true,
  paper_size  TEXT NOT NULL DEFAULT 'any' CHECK (paper_size IN ('any','carta','a4','oficio2','legal')),
  color_mode  TEXT NOT NULL DEFAULT 'any' CHECK (color_mode IN ('any','bw','color')),
  duplex      TEXT NOT NULL DEFAULT 'any' CHECK (duplex IN ('any','yes','no')),
  min_pages   INTEGER CHECK (min_pages IS NULL OR min_pages >= 1),
  max_pages   INTEGER CHECK (max_pages IS NULL OR max_pages >= 1),
  printer_id  UUID NOT NULL REFERENCES printers(id) ON DELETE CASCADE,
  tray        TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_printer_rules_priority ON printer_rules(priority);

DROP TRIGGER IF EXISTS set_updated_at_printer_rules ON printer_rules;
CREATE TRIGGER set_updated_at_printer_rules
  BEFORE UPDATE ON printer_rules
  FOR EACH ROW EXECUTE FUNCTION trigger_set_updated_at();

-- ── Clientes ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS customers (
  id          UUID PRIMARY KEY,
  name        TEXT NOT NULL,
  phone       TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_customers_name ON customers(name);

-- ── Pedidos de recepción local ────────────────────────────────
CREATE TABLE IF NOT EXISTS reception_orders (
  id              UUID PRIMARY KEY,
  correlative     TEXT NOT NULL UNIQUE,               -- ARR-YYYYMMDD-NNN
  customer_id     UUID REFERENCES customers(id) ON DELETE SET NULL,
  customer_name   TEXT NOT NULL,
  notes           TEXT,
  status          TEXT NOT NULL CHECK (status IN ('open','finished','cancelled')),
  is_complete     BOOLEAN NOT NULL DEFAULT false,
  priority        INTEGER NOT NULL DEFAULT 0,
  keep_documents  BOOLEAN NOT NULL DEFAULT false,     -- conservación excepcional
  total_price     NUMERIC(10, 2) NOT NULL DEFAULT 0,
  created_at      TIMESTAMPTZ NOT NULL,
  finished_at     TIMESTAMPTZ,
  purge_after     TIMESTAMPTZ,                        -- fecha prevista de eliminación local
  documents_deleted_at TIMESTAMPTZ,
  updated_at      TIMESTAMPTZ NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_reception_orders_status  ON reception_orders(status);
CREATE INDEX IF NOT EXISTS idx_reception_orders_created ON reception_orders(created_at DESC);

-- ── Documentos recibidos (metadatos; el archivo está solo en la PC local) ──
CREATE TABLE IF NOT EXISTS reception_documents (
  id                 UUID PRIMARY KEY,                -- identificador local del documento
  order_id           UUID REFERENCES reception_orders(id) ON DELETE SET NULL,
  original_file_name TEXT NOT NULL,
  source             TEXT NOT NULL DEFAULT 'folder' CHECK (source IN ('folder','qr')),
  sha256             TEXT,
  size_bytes         BIGINT,
  received_at        TIMESTAMPTZ NOT NULL,
  status             TEXT NOT NULL,
  error_code         TEXT,
  error_message      TEXT,
  page_count         INTEGER,
  size_class         TEXT,                            -- carta | a4 | oficio2 | legal | custom | mixed
  orientation        TEXT,
  page_groups        JSONB,                           -- tamaños y rangos de páginas (sin contenido)
  copies             INTEGER,
  color_mode         TEXT,
  duplex             TEXT,
  paper_size         TEXT,
  scale_mode         TEXT,
  mixed_strategy     TEXT,
  printer_id         UUID,
  notes              TEXT,
  converted_at       TIMESTAMPTZ,
  deleted_at         TIMESTAMPTZ,
  purge_after        TIMESTAMPTZ,
  updated_at         TIMESTAMPTZ NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_reception_documents_order    ON reception_documents(order_id);
CREATE INDEX IF NOT EXISTS idx_reception_documents_received ON reception_documents(received_at DESC);

-- ── Trabajos e intentos de impresión ──────────────────────────
CREATE TABLE IF NOT EXISTS reception_print_jobs (
  id              UUID PRIMARY KEY,
  document_id     UUID NOT NULL REFERENCES reception_documents(id) ON DELETE CASCADE,
  order_id        UUID REFERENCES reception_orders(id) ON DELETE SET NULL,
  kind            TEXT NOT NULL CHECK (kind IN ('print','reprint')),
  retry_of        UUID,
  pages           TEXT,
  page_count      INTEGER NOT NULL,
  copies          INTEGER NOT NULL,
  color_mode      TEXT NOT NULL,
  duplex          TEXT NOT NULL,
  paper_size      TEXT NOT NULL,
  scale_mode      TEXT NOT NULL,
  printer_id      UUID,
  printer_name    TEXT,
  tray            TEXT,
  rule_id         UUID,
  priority        INTEGER NOT NULL DEFAULT 0,
  status          TEXT NOT NULL,   -- ready | sending | sent | printing | printed | error | unknown | cancelled
  error_message   TEXT,
  spooler_status  TEXT,
  price           NUMERIC(10, 2) NOT NULL DEFAULT 0,
  authorized_by   TEXT,
  created_at      TIMESTAMPTZ NOT NULL,
  sent_at         TIMESTAMPTZ,
  spooler_done_at TIMESTAMPTZ,
  confirmed_at    TIMESTAMPTZ,                        -- fecha de impresión confirmada
  cancelled_at    TIMESTAMPTZ,
  updated_at      TIMESTAMPTZ NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_reception_jobs_status  ON reception_print_jobs(status);
CREATE INDEX IF NOT EXISTS idx_reception_jobs_created ON reception_print_jobs(created_at DESC);

CREATE TABLE IF NOT EXISTS reception_print_attempts (
  id          UUID PRIMARY KEY,
  job_id      UUID NOT NULL REFERENCES reception_print_jobs(id) ON DELETE CASCADE,
  attempt_no  INTEGER NOT NULL,
  started_at  TIMESTAMPTZ NOT NULL,
  finished_at TIMESTAMPTZ,
  outcome     TEXT,
  detail      TEXT
);

CREATE TABLE IF NOT EXISTS reception_deletions (
  id            UUID PRIMARY KEY,
  document_id   UUID NOT NULL,
  order_id      UUID,
  original_name TEXT,
  deleted_at    TIMESTAMPTZ NOT NULL,
  reason        TEXT NOT NULL,
  files_removed INTEGER NOT NULL DEFAULT 0
);

-- ── RLS ───────────────────────────────────────────────────────
-- El agente local escribe con la Service Role Key (no pasa por RLS).
-- El personal autenticado solo LEE; nadie anónimo tiene acceso.
ALTER TABLE printer_rules            ENABLE ROW LEVEL SECURITY;
ALTER TABLE customers                ENABLE ROW LEVEL SECURITY;
ALTER TABLE reception_orders         ENABLE ROW LEVEL SECURITY;
ALTER TABLE reception_documents      ENABLE ROW LEVEL SECURITY;
ALTER TABLE reception_print_jobs     ENABLE ROW LEVEL SECURITY;
ALTER TABLE reception_print_attempts ENABLE ROW LEVEL SECURITY;
ALTER TABLE reception_deletions      ENABLE ROW LEVEL SECURITY;

DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['customers','reception_orders','reception_documents',
                           'reception_print_jobs','reception_print_attempts','reception_deletions','printer_rules']
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON %I', t || '_staff_read', t);
    EXECUTE format('CREATE POLICY %I ON %I FOR SELECT TO authenticated USING (is_staff())', t || '_staff_read', t);
  END LOOP;
END $$;

DROP POLICY IF EXISTS printer_rules_admin_insert ON printer_rules;
CREATE POLICY printer_rules_admin_insert ON printer_rules FOR INSERT TO authenticated WITH CHECK (is_admin());
DROP POLICY IF EXISTS printer_rules_admin_update ON printer_rules;
CREATE POLICY printer_rules_admin_update ON printer_rules FOR UPDATE TO authenticated USING (is_admin()) WITH CHECK (is_admin());
DROP POLICY IF EXISTS printer_rules_admin_delete ON printer_rules;
CREATE POLICY printer_rules_admin_delete ON printer_rules FOR DELETE TO authenticated USING (is_admin());

-- ── Ajustes del flujo local ───────────────────────────────────
INSERT INTO settings (key, value, description) VALUES
  ('print_mode',             'supervised', 'Modo de impresión local: supervised | auto'),
  ('retention_days',         '30',  'Días naturales que se conservan los documentos tras finalizar el pedido'),
  ('local_max_file_size_mb', '50',  'Tamaño máximo por archivo recibido en la carpeta (MB)'),
  ('convert_timeout_sec',    '120', 'Tiempo máximo de conversión a PDF (segundos)'),
  ('convert_concurrency',    '1',   'Conversiones simultáneas de LibreOffice (1 a 4)'),
  ('paper_tolerance_pt',     '8',   'Tolerancia al clasificar tamaños de página (puntos, 1/72 in)'),
  ('file_stability_ms',      '2000','Tiempo sin cambios para considerar terminada una descarga (ms)'),
  ('printer_wait_min',       '10',  'Minutos que un trabajo espera a una impresora no disponible'),
  ('auto_confirm_spooler',   'false','Dar por impreso cuando el trabajo sale de la cola de Windows')
ON CONFLICT (key) DO NOTHING;

-- ── Vista para reportes: actividad QR + carpeta ───────────────
CREATE OR REPLACE VIEW v_print_activity
WITH (security_invoker = true) AS
  SELECT j.id, 'qr'::TEXT AS source, j.correlative, j.client_name, j.print_type::TEXT AS color_mode,
         j.page_count, j.copy_count AS copies, j.total_price, j.status::TEXT AS status,
         j.created_at, j.printed_at
  FROM print_jobs j
  UNION ALL
  SELECT j.id, 'folder'::TEXT, o.correlative, o.customer_name, j.color_mode,
         j.page_count, j.copies, j.price, j.status,
         j.created_at, j.confirmed_at
  FROM reception_print_jobs j
  LEFT JOIN reception_orders o ON o.id = j.order_id;
