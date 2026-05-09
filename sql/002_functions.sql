-- ============================================================
-- PRINT QR SYSTEM — Funciones y Triggers
-- ============================================================

-- ============================================================
-- FUNCIÓN: generar correlativo diario
-- Formato: IMP-YYYYMMDD-001
-- ============================================================

CREATE OR REPLACE FUNCTION generate_daily_correlative()
RETURNS TEXT AS $$
DECLARE
  v_date    TEXT;
  v_count   INTEGER;
  v_corr    TEXT;
BEGIN
  v_date := TO_CHAR(NOW() AT TIME ZONE 'America/Guatemala', 'YYYYMMDD');

  SELECT COUNT(*) + 1
  INTO   v_count
  FROM   print_jobs
  WHERE  DATE(created_at AT TIME ZONE 'America/Guatemala') = CURRENT_DATE;

  v_corr := 'IMP-' || v_date || '-' || LPAD(v_count::TEXT, 3, '0');

  -- Garantizar unicidad en caso de colisión
  WHILE EXISTS (SELECT 1 FROM print_jobs WHERE correlative = v_corr) LOOP
    v_count := v_count + 1;
    v_corr := 'IMP-' || v_date || '-' || LPAD(v_count::TEXT, 3, '0');
  END LOOP;

  RETURN v_corr;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================================
-- FUNCIÓN: calcular precio total del trabajo
-- ============================================================

CREATE OR REPLACE FUNCTION calculate_job_price(
  p_print_type    print_type,
  p_page_count    INTEGER,
  p_copy_count    INTEGER
)
RETURNS NUMERIC AS $$
DECLARE
  v_price_bw    NUMERIC;
  v_price_color NUMERIC;
  v_total       NUMERIC;
BEGIN
  SELECT value::NUMERIC INTO v_price_bw
  FROM settings WHERE key = 'price_bw';

  SELECT value::NUMERIC INTO v_price_color
  FROM settings WHERE key = 'price_color';

  IF p_print_type = 'bw' THEN
    v_total := COALESCE(v_price_bw, 0.50) * p_page_count * p_copy_count;
  ELSE
    v_total := COALESCE(v_price_color, 2.00) * p_page_count * p_copy_count;
  END IF;

  RETURN ROUND(v_total, 2);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================================
-- FUNCIÓN: obtener impresora predeterminada por tipo
-- ============================================================

CREATE OR REPLACE FUNCTION get_default_printer(p_type print_type)
RETURNS UUID AS $$
DECLARE
  v_printer_id UUID;
BEGIN
  IF p_type = 'bw' THEN
    SELECT id INTO v_printer_id
    FROM printers
    WHERE is_default_bw = true AND is_active = true
    LIMIT 1;
  ELSE
    SELECT id INTO v_printer_id
    FROM printers
    WHERE is_default_color = true AND is_active = true
    LIMIT 1;
  END IF;

  RETURN v_printer_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================================
-- TRIGGER: updated_at automático en todas las tablas
-- ============================================================

CREATE OR REPLACE FUNCTION trigger_set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER set_updated_at_profiles
  BEFORE UPDATE ON profiles
  FOR EACH ROW EXECUTE FUNCTION trigger_set_updated_at();

CREATE TRIGGER set_updated_at_qr_tokens
  BEFORE UPDATE ON qr_tokens
  FOR EACH ROW EXECUTE FUNCTION trigger_set_updated_at();

CREATE TRIGGER set_updated_at_printers
  BEFORE UPDATE ON printers
  FOR EACH ROW EXECUTE FUNCTION trigger_set_updated_at();

CREATE TRIGGER set_updated_at_settings
  BEFORE UPDATE ON settings
  FOR EACH ROW EXECUTE FUNCTION trigger_set_updated_at();

CREATE TRIGGER set_updated_at_print_jobs
  BEFORE UPDATE ON print_jobs
  FOR EACH ROW EXECUTE FUNCTION trigger_set_updated_at();

-- ============================================================
-- TRIGGER: registrar eventos automáticos en print_job_events
-- al cambiar el estado de un trabajo
-- ============================================================

CREATE OR REPLACE FUNCTION trigger_log_job_status_change()
RETURNS TRIGGER AS $$
BEGIN
  IF OLD.status IS DISTINCT FROM NEW.status THEN
    INSERT INTO print_job_events (
      print_job_id,
      event_type,
      description,
      old_status,
      new_status
    ) VALUES (
      NEW.id,
      'status_change',
      'Estado cambiado de ' || OLD.status || ' a ' || NEW.status,
      OLD.status,
      NEW.status
    );
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER log_job_status_change
  AFTER UPDATE ON print_jobs
  FOR EACH ROW EXECUTE FUNCTION trigger_log_job_status_change();

-- ============================================================
-- TRIGGER: crear perfil automáticamente al registrar usuario
-- ============================================================

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.profiles (id, email, full_name, role, is_active)
  VALUES (
    NEW.id,
    NEW.email,
    COALESCE(NEW.raw_user_meta_data->>'full_name', split_part(NEW.email, '@', 1)),
    'operator'::public.user_role,
    true
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION handle_new_user();

-- ============================================================
-- FUNCIÓN: validar token QR y retornar info
-- ============================================================

CREATE OR REPLACE FUNCTION validate_qr_token(p_token TEXT)
RETURNS TABLE(
  id          UUID,
  is_active   BOOLEAN,
  expires_at  TIMESTAMPTZ
) AS $$
BEGIN
  -- Actualizar contador de uso
  UPDATE qr_tokens
  SET
    last_used_at = NOW(),
    use_count    = use_count + 1
  WHERE
    token    = p_token
    AND is_active = true
    AND (expires_at IS NULL OR expires_at > NOW());

  RETURN QUERY
  SELECT
    qt.id,
    qt.is_active,
    qt.expires_at
  FROM qr_tokens qt
  WHERE qt.token = p_token;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
