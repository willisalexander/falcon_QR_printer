import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { rename, copyFile, unlink, appendFile } from "node:fs/promises";
import { resolve, relative, isAbsolute, join, sep } from "node:path";
import { EventEmitter } from "node:events";

export const nowIso = () => new Date().toISOString();
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Error con código estable para mostrar en el panel. */
export class DocError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

/** Error de validación de una solicitud del panel (HTTP 400/409). */
export class RequestError extends Error {
  constructor(message, status = 400, extra = undefined) {
    super(message);
    this.status = status;
    this.extra = extra;
  }
}

/** true si `target` está estrictamente dentro de `root`. */
export function isInside(root, target) {
  const rel = relative(resolve(root), resolve(target));
  return !!rel && !rel.startsWith("..") && !isAbsolute(rel);
}

export const toRel = (baseDir, abs) => relative(baseDir, abs).split(sep).join("/");
export const toAbs = (baseDir, rel) => join(baseDir, ...String(rel).split("/"));

export async function moveFile(src, dest) {
  try {
    await rename(src, dest);
  } catch (err) {
    if (err.code !== "EXDEV") throw err;
    await copyFile(src, dest);
    await unlink(src);
  }
}

export function sha256File(path) {
  return new Promise((res, rej) => {
    const hash = createHash("sha256");
    createReadStream(path)
      .on("data", (d) => hash.update(d))
      .on("error", rej)
      .on("end", () => res(hash.digest("hex")));
  });
}

/** Bus de cambios: el panel hace long-polling sobre `version`. */
export function createBus() {
  const bus = new EventEmitter();
  bus.setMaxListeners(100);
  bus.version = 1;
  bus.touch = () => {
    bus.version += 1;
    bus.emit("change", bus.version);
  };
  return bus;
}

const ICONS = { info: "ℹ️ ", warn: "⚠️ ", error: "❌", success: "✅" };

export function gtTimestamp(date = new Date()) {
  // Guatemala es UTC-6 sin horario de verano
  return new Intl.DateTimeFormat("sv-SE", {
    timeZone: "America/Guatemala",
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit",
    hour12: false,
  }).format(date).replace("T", " ");
}

export function createLogger(logDir, { silent = false } = {}) {
  return async function log(level, message, data) {
    const ts = gtTimestamp();
    const line = `[${ts} GT] ${ICONS[level] ?? " •"} ${message}${data ? "  " + JSON.stringify(data) : ""}`;
    if (!silent) console.log(line);
    if (logDir) await appendFile(join(logDir, `agent-${ts.slice(0, 10)}.log`), line + "\n").catch(() => {});
  };
}
