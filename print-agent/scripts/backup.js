/**
 * Respaldo de la configuración y del registro local del agente.
 * Copia consistente de la base SQLite (aunque el agente esté en ejecución) y del .env.
 * NO copia documentos de clientes.
 *
 * Uso:  npm run backup            → C:\ElArrecife\Respaldos\<fecha>\
 *       npm run backup -- D:\USB  → carpeta de destino indicada
 */
import "dotenv/config";
import { existsSync } from "node:fs";
import { copyFile, mkdir, readdir, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { loadConfig } from "../src/config.js";

const KEEP = 14; // respaldos que se conservan en la carpeta por defecto

const config = loadConfig();
const stamp = new Date().toISOString().replace(/[:T]/g, "-").slice(0, 19);
const custom = process.argv[2];
const destDir = join(custom ? resolve(custom) : config.dirs.respaldos, `respaldo-${stamp}`);

if (!existsSync(config.dbFile)) {
  console.error(`No existe la base local: ${config.dbFile}`);
  process.exit(1);
}

await mkdir(destDir, { recursive: true });

const db = new DatabaseSync(config.dbFile);
db.exec("PRAGMA busy_timeout=10000");
db.prepare("VACUUM INTO ?").run(join(destDir, "agente.db"));
db.close();

const envFile = resolve(".env");
if (existsSync(envFile)) await copyFile(envFile, join(destDir, "agente.env"));

console.log(`Respaldo creado en: ${destDir}`);
console.log("Contiene claves de acceso (agente.env): guárdelo en un lugar seguro.");

if (!custom) {
  const all = (await readdir(config.dirs.respaldos)).filter((n) => n.startsWith("respaldo-")).sort();
  for (const old of all.slice(0, Math.max(0, all.length - KEEP))) {
    await rm(join(config.dirs.respaldos, old), { recursive: true, force: true });
  }
}
