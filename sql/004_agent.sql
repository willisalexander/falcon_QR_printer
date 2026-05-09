-- ============================================================
-- PRINT QR SYSTEM — Función para el Agente Local (Fase 5)
-- Ejecutar en: Supabase Dashboard → SQL Editor
-- ============================================================

-- claim_next_print_job()
-- Reclama atómicamente el siguiente trabajo aprobado.
-- Usa FOR UPDATE SKIP LOCKED para que dos instancias del agente
-- nunca procesen el mismo trabajo simultáneamente.

CREATE OR REPLACE FUNCTION public.claim_next_print_job()
RETURNS SETOF print_jobs
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id UUID;
BEGIN
  UPDATE print_jobs
  SET status     = 'printing',
      updated_at = NOW()
  WHERE id = (
    SELECT id
    FROM print_jobs
    WHERE status = 'approved'
    ORDER BY created_at ASC
    LIMIT 1
    FOR UPDATE SKIP LOCKED   -- salta filas bloqueadas por otra transacción
  )
  RETURNING id INTO v_id;

  IF v_id IS NOT NULL THEN
    RETURN QUERY SELECT * FROM print_jobs WHERE id = v_id;
  END IF;
END;
$$;
