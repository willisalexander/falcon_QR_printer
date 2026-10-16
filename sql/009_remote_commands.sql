-- =============================================================
-- 009_remote_commands.sql — Entregar o cancelar pedidos desde otra computadora
--
-- Un miembro del personal, desde cualquier computadora con el panel, deja una
-- SOLICITUD. El agente de la PC del negocio la lee y la aplica. Ningún
-- documento viaja: la tabla solo guarda qué pedido y qué acción.
--
-- Es aditiva e idempotente. Ejecutar en: Supabase Dashboard → SQL Editor.
-- =============================================================

CREATE TABLE IF NOT EXISTS reception_commands (
  id                 UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  order_id           UUID NOT NULL REFERENCES reception_orders(id) ON DELETE CASCADE,
  action             TEXT NOT NULL CHECK (action IN ('finish', 'cancel')),
  requested_by       UUID REFERENCES profiles(id) ON DELETE SET NULL,
  requested_by_email TEXT,
  requested_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  status             TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'done', 'rejected')),
  processed_at       TIMESTAMPTZ,
  result_message     TEXT
);

CREATE INDEX IF NOT EXISTS idx_reception_commands_pending ON reception_commands(status, requested_at);
-- Una sola solicitud pendiente por pedido: un doble clic o dos personas a la vez no la duplican.
CREATE UNIQUE INDEX IF NOT EXISTS uq_reception_commands_one_pending
  ON reception_commands(order_id) WHERE status = 'pending';

-- Quién y cuándo los fija el servidor, no el navegador: nadie puede firmar a nombre de
-- otro ni fechar una entrega en otro día para mover ingresos.
CREATE OR REPLACE FUNCTION trigger_reception_command_defaults()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NOT NULL THEN
    NEW.requested_by       := auth.uid();
    NEW.requested_by_email := (SELECT email FROM profiles WHERE id = auth.uid());
    NEW.requested_at       := NOW();
    NEW.status             := 'pending';
    NEW.processed_at       := NULL;
    NEW.result_message     := NULL;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS set_reception_command_defaults ON reception_commands;
CREATE TRIGGER set_reception_command_defaults
  BEFORE INSERT ON reception_commands
  FOR EACH ROW EXECUTE FUNCTION trigger_reception_command_defaults();

-- ── RLS ───────────────────────────────────────────────────────
-- Personal activo (operador o administrador): crear y ver solicitudes.
-- Procesarlas (UPDATE) solo lo hace el agente con la Service Role Key.
ALTER TABLE reception_commands ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS reception_commands_staff_read ON reception_commands;
CREATE POLICY reception_commands_staff_read ON reception_commands
  FOR SELECT TO authenticated USING (is_staff());

DROP POLICY IF EXISTS reception_commands_staff_insert ON reception_commands;
CREATE POLICY reception_commands_staff_insert ON reception_commands
  FOR INSERT TO authenticated
  WITH CHECK (
    is_staff()
    AND EXISTS (SELECT 1 FROM reception_orders o WHERE o.id = order_id AND o.status = 'open')
  );
