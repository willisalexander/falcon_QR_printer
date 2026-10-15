/**
 * Ubicación física de los documentos. Todo se organiza por identificador de
 * documento, nunca por el nombre original:
 *   Originales/<id>/original.<ext>   PDF/<id>/document.pdf
 *   Errores/<id>/original.<ext>      Completados/<id>/{original.<ext>,document.pdf}
 */
import { existsSync } from "node:fs";
import { mkdir, readdir, rm, rename } from "node:fs/promises";
import { join } from "node:path";
import { DocError, UUID_RE, isInside, moveFile, toAbs, toRel } from "./util.js";

export function createFiles(ctx) {
  const { config, db } = ctx;
  const { dirs, baseDir } = config;
  const abs = (rel) => toAbs(baseDir, rel);
  const rel = (p) => toRel(baseDir, p);

  function firstExisting(candidates) {
    for (const c of candidates) {
      if (!c) continue;
      const p = abs(c);
      if (isInside(baseDir, p) && existsSync(p)) return p;
    }
    return null;
  }

  const originalCandidates = (doc) => [
    doc.original_file,
    `Originales/${doc.id}/original${doc.ext}`,
    `Errores/${doc.id}/original${doc.ext}`,
    `Completados/${doc.id}/original${doc.ext}`,
  ];

  const files = {
    abs, rel,

    async ensureDirs() {
      for (const d of Object.values(dirs)) await mkdir(d, { recursive: true });
    },

    findOriginal: (doc) => firstExisting(originalCandidates(doc)),
    findPdf: (doc) =>
      firstExisting([
        doc.pdf_file,
        `PDF/${doc.id}/document.pdf`,
        `Completados/${doc.id}/document.pdf`,
        ...(doc.ext === ".pdf" ? originalCandidates(doc) : []),
      ]),

    resolveOriginal(doc) {
      const p = files.findOriginal(doc);
      if (!p) throw new DocError("FILE_MISSING", "No se encontró el archivo original en el disco.");
      return p;
    },

    /** Mueve el original entre carpetas raíz (Originales ↔ Errores) y devuelve la ruta relativa. */
    async moveOriginal(doc, toRoot) {
      const from = files.resolveOriginal(doc);
      const destDir = join(toRoot, doc.id);
      const dest = join(destDir, `original${doc.ext}`);
      if (from === dest) return rel(dest);
      await mkdir(destDir, { recursive: true });
      await moveFile(from, dest);
      return rel(dest);
    },

    /** Al finalizar el pedido: reúne original y PDF en Completados/<id>/. */
    async archiveToCompleted(doc) {
      const destDir = join(dirs.completados, doc.id);
      await mkdir(destDir, { recursive: true });
      const out = {};
      const original = files.findOriginal(doc);
      if (original) {
        const dest = join(destDir, `original${doc.ext}`);
        if (original !== dest) await moveFile(original, dest);
        out.original_file = rel(dest);
      }
      if (doc.ext === ".pdf") {
        out.pdf_file = out.original_file ?? null;
      } else {
        const pdf = files.findPdf(doc);
        if (pdf) {
          const dest = join(destDir, "document.pdf");
          if (pdf !== dest) await moveFile(pdf, dest);
          out.pdf_file = rel(dest);
        }
      }
      for (const root of [dirs.originales, dirs.pdf]) {
        await rm(join(root, doc.id), { recursive: true, force: true }).catch(() => {});
      }
      db.run("UPDATE documents SET original_file = ?, pdf_file = ? WHERE id = ?",
        out.original_file ?? null, out.pdf_file ?? null, doc.id);
    },

    /**
     * Elimina SOLO las carpetas de este documento. Solo toca rutas
     * <raíz conocida>/<uuid del documento>; nunca una ruta recibida de fuera.
     */
    async deleteDocFiles(doc) {
      if (!UUID_RE.test(doc.id)) throw new Error("Identificador de documento inválido");
      let removed = 0;
      for (const root of [dirs.originales, dirs.pdf, dirs.errores, dirs.completados]) {
        const target = join(root, doc.id);
        if (!isInside(root, target) || !existsSync(target)) continue;
        removed += (await readdir(target)).length;
        await rm(target, { recursive: true, force: true });
      }
      const staged = join(dirs.procesando, doc.id + doc.ext);
      if (existsSync(staged)) {
        await rm(staged, { force: true });
        removed++;
      }
      return removed;
    },

    /** Limpia Temporales (al iniciar: todo; después: lo que tenga más de `maxAgeMs`). */
    async cleanTemp(maxAgeMs = 0) {
      const { stat } = await import("node:fs/promises");
      let removed = 0;
      for (const name of await readdir(dirs.temporales).catch(() => [])) {
        const p = join(dirs.temporales, name);
        try {
          if (maxAgeMs > 0) {
            const st = await stat(p);
            if (ctx.now() - st.mtimeMs < maxAgeMs) continue;
          }
          await rm(p, { recursive: true, force: true });
          removed++;
        } catch { /* en uso: se intentará en la próxima limpieza */ }
      }
      return removed;
    },

    rename,
  };
  return files;
}
