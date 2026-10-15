/** Ensambla el agente. Las dependencias externas son inyectables para las pruebas. */
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { createApi } from "./api.js";
import { MIN_SECRET_LENGTH } from "./auth.js";
import { createConverter } from "./converter.js";
import { openDb } from "./db.js";
import { createFiles } from "./files.js";
import { createIntake } from "./intake.js";
import { createOrders } from "./orders.js";
import { createPrinterService, createDryRunDriver, createSumatraDriver } from "./printers.js";
import { createProcessor } from "./processor.js";
import { createQueue } from "./queue.js";
import { createRetention } from "./retention.js";
import { createStore } from "./store.js";
import { createSync } from "./sync.js";
import { createBus, createLogger } from "./util.js";

export async function createAgent(config, deps = {}) {
  if (!config.agentSecret || config.agentSecret.length < MIN_SECRET_LENGTH) {
    throw new Error(`AGENT_SECRET_TOKEN es obligatorio y debe tener al menos ${MIN_SECRET_LENGTH} caracteres.`);
  }

  for (const d of [...Object.values(config.dirs), dirname(config.dbFile)]) mkdirSync(d, { recursive: true });

  const ctx = {
    config,
    now: deps.now ?? (() => Date.now()),
    log: deps.log ?? createLogger(config.dirs.logs),
    bus: createBus(),
    libreOfficeFound: false,
  };
  ctx.db = openDb(config.dbFile);
  ctx.store = createStore(ctx);
  ctx.files = createFiles(ctx);
  ctx.converter = deps.converter ?? createConverter(ctx);
  ctx.printerService = deps.printerService ?? createPrinterService(ctx);
  ctx.printDriver = deps.printDriver ?? (config.printDriver === "dryrun" ? createDryRunDriver(ctx) : createSumatraDriver());
  ctx.processor = createProcessor(ctx);
  ctx.orders = createOrders(ctx);
  ctx.queue = createQueue(ctx);
  ctx.retention = createRetention(ctx);
  ctx.sync = createSync(ctx, deps.supabase ?? null);
  ctx.intake = createIntake(ctx, { onQueued: (id) => ctx.processor.enqueue(id) });
  ctx.api = createApi(ctx);

  let started = false;
  return {
    ctx,
    async start() {
      await ctx.files.cleanTemp(); // nada temporal sobrevive a un reinicio
      ctx.libreOfficeFound = !!(await ctx.converter.findLibreOffice?.());
      ctx.queue.recover();
      ctx.processor.recover();
      await ctx.printerService.list(0);
      const port = await ctx.api.listen();
      await ctx.intake.start();
      ctx.queue.start();
      ctx.retention.start();
      ctx.sync.start();
      started = true;
      return port;
    },
    async stop() {
      if (!started) return ctx.db.close();
      await ctx.intake.stop();
      await ctx.queue.stop();
      ctx.retention.stop();
      await ctx.sync.stop();
      await ctx.api.close();
      for (let i = 0; i < 200 && !ctx.processor.idle(); i++) await new Promise((r) => setTimeout(r, 25));
      ctx.db.close();
      started = false;
    },
  };
}
