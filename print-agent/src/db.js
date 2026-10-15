/**
 * Registro local persistente (SQLite integrado en Node, sin binarios nativos).
 * Es la fuente de verdad de documentos, pedidos y cola de impresión.
 * Supabase solo recibe una copia de los metadatos administrativos.
 */
import { DatabaseSync } from "node:sqlite";

const MIGRATIONS = [
  `
  CREATE TABLE settings (
    key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at TEXT NOT NULL,
    local_override INTEGER NOT NULL DEFAULT 0
  );
  CREATE TABLE counters (key TEXT PRIMARY KEY, value INTEGER NOT NULL);

  CREATE TABLE customers (
    id TEXT PRIMARY KEY, name TEXT NOT NULL, name_norm TEXT NOT NULL UNIQUE,
    phone TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
  );

  CREATE TABLE orders (
    id TEXT PRIMARY KEY,
    correlative TEXT NOT NULL UNIQUE,
    customer_id TEXT REFERENCES customers(id),
    customer_name TEXT NOT NULL,
    notes TEXT,
    status TEXT NOT NULL DEFAULT 'open',          -- open | finished | cancelled
    is_complete INTEGER NOT NULL DEFAULT 0,
    priority INTEGER NOT NULL DEFAULT 0,
    keep_documents INTEGER NOT NULL DEFAULT 0,
    total_price REAL NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
    finished_at TEXT, documents_deleted_at TEXT
  );
  CREATE INDEX idx_orders_status ON orders(status, finished_at);

  CREATE TABLE documents (
    seq INTEGER PRIMARY KEY AUTOINCREMENT,
    id TEXT NOT NULL UNIQUE,
    original_name TEXT NOT NULL,
    ext TEXT NOT NULL,
    source TEXT NOT NULL DEFAULT 'folder',
    sha256 TEXT,
    size_bytes INTEGER,
    received_at TEXT NOT NULL,
    status TEXT NOT NULL,   -- intake | queued | converting | ready | error | discarded | deleted
    error_code TEXT, error_message TEXT,
    convert_attempts INTEGER NOT NULL DEFAULT 0,
    source_path TEXT,
    original_file TEXT, pdf_file TEXT,
    page_count INTEGER, size_class TEXT, orientation TEXT, analysis TEXT,
    encrypted INTEGER NOT NULL DEFAULT 0,
    duplicate_of TEXT,
    review_ack INTEGER NOT NULL DEFAULT 0,
    order_id TEXT REFERENCES orders(id),
    copies INTEGER, color_mode TEXT, duplex TEXT,
    paper_size TEXT, scale_mode TEXT, mixed_strategy TEXT,
    printer_id TEXT, notes TEXT,
    intake_ms INTEGER, convert_ms INTEGER, converted_at TEXT,
    discarded_at TEXT, deleted_at TEXT,
    updated_at TEXT NOT NULL
  );
  CREATE INDEX idx_documents_status ON documents(status);
  CREATE INDEX idx_documents_order ON documents(order_id);
  CREATE INDEX idx_documents_sha ON documents(sha256);

  CREATE TABLE print_jobs (
    seq INTEGER PRIMARY KEY AUTOINCREMENT,
    id TEXT NOT NULL UNIQUE,
    document_id TEXT NOT NULL REFERENCES documents(id),
    order_id TEXT REFERENCES orders(id),
    kind TEXT NOT NULL DEFAULT 'print',           -- print | reprint
    retry_of TEXT,
    pages TEXT, page_count INTEGER NOT NULL,
    copies INTEGER NOT NULL, color_mode TEXT NOT NULL, duplex TEXT NOT NULL,
    paper_size TEXT NOT NULL, scale_mode TEXT NOT NULL,
    printer_id TEXT, printer_name TEXT, printer_system_name TEXT NOT NULL,
    tray TEXT, rule_id TEXT,
    priority INTEGER NOT NULL DEFAULT 0,
    batch_at TEXT NOT NULL,
    status TEXT NOT NULL,   -- ready | sending | sent | printing | printed | error | unknown | cancelled
    hold_reason TEXT, hold_since TEXT,
    error_message TEXT, spooler_status TEXT, win_job_id INTEGER,
    price REAL NOT NULL DEFAULT 0,
    authorized_by TEXT,
    created_at TEXT NOT NULL, sent_at TEXT, spooler_done_at TEXT,
    confirmed_at TEXT, cancelled_at TEXT, updated_at TEXT NOT NULL
  );
  CREATE INDEX idx_jobs_status ON print_jobs(status);
  CREATE INDEX idx_jobs_document ON print_jobs(document_id);

  CREATE TABLE print_attempts (
    id TEXT PRIMARY KEY,
    job_id TEXT NOT NULL REFERENCES print_jobs(id),
    attempt_no INTEGER NOT NULL,
    started_at TEXT NOT NULL, finished_at TEXT,
    outcome TEXT,           -- NULL = en curso | sent | failed | unknown
    detail TEXT, printer_system_name TEXT, options TEXT
  );
  CREATE INDEX idx_attempts_job ON print_attempts(job_id);

  CREATE TABLE printers (
    id TEXT PRIMARY KEY, name TEXT NOT NULL, system_name TEXT NOT NULL,
    is_active INTEGER NOT NULL DEFAULT 1,
    supports_color INTEGER NOT NULL DEFAULT 0,
    supports_duplex INTEGER NOT NULL DEFAULT 0,
    paper_sizes TEXT NOT NULL DEFAULT '[]', trays TEXT NOT NULL DEFAULT '{}',
    priority INTEGER NOT NULL DEFAULT 100
  );
  CREATE TABLE rules (
    id TEXT PRIMARY KEY, name TEXT NOT NULL,
    priority INTEGER NOT NULL DEFAULT 100, enabled INTEGER NOT NULL DEFAULT 1,
    paper_size TEXT NOT NULL DEFAULT 'any', color_mode TEXT NOT NULL DEFAULT 'any',
    duplex TEXT NOT NULL DEFAULT 'any',
    min_pages INTEGER, max_pages INTEGER,
    printer_id TEXT NOT NULL, tray TEXT
  );

  CREATE TABLE audit (
    seq INTEGER PRIMARY KEY AUTOINCREMENT,
    id TEXT NOT NULL UNIQUE, at TEXT NOT NULL, actor TEXT,
    action TEXT NOT NULL, entity TEXT, entity_id TEXT, detail TEXT
  );
  CREATE TABLE deletions (
    id TEXT PRIMARY KEY, document_id TEXT NOT NULL, order_id TEXT,
    original_name TEXT, deleted_at TEXT NOT NULL, reason TEXT NOT NULL,
    files_removed INTEGER NOT NULL DEFAULT 0
  );
  CREATE TABLE sync_dirty (
    entity TEXT NOT NULL, entity_id TEXT NOT NULL, dirty_at TEXT NOT NULL,
    attempts INTEGER NOT NULL DEFAULT 0, last_error TEXT,
    PRIMARY KEY (entity, entity_id)
  );
  `,
];

const clean = (v) => (v === undefined ? null : typeof v === "boolean" ? (v ? 1 : 0) : v);

export function openDb(file) {
  const raw = new DatabaseSync(file);
  raw.exec("PRAGMA journal_mode=WAL; PRAGMA synchronous=NORMAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;");

  const current = raw.prepare("PRAGMA user_version").get().user_version;
  for (let v = current; v < MIGRATIONS.length; v++) {
    raw.exec("BEGIN IMMEDIATE");
    try {
      raw.exec(MIGRATIONS[v]);
      raw.exec(`PRAGMA user_version = ${v + 1}`);
      raw.exec("COMMIT");
    } catch (err) {
      raw.exec("ROLLBACK");
      throw err;
    }
  }

  const cache = new Map();
  const stmt = (sql) => {
    let s = cache.get(sql);
    if (!s) cache.set(sql, (s = raw.prepare(sql)));
    return s;
  };
  let depth = 0;

  return {
    raw,
    run: (sql, ...p) => stmt(sql).run(...p.map(clean)),
    get: (sql, ...p) => stmt(sql).get(...p.map(clean)),
    all: (sql, ...p) => stmt(sql).all(...p.map(clean)),
    /** Transacción síncrona (anidable). `fn` no puede usar await. */
    tx(fn) {
      if (depth > 0) return fn();
      raw.exec("BEGIN IMMEDIATE");
      depth++;
      try {
        const out = fn();
        raw.exec("COMMIT");
        return out;
      } catch (err) {
        raw.exec("ROLLBACK");
        throw err;
      } finally {
        depth--;
      }
    },
    close() {
      cache.clear();
      raw.close();
    },
  };
}
