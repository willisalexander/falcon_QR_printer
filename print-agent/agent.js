/**
 * Falcon QR Printer — Agente local v3
 *
 * Recibe documentos desde la carpeta vigilada, los convierte a PDF, los analiza
 * y los imprime bajo control del operador. Todo el procesamiento documental
 * ocurre en esta computadora; Supabase solo recibe metadatos administrativos.
 *
 * El flujo QR anterior (src/legacy-qr.js) queda aislado y apagado por defecto.
 */
import "dotenv/config";
import { createClient } from "@supabase/supabase-js";
import { createAgent } from "./src/app.js";
import { loadConfig } from "./src/config.js";

const config = loadConfig();

const supabase = config.supabaseUrl && config.supabaseServiceKey
  ? createClient(config.supabaseUrl, config.supabaseServiceKey, { auth: { persistSession: false } })
  : null;

let agent, legacy = null;

async function main() {
  agent = await createAgent(config, { supabase });
  const { log } = agent.ctx;
  const sep = "═".repeat(60);
  await log("info", sep);
  await log("info", "Falcon QR Printer — Agente local v3 (recepción por carpeta)");

  let port;
  try {
    port = await agent.start();
  } catch (err) {
    if (err?.code === "EADDRINUSE") {
      // El puerto ocupado es el candado de instancia única: dos agentes imprimirían doble.
      await log("error", `Ya hay un agente ejecutándose (puerto ${config.apiPort} en uso). Esta instancia se cierra.`);
      process.exit(1);
    }
    throw err;
  }

  await log("info", `Carpeta vigilada : ${config.dirs.entradas}`);
  await log("info", `Almacenamiento   : ${config.baseDir}`);
  await log("info", `Servicio local   : http://127.0.0.1:${port} (orígenes: ${config.allowedOrigins.join(", ")})`);
  await log("info", `Modo de impresión: ${agent.ctx.store.setting("print_mode")}  |  Driver: ${agent.ctx.printDriver.name}`);
  await log(supabase ? "info" : "warn", supabase
    ? `Supabase (solo metadatos): ${config.supabaseUrl}`
    : "Supabase no configurado: el agente funciona solo en local, sin impresoras ni reglas del panel.");
  await log(agent.ctx.libreOfficeFound ? "success" : "warn", agent.ctx.libreOfficeFound
    ? "LibreOffice encontrado"
    : "LibreOffice NO encontrado — los documentos Word quedarán en error hasta instalarlo");
  await log("info", sep);

  if (config.legacyQrEnabled) {
    legacy = await import("./src/legacy-qr.js");
    await legacy.startLegacyQr();
  }
}

let closing = false;
async function shutdown(signal) {
  if (closing) return;
  closing = true;
  await agent?.ctx.log("info", `Señal ${signal} recibida. Finalizando agente…`);
  await legacy?.stopLegacyQr().catch(() => {});
  await agent?.stop().catch(() => {});
  process.exit(0);
}
process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));
// PM2 en Windows no entrega SIGINT: pide el cierre con un mensaje.
process.on("message", (msg) => {
  if (msg === "shutdown") void shutdown("shutdown");
});

main().catch((err) => {
  console.error("❌ Error fatal al iniciar el agente:", err?.message ?? err);
  process.exit(1);
});
