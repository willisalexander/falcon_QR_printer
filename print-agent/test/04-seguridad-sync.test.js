import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { signToken, verifyToken } from "../src/auth.js";
import { createConverter } from "../src/converter.js";
import { fakeSupabase, makeAgent, makePdf, ORIGIN, SECRET, sleep, waitFor } from "./helpers.js";

const here = dirname(fileURLToPath(import.meta.url));
const agentDir = join(here, "..");

test("servicio local: exige credencial, origen permitido y host local", async () => {
  const t = await makeAgent();
  try {
    assert.equal((await t.api("GET", "/api/state", null, { Authorization: "" })).status, 401);
    assert.equal((await t.api("GET", "/api/state", null, { Authorization: "Bearer falso.falso" })).status, 401);
    const expired = signToken(SECRET, { sub: "u", role: "admin", exp: Math.floor(Date.now() / 1000) - 10 });
    assert.equal((await t.api("GET", "/api/state", null, { Authorization: `Bearer ${expired}` })).status, 401);
    const forged = signToken("otro-secreto-distinto-de-mas-de-32-caracteres", { sub: "u", role: "admin", exp: Math.floor(Date.now() / 1000) + 100 });
    assert.equal((await t.api("GET", "/api/state", null, { Authorization: `Bearer ${forged}` })).status, 401);
    assert.equal((await t.api("GET", "/api/state", null, { Origin: "https://sitio-malicioso.example" })).status, 403);
    // fetch no permite falsificar Host: se usa http directamente.
    const { request } = await import("node:http");
    const rebind = await new Promise((resolve, reject) => {
      request({ host: "127.0.0.1", port: t.port, path: "/api/state", headers: { Host: "atacante.example", Authorization: `Bearer ${t.token}` } },
        (res) => { res.resume(); resolve(res.statusCode); }).on("error", reject).end();
    });
    assert.equal(rebind, 403, "anti DNS-rebinding");
    assert.equal(t.config.apiHost, "127.0.0.1");

    const ok = await t.api("GET", "/api/state");
    assert.equal(ok.status, 200);
    assert.equal(ok.headers.get("access-control-allow-origin"), ORIGIN);
    // Un operador puede apagar el modo automático, pero no encenderlo.
    const op = signToken(SECRET, { sub: "u2", email: "op@prueba", role: "operator", exp: Math.floor(Date.now() / 1000) + 100 });
    assert.equal((await t.api("POST", "/api/print-mode", { mode: "auto" }, { Authorization: `Bearer ${op}` })).status, 403);
    assert.equal((await t.api("POST", "/api/print-mode", { mode: "supervised" }, { Authorization: `Bearer ${op}` })).status, 200);
    assert.equal(verifyToken("corto", op), null);
  } finally {
    await t.close();
  }
});

test("servicio local: documentos solo por identificador, sin rutas ni recorrido de carpetas", async () => {
  const t = await makeAgent();
  try {
    await t.drop("privado.pdf", await makePdf(["carta"]));
    await t.waitReady(1);
    const [doc] = t.docs();
    for (const bad of ["..%2F..%2FDatos%2Fagente.db", "C:%5CWindows%5Cwin.ini", `${doc.id}%2F..%2F..`, "no-es-uuid"]) {
      const r = await t.api("GET", `/api/documents/${bad}/pdf`);
      assert.ok([400, 404].includes(r.status), `ruta aceptada: ${bad}`);
    }
    assert.equal((await t.api("POST", "/api/documents/update", { ids: ["../../x"], patch: { copies: 1 } })).status, 400);
    assert.equal((await t.api("GET", `/api/documents/${doc.id}/pdf`)).status, 200);
    // El panel nunca recibe rutas del disco.
    const state = JSON.stringify((await t.api("GET", "/api/state")).body.documents);
    assert.ok(!state.includes("Originales") && !state.includes("original_file") && !state.includes("source_path"));
    // Aviso de cambios sin recargar: la espera larga responde en cuanto llega un archivo.
    const version = (await t.api("GET", "/api/state")).body.agent.version;
    const pending = t.api("GET", `/api/changes?since=${version}`);
    await t.drop("nuevo.pdf", await makePdf(["legal"]));
    assert.ok((await pending).body.version > version);
  } finally {
    await t.close();
  }
});

test("sincronización: solo metadatos, nunca Storage, rutas ni contenido", async () => {
  const sb = fakeSupabase();
  const t = await makeAgent({ supabase: sb });
  try {
    await waitFor(() => t.ctx.orders.loadPrinters().length === 3, { label: "impresoras y reglas bajan del panel" });
    assert.equal(t.ctx.db.all("SELECT * FROM rules").length, 4);
    await t.drop("contrato confidencial.pdf", await makePdf(["carta"]));
    await t.waitReady(1);
    const [doc] = t.docs();
    const { body } = await t.api("POST", "/api/documents/assign", { ids: [doc.id], customerName: "Cliente Sync" });
    await t.api("POST", "/api/documents/update", { ids: [doc.id], patch: { copies: 1, color_mode: "bw", duplex: "simplex" } });
    await t.api("POST", "/api/documents/authorize", { ids: [doc.id] });
    await t.waitJobs("sent", 1);
    await t.api("POST", `/api/orders/${body.orderId}/finish`);
    await t.ctx.sync.cycle();

    const tables = new Set(sb.upserts.map((u) => u.table));
    for (const table of ["customers", "reception_orders", "reception_documents", "reception_print_jobs", "reception_print_attempts", "audit_logs"]) {
      assert.ok(tables.has(table), `no se sincronizó ${table}`);
    }
    const sent = JSON.stringify(sb.upserts);
    for (const leak of [t.dir.replace(/\\/g, "\\\\"), "Originales/", "Completados/", "original.pdf", "document.pdf", "%PDF"]) {
      assert.ok(!sent.includes(leak), `se filtró "${leak}" a Supabase`);
    }
    const row = sb.upserts.filter((u) => u.table === "reception_documents").at(-1).rows.find((r) => r.id === doc.id);
    assert.equal(row.original_file_name, "contrato confidencial.pdf");
    assert.equal(row.source, "folder");
    assert.equal(row.page_count, 1);
    assert.ok(sb.upserts.filter((u) => u.table === "reception_orders").at(-1).rows[0].purge_after, "fecha prevista de eliminación");
    assert.equal(t.ctx.sync.status().pending, 0);
  } finally {
    await t.close();
  }
});

test("caída de internet: el trabajo continúa en local y los metadatos se suben al reconectar", async () => {
  const sb = fakeSupabase();
  const t = await makeAgent({ supabase: sb });
  try {
    await waitFor(() => t.ctx.orders.loadPrinters().length === 3, { label: "configuración inicial" });
    await waitFor(() => t.ctx.sync.status().online === true);
    sb.offline = true;
    const before = sb.upserts.length;
    await t.drop("sin-internet.pdf", await makePdf(["carta"]));
    await t.waitReady(1);
    const [doc] = t.docs();
    await t.api("POST", "/api/documents/assign", { ids: [doc.id], customerName: "Offline" });
    await t.api("POST", "/api/documents/update", { ids: [doc.id], patch: { copies: 1, color_mode: "bw", duplex: "simplex" } });
    await t.api("POST", "/api/documents/authorize", { ids: [doc.id] });
    await t.waitJobs("sent", 1);
    assert.equal(t.printDriver.calls.length, 1, "se imprime sin internet con la configuración en caché");
    // Apagar el modo automático sin internet se aplica y queda pendiente de subir.
    await t.api("POST", "/api/print-mode", { mode: "auto" });
    const s = await t.ctx.sync.cycle({ forcePull: true });
    assert.equal(s.online, false);
    assert.ok(s.pending > 0);
    assert.equal(sb.upserts.length, before);

    sb.offline = false;
    sb.tables.settings = [{ key: "print_mode", value: "supervised" }]; // valor viejo en la nube
    const s2 = await t.ctx.sync.cycle({ forcePull: true });
    assert.equal(s2.online, true);
    assert.equal(s2.pending, 0);
    assert.equal(t.ctx.store.setting("print_mode"), "auto", "el cambio local no se pisa con el valor viejo");
    assert.deepEqual(sb.upserts.find((u) => u.table === "settings").rows, [{ key: "print_mode", value: "auto" }]);
    assert.ok(sb.upserts.some((u) => u.table === "reception_print_jobs"));
  } finally {
    await t.close();
  }
});

test("el flujo local no contiene ninguna llamada a Supabase Storage", () => {
  const src = join(agentDir, "src");
  for (const file of readdirSync(src).filter((f) => f.endsWith(".js") && f !== "legacy-qr.js")) {
    const code = readFileSync(join(src, file), "utf8").replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, "");
    assert.ok(!/\.storage\b|createSignedUrl|\.upload\(|\.download\(/.test(code), `${file} usa Storage`);
  }
  assert.ok(!/legacy-qr/.test(readFileSync(join(src, "app.js"), "utf8")), "el flujo heredado no forma parte del agente local");
});

test("flujo QR heredado: intacto, aislado y apagado por defecto", async () => {
  execFileSync(process.execPath, ["--check", join(agentDir, "src", "legacy-qr.js")]);
  execFileSync(process.execPath, ["--check", join(agentDir, "agent.js")]);
  const legacy = readFileSync(join(agentDir, "src", "legacy-qr.js"), "utf8");
  for (const fn of ["claimNextJob", "recoverStuckJobs", "convertToPdfWithLibreOffice", "arrangeSlidesPerPage", "resizePdfToTarget", "processWithRetry", 'from("print-files")']) {
    assert.ok(legacy.includes(fn), `falta ${fn} en el flujo heredado`);
  }
  const entry = readFileSync(join(agentDir, "agent.js"), "utf8");
  assert.match(entry, /if \(config\.legacyQrEnabled\)/);
  const { loadConfig } = await import("../src/config.js");
  assert.equal(loadConfig({}).legacyQrEnabled, false);
  assert.equal(loadConfig({ LEGACY_QR_ENABLED: "true" }).legacyQrEnabled, true);
});

test("LibreOffice real: conversión DOCX/DOC a PDF (se omite si no está instalado)", async (ctx) => {
  const { mkdtemp, rm, writeFile } = await import("node:fs/promises");
  const { tmpdir } = await import("node:os");
  const dir = await mkdtemp(join(tmpdir(), "fqp-lo-"));
  const conv = createConverter({ config: { libreOfficePath: process.env.LIBREOFFICE_PATH ?? "", dirs: { temporales: dir } } });
  if (!(await conv.findLibreOffice())) {
    await rm(dir, { recursive: true, force: true });
    return ctx.skip("LibreOffice no está instalado en este equipo: pendiente de validar en la computadora del negocio");
  }
  try {
    const { analyzePdf } = await import("../src/analyzer.js");
    const { makeDocx } = await import("./helpers.js");
    const cases = [
      ["original.docx", makeDocx()],
      // Caso real frecuente: un ".doc" que por dentro es RTF.
      ["original.doc", "{\\rtf1\\ansi Documento de prueba de El Arrecife.\\par}"],
    ];
    for (const [name, content] of cases) {
      const input = join(dir, name);
      await writeFile(input, content);
      const out = await conv.convert(input, { timeoutMs: 180000 });
      const a = await analyzePdf(out.pdf);
      assert.equal(a.pageCount, 1, name);
      assert.equal(a.sizeClass === "carta" || a.sizeClass === "a4", true, `${name}: tamaño ${a.sizeClass}`);
      await out.cleanup();
    }
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("a distancia: Entregado y Cancelar pedidos desde otra computadora, sin mover documentos", async () => {
  const sb = fakeSupabase();
  sb.tables.reception_commands = [];
  const t = await makeAgent({ supabase: sb });
  try {
    await waitFor(() => t.ctx.orders.loadPrinters().length === 3);
    const mk = async (name) => {
      const before = t.docs().length;
      await t.drop(`${name}.pdf`, await makePdf(["carta"]));
      await waitFor(() => t.docs().filter((d) => d.status === "ready").length > before);
      const id = t.docs().at(-1).id;
      const { body } = await t.api("POST", "/api/documents/assign", { ids: [id], customerName: name });
      await t.api("POST", "/api/documents/update", { ids: [id], patch: { copies: 1, color_mode: "bw", duplex: "simplex" } });
      return { id, orderId: body.orderId };
    };
    const a = await mk("Entrega remota");
    await t.api("POST", "/api/documents/authorize", { ids: [a.id] });
    await t.waitJobs("sent", 1);
    const b = await mk("Cancelado remoto");
    const c = await mk("Con cola");
    t.printerService.offline.add("HP Carta");
    await t.api("POST", "/api/documents/authorize", { ids: [c.id] });

    const asked = new Date(Date.now() - 3 * 3600000).toISOString(); // pedido hace 3 h con la PC apagada
    const cmd = (id, order_id, action) => ({ id, order_id, action, requested_at: asked, requested_by_email: "caja@prueba", status: "pending" });
    sb.tables.reception_commands.push(
      cmd("c1", a.orderId, "finish"),
      cmd("c2", b.orderId, "cancel"),
      cmd("c3", c.orderId, "finish"),
      cmd("c4", "99999999-0000-4000-8000-000000000000", "finish"),
    );
    await t.ctx.sync.cycle();
    const by = Object.fromEntries(sb.tables.reception_commands.map((r) => [r.id, r]));
    assert.equal(by.c1.status, "done");
    assert.equal(by.c2.status, "done");
    assert.equal(by.c3.status, "rejected");
    assert.match(by.c3.result_message, /trabajos en cola/);
    assert.equal(by.c4.status, "rejected");

    const order = (id) => t.ctx.db.get("SELECT * FROM orders WHERE id = ?", id);
    assert.equal(order(a.orderId).status, "finished");
    assert.equal(order(a.orderId).finished_at, asked, "el ingreso cuenta en el momento en que se pidió");
    assert.equal(t.jobs().find((j) => j.document_id === a.id).status, "printed");
    assert.equal(order(b.orderId).status, "cancelled");
    assert.equal(order(c.orderId).status, "open", "no se fuerza si hay trabajos en cola");
    const audit = t.ctx.db.get("SELECT actor FROM audit WHERE action = 'order_finished'");
    assert.equal(audit.actor, "caja@prueba (a distancia)");

    // Repetida o ya aplicada: no hace nada dos veces.
    sb.tables.reception_commands.push(cmd("c5", a.orderId, "finish"), cmd("c6", a.orderId, "cancel"));
    await t.ctx.sync.cycle();
    const again = Object.fromEntries(sb.tables.reception_commands.map((r) => [r.id, r]));
    assert.deepEqual([again.c5.status, again.c5.result_message], ["done", "Ya estaba aplicado."]);
    assert.equal(again.c6.status, "rejected");
    assert.equal(order(a.orderId).status, "finished");
    // Nunca se envió un documento a Supabase.
    assert.ok(!JSON.stringify(sb.upserts).includes("%PDF"));
  } finally {
    await t.close();
  }
});
