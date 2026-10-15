-- =============================================================
-- 007_schema_drift.sql — Objetos que el código QR ya usa pero que
-- no estaban en los scripts del repositorio.
-- Es idempotente: si en producción ya existen, no cambia nada.
-- Ejecutar en: Supabase Dashboard → SQL Editor
-- =============================================================

ALTER TABLE print_jobs
  ADD COLUMN IF NOT EXISTS paper_size TEXT DEFAULT 'carta',
  ADD COLUMN IF NOT EXISTS page_from  INTEGER,
  ADD COLUMN IF NOT EXISTS page_to    INTEGER;

-- Usada por app/print/[token]/actions.ts
CREATE OR REPLACE FUNCTION public.increment_qr_use_count(token_id UUID)
RETURNS VOID
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  UPDATE qr_tokens
  SET use_count = use_count + 1, last_used_at = NOW()
  WHERE id = token_id;
$$;
