-- ============================================================
-- PRINT QR SYSTEM — Row Level Security (RLS)
-- ============================================================

-- ============================================================
-- HELPER: verificar si el usuario autenticado es admin
-- ============================================================

CREATE OR REPLACE FUNCTION is_admin()
RETURNS BOOLEAN AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1 FROM profiles
    WHERE id = auth.uid()
      AND role = 'admin'
      AND is_active = true
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER STABLE;

-- ============================================================
-- HELPER: verificar si el usuario es admin u operador activo
-- ============================================================

CREATE OR REPLACE FUNCTION is_staff()
RETURNS BOOLEAN AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1 FROM profiles
    WHERE id = auth.uid()
      AND role IN ('admin', 'operator')
      AND is_active = true
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER STABLE;

-- ============================================================
-- RLS: profiles
-- ============================================================

ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;

-- El trigger del sistema puede insertar perfiles (auth.uid() es NULL en ese momento)
CREATE POLICY "profiles_insert_trigger"
  ON profiles FOR INSERT
  WITH CHECK (true);

-- Los usuarios pueden ver su propio perfil; staff puede ver todos
CREATE POLICY "profiles_select_own"
  ON profiles FOR SELECT
  USING (id = auth.uid() OR is_staff());

-- Los usuarios solo pueden editar su propio perfil
CREATE POLICY "profiles_update_own"
  ON profiles FOR UPDATE
  USING (id = auth.uid())
  WITH CHECK (id = auth.uid());

-- Solo admins pueden actualizar cualquier perfil o eliminar
CREATE POLICY "profiles_admin_update"
  ON profiles FOR UPDATE
  USING (is_admin());

CREATE POLICY "profiles_admin_delete"
  ON profiles FOR DELETE
  USING (is_admin());

-- ============================================================
-- RLS: qr_tokens
-- ============================================================

ALTER TABLE qr_tokens ENABLE ROW LEVEL SECURITY;

-- Lectura pública del token (para validación sin auth)
CREATE POLICY "qr_tokens_public_read"
  ON qr_tokens FOR SELECT
  TO anon, authenticated
  USING (true);

-- Solo staff puede modificar tokens
CREATE POLICY "qr_tokens_staff_insert"
  ON qr_tokens FOR INSERT
  TO authenticated
  WITH CHECK (is_staff());

CREATE POLICY "qr_tokens_staff_update"
  ON qr_tokens FOR UPDATE
  TO authenticated
  USING (is_staff());

CREATE POLICY "qr_tokens_admin_delete"
  ON qr_tokens FOR DELETE
  TO authenticated
  USING (is_admin());

-- ============================================================
-- RLS: printers
-- ============================================================

ALTER TABLE printers ENABLE ROW LEVEL SECURITY;

CREATE POLICY "printers_staff_read"
  ON printers FOR SELECT
  TO authenticated
  USING (is_staff());

CREATE POLICY "printers_admin_write"
  ON printers FOR INSERT
  TO authenticated
  WITH CHECK (is_admin());

CREATE POLICY "printers_admin_update"
  ON printers FOR UPDATE
  TO authenticated
  USING (is_admin());

CREATE POLICY "printers_admin_delete"
  ON printers FOR DELETE
  TO authenticated
  USING (is_admin());

-- ============================================================
-- RLS: settings
-- ============================================================

ALTER TABLE settings ENABLE ROW LEVEL SECURITY;

-- Settings son públicas en lectura (necesario para calcular precios en formulario público)
CREATE POLICY "settings_public_read"
  ON settings FOR SELECT
  TO anon, authenticated
  USING (true);

CREATE POLICY "settings_admin_write"
  ON settings FOR INSERT
  TO authenticated
  WITH CHECK (is_admin());

CREATE POLICY "settings_admin_update"
  ON settings FOR UPDATE
  TO authenticated
  USING (is_admin());

-- ============================================================
-- RLS: print_jobs
-- ============================================================

ALTER TABLE print_jobs ENABLE ROW LEVEL SECURITY;

-- Inserción pública (anon puede crear trabajos desde el formulario QR)
CREATE POLICY "print_jobs_public_insert"
  ON print_jobs FOR INSERT
  TO anon, authenticated
  WITH CHECK (true);

-- Solo staff puede leer los trabajos
CREATE POLICY "print_jobs_staff_read"
  ON print_jobs FOR SELECT
  TO authenticated
  USING (is_staff());

-- Solo staff puede actualizar
CREATE POLICY "print_jobs_staff_update"
  ON print_jobs FOR UPDATE
  TO authenticated
  USING (is_staff());

-- Solo admin puede eliminar
CREATE POLICY "print_jobs_admin_delete"
  ON print_jobs FOR DELETE
  TO authenticated
  USING (is_admin());

-- ============================================================
-- RLS: print_job_events
-- ============================================================

ALTER TABLE print_job_events ENABLE ROW LEVEL SECURITY;

-- Inserción pública (triggers y clientes anónimos)
CREATE POLICY "job_events_public_insert"
  ON print_job_events FOR INSERT
  TO anon, authenticated
  WITH CHECK (true);

CREATE POLICY "job_events_staff_read"
  ON print_job_events FOR SELECT
  TO authenticated
  USING (is_staff());

-- ============================================================
-- RLS: audit_logs
-- ============================================================

ALTER TABLE audit_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "audit_logs_insert_any"
  ON audit_logs FOR INSERT
  TO anon, authenticated
  WITH CHECK (true);

CREATE POLICY "audit_logs_admin_read"
  ON audit_logs FOR SELECT
  TO authenticated
  USING (is_admin());

-- ============================================================
-- STORAGE: Configuración de buckets
-- (Ejecutar en Supabase Dashboard → Storage, o via SQL)
-- ============================================================

-- Bucket para PDFs de impresión
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'print-files',
  'print-files',
  false,
  10485760, -- 10 MB
  ARRAY['application/pdf', 'image/jpeg', 'image/png', 'image/webp']
) ON CONFLICT (id) DO NOTHING;

-- Bucket para miniaturas (público para mostrar en admin)
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'thumbnails',
  'thumbnails',
  true,
  2097152, -- 2 MB
  ARRAY['image/png', 'image/jpeg', 'image/webp']
) ON CONFLICT (id) DO NOTHING;

-- Políticas de Storage: print-files
CREATE POLICY "storage_print_files_public_upload"
  ON storage.objects FOR INSERT
  TO anon, authenticated
  WITH CHECK (bucket_id = 'print-files');

CREATE POLICY "storage_print_files_staff_read"
  ON storage.objects FOR SELECT
  TO authenticated
  USING (
    bucket_id = 'print-files'
    AND is_staff()
  );

CREATE POLICY "storage_thumbnails_public_read"
  ON storage.objects FOR SELECT
  TO anon, authenticated
  USING (bucket_id = 'thumbnails');

CREATE POLICY "storage_thumbnails_insert"
  ON storage.objects FOR INSERT
  TO anon, authenticated
  WITH CHECK (bucket_id = 'thumbnails');
