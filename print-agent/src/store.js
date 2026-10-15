/** Operaciones transversales sobre el registro local: ajustes, auditoría, sincronización. */
import { randomUUID } from "node:crypto";
import { DEFAULT_SETTINGS } from "./config.js";
import { nowIso, gtTimestamp } from "./util.js";

export function createStore(ctx) {
  const { db } = ctx;

  const store = {
    setting(key) {
      const row = db.get("SELECT value FROM settings WHERE key = ?", key);
      return row?.value ?? DEFAULT_SETTINGS[key] ?? null;
    },
    settingInt(key, min = 0) {
      const n = parseInt(store.setting(key), 10);
      const d = parseInt(DEFAULT_SETTINGS[key], 10);
      return Number.isFinite(n) && n >= min ? n : d;
    },
    settingNum(key) {
      const n = parseFloat(store.setting(key));
      return Number.isFinite(n) ? n : parseFloat(DEFAULT_SETTINGS[key]);
    },
    /** `local: true` = cambiado en esta PC; se sube a Supabase y no se pisa hasta subirlo. */
    setSetting(key, value, { local = false } = {}) {
      db.run(
        `INSERT INTO settings (key, value, updated_at, local_override) VALUES (?, ?, ?, ?)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at,
           local_override = excluded.local_override`,
        key, String(value), nowIso(), local
      );
      if (local) store.dirty("setting", key);
    },
    allSettings() {
      const out = { ...DEFAULT_SETTINGS };
      for (const r of db.all("SELECT key, value FROM settings")) out[r.key] = r.value;
      return out;
    },

    /** Marca una entidad para subir sus metadatos a Supabase. */
    dirty(entity, id) {
      db.run(
        `INSERT INTO sync_dirty (entity, entity_id, dirty_at) VALUES (?, ?, ?)
         ON CONFLICT(entity, entity_id) DO UPDATE SET dirty_at = excluded.dirty_at`,
        entity, id, nowIso()
      );
    },

    audit(actor, action, entity, entityId, detail) {
      const id = randomUUID();
      db.run(
        "INSERT INTO audit (id, at, actor, action, entity, entity_id, detail) VALUES (?, ?, ?, ?, ?, ?, ?)",
        id, nowIso(), actor ?? "sistema", action, entity ?? null, entityId ?? null,
        detail ? JSON.stringify(detail) : null
      );
      store.dirty("audit", id);
    },

    /** Correlativo local de pedido: ARR-YYYYMMDD-NNN (fecha de Guatemala). */
    nextCorrelative() {
      const day = gtTimestamp(new Date(ctx.now())).slice(0, 10).replace(/-/g, "");
      const key = `corr:${day}`;
      db.run(
        "INSERT INTO counters (key, value) VALUES (?, 1) ON CONFLICT(key) DO UPDATE SET value = value + 1",
        key
      );
      const n = db.get("SELECT value FROM counters WHERE key = ?", key).value;
      return `ARR-${day}-${String(n).padStart(3, "0")}`;
    },

    unitPrice(colorMode) {
      return store.settingNum(colorMode === "color" ? "price_color" : "price_bw");
    },
  };
  return store;
}
