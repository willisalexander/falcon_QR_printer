/**
 * Retención de documentos: elimina originales y PDF de pedidos cerrados cuando
 * vence el plazo configurado (30 días por defecto). Los metadatos se conservan.
 * Es un borrado normal del sistema de archivos, no un borrado irrecuperable.
 */
import { randomUUID } from "node:crypto";
import { ACTIVE_JOB_SQL } from "./orders.js";
import { nowIso } from "./util.js";

const DAY_MS = 86400000;
const EVERY_MS = 6 * 3600000;
const TEMP_MAX_AGE_MS = DAY_MS;

export function createRetention(ctx) {
  const { db, store, files, log, bus } = ctx;
  let timer = null, startTimer = null, running = false;

  const hasActiveJobs = (column, id) =>
    !!db.get(`SELECT 1 AS x FROM print_jobs WHERE ${column} = ? AND ${ACTIVE_JOB_SQL}`,
      id, new Date(ctx.now() - 3600000).toISOString());

  async function purgeDocument(doc, reason) {
    if (["deleted", "intake", "queued", "converting"].includes(doc.status)) return false;
    if (hasActiveJobs("document_id", doc.id)) return false;
    const removed = await files.deleteDocFiles(doc);
    db.tx(() => {
      db.run("UPDATE documents SET status = 'deleted', deleted_at = ?, original_file = NULL, pdf_file = NULL, updated_at = ? WHERE id = ?",
        nowIso(), nowIso(), doc.id);
      db.run("INSERT INTO deletions (id, document_id, order_id, original_name, deleted_at, reason, files_removed) VALUES (?, ?, ?, ?, ?, ?, ?)",
        randomUUID(), doc.id, doc.order_id, doc.original_name, nowIso(), reason, removed);
      store.dirty("document", doc.id);
      store.audit("sistema", "document_deleted", "document", doc.id, { reason, files: removed });
    });
    return true;
  }

  async function run() {
    if (running) return { deleted: 0, skipped: true };
    running = true;
    let deleted = 0;
    try {
      const days = store.settingInt("retention_days", 1);
      const cutoff = new Date(ctx.now() - days * DAY_MS).toISOString();

      // Solo pedidos cerrados, vencidos, sin conservación excepcional.
      const expired = db.all(
        `SELECT id, correlative FROM orders
         WHERE status IN ('finished','cancelled') AND keep_documents = 0
           AND documents_deleted_at IS NULL AND finished_at IS NOT NULL AND finished_at <= ?`, cutoff);
      for (const order of expired) {
        if (hasActiveJobs("order_id", order.id)) continue;
        let pending = 0;
        for (const doc of db.all("SELECT * FROM documents WHERE order_id = ? AND status != 'deleted'", order.id)) {
          if (await purgeDocument(doc, `Retención de ${days} días (pedido ${order.correlative})`)) deleted++;
          else pending++;
        }
        if (pending === 0) {
          db.run("UPDATE orders SET documents_deleted_at = ?, updated_at = ? WHERE id = ?", nowIso(), nowIso(), order.id);
          store.dirty("order", order.id);
        }
      }

      // Documentos descartados por el operador.
      for (const doc of db.all("SELECT * FROM documents WHERE status = 'discarded' AND discarded_at <= ?", cutoff)) {
        if (await purgeDocument(doc, `Retención de ${days} días (documento descartado)`)) deleted++;
      }

      const temp = await files.cleanTemp(TEMP_MAX_AGE_MS);
      if (deleted > 0 || temp > 0) {
        await log("info", `Limpieza de retención: ${deleted} documento(s) eliminados, ${temp} temporal(es).`);
        bus.touch();
      }
      return { deleted, temp };
    } catch (err) {
      await log("error", "Error en la limpieza de retención", { message: err?.message });
      return { deleted, error: err?.message };
    } finally {
      running = false;
    }
  }

  return {
    run,
    start() {
      // Al iniciar (por si la PC estuvo apagada) y luego varias veces al día.
      startTimer = setTimeout(() => void run(), 60000);
      timer = setInterval(() => void run(), EVERY_MS);
    },
    stop() {
      clearTimeout(startTimer);
      clearInterval(timer);
    },
  };
}
