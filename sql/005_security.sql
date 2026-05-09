-- =============================================================
-- 005_security.sql — Hardening de políticas RLS y Storage
-- Ejecutar en: Supabase Dashboard → SQL Editor
-- =============================================================

-- ── print_jobs: INSERT público más restrictivo ────────────────
-- Solo permite insertar si el qr_token existe y está activo.
DROP POLICY IF EXISTS "print_jobs_public_insert" ON print_jobs;
CREATE POLICY "print_jobs_public_insert" ON print_jobs
  FOR INSERT TO anon, authenticated
  WITH CHECK (
    qr_token_id IS NOT NULL
    AND EXISTS (
      SELECT 1 FROM qr_tokens
      WHERE id = print_jobs.qr_token_id
        AND is_active = true
        AND (expires_at IS NULL OR expires_at > NOW())
    )
  );

-- ── print_job_events: INSERT público más restrictivo ─────────
DROP POLICY IF EXISTS "job_events_public_insert" ON print_job_events;
CREATE POLICY "job_events_public_insert" ON print_job_events
  FOR INSERT TO anon, authenticated
  WITH CHECK (
    print_job_id IS NOT NULL
    AND EXISTS (SELECT 1 FROM print_jobs WHERE id = print_job_id)
  );

-- ── audit_logs: solo staff autenticado puede insertar ────────
DROP POLICY IF EXISTS "audit_logs_insert_any" ON audit_logs;
CREATE POLICY "audit_logs_staff_insert" ON audit_logs
  FOR INSERT TO authenticated
  WITH CHECK (auth.uid() IS NOT NULL);

-- ── Storage: hacer el bucket thumbnails privado ──────────────
-- Las URLs ahora se generan como signed URLs (1 hora de validez).
UPDATE storage.buckets
  SET public = false
  WHERE id = 'thumbnails';
