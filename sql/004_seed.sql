-- ============================================================
-- PRINT QR SYSTEM — Seed Inicial
-- Configuración predeterminada del sistema
-- ============================================================

-- ============================================================
-- Configuración general (settings)
-- ============================================================

INSERT INTO settings (key, value, description) VALUES
  ('price_bw',                  '0.50',  'Precio por página en blanco y negro (Q)'),
  ('price_color',               '2.00',  'Precio por página a color (Q)'),
  ('max_pages_without_approval','20',    'Máximo de páginas permitidas sin aprobación manual'),
  ('max_file_size_mb',          '10',    'Tamaño máximo de archivo permitido en MB'),
  ('allowed_file_types',        'pdf,jpg,jpeg,png,webp', 'Tipos de archivo permitidos'),
  ('system_active',             'true',  'Estado general del sistema (true/false)'),
  ('public_message',            'Escanea el código QR para enviar tu impresión. Pasa al mostrador para pagar y retirar.', 'Mensaje público para los clientes'),
  ('business_name',             'Print QR System', 'Nombre del negocio'),
  ('timezone',                  'America/Guatemala', 'Zona horaria del negocio')
ON CONFLICT (key) DO NOTHING;

-- ============================================================
-- Token QR inicial
-- ============================================================

INSERT INTO qr_tokens (token, label, is_active)
VALUES (
  encode(gen_random_bytes(32), 'hex'),
  'QR Principal',
  true
)
ON CONFLICT DO NOTHING;

-- ============================================================
-- NOTA: El primer usuario admin se crea desde Supabase Auth
-- Dashboard o desde el panel de administración.
-- Luego actualizar manualmente el rol en la tabla profiles:
--
-- UPDATE profiles SET role = 'admin' WHERE email = 'tu@email.com';
-- ============================================================
