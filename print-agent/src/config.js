/**
 * Configuración del agente. Todo lo que define DÓNDE se guardan documentos
 * vive en el .env local (no se puede cambiar de forma remota).
 */
import { resolve, join } from "node:path";

const int = (v, d) => {
  const n = parseInt(v ?? "", 10);
  return Number.isFinite(n) ? n : d;
};

// Ajustes operativos: se editan en el panel (tabla `settings` de Supabase) y se
// guardan en caché local para seguir funcionando sin internet.
export const DEFAULT_SETTINGS = {
  print_mode: "supervised",        // supervised | auto
  retention_days: "30",
  local_max_file_size_mb: "50",
  convert_timeout_sec: "120",
  convert_concurrency: "1",
  paper_tolerance_pt: "8",
  file_stability_ms: "2000",
  printer_wait_min: "10",
  auto_confirm_spooler: "false",
  price_bw: "0.50",
  price_color: "2.00",
};

// Claves que el agente acepta desde Supabase (cualquier otra se ignora).
export const SYNCED_SETTING_KEYS = Object.keys(DEFAULT_SETTINGS);

export function loadConfig(env = process.env) {
  const baseDir = resolve(env.BASE_DIR ?? "C:\\ElArrecife");
  const dir = (name) => join(baseDir, name);

  return {
    baseDir,
    dirs: {
      entradas:    resolve(env.WATCH_DIR ?? dir("Entradas")),
      procesando:  dir("Procesando"),
      originales:  dir("Originales"),
      pdf:         dir("PDF"),
      completados: dir("Completados"),
      errores:     dir("Errores"),
      logs:        dir("Logs"),
      temporales:  dir("Temporales"),
      datos:       dir("Datos"),
      respaldos:   dir("Respaldos"),
    },
    dbFile: env.DB_FILE ?? join(dir("Datos"), "agente.db"),

    apiHost: "127.0.0.1", // fijo: el servicio nunca escucha fuera de localhost
    apiPort: int(env.AGENT_PORT, 47821),
    allowedOrigins: (env.ALLOWED_ORIGINS ?? "http://localhost:3000,http://127.0.0.1:3000")
      .split(",").map((s) => s.trim().replace(/\/$/, "")).filter(Boolean),
    agentSecret: env.AGENT_SECRET_TOKEN ?? "",

    supabaseUrl: env.SUPABASE_URL ?? "",
    supabaseServiceKey: env.SUPABASE_SERVICE_ROLE_KEY ?? "",
    syncIntervalMs: int(env.SYNC_INTERVAL_MS, 10000),

    libreOfficePath: env.LIBREOFFICE_PATH ?? "",
    printDriver: env.PRINT_DRIVER ?? "sumatra", // sumatra | dryrun
    printTimeoutMs: int(env.PRINT_TIMEOUT_MS, 120000),

    // Flujo QR anterior (usa Supabase Storage): aislado y apagado por defecto.
    legacyQrEnabled: env.LEGACY_QR_ENABLED === "true",
  };
}
