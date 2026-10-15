/**
 * Cola de impresión persistente.
 *
 * Garantías contra impresiones duplicadas:
 *  - Un solo trabajador envía, de uno en uno; el trabajo se reclama con un
 *    UPDATE condicional (ready → sending) dentro de una transacción.
 *  - Cada envío queda registrado como intento ANTES de llamar a la impresora.
 *  - No hay reintentos automáticos. Si el agente cae o se agota el tiempo
 *    durante un envío, el trabajo queda "incierto" y decide el operador.
 *  - "Enviado" significa que Windows aceptó el trabajo, no que salió el papel.
 */
import { randomUUID } from "node:crypto";
import { copyFile, link, mkdir, unlink } from "node:fs/promises";
import { join } from "node:path";
import { PAPER_SIZES, findDriverForm } from "./paper.js";
import { nowIso } from "./util.js";

const SIDE = { simplex: "simplex", long: "duplexlong", short: "duplexshort" };
// Nombres de formulario estándar, solo si el driver no pudo consultarse.
const FALLBACK_FORM = { carta: "Letter", a4: "A4", legal: "Legal", oficio2: "Oficio II" };
const TICK_MS = 1500;
const SPOOLER_EVERY_MS = 4000;
const SPOOLER_GIVE_UP_MS = 90000;

const jobToken = (jobId) => `FQP-${jobId.slice(0, 8)}`;

function withTimeout(promise, ms) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(Object.assign(new Error("Tiempo de envío agotado"), { timedOut: true })), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

export function createQueue(ctx) {
  const { config, db, log, store, files, bus } = ctx;
  let timer = null, running = false, stopped = false, kickPending = false, lastSpooler = 0;

  function failJob(job, message) {
    db.tx(() => {
      db.run("UPDATE print_jobs SET status = 'error', error_message = ?, hold_reason = NULL, hold_since = NULL, updated_at = ? WHERE id = ? AND status = 'ready'",
        message, nowIso(), job.id);
      store.dirty("job", job.id);
      store.audit("sistema", "job_error", "job", job.id, { message });
    });
    bus.touch();
  }

  /** Opciones de pdf-to-printer para un trabajo. */
  function buildOptions(job, formName) {
    return {
      printer: job.printer_system_name,
      copies: job.copies,
      silent: true,
      paperSize: formName,
      scale: job.scale_mode,
      side: SIDE[job.duplex],
      monochrome: job.color_mode === "bw",
      ...(job.tray && { bin: job.tray }),
      ...(job.pages && { pages: job.pages }),
    };
  }

  async function trySend(job) {
    const doc = db.get("SELECT * FROM documents WHERE id = ?", job.document_id);
    const pdf = doc && doc.status === "ready" ? files.findPdf(doc) : null;
    if (!pdf) return failJob(job, "El PDF ya no existe en esta computadora.");

    if (!ctx.printerService.isAvailableSync(job.printer_system_name)) {
      const waitMs = store.settingInt("printer_wait_min", 1) * 60000;
      if (!job.hold_since) {
        db.run("UPDATE print_jobs SET hold_reason = ?, hold_since = ?, updated_at = ? WHERE id = ? AND status = 'ready'",
          `Impresora "${job.printer_name}" no disponible (apagada, desconectada o sin conexión).`, nowIso(), nowIso(), job.id);
        bus.touch();
      } else if (ctx.now() - Date.parse(job.hold_since) > waitMs) {
        failJob(job, `La impresora "${job.printer_name}" no estuvo disponible durante ${store.settingInt("printer_wait_min", 1)} minutos.`);
      }
      return;
    }

    // El tamaño se pide con el nombre de formulario que realmente tiene el driver.
    const caps = await ctx.printerService.capabilities(job.printer_system_name);
    let formName = FALLBACK_FORM[job.paper_size];
    if (caps.valid && caps.paperSizes.length > 0) {
      formName = findDriverForm(job.paper_size, caps.paperSizes);
      if (!formName) {
        return failJob(job,
          `El driver de "${job.printer_name}" no tiene un formulario ${PAPER_SIZES[job.paper_size].label} (${PAPER_SIZES[job.paper_size].inches}). ` +
          "Créelo en Windows (Propiedades del servidor de impresión) o elija otra impresora.");
      }
    }
    if (job.tray && caps.valid && caps.bins.length > 0 && !caps.bins.includes(job.tray)) {
      return failJob(job, `La bandeja "${job.tray}" no existe en "${job.printer_name}". Bandejas del driver: ${caps.bins.join(", ")}.`);
    }
    const options = buildOptions(job, formName);

    // Reclamo atómico + registro del intento antes de tocar la impresora.
    const attemptId = db.tx(() => {
      const r = db.run(
        "UPDATE print_jobs SET status = 'sending', hold_reason = NULL, hold_since = NULL, updated_at = ? WHERE id = ? AND status = 'ready'",
        nowIso(), job.id);
      if (r.changes !== 1) return null;
      const n = db.get("SELECT COUNT(*) AS n FROM print_attempts WHERE job_id = ?", job.id).n + 1;
      const id = randomUUID();
      db.run(
        "INSERT INTO print_attempts (id, job_id, attempt_no, started_at, printer_system_name, options) VALUES (?, ?, ?, ?, ?, ?)",
        id, job.id, n, nowIso(), job.printer_system_name, JSON.stringify(options));
      return id;
    });
    if (!attemptId) return;
    bus.touch();

    // Copia con nombre identificable para reconocer el trabajo en la cola de Windows.
    const printDir = join(config.dirs.temporales, "impresion");
    const printFile = join(printDir, `${jobToken(job.id)}.pdf`);
    let outcome, detail = null;
    try {
      await mkdir(printDir, { recursive: true });
      await unlink(printFile).catch(() => {});
      await link(pdf, printFile).catch(() => copyFile(pdf, printFile));
      await withTimeout(ctx.printDriver.print(printFile, options), config.printTimeoutMs);
      outcome = "sent";
    } catch (err) {
      outcome = err?.timedOut ? "unknown" : "failed";
      detail = String(err?.message ?? err).slice(0, 400);
    } finally {
      if (outcome !== "unknown") await unlink(printFile).catch(() => {});
    }

    const status = outcome === "sent" ? "sent" : outcome === "failed" ? "error" : "unknown";
    db.tx(() => {
      db.run("UPDATE print_attempts SET finished_at = ?, outcome = ?, detail = ? WHERE id = ?", nowIso(), outcome, detail, attemptId);
      db.run(
        "UPDATE print_jobs SET status = ?, sent_at = ?, error_message = ?, updated_at = ? WHERE id = ?",
        status, outcome === "sent" ? nowIso() : null,
        outcome === "sent" ? null
          : outcome === "failed" ? `Windows rechazó el trabajo: ${detail}`
          : "No se pudo determinar si el trabajo llegó a la impresora. Verifique si salió el papel.",
        nowIso(), job.id);
      store.dirty("job", job.id);
      store.dirty("attempt", attemptId);
      store.audit("sistema", `print_${outcome}`, "job", job.id, { printer: job.printer_name, copies: job.copies, detail });
    });
    await log(outcome === "sent" ? "success" : "error",
      `Trabajo ${jobToken(job.id)} (${doc.original_name}) → ${job.printer_name}: ${outcome}${detail ? " — " + detail : ""}`);
    bus.touch();
  }

  async function sendPending() {
    // Prioridad manual, luego orden de autorización; los trabajos de un mismo
    // pedido van seguidos para no intercalar documentos de clientes distintos.
    const jobs = db.all(
      "SELECT * FROM print_jobs WHERE status = 'ready' ORDER BY priority DESC, batch_at ASC, COALESCE(order_id, ''), seq ASC LIMIT 50");
    for (const job of jobs) {
      if (stopped) break;
      const fresh = db.get("SELECT * FROM print_jobs WHERE id = ? AND status = 'ready'", job.id);
      if (fresh) await trySend(fresh);
    }
  }

  /** Sigue los trabajos enviados dentro de la cola de Windows mientras sea posible verlos. */
  async function monitorSpooler() {
    if (ctx.now() - lastSpooler < SPOOLER_EVERY_MS) return;
    lastSpooler = ctx.now();
    const tracked = db.all(
      "SELECT * FROM print_jobs WHERE status = 'printing' OR (status = 'sent' AND spooler_done_at IS NULL AND spooler_status IS NULL)");
    if (tracked.length === 0) return;
    const autoConfirm = store.setting("auto_confirm_spooler") === "true";
    const byPrinter = Map.groupBy(tracked, (j) => j.printer_system_name);

    for (const [printer, jobs] of byPrinter) {
      let spool;
      try {
        spool = await ctx.printerService.spoolerJobs(printer);
      } catch {
        continue; // sin lectura de la cola no se concluye nada
      }
      for (const job of jobs) {
        const hit = spool.find((s) => s.documentName.includes(jobToken(job.id)));
        if (hit) {
          db.run("UPDATE print_jobs SET status = 'printing', win_job_id = ?, spooler_status = ?, updated_at = ? WHERE id = ? AND status IN ('sent','printing')",
            hit.id, hit.status, nowIso(), job.id);
        } else if (job.status === "printing") {
          // Estuvo en la cola y ya salió de ella sin error reportado.
          db.run(
            `UPDATE print_jobs SET status = ?, spooler_done_at = ?, confirmed_at = ?, spooler_status = 'Completado en la cola de Windows', updated_at = ?
             WHERE id = ? AND status = 'printing'`,
            autoConfirm ? "printed" : "sent", nowIso(), autoConfirm ? nowIso() : null, nowIso(), job.id);
          if (autoConfirm) store.audit("sistema", "job_confirmed_spooler", "job", job.id);
        } else if (ctx.now() - Date.parse(job.sent_at) > SPOOLER_GIVE_UP_MS) {
          db.run("UPDATE print_jobs SET spooler_status = 'No observado en la cola de Windows', updated_at = ? WHERE id = ?", nowIso(), job.id);
        } else {
          continue;
        }
        store.dirty("job", job.id);
        bus.touch();
      }
    }
  }

  async function tick() {
    if (running || stopped) return;
    running = true;
    try {
      do {
        kickPending = false;
        await ctx.printerService.list(10000);
        ctx.orders.autoEvaluate();
        await sendPending();
      } while (kickPending && !stopped);
      await monitorSpooler();
    } catch (err) {
      await log("error", "Error en la cola de impresión", { message: err?.message });
    } finally {
      running = false;
    }
  }

  return {
    /**
     * Tras un reinicio: lo que quedó a medio enviar NO se reenvía.
     * Los trabajos en cola (ready) se conservan y continúan.
     */
    recover() {
      db.tx(() => {
        for (const job of db.all("SELECT id FROM print_jobs WHERE status = 'sending'")) {
          db.run(
            `UPDATE print_jobs SET status = 'unknown',
               error_message = 'El agente se detuvo durante el envío. Verifique si salió el papel antes de reenviar.', updated_at = ?
             WHERE id = ?`, nowIso(), job.id);
          store.dirty("job", job.id);
          store.audit("sistema", "job_unknown_after_restart", "job", job.id);
        }
        db.run("UPDATE print_attempts SET outcome = 'unknown', finished_at = ?, detail = 'Agente detenido durante el envío' WHERE outcome IS NULL", nowIso());
        db.run("UPDATE print_jobs SET hold_since = NULL, hold_reason = NULL WHERE status = 'ready'");
      });
    },
    start() {
      timer = setInterval(() => void tick(), TICK_MS);
    },
    async stop() {
      stopped = true;
      clearInterval(timer);
      while (running) await new Promise((r) => setTimeout(r, 20));
    },
    kick() {
      kickPending = true;
      void tick();
    },
    tick, buildOptions,
    busy: () => running,
  };
}
