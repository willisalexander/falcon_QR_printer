/**
 * Print QR System — Agente Local de Impresión v2.0
 *
 * Fase 5 — Producción:
 *  - Claiming atómico via RPC (FOR UPDATE SKIP LOCKED)
 *  - Recuperación de trabajos atascados al arrancar
 *  - Reintentos con backoff exponencial (2 s, 4 s, 8 s)
 *  - Apagado graceful (SIGTERM / SIGINT)
 *  - Logging a consola + archivo diario en ./logs/
 */

import "dotenv/config";
import { createClient } from "@supabase/supabase-js";
import pdfToPrinter from "pdf-to-printer";
const { print, getPrinters } = pdfToPrinter;
import { writeFile, mkdir, unlink, appendFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";

// ── Configuración ────────────────────────────────────────────

const SUPABASE_URL      = process.env.SUPABASE_URL;
const SERVICE_KEY       = process.env.SUPABASE_SERVICE_ROLE_KEY;
const POLL_INTERVAL_MS  = parseInt(process.env.POLLING_INTERVAL_MS  ?? "5000");
const TEMP_DIR          = process.env.TEMP_DIR           ?? "./tmp";
const LOG_DIR           = process.env.LOG_DIR            ?? "./logs";
const MAX_RETRIES       = parseInt(process.env.MAX_RETRIES       ?? "3");
const STUCK_TIMEOUT_MIN = parseInt(process.env.STUCK_TIMEOUT_MIN ?? "10");

if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error("❌ Faltan SUPABASE_URL o SUPABASE_SERVICE_ROLE_KEY en .env");
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { persistSession: false },
});

let isShuttingDown = false;
let activeJobId    = null;

// ── Directorios ──────────────────────────────────────────────

for (const dir of [TEMP_DIR, LOG_DIR]) {
  if (!existsSync(dir)) await mkdir(dir, { recursive: true });
}

// ── Logging ──────────────────────────────────────────────────

const ICONS = { info: "ℹ️ ", warn: "⚠️ ", error: "❌", success: "✅" };

async function log(level, message, data) {
  const ts   = new Date().toISOString();
  const icon = ICONS[level] ?? " •";
  const line = `[${ts}] ${icon} ${message}${data ? "  " + JSON.stringify(data) : ""}`;
  console.log(line);
  const file = join(LOG_DIR, `agent-${ts.slice(0, 10)}.log`);
  await appendFile(file, line + "\n").catch(() => {});
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ── Helpers de base de datos ─────────────────────────────────

async function dbUpdateJob(jobId, fields) {
  const { error } = await supabase
    .from("print_jobs")
    .update({ ...fields, updated_at: new Date().toISOString() })
    .eq("id", jobId);
  if (error) throw new Error(`Error al actualizar job ${jobId}: ${error.message}`);
}

async function dbLogEvent(jobId, eventType, description, newStatus = null, metadata = null) {
  await supabase.from("print_job_events").insert({
    print_job_id: jobId,
    event_type:   eventType,
    description,
    new_status:   newStatus,
    metadata,
  });
}

// ── Claiming atómico ─────────────────────────────────────────

async function claimNextJob() {
  // Intenta usar el RPC con FOR UPDATE SKIP LOCKED (ver sql/004_agent.sql)
  const { data, error } = await supabase.rpc("claim_next_print_job");

  if (!error) return data?.[0] ?? null;

  // Fallback si la función SQL no existe aún
  await log("warn", "RPC claim_next_print_job no disponible — usando fallback simple");
  const { data: jobs } = await supabase
    .from("print_jobs")
    .select("*")
    .eq("status", "approved")
    .order("created_at", { ascending: true })
    .limit(1);

  const job = jobs?.[0];
  if (!job) return null;

  await dbUpdateJob(job.id, { status: "printing" });
  return job;
}

// ── Recuperar trabajos atascados ─────────────────────────────

async function recoverStuckJobs() {
  const cutoff = new Date(Date.now() - STUCK_TIMEOUT_MIN * 60 * 1000).toISOString();
  const { data: stuck } = await supabase
    .from("print_jobs")
    .select("id, correlative")
    .eq("status", "printing")
    .lt("updated_at", cutoff);

  if (!stuck?.length) return;

  await log("warn", `Recuperando ${stuck.length} trabajo(s) atascado(s) en 'printing'`);
  for (const job of stuck) {
    await dbUpdateJob(job.id, { status: "approved" });
    await dbLogEvent(
      job.id,
      "note",
      `Trabajo recuperado al iniciar el agente (estaba en 'printing' > ${STUCK_TIMEOUT_MIN} min)`,
      "approved"
    );
    await log("info", `Restaurado a 'approved': ${job.correlative}`);
  }
}

// ── Procesar un trabajo ──────────────────────────────────────

async function processJob(job, attempt) {
  const tempFile = join(TEMP_DIR, `${job.id}.pdf`);

  try {
    // Determinar impresora según tipo de impresión
    const { data: printers, error: printerErr } = await supabase
      .from("printers")
      .select("*")
      .eq("is_active", true);

    if (printerErr) throw new Error(`Error al leer impresoras de Supabase: ${printerErr.message}`);

    // Log de diagnóstico
    if (!printers?.length) {
      throw new Error(
        "No hay impresoras activas en la base de datos. " +
        "Ve a /admin/printers y agrega una impresora."
      );
    }

    await log("info", `  Impresoras en BD (activas): ${printers.map((p) => `${p.name} [bw_default=${p.is_default_bw}, color_default=${p.is_default_color}]`).join(" | ")}`);

    const printer = job.print_type === "bw"
      ? printers.find((p) => p.is_default_bw)
      : printers.find((p) => p.is_default_color);

    if (!printer) {
      const campo = job.print_type === "bw" ? "is_default_bw" : "is_default_color";
      throw new Error(
        `Ninguna impresora activa tiene ${campo}=true. ` +
        `Ve a /admin/printers y haz clic en "Default ${job.print_type === "bw" ? "B/N" : "Color"}".`
      );
    }

    await log("info", `  Impresora: ${printer.name} (${printer.system_name})`);

    // Descargar PDF desde Supabase Storage
    const { data: blob, error: dlErr } = await supabase.storage
      .from("print-files")
      .download(job.file_path);

    if (dlErr || !blob) throw new Error(`Descarga fallida: ${dlErr?.message}`);
    await writeFile(tempFile, Buffer.from(await blob.arrayBuffer()));

    // Enviar a impresora
    await print(tempFile, {
      printer: printer.system_name,
      copies:  job.copy_count,
      silent:  true,
    });

    // Éxito — actualizar estado
    await dbUpdateJob(job.id, {
      status:     "printed",
      printed_at: new Date().toISOString(),
      printer_id: printer.id,
    });
    await dbLogEvent(
      job.id,
      "printed",
      `Impreso en ${printer.name} (intento ${attempt})`,
      "printed",
      { printer: printer.name, attempt }
    );
    await log("success", `${job.correlative} → impreso en ${printer.name}`);

  } finally {
    await unlink(tempFile).catch(() => {});
  }
}

// ── Reintentos con backoff exponencial ───────────────────────

async function processWithRetry(job) {
  await log("info", `Trabajo: ${job.correlative} — ${job.client_name}`);

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      await processJob(job, attempt);
      return; // éxito
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      await log("error", `Intento ${attempt}/${MAX_RETRIES} fallido: ${msg}`);

      if (attempt < MAX_RETRIES) {
        const delay = Math.pow(2, attempt) * 2000; // 4 s, 8 s
        await dbLogEvent(job.id, "error", `Error intento ${attempt}: ${msg}`, null, { attempt, error: msg });
        await log("info", `Reintentando en ${delay / 1000} s…`);
        await sleep(delay);
      } else {
        // Reintentos agotados
        await dbUpdateJob(job.id, { status: "failed" }).catch(() => {});
        await dbLogEvent(
          job.id,
          "error",
          `Fallido tras ${MAX_RETRIES} intentos: ${msg}`,
          "failed",
          { error: msg, attempts: MAX_RETRIES }
        );
        await supabase.from("audit_logs").insert({
          action:     "print_failed",
          table_name: "print_jobs",
          record_id:  job.id,
          new_values: { error: msg, correlative: job.correlative, attempts: MAX_RETRIES },
        }).then(() => {}, () => {});  // .catch() no existe en PostgrestBuilder
        await log("error", `${job.correlative} marcado como FALLIDO`);
      }
    }
  }
}

// ── Ciclo de polling ─────────────────────────────────────────

async function poll() {
  if (isShuttingDown) {
    await log("info", "Agente detenido correctamente.");
    process.exit(0);
  }

  try {
    const job = await claimNextJob();
    if (job) {
      activeJobId = job.id;
      await processWithRetry(job);
      activeJobId = null;
    }
  } catch (err) {
    await log("error", "Error inesperado en poll()", { message: err?.message });
  }

  if (!isShuttingDown) {
    setTimeout(poll, POLL_INTERVAL_MS);
  } else {
    await log("info", "Agente detenido correctamente.");
    process.exit(0);
  }
}

// ── Apagado graceful ─────────────────────────────────────────

function setupGracefulShutdown() {
  const handler = async (signal) => {
    await log("info", `Señal ${signal} recibida. Finalizando agente…`);
    isShuttingDown = true;
    if (!activeJobId) {
      await log("info", "Sin trabajo activo. Saliendo.");
      process.exit(0);
    } else {
      await log("info", `Esperando que termine el trabajo activo: ${activeJobId}`);
    }
  };
  process.on("SIGTERM", () => void handler("SIGTERM"));
  process.on("SIGINT",  () => void handler("SIGINT"));
}

// ── Main ─────────────────────────────────────────────────────

async function main() {
  const sep = "═".repeat(52);
  await log("info", sep);
  await log("info", "Print QR System — Agente de Impresión v2.0");
  await log("info", `Supabase : ${SUPABASE_URL}`);
  await log("info", `Polling  : cada ${POLL_INTERVAL_MS / 1000} s`);
  await log("info", `Reintentos: ${MAX_RETRIES}  |  Stuck timeout: ${STUCK_TIMEOUT_MIN} min`);
  await log("info", sep);

  // Verificar conexión con Supabase
  const { error: pingErr } = await supabase.from("settings").select("key").limit(1);
  if (pingErr) {
    await log("error", "No se pudo conectar con Supabase", { message: pingErr.message });
    process.exit(1);
  }
  await log("success", "Conexión con Supabase OK");

  // Listar impresoras del sistema
  try {
    const sysPrinters = await getPrinters();
    const names = sysPrinters.map((p) => p.deviceId).join(", ") || "ninguna detectada";
    await log("info", `Impresoras del sistema: ${names}`);
  } catch {
    await log("warn", "No se pudo obtener la lista de impresoras del sistema");
  }

  // Recuperar trabajos que quedaron atascados en ejecuciones previas
  await recoverStuckJobs();

  setupGracefulShutdown();
  await log("info", "Iniciando ciclo de polling…");

  await poll();
}

main().catch(async (err) => {
  await log("error", "Error fatal al iniciar el agente", { message: err?.message });
  process.exit(1);
});
