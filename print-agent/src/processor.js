/**
 * Cola de conversión y análisis. Independiente de la recepción y de la impresión,
 * con concurrencia limitada para no saturar la computadora.
 */
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { analyzePdf, validateFileFormat } from "./analyzer.js";
import { moveFile, nowIso } from "./util.js";

export function createProcessor(ctx) {
  const { config, db, log, store, files, bus } = ctx;
  const queue = [];
  const active = new Set();

  function enqueue(id) {
    if (!queue.includes(id) && !active.has(id)) queue.push(id);
    pump();
  }

  function pump() {
    const max = Math.min(4, store.settingInt("convert_concurrency", 1));
    while (active.size < max && queue.length) {
      const id = queue.shift();
      active.add(id);
      processOne(id)
        .catch((err) => log("error", `Error inesperado al procesar ${id}`, { message: err?.message }))
        .finally(() => {
          active.delete(id);
          pump();
        });
    }
  }

  async function processOne(id) {
    let doc = db.get("SELECT * FROM documents WHERE id = ?", id);
    if (!doc || !["queued", "converting"].includes(doc.status)) return;
    db.run("UPDATE documents SET status = 'converting', convert_attempts = convert_attempts + 1, updated_at = ? WHERE id = ?", nowIso(), id);
    bus.touch();

    const t0 = ctx.now();
    let cleanup = null;
    try {
      // Un reintento parte de Errores: el original vuelve a su carpeta definitiva.
      const originalRel = await files.moveOriginal(doc, config.dirs.originales);
      db.run("UPDATE documents SET original_file = ? WHERE id = ?", originalRel, id);
      doc = { ...doc, original_file: originalRel };
      const original = files.abs(originalRel);
      await validateFileFormat(original, doc.ext);

      let pdfRel = originalRel;
      if (doc.ext !== ".pdf") {
        const out = await ctx.converter.convert(original, {
          timeoutMs: store.settingInt("convert_timeout_sec", 10) * 1000,
        });
        cleanup = out.cleanup;
        const pdfDir = join(config.dirs.pdf, id);
        await mkdir(pdfDir, { recursive: true });
        const dest = join(pdfDir, "document.pdf");
        await moveFile(out.pdf, dest);
        pdfRel = files.rel(dest);
      }

      // Nada se imprime sin pasar esta validación (también el PDF que generó LibreOffice).
      const analysis = await analyzePdf(files.abs(pdfRel), { tolerancePt: store.settingNum("paper_tolerance_pt") });

      db.tx(() => {
        db.run(
          `UPDATE documents SET status = 'ready', pdf_file = ?, page_count = ?, size_class = ?, orientation = ?,
             analysis = ?, encrypted = ?, convert_ms = ?, converted_at = ?, error_code = NULL, error_message = NULL,
             updated_at = ? WHERE id = ?`,
          pdfRel, analysis.pageCount, analysis.sizeClass, analysis.orientation, JSON.stringify(analysis),
          analysis.encrypted, ctx.now() - t0, nowIso(), nowIso(), id
        );
        store.dirty("document", id);
      });
      await log("success", `Listo: ${doc.original_name} — ${analysis.pageCount} pág., ${analysis.sizeClass}`);
    } catch (err) {
      const code = err?.code && typeof err.code === "string" ? err.code : "PROCESS_ERROR";
      const message = err?.message ?? String(err);
      let originalRel = doc.original_file;
      try {
        originalRel = await files.moveOriginal(doc, config.dirs.errores);
      } catch { /* el original no está: el mensaje de error ya lo indica */ }
      db.tx(() => {
        db.run(
          `UPDATE documents SET status = 'error', error_code = ?, error_message = ?, original_file = ?,
             convert_ms = ?, updated_at = ? WHERE id = ?`,
          code, message.slice(0, 500), originalRel, ctx.now() - t0, nowIso(), id
        );
        store.audit("sistema", "document_error", "document", id, { code, message: message.slice(0, 300) });
        store.dirty("document", id);
      });
      await log("error", `Error en ${doc.original_name}: [${code}] ${message}`);
    } finally {
      await cleanup?.();
      bus.touch();
    }
  }

  return {
    enqueue,
    /** Tras un reinicio: lo que estaba en cola o a media conversión vuelve a la cola. */
    recover() {
      db.run("UPDATE documents SET status = 'queued' WHERE status = 'converting'");
      for (const r of db.all("SELECT id FROM documents WHERE status = 'queued' ORDER BY seq")) enqueue(r.id);
    },
    idle: () => active.size === 0 && queue.length === 0,
    stats: () => ({ queued: queue.length, converting: active.size }),
  };
}
