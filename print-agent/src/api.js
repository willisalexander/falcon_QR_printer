/**
 * Servicio local para el panel administrativo.
 *  - Escucha únicamente en 127.0.0.1.
 *  - Exige credencial firmada y origen permitido en cada solicitud.
 *  - Los documentos se piden por identificador; nunca se acepta una ruta.
 */
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { createServer } from "node:http";
import { verifyToken } from "./auth.js";
import { findDriverForm, PAPER_KEYS } from "./paper.js";
import { RequestError, UUID_RE } from "./util.js";

const MAX_BODY = 256 * 1024;
const LONG_POLL_MS = 25000;

function readJson(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on("data", (c) => {
      size += c.length;
      if (size > MAX_BODY) {
        reject(new RequestError("Solicitud demasiado grande.", 413));
        req.destroy();
      } else chunks.push(c);
    });
    req.on("end", () => {
      if (chunks.length === 0) return resolve({});
      try {
        const v = JSON.parse(Buffer.concat(chunks).toString("utf8"));
        if (!v || typeof v !== "object" || Array.isArray(v)) throw new Error();
        resolve(v);
      } catch {
        reject(new RequestError("JSON inválido."));
      }
    });
    req.on("error", reject);
  });
}

export function createApi(ctx) {
  const { config, bus, store, orders, files } = ctx;
  const allowedHosts = new Set([`127.0.0.1:${config.apiPort}`, `localhost:${config.apiPort}`]);
  const routes = [];
  const waiters = new Set();

  const route = (method, path, handler, opts = {}) => {
    const keys = [];
    const re = new RegExp("^" + path.replace(/:(\w+)/g, (_, k) => (keys.push(k), "([0-9a-fA-F-]{36})")) + "$");
    routes.push({ method, re, keys, handler, admin: !!opts.admin });
  };

  const agentStatus = () => ({
    version: bus.version,
    intake: ctx.intake.status(),
    processing: ctx.processor.stats(),
    sync: ctx.sync.status(),
    libreOffice: ctx.libreOfficeFound,
    printDriver: ctx.printDriver.name,
    retentionDays: store.settingInt("retention_days", 1),
    settings: store.allSettings(),
    watchFolder: config.dirs.entradas,
  });

  // ── Rutas ──────────────────────────────────────────────────
  route("GET", "/api/state", () => ({ ...orders.state(), agent: agentStatus() }));

  route("GET", "/api/changes", (_req, { query, res }) =>
    new Promise((resolve) => {
      const since = parseInt(query.get("since") ?? "0", 10) || 0;
      if (bus.version > since) return resolve({ version: bus.version });
      const done = () => {
        clearTimeout(timer);
        bus.off("change", done);
        waiters.delete(done);
        resolve({ version: bus.version });
      };
      const timer = setTimeout(done, LONG_POLL_MS);
      bus.on("change", done);
      waiters.add(done);
      res.on("close", done); // el panel cerró la pestaña
    }));

  route("GET", "/api/documents/:id", (_req, { params }) => orders.documentDetail(params.id));

  route("GET", "/api/documents/:id/pdf", async (_req, { params, res }) => {
    const doc = orders.getDoc(params.id);
    const pdf = doc && doc.status === "ready" ? files.findPdf(doc) : null;
    if (!pdf) throw new RequestError("El PDF no está disponible en esta computadora.", 404);
    const st = await stat(pdf);
    res.writeHead(200, {
      "Content-Type": "application/pdf",
      "Content-Length": st.size,
      "Content-Disposition": "inline",
      "Cache-Control": "no-store",
    });
    createReadStream(pdf).pipe(res);
    return undefined; // respuesta ya enviada
  });

  route("POST", "/api/documents/update", (_r, { body, actor }) => (orders.updateDocuments(body.ids, body.patch, actor), { ok: true }));
  route("POST", "/api/documents/assign", (_r, { body, actor }) => orders.assign(body, actor));
  route("POST", "/api/documents/unassign", (_r, { body, actor }) => (orders.unassign(body.ids, actor), { ok: true }));
  route("POST", "/api/documents/authorize", (_r, { body, actor }) => ({ results: orders.authorize({ ids: body.ids }, actor) }));
  route("POST", "/api/documents/discard", (_r, { body, actor }) => (orders.discard(body.ids, actor), { ok: true }));
  route("POST", "/api/documents/:id/retry", (_r, { params, actor }) => (orders.retryDocument(params.id, actor), { ok: true }));
  // Sin cobro: corrección dentro del pedido original. Con cobro: pedido nuevo para otro cliente.
  route("POST", "/api/documents/:id/reprint", (_r, { params, body, actor }) => {
    const { charge, customerName, ...overrides } = body;
    return charge
      ? orders.reprintAsNewOrder(params.id, overrides, customerName, actor)
      : orders.reprint(params.id, overrides, actor);
  });

  route("GET", "/api/customers", (_r, { query }) => ({ customers: orders.searchCustomers(query.get("q") ?? "") }));

  route("POST", "/api/orders/:id/update", (_r, { params, body, actor }) => (orders.updateOrder(params.id, body, actor), { ok: true }));
  route("POST", "/api/orders/:id/authorize", (_r, { params, actor }) => ({ results: orders.authorize({ orderId: params.id }, actor) }));
  route("POST", "/api/orders/:id/finish", async (_r, { params, actor }) => (await orders.finishOrder(params.id, actor), { ok: true }));
  route("POST", "/api/orders/:id/cancel", (_r, { params, actor }) => (orders.cancelOrder(params.id, actor), { ok: true }));

  route("POST", "/api/jobs/:id/cancel", (_r, { params, actor }) => (orders.cancelJob(params.id, actor), { ok: true }));
  route("POST", "/api/jobs/:id/confirm", (_r, { params, actor }) => (orders.confirmJob(params.id, actor), { ok: true }));
  route("POST", "/api/jobs/:id/not-printed", (_r, { params, actor }) => (orders.markNotPrinted(params.id, actor), { ok: true }));
  route("POST", "/api/jobs/:id/resend", (_r, { params, actor }) => orders.resendJob(params.id, actor));
  route("POST", "/api/jobs/:id/priority", (_r, { params, body, actor }) => (orders.setJobPriority(params.id, body.priority, actor), { ok: true }));

  route("GET", "/api/history/orders", (_r, { query }) => ({ orders: orders.history({ q: query.get("q") ?? "", offset: query.get("offset") ?? 0 }) }));
  route("GET", "/api/history/audit", (_r, { query }) => ({ entries: orders.auditLog(query.get("offset") ?? 0) }));
  route("GET", "/api/history/errors", () => orders.errors());
  route("GET", "/api/history/deletions", () => ({ deletions: orders.deletions() }));
  route("GET", "/api/metrics", () => orders.metrics());

  // Impresoras instaladas en Windows y lo que su driver declara (para el formulario de impresoras).
  route("GET", "/api/printers/system", async (_r, { query }) => {
    const list = await ctx.printerService.list(0);
    const name = query.get("name");
    if (!name) return { printers: list };
    if (!list.some((p) => p.name === name)) throw new RequestError("Esa impresora no está instalada en Windows.", 404);
    const caps = await ctx.printerService.capabilities(name, 0);
    return {
      printer: list.find((p) => p.name === name),
      capabilities: caps,
      detectedPaperSizes: caps.valid ? PAPER_KEYS.filter((k) => findDriverForm(k, caps.paperSizes)) : [],
    };
  });

  // Apagar el modo automático debe funcionar al instante y sin internet: cualquier
  // miembro del personal puede volver a supervisado; activarlo es solo para administradores.
  route("POST", "/api/print-mode", (_r, { body, actor, role }) => {
    if (!["supervised", "auto"].includes(body.mode)) throw new RequestError("Modo inválido.");
    if (body.mode === "auto" && role !== "admin") throw new RequestError("Solo un administrador puede activar el modo automático.", 403);
    store.setSetting("print_mode", body.mode, { local: true });
    store.audit(actor, "print_mode_changed", "setting", "print_mode", { mode: body.mode });
    bus.touch();
    ctx.queue.kick();
    return { mode: body.mode };
  });

  route("POST", "/api/config/refresh", async () => {
    const s = await ctx.sync.cycle({ forcePull: true });
    ctx.printerService.invalidate();
    return { sync: s };
  });

  route("POST", "/api/retention/run", () => ctx.retention.run(), { admin: true });

  // ── Servidor ───────────────────────────────────────────────
  async function handle(req, res) {
    const origin = req.headers.origin;
    const originOk = !origin || config.allowedOrigins.includes(origin);
    const cors = origin && originOk
      ? {
          "Access-Control-Allow-Origin": origin,
          "Vary": "Origin",
          "Access-Control-Allow-Headers": "Authorization, Content-Type",
          "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
          "Access-Control-Allow-Private-Network": "true",
          "Access-Control-Max-Age": "600",
        }
      : {};
    const send = (status, payload) => {
      if (res.headersSent) return;
      res.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff", ...cors });
      res.end(JSON.stringify(payload));
    };

    try {
      // Anti DNS-rebinding: solo se atiende si el navegador cree estar hablando con localhost.
      if (!allowedHosts.has(req.headers.host ?? "")) return send(403, { error: "Host no permitido." });
      if (!originOk) return send(403, { error: "Origen no permitido." });
      if (req.method === "OPTIONS") {
        res.writeHead(204, cors);
        return res.end();
      }

      const url = new URL(req.url, "http://127.0.0.1");
      if (req.method === "GET" && url.pathname === "/api/health") return send(200, { ok: true, service: "falcon-print-agent" });

      const auth = req.headers.authorization ?? "";
      const session = verifyToken(config.agentSecret, auth.startsWith("Bearer ") ? auth.slice(7) : "", ctx.now());
      if (!session) return send(401, { error: "Sesión del agente inválida o vencida." });

      for (const r of routes) {
        if (r.method !== req.method) continue;
        const m = r.re.exec(url.pathname);
        if (!m) continue;
        if (r.admin && session.role !== "admin") return send(403, { error: "Se requieren permisos de administrador." });
        const params = Object.fromEntries(r.keys.map((k, i) => [k, m[i + 1].toLowerCase()]));
        if (!Object.values(params).every((v) => UUID_RE.test(v))) return send(400, { error: "Identificador inválido." });
        const body = req.method === "POST" ? await readJson(req) : {};
        Object.keys(cors).forEach((k) => res.setHeader(k, cors[k]));
        const out = await r.handler(req, {
          params, body, res, query: url.searchParams,
          actor: session.email ?? session.sub ?? "operador", role: session.role,
        });
        if (out !== undefined) send(200, out);
        return;
      }
      send(404, { error: "Ruta no encontrada." });
    } catch (err) {
      if (err instanceof RequestError) return send(err.status, { error: err.message, ...(err.extra ?? {}) });
      await ctx.log("error", `API ${req.method} ${req.url}`, { message: err?.message });
      send(500, { error: "Error interno del agente." });
    }
  }

  const server = createServer((req, res) => void handle(req, res));
  server.requestTimeout = 60000;

  return {
    listen: () =>
      new Promise((resolve, reject) => {
        server.once("error", reject);
        server.listen(config.apiPort, config.apiHost, () => {
          config.apiPort = server.address().port; // puerto real cuando se pidió 0 (pruebas)
          allowedHosts.add(`127.0.0.1:${config.apiPort}`).add(`localhost:${config.apiPort}`);
          resolve(config.apiPort);
        });
      }),
    close: () =>
      new Promise((resolve) => {
        for (const done of [...waiters]) done();
        server.close(() => resolve());
        server.closeAllConnections?.();
      }),
  };
}
