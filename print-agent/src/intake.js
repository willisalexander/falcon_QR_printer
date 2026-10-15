/**
 * Recepción automática desde la carpeta vigilada (C:\ElArrecife\Entradas).
 *
 * Un archivo se toma solo cuando dejó de cambiar y ya no está abierto por quien
 * lo descarga. Tomarlo = registrarlo en SQLite y MOVERLO fuera de Entradas, por
 * lo que no puede detectarse dos veces. Aparecer en la carpeta nunca imprime.
 */
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readdir, stat } from "node:fs/promises";
import { basename, extname, join } from "node:path";
import chokidar from "chokidar";
import { moveFile, nowIso, sha256File } from "./util.js";

export const SUPPORTED_EXT = new Set([".pdf", ".doc", ".docx"]);
const TEMP_RE = /(\.(crdownload|part|partial|tmp|temp|download|opdownload)$)|(^~\$)|(^\.)|(^desktop\.ini$)|(^thumbs\.db$)/i;
const BUSY_CODES = new Set(["EBUSY", "EPERM", "EACCES"]);
const TICK_MS = 400;
const RESCAN_MS = 5000;

export function createIntake(ctx, { onQueued }) {
  const { config, db, log, store, files, bus } = ctx;
  const { dirs } = config;
  const candidates = new Map(); // ruta → { size, mtimeMs, stableSince, tries }
  const ignored = new Map();    // ruta → { name, reason }
  let watcher = null, tickTimer = null, rescanTimer = null, busy = false;

  function consider(path) {
    const name = basename(path);
    if (TEMP_RE.test(name)) return;
    if (!SUPPORTED_EXT.has(extname(name).toLowerCase())) {
      if (!ignored.has(path)) {
        ignored.set(path, { name, reason: "Tipo de archivo no admitido (solo PDF, DOC, DOCX)" });
        bus.touch();
      }
      return;
    }
    if (!candidates.has(path)) {
      candidates.set(path, { size: -1, mtimeMs: 0, stableSince: ctx.now(), tries: 0 });
    }
  }

  async function rescan() {
    const entries = await readdir(dirs.entradas, { withFileTypes: true }).catch(() => []);
    const present = new Set();
    for (const e of entries) {
      if (!e.isFile()) continue;
      const p = join(dirs.entradas, e.name);
      present.add(p);
      consider(p);
    }
    let changed = false;
    for (const p of ignored.keys()) if (!present.has(p)) changed = ignored.delete(p) || changed;
    if (changed) bus.touch();
  }

  async function tick() {
    if (busy) return;
    busy = true;
    try {
      const stabilityMs = store.settingInt("file_stability_ms", 200);
      for (const [path, c] of [...candidates]) {
        let st;
        try {
          st = await stat(path);
        } catch {
          candidates.delete(path);
          continue;
        }
        if (st.size !== c.size || st.mtimeMs !== c.mtimeMs) {
          c.size = st.size;
          c.mtimeMs = st.mtimeMs;
          c.stableSince = ctx.now();
          continue;
        }
        if (st.size === 0) continue; // marcador vacío de una descarga que no empezó
        if (ctx.now() - c.stableSince < stabilityMs) continue;

        if (await takeFile(path, st)) {
          candidates.delete(path);
        } else {
          c.tries++;
          c.stableSince = ctx.now(); // sigue en uso: esperar otro periodo completo
          if (c.tries === 20) await log("warn", `Archivo en uso por mucho tiempo, se sigue esperando: ${basename(path)}`);
        }
      }
    } catch (err) {
      await log("error", "Error en el monitor de carpeta", { message: err?.message });
    } finally {
      busy = false;
    }
  }

  /** Registra y mueve un archivo estable. false = no se pudo tomar todavía. */
  async function takeFile(path, st) {
    const name = basename(path);
    const ext = extname(name).toLowerCase();
    const id = randomUUID();
    const staged = join(dirs.procesando, id + ext);
    const now = nowIso();

    // La fila se crea ANTES de mover: si el agente cae a medias, recover() sabe qué hacer.
    db.run(
      `INSERT INTO documents (id, original_name, ext, size_bytes, received_at, status, source_path, updated_at)
       VALUES (?, ?, ?, ?, ?, 'intake', ?, ?)`,
      id, name, ext, st.size, now, path, now
    );
    try {
      await moveFile(path, staged);
    } catch (err) {
      db.run("DELETE FROM documents WHERE id = ? AND status = 'intake'", id);
      if (err.code === "ENOENT") return true; // lo retiraron antes de tomarlo
      if (!BUSY_CODES.has(err.code)) await log("warn", `No se pudo mover ${name}: ${err.message}`);
      return false;
    }
    await finalize(id);
    return true;
  }

  async function finalize(id) {
    const doc = db.get("SELECT * FROM documents WHERE id = ?", id);
    const staged = join(dirs.procesando, id + doc.ext);
    const started = Date.parse(doc.received_at);
    try {
      const st = await stat(staged);
      const maxBytes = store.settingInt("local_max_file_size_mb", 1) * 1024 * 1024;
      const tooLarge = st.size > maxBytes;
      const sha = await sha256File(staged);
      const dup = db.get(
        "SELECT id FROM documents WHERE sha256 = ? AND id != ? AND status != 'deleted' ORDER BY seq LIMIT 1",
        sha, id
      );
      const root = tooLarge ? dirs.errores : dirs.originales;
      const destDir = join(root, id);
      await mkdir(destDir, { recursive: true });
      const dest = join(destDir, `original${doc.ext}`);
      await moveFile(staged, dest);

      db.tx(() => {
        db.run(
          `UPDATE documents SET status = ?, sha256 = ?, size_bytes = ?, duplicate_of = ?, original_file = ?,
             source_path = NULL, intake_ms = ?, error_code = ?, error_message = ?, updated_at = ? WHERE id = ?`,
          tooLarge ? "error" : "queued", sha, st.size, dup?.id ?? null, files.rel(dest),
          Math.max(0, ctx.now() - started),
          tooLarge ? "TOO_LARGE" : null,
          tooLarge ? `El archivo supera el límite de ${store.setting("local_max_file_size_mb")} MB.` : null,
          nowIso(), id
        );
        store.audit("sistema", "document_received", "document", id, { name: doc.original_name, size: st.size });
        store.dirty("document", id);
      });
      await log("info", `Recibido: ${doc.original_name} → ${id}${dup ? " (mismo contenido que uno anterior)" : ""}`);
      bus.touch();
      if (!tooLarge) onQueued(id);
    } catch (err) {
      db.run(
        "UPDATE documents SET status = 'error', error_code = 'INTAKE_ERROR', error_message = ?, updated_at = ? WHERE id = ?",
        `No se pudo registrar el archivo: ${err.message}`, nowIso(), id
      );
      await log("error", `Error al recibir ${doc.original_name}`, { message: err.message });
      bus.touch();
    }
  }

  /** Tras un reinicio: termina lo que quedó a medias. */
  async function recover() {
    for (const doc of db.all("SELECT * FROM documents WHERE status = 'intake'")) {
      if (existsSync(join(dirs.procesando, doc.id + doc.ext))) {
        await finalize(doc.id);
      } else {
        // Nunca se movió: sigue en Entradas y se detectará de nuevo.
        db.run("DELETE FROM documents WHERE id = ?", doc.id);
      }
    }
    // Archivos en Procesando sin registro: se devuelven a Entradas para no perderlos.
    for (const name of await readdir(dirs.procesando).catch(() => [])) {
      const id = basename(name, extname(name));
      if (db.get("SELECT 1 AS x FROM documents WHERE id = ?", id)) continue;
      await moveFile(join(dirs.procesando, name), join(dirs.entradas, `recuperado-${name}`)).catch(() => {});
    }
  }

  return {
    async start() {
      await recover();
      await rescan(); // archivos que ya estaban al iniciar el servicio
      watcher = chokidar.watch(dirs.entradas, { depth: 0, ignoreInitial: true, persistent: true });
      watcher.on("add", consider).on("change", consider);
      watcher.on("error", (err) => void log("warn", `Monitor de carpeta: ${err?.message}`));
      // Hasta "ready" chokidar descarta lo que aparece; se espera y se vuelve a listar.
      await new Promise((resolve) => watcher.once("ready", resolve));
      await rescan();
      tickTimer = setInterval(() => void tick(), TICK_MS);
      // Respaldo por si Windows pierde un evento del sistema de archivos.
      rescanTimer = setInterval(() => void rescan(), RESCAN_MS);
    },
    async stop() {
      clearInterval(tickTimer);
      clearInterval(rescanTimer);
      await watcher?.close();
      while (busy) await new Promise((r) => setTimeout(r, 20));
    },
    status: () => ({
      folder: dirs.entradas,
      waiting: [...candidates.keys()].map((p) => basename(p)),
      ignored: [...ignored.values()],
    }),
    rescan, tick,
  };
}
