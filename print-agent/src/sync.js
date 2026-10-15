/**
 * Sincronización con Supabase — SOLO metadatos administrativos.
 *   Baja: impresoras, reglas y ajustes (se guardan en caché local).
 *   Sube: clientes, pedidos, documentos (sin contenido ni rutas), trabajos,
 *         intentos, eliminaciones y auditoría.
 * Este módulo no usa Supabase Storage: ningún archivo sale de la computadora.
 * Sin internet, lo pendiente queda en `sync_dirty` y se sube al reconectar.
 */
import { SYNCED_SETTING_KEYS } from "./config.js";
import { PAPER_KEYS } from "./paper.js";
import { UUID_RE, nowIso } from "./util.js";

const DAY_MS = 86400000;
const PULL_EVERY_MS = 30000;
const BATCH = 200;
const ORDER = ["customer", "order", "document", "job", "attempt", "deletion", "audit", "setting"];

export function createSync(ctx, client) {
  const { db, store, log, bus } = ctx;
  const status = { enabled: !!client, online: null, lastOkAt: null, lastError: null, pending: 0 };
  let timer = null, running = false, lastPull = 0;

  const purgeAfter = (finishedAt, keep) =>
    !finishedAt || keep ? null : new Date(Date.parse(finishedAt) + store.settingInt("retention_days", 1) * DAY_MS).toISOString();

  // Fila local → fila de Supabase. Nunca incluye rutas del disco ni contenido.
  const MAPPERS = {
    customer: {
      table: "customers",
      load: (id) => db.get("SELECT id, name, phone, created_at, updated_at FROM customers WHERE id = ?", id),
    },
    order: {
      table: "reception_orders",
      load(id) {
        const o = db.get("SELECT * FROM orders WHERE id = ?", id);
        return o && {
          id: o.id, correlative: o.correlative, customer_id: o.customer_id, customer_name: o.customer_name,
          notes: o.notes, status: o.status, is_complete: !!o.is_complete, priority: o.priority,
          keep_documents: !!o.keep_documents, total_price: o.total_price, created_at: o.created_at,
          finished_at: o.finished_at, purge_after: purgeAfter(o.finished_at, o.keep_documents),
          documents_deleted_at: o.documents_deleted_at, updated_at: o.updated_at,
        };
      },
    },
    document: {
      table: "reception_documents",
      load(id) {
        const d = db.get("SELECT * FROM documents WHERE id = ?", id);
        if (!d || d.status === "intake") return null;
        const order = d.order_id ? db.get("SELECT finished_at, keep_documents FROM orders WHERE id = ?", d.order_id) : null;
        const groups = d.analysis ? JSON.parse(d.analysis).groups : null;
        return {
          id: d.id, order_id: d.order_id, original_file_name: d.original_name, source: d.source,
          sha256: d.sha256, size_bytes: d.size_bytes, received_at: d.received_at, status: d.status,
          error_code: d.error_code, error_message: d.error_message, page_count: d.page_count,
          size_class: d.size_class, orientation: d.orientation, page_groups: groups,
          copies: d.copies, color_mode: d.color_mode, duplex: d.duplex, paper_size: d.paper_size,
          scale_mode: d.scale_mode, mixed_strategy: d.mixed_strategy, printer_id: d.printer_id, notes: d.notes,
          converted_at: d.converted_at, deleted_at: d.deleted_at,
          purge_after: d.status === "discarded" ? purgeAfter(d.discarded_at, false) : purgeAfter(order?.finished_at, order?.keep_documents),
          updated_at: d.updated_at,
        };
      },
    },
    job: {
      table: "reception_print_jobs",
      load(id) {
        const j = db.get("SELECT * FROM print_jobs WHERE id = ?", id);
        return j && {
          id: j.id, document_id: j.document_id, order_id: j.order_id, kind: j.kind, retry_of: j.retry_of,
          pages: j.pages, page_count: j.page_count, copies: j.copies, color_mode: j.color_mode, duplex: j.duplex,
          paper_size: j.paper_size, scale_mode: j.scale_mode, printer_id: j.printer_id, printer_name: j.printer_name,
          tray: j.tray, rule_id: j.rule_id, priority: j.priority, status: j.status, error_message: j.error_message,
          spooler_status: j.spooler_status, price: j.price, authorized_by: j.authorized_by, created_at: j.created_at,
          sent_at: j.sent_at, spooler_done_at: j.spooler_done_at, confirmed_at: j.confirmed_at,
          cancelled_at: j.cancelled_at, updated_at: j.updated_at,
        };
      },
    },
    attempt: {
      table: "reception_print_attempts",
      load: (id) => db.get(
        "SELECT id, job_id, attempt_no, started_at, finished_at, outcome, detail FROM print_attempts WHERE id = ?", id),
    },
    deletion: {
      table: "reception_deletions",
      load: (id) => db.get("SELECT * FROM deletions WHERE id = ?", id),
    },
    audit: {
      table: "audit_logs",
      load(id) {
        const a = db.get("SELECT * FROM audit WHERE id = ?", id);
        return a && {
          id: a.id, action: a.action, table_name: a.entity,
          record_id: a.entity_id && UUID_RE.test(a.entity_id) ? a.entity_id : null,
          new_values: { actor: a.actor, origen: "agente_local", ...(a.detail ? JSON.parse(a.detail) : {}) },
          created_at: a.at,
        };
      },
    },
    setting: {
      table: "settings", conflict: "key",
      load(key) {
        const s = db.get("SELECT key, value FROM settings WHERE key = ?", key);
        return s && SYNCED_SETTING_KEYS.includes(s.key) ? s : null;
      },
      done: (key) => db.run("UPDATE settings SET local_override = 0 WHERE key = ?", key),
    },
  };

  async function pullConfig() {
    const [printers, rules, settings] = await Promise.all([
      client.from("printers").select("id, name, system_name, is_active, supports_color, supports_duplex, paper_sizes, trays, priority"),
      client.from("printer_rules").select("id, name, priority, enabled, paper_size, color_mode, duplex, min_pages, max_pages, printer_id, tray"),
      client.from("settings").select("key, value").in("key", SYNCED_SETTING_KEYS),
    ]);
    for (const r of [printers, rules, settings]) if (r.error) throw new Error(r.error.message);

    const before = JSON.stringify([db.all("SELECT * FROM printers ORDER BY id"), db.all("SELECT * FROM rules ORDER BY id"), db.all("SELECT key, value FROM settings ORDER BY key")]);
    db.tx(() => {
      db.run("DELETE FROM printers");
      for (const p of printers.data ?? []) {
        const sizes = (Array.isArray(p.paper_sizes) ? p.paper_sizes : []).filter((s) => PAPER_KEYS.includes(s));
        db.run(
          "INSERT INTO printers (id, name, system_name, is_active, supports_color, supports_duplex, paper_sizes, trays, priority) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
          p.id, p.name, p.system_name, !!p.is_active, !!p.supports_color, !!p.supports_duplex,
          JSON.stringify(sizes), JSON.stringify(p.trays && typeof p.trays === "object" ? p.trays : {}), p.priority ?? 100);
      }
      db.run("DELETE FROM rules");
      for (const r of rules.data ?? []) {
        db.run(
          "INSERT INTO rules (id, name, priority, enabled, paper_size, color_mode, duplex, min_pages, max_pages, printer_id, tray) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
          r.id, r.name, r.priority ?? 100, !!r.enabled, r.paper_size ?? "any", r.color_mode ?? "any", r.duplex ?? "any",
          r.min_pages, r.max_pages, r.printer_id, r.tray || null);
      }
      for (const s of settings.data ?? []) {
        // Un cambio hecho en esta PC que aún no subió tiene precedencia (p. ej. apagar el modo automático).
        const local = db.get("SELECT local_override FROM settings WHERE key = ?", s.key);
        if (!local?.local_override) store.setSetting(s.key, s.value);
      }
    });
    const after = JSON.stringify([db.all("SELECT * FROM printers ORDER BY id"), db.all("SELECT * FROM rules ORDER BY id"), db.all("SELECT key, value FROM settings ORDER BY key")]);
    if (before !== after) bus.touch();
  }

  async function pushEntity(entity, rows) {
    const mapper = MAPPERS[entity];
    const items = [];
    for (const row of rows) {
      const payload = mapper.load(row.entity_id);
      if (payload) items.push({ row, payload });
      else db.run("DELETE FROM sync_dirty WHERE entity = ? AND entity_id = ? AND dirty_at = ?", entity, row.entity_id, row.dirty_at);
    }
    if (items.length === 0) return;
    const upsert = (payloads) => client.from(mapper.table).upsert(payloads, { onConflict: mapper.conflict ?? "id" });
    const settle = (item, error) => {
      if (error) {
        db.run("UPDATE sync_dirty SET attempts = attempts + 1, last_error = ? WHERE entity = ? AND entity_id = ?",
          String(error.message ?? error).slice(0, 300), entity, item.row.entity_id);
        return;
      }
      // Solo se limpia si no volvió a cambiar mientras se subía.
      db.run("DELETE FROM sync_dirty WHERE entity = ? AND entity_id = ? AND dirty_at = ?", entity, item.row.entity_id, item.row.dirty_at);
      mapper.done?.(item.row.entity_id);
    };

    const batch = await upsert(items.map((i) => i.payload));
    if (!batch.error) return items.forEach((i) => settle(i, null));
    // El lote falló: fila por fila para que una fila inválida no bloquee al resto.
    let failures = 0;
    for (const item of items) {
      const one = await upsert([item.payload]);
      settle(item, one.error);
      if (one.error) failures++;
    }
    if (failures === items.length) throw new Error(batch.error.message);
  }

  async function pushDirty() {
    for (const entity of ORDER) {
      const rows = db.all("SELECT * FROM sync_dirty WHERE entity = ? ORDER BY dirty_at LIMIT ?", entity, BATCH);
      if (rows.length) await pushEntity(entity, rows);
    }
  }

  async function cycle({ forcePull = false } = {}) {
    if (!client || running) return status;
    running = true;
    const wasOnline = status.online;
    try {
      if (forcePull || ctx.now() - lastPull > PULL_EVERY_MS) {
        await pullConfig();
        lastPull = ctx.now();
      }
      await pushDirty();
      status.online = true;
      status.lastOkAt = nowIso();
      status.lastError = null;
      if (wasOnline === false) await log("success", "Conexión con Supabase restablecida: metadatos sincronizados.");
    } catch (err) {
      status.online = false;
      status.lastError = String(err?.message ?? err).slice(0, 200);
      if (wasOnline !== false) await log("warn", `Sin conexión con Supabase: los cambios quedan guardados localmente. (${status.lastError})`);
    } finally {
      status.pending = db.get("SELECT COUNT(*) AS n FROM sync_dirty").n;
      running = false;
      if (wasOnline !== status.online) bus.touch();
    }
    return status;
  }

  return {
    cycle,
    status: () => ({ ...status, pending: db.get("SELECT COUNT(*) AS n FROM sync_dirty").n }),
    start() {
      if (!client) return;
      void cycle({ forcePull: true });
      timer = setInterval(() => void cycle(), ctx.config.syncIntervalMs);
    },
    async stop() {
      clearInterval(timer);
      while (running) await new Promise((r) => setTimeout(r, 20));
    },
  };
}
