import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { crc32 } from "node:zlib";
import { PDFDocument } from "pdf-lib";
import { createAgent } from "../src/app.js";
import { signToken } from "../src/auth.js";
import { loadConfig } from "../src/config.js";
import { PAPER_SIZES } from "../src/paper.js";

export const SECRET = "secreto-de-prueba-con-mas-de-32-caracteres!!";
export const ORIGIN = "http://localhost:3000";
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function waitFor(fn, { timeout = 8000, every = 40, label = "condición" } = {}) {
  const end = Date.now() + timeout;
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() > end) throw new Error(`Tiempo agotado esperando: ${label}`);
    await sleep(every);
  }
}

/** PDF con una página por cada entrada: clave de papel o [ancho, alto] en puntos. */
export async function makePdf(pages = ["carta"]) {
  const doc = await PDFDocument.create();
  for (const p of pages) {
    const size = Array.isArray(p) ? p : [PAPER_SIZES[p].w, PAPER_SIZES[p].h];
    // Texto único: dos PDF generados nunca tienen el mismo contenido por accidente.
    doc.addPage(size).drawText(`Prueba ${Math.random().toString(36).slice(2)}`, { x: 40, y: 40, size: 12 });
  }
  return Buffer.from(await doc.save());
}

/** DOCX mínimo y válido (ZIP sin compresión) con el texto indicado. */
export function makeDocx(text = "Documento de prueba de El Arrecife") {
  const files = {
    "[Content_Types].xml": '<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>',
    "_rels/.rels": '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>',
    "word/document.xml": `<?xml version="1.0" encoding="UTF-8"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>${text}</w:t></w:r></w:p></w:body></w:document>`,
  };
  const locals = [], centrals = [];
  let offset = 0;
  for (const [name, content] of Object.entries(files)) {
    const n = Buffer.from(name), data = Buffer.from(content), crc = crc32(data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4);
    local.writeUInt32LE(crc, 14); local.writeUInt32LE(data.length, 18); local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(n.length, 26);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0); central.writeUInt16LE(20, 4); central.writeUInt16LE(20, 6);
    central.writeUInt32LE(crc, 16); central.writeUInt32LE(data.length, 20); central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(n.length, 28); central.writeUInt32LE(offset, 42);
    locals.push(local, n, data);
    centrals.push(central, n);
    offset += 30 + n.length + data.length;
  }
  const dir = Buffer.concat(centrals), end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(Object.keys(files).length, 8); end.writeUInt16LE(Object.keys(files).length, 10);
  end.writeUInt32LE(dir.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, dir, end]);
}

export const PRINTERS = {
  carta:  { id: "11111111-1111-4111-8111-111111111111", name: "Láser Carta", system_name: "HP Carta", is_active: true, supports_color: false, supports_duplex: true, paper_sizes: ["carta", "a4"], trays: { carta: "Bandeja 1" }, priority: 1 },
  legal:  { id: "22222222-2222-4222-8222-222222222222", name: "Láser Legal", system_name: "HP Legal", is_active: true, supports_color: false, supports_duplex: false, paper_sizes: ["legal", "oficio2"], trays: {}, priority: 2 },
  color:  { id: "33333333-3333-4333-8333-333333333333", name: "Tinta Color", system_name: "Canon Color", is_active: true, supports_color: true, supports_duplex: false, paper_sizes: ["carta"], trays: {}, priority: 3 },
};

export const RULES = [
  { id: "aaaaaaaa-0000-4000-8000-000000000001", name: "Carta B/N", priority: 10, enabled: true, paper_size: "carta", color_mode: "bw", duplex: "any", min_pages: null, max_pages: null, printer_id: PRINTERS.carta.id, tray: null },
  { id: "aaaaaaaa-0000-4000-8000-000000000002", name: "Legal B/N", priority: 20, enabled: true, paper_size: "legal", color_mode: "bw", duplex: "any", min_pages: null, max_pages: null, printer_id: PRINTERS.legal.id, tray: null },
  { id: "aaaaaaaa-0000-4000-8000-000000000003", name: "Oficio B/N", priority: 30, enabled: true, paper_size: "oficio2", color_mode: "bw", duplex: "any", min_pages: null, max_pages: null, printer_id: PRINTERS.legal.id, tray: null },
  { id: "aaaaaaaa-0000-4000-8000-000000000004", name: "Carta color", priority: 40, enabled: true, paper_size: "carta", color_mode: "color", duplex: "any", min_pages: null, max_pages: null, printer_id: PRINTERS.color.id, tray: null },
];

const DRIVER_FORMS = [
  { name: "Letter", w: 850, h: 1100 }, { name: "A4", w: 827, h: 1169 },
  { name: "Legal", w: 850, h: 1400 }, { name: "Oficio II", w: 850, h: 1300 },
];

export function fakePrinterService() {
  const svc = {
    offline: new Set(),
    spool: [],
    async list() {
      return Object.values(PRINTERS).map((p) => ({ name: p.system_name, status: "Normal", offline: svc.offline.has(p.system_name) }));
    },
    isAvailableSync: (name) => Object.values(PRINTERS).some((p) => p.system_name === name) && !svc.offline.has(name),
    capabilities: async () => ({ valid: true, canDuplex: true, supportsColor: true, paperSizes: DRIVER_FORMS, bins: ["Bandeja 1", "Bandeja 2"] }),
    spoolerJobs: async () => svc.spool,
    invalidate() {},
  };
  return svc;
}

export function fakeDriver() {
  const driver = {
    name: "fake",
    calls: [],
    behavior: "ok", // ok | fail | hang
    async print(file, options) {
      driver.calls.push({ file, options });
      if (driver.behavior === "fail") throw new Error("spooler rechazó el trabajo");
      if (driver.behavior === "hang") await new Promise(() => {});
    },
  };
  return driver;
}

/** Convertidor falso: produce un PDF carta de 2 páginas (o falla si el nombre lo pide). */
export function fakeConverter() {
  const conv = {
    calls: 0,
    fail: false,
    findLibreOffice: async () => "fake-soffice",
    async convert(input) {
      conv.calls++;
      if (conv.fail) throw Object.assign(new Error("LibreOffice no generó el PDF."), { code: "CONVERT_FAILED" });
      const dir = await mkdtemp(join(tmpdir(), "fqp-conv-"));
      const pdf = join(dir, "original.pdf");
      await writeFile(pdf, await makePdf(["carta", "carta"]));
      return { pdf, cleanup: () => rm(dir, { recursive: true, force: true }) };
    },
  };
  return conv;
}

/** Cliente Supabase falso: registra upserts, puede simular caída de internet y prohíbe Storage. */
export function fakeSupabase() {
  const sb = {
    offline: false,
    tables: { printers: Object.values(PRINTERS), printer_rules: RULES, settings: [] },
    upserts: [],
    get storage() {
      throw new Error("PROHIBIDO: el flujo local intentó usar Supabase Storage");
    },
    from(table) {
      const filters = [];
      const rows = () => (sb.tables[table] ?? []).filter((r) => filters.every(([k, v]) => r[k] === v));
      const result = () => (sb.offline ? { data: null, error: { message: "fetch failed" } } : { data: rows(), error: null });
      const builder = {
        select: () => builder,
        in: () => builder,
        order: () => builder,
        limit: () => builder,
        eq: (k, v) => (filters.push([k, v]), builder),
        then: (res, rej) => Promise.resolve(result()).then(res, rej),
        upsert(list) {
          if (sb.offline) return Promise.resolve({ error: { message: "fetch failed" } });
          sb.upserts.push({ table, rows: structuredClone(list) });
          return Promise.resolve({ error: null });
        },
        update(values) {
          const upd = {
            eq: (k, v) => (filters.push([k, v]), upd),
            then: (res, rej) => {
              if (sb.offline) return Promise.resolve({ error: { message: "fetch failed" } }).then(res, rej);
              for (const r of rows()) Object.assign(r, values);
              return Promise.resolve({ error: null }).then(res, rej);
            },
          };
          return upd;
        },
      };
      return builder;
    },
  };
  return sb;
}

export async function makeAgent({ baseDir, settings = {}, supabase = null, start = true, deps = {} } = {}) {
  const dir = baseDir ?? (await mkdtemp(join(tmpdir(), "fqp-test-")));
  const config = loadConfig({ BASE_DIR: dir, AGENT_PORT: "0", AGENT_SECRET_TOKEN: SECRET, ALLOWED_ORIGINS: ORIGIN });
  config.printTimeoutMs = 400;
  const printerService = deps.printerService ?? fakePrinterService();
  const printDriver = deps.printDriver ?? fakeDriver();
  const converter = deps.converter ?? fakeConverter();
  const agent = await createAgent(config, { log: async () => {}, printerService, printDriver, converter, supabase });
  const { ctx } = agent;

  // Impresoras y reglas como llegarían desde el panel.
  if (!supabase && !ctx.db.get("SELECT 1 AS x FROM printers")) {
    for (const p of Object.values(PRINTERS)) {
      ctx.db.run("INSERT INTO printers (id, name, system_name, is_active, supports_color, supports_duplex, paper_sizes, trays, priority) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
        p.id, p.name, p.system_name, p.is_active, p.supports_color, p.supports_duplex, JSON.stringify(p.paper_sizes), JSON.stringify(p.trays), p.priority);
    }
    for (const r of RULES) {
      ctx.db.run("INSERT INTO rules (id, name, priority, enabled, paper_size, color_mode, duplex, printer_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
        r.id, r.name, r.priority, r.enabled, r.paper_size, r.color_mode, r.duplex, r.printer_id);
    }
  }
  for (const [k, v] of Object.entries({ file_stability_ms: "300", ...settings })) ctx.store.setSetting(k, v);

  const port = start ? await agent.start() : null;
  const token = signToken(SECRET, { sub: "u1", email: "operador@prueba", role: "admin", exp: Math.floor(Date.now() / 1000) + 3600 });

  const api = async (method, path, body, headers = {}) => {
    const res = await fetch(`http://127.0.0.1:${port}${path}`, {
      method,
      headers: { Authorization: `Bearer ${token}`, Origin: ORIGIN, ...(body ? { "Content-Type": "application/json" } : {}), ...headers },
      body: body ? JSON.stringify(body) : undefined,
    });
    const type = res.headers.get("content-type") ?? "";
    return { status: res.status, headers: res.headers, body: type.includes("json") ? await res.json() : Buffer.from(await res.arrayBuffer()) };
  };

  const docs = () => ctx.db.all("SELECT * FROM documents ORDER BY seq");
  const jobs = () => ctx.db.all("SELECT * FROM print_jobs ORDER BY seq");

  return {
    agent, ctx, config, dir, port, token, api, docs, jobs, printerService, printDriver, converter,
    entradas: config.dirs.entradas,
    /** Deja un archivo en la carpeta vigilada, como lo haría WhatsApp Desktop. */
    drop: (name, content) => writeFile(join(config.dirs.entradas, name), content),
    waitReady: (n = 1) => waitFor(() => docs().filter((d) => d.status === "ready").length >= n, { label: `${n} documento(s) listos` }),
    waitJobs: (status, n = 1) => waitFor(() => jobs().filter((j) => j.status === status).length >= n, { label: `${n} trabajo(s) ${status}` }),
    async close({ keep = false } = {}) {
      await agent.stop();
      if (!keep) await rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    },
  };
}
