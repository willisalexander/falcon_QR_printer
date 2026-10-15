/**
 * Operaciones del operador: identificar cliente, configurar documentos,
 * autorizar impresión, reimprimir y cerrar pedidos. Todas son transacciones
 * síncronas sobre SQLite; el envío físico lo hace queue.js.
 */
import { randomUUID } from "node:crypto";
import { copyFile, mkdir, rm, stat } from "node:fs/promises";
import { join } from "node:path";
import { PAPER_SIZES } from "./paper.js";
import { COLOR_MODES, DUPLEX_MODES, SCALE_MODES, planDocument } from "./planner.js";
import { RequestError, UUID_RE, nowIso, sha256File } from "./util.js";

const DAY_MS = 86400000;
// Un trabajo "vivo": todavía puede producir papel o no se sabe si lo produjo.
// Lleva un parámetro: la fecha ISO desde la cual un "enviado" aún se considera en curso.
export const ACTIVE_JOB_SQL =
  "(status IN ('ready','sending','printing','unknown') OR (status = 'sent' AND sent_at > ?))";
// Para "ya fue enviado": cualquier impresión normal que no terminó cancelada ni en error cierto.
const BLOCKING_PRINT_SQL = "kind = 'print' AND status NOT IN ('cancelled','error')";

const normName = (s) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/\s+/g, " ").trim();

function ids(list) {
  if (!Array.isArray(list) || list.length === 0 || list.length > 500 || !list.every((x) => UUID_RE.test(x))) {
    throw new RequestError("Lista de identificadores inválida.");
  }
  return [...new Set(list)];
}

function validatePatch(patch, printers) {
  if (!patch || typeof patch !== "object") throw new RequestError("Datos inválidos.");
  const out = {};
  const has = (k) => Object.hasOwn(patch, k);
  const oneOf = (k, allowed, nullable = true) => {
    if (!has(k)) return;
    if (patch[k] === null && nullable) out[k] = null;
    else if (allowed.includes(patch[k])) out[k] = patch[k];
    else throw new RequestError(`Valor inválido para ${k}.`);
  };
  if (has("copies")) {
    if (patch.copies === null) out.copies = null;
    else if (Number.isInteger(patch.copies) && patch.copies >= 1 && patch.copies <= 999) out.copies = patch.copies;
    else throw new RequestError("Las copias deben estar entre 1 y 999.");
  }
  oneOf("color_mode", COLOR_MODES);
  oneOf("duplex", DUPLEX_MODES);
  oneOf("paper_size", Object.keys(PAPER_SIZES));
  oneOf("scale_mode", SCALE_MODES);
  oneOf("mixed_strategy", ["split", "fit"]);
  if (has("printer_id")) {
    if (patch.printer_id === null) out.printer_id = null;
    else if (printers.some((p) => p.id === patch.printer_id)) out.printer_id = patch.printer_id;
    else throw new RequestError("La impresora seleccionada no existe.");
  }
  if (has("notes")) {
    if (patch.notes !== null && typeof patch.notes !== "string") throw new RequestError("Observaciones inválidas.");
    out.notes = patch.notes ? patch.notes.slice(0, 500) : null;
  }
  if (has("review_ack")) out.review_ack = patch.review_ack ? 1 : 0;
  return out;
}

export function createOrders(ctx) {
  const { db, store, bus, files } = ctx;

  // ── Lectura ────────────────────────────────────────────────

  const loadPrinters = () =>
    db.all("SELECT * FROM printers ORDER BY priority, name").map((p) => ({
      ...p, is_active: !!p.is_active, supports_color: !!p.supports_color, supports_duplex: !!p.supports_duplex,
      paper_sizes: JSON.parse(p.paper_sizes), trays: JSON.parse(p.trays),
    }));
  const loadRules = () => db.all("SELECT * FROM rules").map((r) => ({ ...r, enabled: !!r.enabled }));

  const planEnv = (extra = {}) => ({
    printers: loadPrinters(),
    rules: loadRules(),
    isAvailable: (p) => ctx.printerService.isAvailableSync(p.system_name),
    ...extra,
  });

  const parseDoc = (row) => ({ ...row, analysis: row.analysis ? JSON.parse(row.analysis) : null });
  const getDoc = (id) => {
    const row = db.get("SELECT * FROM documents WHERE id = ?", id);
    return row ? parseDoc(row) : null;
  };

  function purgeDate(finishedAt) {
    if (!finishedAt) return null;
    return new Date(Date.parse(finishedAt) + store.settingInt("retention_days", 1) * DAY_MS).toISOString();
  }

  /** Vista del documento para el panel: sin rutas del disco. */
  function publicDoc(doc, env) {
    const { source_path, original_file, pdf_file, analysis, ...rest } = doc;
    return {
      ...rest,
      encrypted: !!doc.encrypted, review_ack: !!doc.review_ack,
      groups: analysis?.groups ?? [],
      has_pdf: doc.status === "ready" && !!files.findPdf(doc),
      plan: doc.status === "ready" && env ? planDocument(doc, env) : null,
    };
  }

  function publicOrder(o) {
    return {
      ...o, is_complete: !!o.is_complete, keep_documents: !!o.keep_documents,
      purge_after: o.keep_documents ? null : purgeDate(o.finished_at),
    };
  }

  function state() {
    const env = planEnv();
    const docs = db.all(
      `SELECT d.* FROM documents d LEFT JOIN orders o ON o.id = d.order_id
       WHERE d.status IN ('queued','converting','ready','error') AND (d.order_id IS NULL OR o.status = 'open')
       ORDER BY d.seq`
    ).map((r) => publicDoc(parseDoc(r), env));
    const orders = db.all("SELECT * FROM orders WHERE status = 'open' ORDER BY created_at").map(publicOrder);
    const dayAgo = new Date(ctx.now() - DAY_MS).toISOString();
    const jobs = db.all(
      `SELECT j.*, d.original_name, o.customer_name, o.correlative
       FROM print_jobs j JOIN documents d ON d.id = j.document_id LEFT JOIN orders o ON o.id = j.order_id
       WHERE j.status IN ('ready','sending','sent','printing','unknown','error') OR j.updated_at > ?
       ORDER BY j.seq DESC LIMIT 400`, dayAgo
    );
    return {
      mode: store.setting("print_mode"),
      documents: docs, orders, jobs,
      printers: env.printers.map((p) => ({ ...p, available: env.isAvailable(p) })),
      rules: env.rules,
      paperSizes: PAPER_SIZES,
    };
  }

  // ── Pedidos y clientes ─────────────────────────────────────

  function recalcOrder(orderId) {
    if (!orderId) return;
    const rows = db.all(
      "SELECT page_count, copies, color_mode FROM documents WHERE order_id = ? AND status NOT IN ('discarded','error')", orderId);
    let total = 0;
    for (const r of rows) {
      if (r.page_count && r.copies && r.color_mode) total += r.page_count * r.copies * store.unitPrice(r.color_mode);
    }
    db.run("UPDATE orders SET total_price = ?, updated_at = ? WHERE id = ?", Math.round(total * 100) / 100, nowIso(), orderId);
    store.dirty("order", orderId);
  }

  function closeEmptyOrders() {
    const empty = db.all(
      `SELECT o.id FROM orders o WHERE o.status = 'open'
         AND NOT EXISTS (SELECT 1 FROM documents d WHERE d.order_id = o.id)
         AND NOT EXISTS (SELECT 1 FROM print_jobs j WHERE j.order_id = o.id)`);
    for (const { id } of empty) {
      db.run("UPDATE orders SET status = 'cancelled', finished_at = ?, updated_at = ?, notes = COALESCE(notes, 'Pedido vacío') WHERE id = ?",
        nowIso(), nowIso(), id);
      store.dirty("order", id);
    }
  }

  function upsertCustomer(name) {
    const clean = String(name ?? "").replace(/\s+/g, " ").trim();
    if (clean.length < 2 || clean.length > 100) throw new RequestError("Escriba el nombre del cliente (2 a 100 caracteres).");
    const norm = normName(clean);
    let c = db.get("SELECT * FROM customers WHERE name_norm = ?", norm);
    if (!c) {
      c = { id: randomUUID(), name: clean };
      db.run("INSERT INTO customers (id, name, name_norm, created_at, updated_at) VALUES (?, ?, ?, ?, ?)",
        c.id, clean, norm, nowIso(), nowIso());
      store.dirty("customer", c.id);
    }
    // Se reconoce al mismo cliente aunque cambien mayúsculas o acentos, pero el
    // pedido muestra el nombre tal como lo escribió el operador esta vez.
    return { id: c.id, name: clean };
  }

  function createOrder(customer) {
    const id = randomUUID();
    db.run(
      "INSERT INTO orders (id, correlative, customer_id, customer_name, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)",
      id, store.nextCorrelative(), customer.id, customer.name, nowIso(), nowIso());
    store.dirty("order", id);
    return id;
  }

  const hasBlockingJobs = (docId) =>
    !!db.get("SELECT 1 AS x FROM print_jobs WHERE document_id = ? AND status NOT IN ('cancelled','error')", docId);

  // ── Trabajos de impresión ──────────────────────────────────

  function createJobs(doc, plan, { kind, actor, batchAt, priority = 0 }) {
    const created = [];
    for (const part of plan.parts) {
      const id = randomUUID();
      const price = Math.round(part.pageCount * doc.copies * store.unitPrice(doc.color_mode) * 100) / 100;
      db.run(
        `INSERT INTO print_jobs (id, document_id, order_id, kind, pages, page_count, copies, color_mode, duplex,
           paper_size, scale_mode, printer_id, printer_name, printer_system_name, tray, rule_id, priority,
           batch_at, status, price, authorized_by, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'ready', ?, ?, ?, ?)`,
        id, doc.id, doc.order_id, kind, part.pages, part.pageCount, doc.copies, doc.color_mode, doc.duplex,
        part.paper, part.scale, part.printerId, part.printerName, part.printerSystemName, part.tray, part.ruleId,
        priority, batchAt, price, actor, nowIso(), nowIso());
      store.dirty("job", id);
      created.push(id);
    }
    store.audit(actor, kind === "reprint" ? "reprint_requested" : "print_authorized", "document", doc.id, {
      jobs: created.length, copies: doc.copies, color: doc.color_mode, duplex: doc.duplex,
      printers: [...new Set(plan.parts.map((p) => p.printerName))],
    });
    return created;
  }

  const orders = {
    state, getDoc, planEnv, loadPrinters, purgeDate, publicOrder,

    documentDetail(id) {
      const doc = getDoc(id);
      if (!doc) throw new RequestError("Documento no encontrado.", 404);
      const jobs = db.all("SELECT * FROM print_jobs WHERE document_id = ? ORDER BY seq DESC", id);
      const attempts = db.all(
        `SELECT a.* FROM print_attempts a JOIN print_jobs j ON j.id = a.job_id WHERE j.document_id = ? ORDER BY a.started_at DESC`, id);
      return { document: publicDoc(doc, planEnv({ skipOrderCheck: true })), jobs, attempts, pdf_available: !!files.findPdf(doc) };
    },

    searchCustomers(q) {
      const norm = `%${normName(String(q ?? "")).slice(0, 60)}%`;
      return db.all("SELECT id, name FROM customers WHERE name_norm LIKE ? ORDER BY updated_at DESC LIMIT 12", norm);
    },

    /** Asocia documentos a un cliente. Reutiliza su pedido abierto salvo que se pida uno nuevo. */
    assign({ ids: list, customerName, orderId, newOrder }, actor) {
      const docIds = ids(list);
      const result = db.tx(() => {
        let target = orderId;
        if (target) {
          const o = db.get("SELECT status FROM orders WHERE id = ?", target);
          if (!o || o.status !== "open") throw new RequestError("El pedido ya no está abierto.", 409);
        } else {
          const customer = upsertCustomer(customerName);
          db.run("UPDATE customers SET updated_at = ? WHERE id = ?", nowIso(), customer.id);
          const open = newOrder ? null : db.get(
            "SELECT id FROM orders WHERE customer_id = ? AND status = 'open' ORDER BY created_at DESC LIMIT 1", customer.id);
          target = open?.id ?? createOrder(customer);
        }
        const touched = new Set([target]);
        for (const id of docIds) {
          const doc = db.get("SELECT id, order_id, status FROM documents WHERE id = ?", id);
          if (!doc || ["deleted", "discarded", "intake"].includes(doc.status)) throw new RequestError("Documento no disponible.", 404);
          if (doc.order_id === target) continue;
          if (hasBlockingJobs(id)) throw new RequestError("Un documento ya tiene impresiones: no puede cambiar de pedido.", 409);
          if (doc.order_id) touched.add(doc.order_id);
          db.run("UPDATE documents SET order_id = ?, updated_at = ? WHERE id = ?", target, nowIso(), id);
          store.dirty("document", id);
        }
        store.audit(actor, "documents_assigned", "order", target, { documents: docIds.length });
        closeEmptyOrders();
        for (const o of touched) recalcOrder(o);
        return { orderId: target };
      });
      bus.touch();
      return result;
    },

    unassign(list, actor) {
      const docIds = ids(list);
      db.tx(() => {
        const touched = new Set();
        for (const id of docIds) {
          const doc = db.get("SELECT order_id FROM documents WHERE id = ?", id);
          if (!doc?.order_id) continue;
          if (hasBlockingJobs(id)) throw new RequestError("Un documento ya tiene impresiones: no puede quitarse del pedido.", 409);
          touched.add(doc.order_id);
          db.run("UPDATE documents SET order_id = NULL, updated_at = ? WHERE id = ?", nowIso(), id);
          store.dirty("document", id);
        }
        store.audit(actor, "documents_unassigned", "document", null, { documents: docIds.length });
        closeEmptyOrders();
        for (const o of touched) recalcOrder(o);
      });
      bus.touch();
    },

    updateDocuments(list, patch, actor) {
      const docIds = ids(list);
      const fields = validatePatch(patch, loadPrinters());
      const keys = Object.keys(fields);
      if (keys.length === 0) return;
      db.tx(() => {
        const touched = new Set();
        const sql = `UPDATE documents SET ${keys.map((k) => `${k} = ?`).join(", ")}, updated_at = ? WHERE id = ? AND status NOT IN ('deleted','discarded')`;
        for (const id of docIds) {
          db.run(sql, ...keys.map((k) => fields[k]), nowIso(), id);
          store.dirty("document", id);
          const o = db.get("SELECT order_id FROM documents WHERE id = ?", id)?.order_id;
          if (o) touched.add(o);
        }
        store.audit(actor, "documents_updated", "document", docIds.length === 1 ? docIds[0] : null, { documents: docIds.length, ...fields });
        for (const o of touched) recalcOrder(o);
      });
      bus.touch();
    },

    updateOrder(id, patch, actor) {
      if (!UUID_RE.test(id) || !patch || typeof patch !== "object") throw new RequestError("Datos inválidos.");
      db.tx(() => {
        const o = db.get("SELECT * FROM orders WHERE id = ?", id);
        if (!o) throw new RequestError("Pedido no encontrado.", 404);
        const set = {};
        if (Object.hasOwn(patch, "customer_name")) {
          if (o.status !== "open") throw new RequestError("El pedido ya está cerrado.", 409);
          const c = upsertCustomer(patch.customer_name);
          set.customer_id = c.id;
          set.customer_name = c.name;
        }
        if (Object.hasOwn(patch, "notes")) set.notes = patch.notes ? String(patch.notes).slice(0, 500) : null;
        if (Object.hasOwn(patch, "is_complete")) set.is_complete = patch.is_complete ? 1 : 0;
        if (Object.hasOwn(patch, "keep_documents")) set.keep_documents = patch.keep_documents ? 1 : 0;
        if (Object.hasOwn(patch, "priority")) {
          if (!Number.isInteger(patch.priority) || Math.abs(patch.priority) > 9) throw new RequestError("Prioridad inválida.");
          set.priority = patch.priority;
          db.run("UPDATE print_jobs SET priority = ?, updated_at = ? WHERE order_id = ? AND status = 'ready'", patch.priority, nowIso(), id);
        }
        const keys = Object.keys(set);
        if (keys.length === 0) return;
        db.run(`UPDATE orders SET ${keys.map((k) => `${k} = ?`).join(", ")}, updated_at = ? WHERE id = ?`,
          ...keys.map((k) => set[k]), nowIso(), id);
        store.dirty("order", id);
        store.audit(actor, "order_updated", "order", id, set);
      });
      bus.touch();
    },

    /**
     * Autoriza la impresión de documentos (modo supervisado) o la dispara el
     * modo automático. Un documento que ya fue enviado solo admite "Reimprimir".
     */
    authorize({ ids: list, orderId }, actor, { auto = false } = {}) {
      const results = db.tx(() => {
        let docIds;
        if (orderId) {
          docIds = db.all(
            `SELECT id FROM documents d WHERE order_id = ? AND status = 'ready'
               AND NOT EXISTS (SELECT 1 FROM print_jobs j WHERE j.document_id = d.id AND ${BLOCKING_PRINT_SQL}) ORDER BY seq`,
            orderId).map((r) => r.id);
          if (docIds.length === 0) throw new RequestError("El pedido no tiene documentos pendientes de imprimir.", 409);
        } else {
          docIds = ids(list);
        }
        const env = planEnv();
        const batchAt = nowIso();
        const out = [];
        for (const id of docIds) {
          const doc = getDoc(id);
          if (!doc) { out.push({ id, ok: false, problems: ["Documento no encontrado."] }); continue; }
          if (db.get(`SELECT 1 AS x FROM print_jobs WHERE document_id = ? AND ${BLOCKING_PRINT_SQL}`, id)) {
            out.push({ id, ok: false, problems: ["Este documento ya fue enviado a imprimir. Use Reimprimir si necesita otra copia."] });
            continue;
          }
          const order = doc.order_id ? db.get("SELECT status, priority FROM orders WHERE id = ?", doc.order_id) : null;
          if (order && order.status !== "open") { out.push({ id, ok: false, problems: ["El pedido ya está cerrado."] }); continue; }
          const plan = planDocument(doc, env);
          if (!plan.ok) { out.push({ id, ok: false, problems: plan.problems }); continue; }
          if (auto && (plan.autoBlocked || !plan.allAvailable)) continue;
          const jobs = createJobs(doc, plan, {
            kind: "print", actor, batchAt, priority: order?.priority ?? 0,
          });
          // Autorizar a mano equivale a haber revisado las advertencias.
          if (!auto) db.run("UPDATE documents SET review_ack = 1 WHERE id = ?", id);
          out.push({ id, ok: true, jobs });
        }
        return out;
      });
      if (results.some((r) => r.ok)) {
        bus.touch();
        ctx.queue?.kick();
      }
      return results;
    },

    /** Modo automático: solo pedidos marcados completos y sin ninguna impresión previa. */
    autoEvaluate() {
      if (store.setting("print_mode") !== "auto") return 0;
      const candidates = db.all(
        `SELECT d.id FROM documents d JOIN orders o ON o.id = d.order_id
         WHERE d.status = 'ready' AND o.status = 'open' AND o.is_complete = 1
           AND NOT EXISTS (SELECT 1 FROM print_jobs j WHERE j.document_id = d.id AND j.kind = 'print')
         ORDER BY d.seq`).map((r) => r.id);
      if (candidates.length === 0) return 0;
      const results = orders.authorize({ ids: candidates }, "automático", { auto: true });
      return results.filter((r) => r.ok).length;
    },

    /** Reimpresión desde el PDF guardado en esta computadora. */
    reprint(id, overrides, actor) {
      if (!UUID_RE.test(id)) throw new RequestError("Identificador inválido.");
      const doc = getDoc(id);
      if (!doc) throw new RequestError("Documento no encontrado.", 404);
      if (doc.status !== "ready" || !files.findPdf(doc)) {
        throw new RequestError("El documento ya fue eliminado de esta computadora y no está disponible para reimpresión.", 410);
      }
      const fields = validatePatch(overrides ?? {}, loadPrinters());
      delete fields.notes;
      const merged = { ...doc, ...fields };
      const plan = planDocument(merged, planEnv({ skipOrderCheck: true }));
      if (!plan.ok) throw new RequestError("No se puede reimprimir con esta configuración.", 422, { problems: plan.problems });
      const jobs = db.tx(() => createJobs(merged, plan, { kind: "reprint", actor, batchAt: nowIso() }));
      bus.touch();
      ctx.queue?.kick();
      return { jobs };
    },

    /**
     * Reimpresión COBRADA: otra persona pide el mismo documento. Se crea un
     * documento independiente (con su propia copia del PDF) dentro de un pedido
     * nuevo a nombre de ese cliente y se autoriza de inmediato. A partir de ahí
     * sigue el proceso normal: aparece en Recepción y suma al dar Entregado.
     * El pedido original no se toca.
     */
    async reprintAsNewOrder(id, overrides, customerName, actor) {
      if (!UUID_RE.test(id)) throw new RequestError("Identificador inválido.");
      const doc = getDoc(id);
      if (!doc) throw new RequestError("Documento no encontrado.", 404);
      const pdf = doc.status === "ready" ? files.findPdf(doc) : null;
      if (!pdf) {
        throw new RequestError("El documento ya fue eliminado de esta computadora y no está disponible para reimpresión.", 410);
      }
      const name = String(customerName ?? "").replace(/\s+/g, " ").trim();
      if (name.length < 2 || name.length > 100) throw new RequestError("Escriba el nombre del cliente (2 a 100 caracteres).");
      const fields = validatePatch(overrides ?? {}, loadPrinters());
      delete fields.notes;
      delete fields.review_ack;
      const merged = { ...doc, ...fields };
      // Se comprueba antes de crear nada: si no puede imprimirse, no queda un pedido a medias.
      const plan = planDocument(merged, planEnv({ skipOrderCheck: true }));
      if (!plan.ok) throw new RequestError("No se puede reimprimir con esta configuración.", 422, { problems: plan.problems });

      const newId = randomUUID();
      const destDir = join(ctx.config.dirs.originales, newId);
      const dest = join(destDir, "original.pdf");
      await mkdir(destDir, { recursive: true });
      await copyFile(pdf, dest);
      const [sha, st] = await Promise.all([sha256File(dest), stat(dest)]);
      const rel = files.rel(dest);
      const origin = doc.order_id ? db.get("SELECT correlative FROM orders WHERE id = ?", doc.order_id)?.correlative : null;

      let orderId;
      try {
        orderId = db.tx(() => {
          const now = nowIso();
          db.run(
            `INSERT INTO documents (id, original_name, ext, source, sha256, size_bytes, received_at, status,
               original_file, pdf_file, page_count, size_class, orientation, analysis, encrypted,
               duplicate_of, review_ack, copies, color_mode, duplex, paper_size, scale_mode, mixed_strategy,
               printer_id, converted_at, updated_at)
             VALUES (?, ?, '.pdf', ?, ?, ?, ?, 'ready', ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            newId, doc.original_name, doc.source, sha, st.size, now, rel, rel,
            doc.page_count, doc.size_class, doc.orientation, JSON.stringify(doc.analysis), doc.encrypted,
            doc.id, merged.copies, merged.color_mode, merged.duplex, merged.paper_size, merged.scale_mode,
            merged.mixed_strategy, merged.printer_id, now, now);
          const order = createOrder(upsertCustomer(name));
          db.run("UPDATE orders SET notes = ? WHERE id = ?",
            `Reimpresión de "${doc.original_name}"${origin ? ` (pedido ${origin})` : ""}`.slice(0, 500), order);
          db.run("UPDATE documents SET order_id = ? WHERE id = ?", order, newId);
          store.dirty("document", newId);
          store.audit(actor, "reprint_as_new_order", "order", order, { document: newId, original: doc.id, customer: name });
          recalcOrder(order);
          return order;
        });
      } catch (err) {
        await rm(destDir, { recursive: true, force: true }).catch(() => {});
        throw err;
      }
      const [result] = orders.authorize({ ids: [newId] }, actor);
      bus.touch();
      return { orderId, documentId: newId, authorized: result.ok, problems: result.problems ?? [] };
    },

    discard(list, actor) {
      const docIds = ids(list);
      db.tx(() => {
        const touched = new Set();
        for (const id of docIds) {
          const doc = db.get("SELECT order_id, status FROM documents WHERE id = ?", id);
          if (!doc || doc.status === "deleted") continue;
          if (hasBlockingJobs(id)) throw new RequestError("Un documento ya tiene impresiones: no puede descartarse.", 409);
          if (doc.order_id) touched.add(doc.order_id);
          db.run("UPDATE documents SET status = 'discarded', discarded_at = ?, order_id = NULL, updated_at = ? WHERE id = ?",
            nowIso(), nowIso(), id);
          store.dirty("document", id);
          store.audit(actor, "document_discarded", "document", id);
        }
        closeEmptyOrders();
        for (const o of touched) recalcOrder(o);
      });
      bus.touch();
    },

    retryDocument(id, actor) {
      if (!UUID_RE.test(id)) throw new RequestError("Identificador inválido.");
      const r = db.run("UPDATE documents SET status = 'queued', error_code = NULL, error_message = NULL, updated_at = ? WHERE id = ? AND status = 'error'",
        nowIso(), id);
      if (r.changes !== 1) throw new RequestError("El documento no está en estado de error.", 409);
      store.audit(actor, "document_retry", "document", id);
      bus.touch();
      ctx.processor.enqueue(id);
    },

    // ── Cola ─────────────────────────────────────────────────

    cancelJob(id, actor) {
      const r = db.run("UPDATE print_jobs SET status = 'cancelled', cancelled_at = ?, updated_at = ? WHERE id = ? AND status = 'ready'",
        nowIso(), nowIso(), id);
      if (r.changes !== 1) throw new RequestError("Solo se pueden cancelar trabajos que aún no se enviaron a la impresora.", 409);
      store.dirty("job", id);
      store.audit(actor, "job_cancelled", "job", id);
      bus.touch();
    },

    /** El operador confirma que el papel salió. */
    confirmJob(id, actor) {
      const r = db.run(
        "UPDATE print_jobs SET status = 'printed', confirmed_at = ?, updated_at = ? WHERE id = ? AND status IN ('sent','printing','unknown')",
        nowIso(), nowIso(), id);
      if (r.changes !== 1) throw new RequestError("El trabajo no está pendiente de confirmación.", 409);
      store.dirty("job", id);
      store.audit(actor, "job_confirmed", "job", id);
      bus.touch();
    },

    /** Envío incierto que el operador verificó que NO salió: queda en error y puede reenviarse. */
    markNotPrinted(id, actor) {
      const r = db.run(
        `UPDATE print_jobs SET status = 'error', error_message = 'El operador indicó que no se imprimió.', updated_at = ?
         WHERE id = ? AND status IN ('unknown','sent')`, nowIso(), id);
      if (r.changes !== 1) throw new RequestError("El trabajo no admite esta acción.", 409);
      store.dirty("job", id);
      store.audit(actor, "job_marked_not_printed", "job", id);
      bus.touch();
    },

    /** Reenvío manual de un trabajo fallido o cancelado: crea un trabajo nuevo con trazabilidad. */
    resendJob(id, actor) {
      const newId = db.tx(() => {
        const job = db.get("SELECT * FROM print_jobs WHERE id = ?", id);
        if (!job) throw new RequestError("Trabajo no encontrado.", 404);
        if (!["error", "cancelled"].includes(job.status)) {
          throw new RequestError("Solo se reenvían trabajos en error o cancelados. Si el envío es incierto, verifique primero si salió el papel.", 409);
        }
        if (db.get("SELECT 1 AS x FROM print_jobs WHERE retry_of = ? AND status NOT IN ('cancelled','error')", id)) {
          throw new RequestError("Este trabajo ya fue reenviado.", 409);
        }
        const doc = getDoc(job.document_id);
        if (!doc || !files.findPdf(doc)) throw new RequestError("El PDF ya no está disponible en esta computadora.", 410);
        const nid = randomUUID();
        db.run(
          `INSERT INTO print_jobs (id, document_id, order_id, kind, retry_of, pages, page_count, copies, color_mode, duplex,
             paper_size, scale_mode, printer_id, printer_name, printer_system_name, tray, rule_id, priority,
             batch_at, status, price, authorized_by, created_at, updated_at)
           SELECT ?, document_id, order_id, kind, id, pages, page_count, copies, color_mode, duplex,
             paper_size, scale_mode, printer_id, printer_name, printer_system_name, tray, rule_id, priority,
             ?, 'ready', price, ?, ?, ? FROM print_jobs WHERE id = ?`,
          nid, nowIso(), actor, nowIso(), nowIso(), id);
        store.dirty("job", nid);
        store.audit(actor, "job_resent", "job", nid, { retry_of: id });
        return nid;
      });
      bus.touch();
      ctx.queue?.kick();
      return { jobId: newId };
    },

    setJobPriority(id, priority, actor) {
      if (!Number.isInteger(priority) || Math.abs(priority) > 9) throw new RequestError("Prioridad inválida.");
      const r = db.run("UPDATE print_jobs SET priority = ?, updated_at = ? WHERE id = ? AND status = 'ready'", priority, nowIso(), id);
      if (r.changes !== 1) throw new RequestError("Solo se prioriza un trabajo que aún está en cola.", 409);
      store.audit(actor, "job_priority", "job", id, { priority });
      bus.touch();
    },

    // ── Cierre de pedidos ────────────────────────────────────

    /** Entregado: confirma lo enviado, cierra el pedido e inicia el plazo de retención. */
    async finishOrder(id, actor) {
      if (!UUID_RE.test(id)) throw new RequestError("Identificador inválido.");
      db.tx(() => {
        const o = db.get("SELECT status FROM orders WHERE id = ?", id);
        if (!o) throw new RequestError("Pedido no encontrado.", 404);
        if (o.status !== "open") throw new RequestError("El pedido ya está cerrado.", 409);
        const pending = db.get(
          "SELECT COUNT(*) AS n FROM print_jobs WHERE order_id = ? AND status IN ('ready','sending','unknown')", id).n;
        if (pending > 0) {
          throw new RequestError("El pedido tiene trabajos en cola o con envío incierto. Resuélvalos antes de finalizar.", 409);
        }
        for (const j of db.all("SELECT id FROM print_jobs WHERE order_id = ? AND status IN ('sent','printing')", id)) {
          db.run("UPDATE print_jobs SET status = 'printed', confirmed_at = ?, updated_at = ? WHERE id = ?", nowIso(), nowIso(), j.id);
          store.dirty("job", j.id);
        }
        db.run("UPDATE orders SET status = 'finished', is_complete = 1, finished_at = ?, updated_at = ? WHERE id = ?", nowIso(), nowIso(), id);
        store.dirty("order", id);
        store.audit(actor, "order_finished", "order", id);
      });
      for (const doc of db.all("SELECT * FROM documents WHERE order_id = ? AND status IN ('ready','error')", id)) {
        await files.archiveToCompleted(doc).catch((err) => ctx.log("warn", `No se pudo archivar ${doc.id}: ${err.message}`));
        store.dirty("document", doc.id);
      }
      bus.touch();
    },

    cancelOrder(id, actor) {
      if (!UUID_RE.test(id)) throw new RequestError("Identificador inválido.");
      db.tx(() => {
        const o = db.get("SELECT status FROM orders WHERE id = ?", id);
        if (!o || o.status !== "open") throw new RequestError("El pedido no está abierto.", 409);
        if (db.get("SELECT 1 AS x FROM print_jobs WHERE order_id = ? AND status IN ('sending','unknown')", id)) {
          throw new RequestError("Hay un envío en curso o incierto: resuélvalo antes de cancelar.", 409);
        }
        for (const j of db.all("SELECT id FROM print_jobs WHERE order_id = ? AND status = 'ready'", id)) {
          db.run("UPDATE print_jobs SET status = 'cancelled', cancelled_at = ?, updated_at = ? WHERE id = ?", nowIso(), nowIso(), j.id);
          store.dirty("job", j.id);
        }
        db.run("UPDATE orders SET status = 'cancelled', finished_at = ?, updated_at = ? WHERE id = ?", nowIso(), nowIso(), id);
        store.dirty("order", id);
        store.audit(actor, "order_cancelled", "order", id);
      });
      bus.touch();
    },

    // ── Historial ────────────────────────────────────────────

    history({ q = "", offset = 0 }) {
      // La búsqueda ignora mayúsculas y acentos, algo que el LIKE de SQLite no hace.
      const needle = normName(String(q)).slice(0, 60);
      const start = Math.max(0, parseInt(offset, 10) || 0);
      let rows = db.all("SELECT * FROM orders WHERE status IN ('finished','cancelled') ORDER BY finished_at DESC LIMIT 5000");
      if (needle) {
        rows = rows.filter((o) =>
          normName(`${o.customer_name} ${o.correlative}`).includes(needle) ||
          db.all("SELECT original_name FROM documents WHERE order_id = ?", o.id).some((d) => normName(d.original_name).includes(needle)));
      }
      return rows.slice(start, start + 50).map((o) => ({
        ...publicOrder(o),
        documents: db.all("SELECT * FROM documents WHERE order_id = ? ORDER BY seq", o.id).map((d) => {
          const doc = parseDoc(d);
          return { ...publicDoc(doc, null), pdf_available: doc.status === "ready" && !!files.findPdf(doc) };
        }),
        jobs: db.all("SELECT * FROM print_jobs WHERE order_id = ? ORDER BY seq", o.id),
      }));
    },

    auditLog: (offset = 0) =>
      db.all("SELECT id, at, actor, action, entity, entity_id, detail FROM audit ORDER BY seq DESC LIMIT 100 OFFSET ?",
        Math.max(0, parseInt(offset, 10) || 0)).map((a) => ({ ...a, detail: a.detail ? JSON.parse(a.detail) : null })),

    errors: () => ({
      documents: db.all(
        "SELECT id, original_name, received_at, error_code, error_message, updated_at FROM documents WHERE error_code IS NOT NULL ORDER BY seq DESC LIMIT 100"),
      jobs: db.all(
        `SELECT j.id, j.status, j.error_message, j.printer_name, j.updated_at, d.original_name
         FROM print_jobs j JOIN documents d ON d.id = j.document_id
         WHERE j.status IN ('error','unknown') ORDER BY j.seq DESC LIMIT 100`),
    }),

    deletions: () => db.all("SELECT * FROM deletions ORDER BY deleted_at DESC LIMIT 200"),

    metrics() {
      const since = new Date(ctx.now() - DAY_MS).toISOString();
      const d = db.get(
        `SELECT COUNT(*) AS received, AVG(intake_ms) AS avg_intake_ms, AVG(convert_ms) AS avg_convert_ms, MAX(convert_ms) AS max_convert_ms
         FROM documents WHERE received_at > ?`, since);
      const j = db.get(
        `SELECT COUNT(*) AS sent, AVG((julianday(sent_at) - julianday(created_at)) * 86400000) AS avg_queue_ms
         FROM print_jobs WHERE sent_at > ?`, since);
      return { window_hours: 24, ...d, ...j };
    },
  };
  return orders;
}
