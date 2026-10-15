/**
 * Consulta de impresoras instaladas en Windows, sus capacidades reales según
 * el driver y el estado de la cola de impresión. Se usa PowerShell con scripts
 * temporales para evitar problemas de escape en la línea de comandos.
 */
import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import pdfToPrinter from "pdf-to-printer";

const OFFLINE_STATUSES = new Set(["Offline", "Error", "NotAvailable", "ServerUnknown", "ServerOffline", "Unknown"]);

function runPs(tempDir, script, timeout = 20000) {
  return new Promise(async (resolve, reject) => {
    const file = join(tempDir, `ps_${randomUUID()}.ps1`);
    try {
      // BOM: sin él PowerShell 5.1 lee mal los nombres de impresora con acentos.
      await writeFile(file, "﻿[Console]::OutputEncoding = [Text.Encoding]::UTF8\r\n" + script, "utf8");
    } catch (err) {
      return reject(err);
    }
    execFile(
      "powershell",
      ["-NoProfile", "-NonInteractive", "-WindowStyle", "Hidden", "-ExecutionPolicy", "Bypass", "-File", file],
      { timeout, windowsHide: true, maxBuffer: 8 * 1024 * 1024 },
      (err, stdout) => {
        unlink(file).catch(() => {});
        if (err) reject(err);
        else resolve(stdout ?? "");
      }
    );
  });
}

const parseJsonList = (text) => {
  const t = text.trim();
  if (!t) return [];
  const v = JSON.parse(t);
  return Array.isArray(v) ? v : [v];
};

const psQuote = (s) => `'${String(s).replace(/'/g, "''")}'`;

export function createPrinterService(ctx) {
  const tempDir = ctx.config.dirs.temporales;
  let statusCache = { at: 0, list: [], ok: false };
  const capsCache = new Map();

  const service = {
    /** Impresoras instaladas y su estado. `maxAgeMs` evita lanzar PowerShell en cada consulta. */
    async list(maxAgeMs = 15000) {
      if (ctx.now() - statusCache.at < maxAgeMs) return statusCache.list;
      try {
        const out = await runPs(tempDir,
          "Get-Printer | Select-Object Name, DriverName, PortName, @{n='Status';e={[string]$_.PrinterStatus}}, WorkOffline | ConvertTo-Json -Compress");
        const list = parseJsonList(out).map((p) => ({
          name: p.Name, driver: p.DriverName, port: p.PortName, status: p.Status,
          offline: !!p.WorkOffline || OFFLINE_STATUSES.has(p.Status),
        }));
        statusCache = { at: ctx.now(), list, ok: true };
      } catch (err) {
        await ctx.log("warn", `No se pudo consultar las impresoras de Windows: ${err.message?.slice(0, 150)}`);
        statusCache = { at: ctx.now(), list: [], ok: false };
      }
      return statusCache.list;
    },

    /** true solo si Windows la reporta instalada y en línea. */
    isAvailableSync(systemName) {
      const p = statusCache.list.find((x) => x.name === systemName);
      return !!p && !p.offline;
    },

    /** Capacidades que declara el driver: dúplex, color, formularios y bandejas. */
    async capabilities(systemName, maxAgeMs = 600000) {
      const hit = capsCache.get(systemName);
      if (hit && ctx.now() - hit.at < maxAgeMs) return hit.caps;
      const script = [
        "Add-Type -AssemblyName System.Drawing",
        "$ps = New-Object System.Drawing.Printing.PrinterSettings",
        `$ps.PrinterName = ${psQuote(systemName)}`,
        "if (-not $ps.IsValid) { '{\"valid\":false}'; exit }",
        "[pscustomobject]@{",
        "  valid = $true; canDuplex = $ps.CanDuplex; supportsColor = $ps.SupportsColor",
        "  paperSizes = @($ps.PaperSizes | ForEach-Object { [pscustomobject]@{ name = $_.PaperName; w = $_.Width; h = $_.Height } })",
        "  bins = @($ps.PaperSources | ForEach-Object { $_.SourceName })",
        "} | ConvertTo-Json -Compress -Depth 4",
      ].join("\r\n");
      let caps;
      try {
        const raw = JSON.parse((await runPs(tempDir, script)).trim());
        caps = raw.valid
          ? { valid: true, canDuplex: !!raw.canDuplex, supportsColor: !!raw.supportsColor, paperSizes: raw.paperSizes ?? [], bins: raw.bins ?? [] }
          : { valid: false };
      } catch (err) {
        await ctx.log("warn", `No se pudieron leer las capacidades de "${systemName}": ${err.message?.slice(0, 150)}`);
        caps = { valid: false };
      }
      capsCache.set(systemName, { at: ctx.now(), caps });
      return caps;
    },

    /** Trabajos presentes en la cola de Windows de una impresora. */
    async spoolerJobs(systemName) {
      const out = await runPs(tempDir,
        `Get-PrintJob -PrinterName ${psQuote(systemName)} | Select-Object Id, DocumentName, @{n='Status';e={[string]$_.JobStatus}} | ConvertTo-Json -Compress`);
      return parseJsonList(out).map((j) => ({ id: j.Id, documentName: j.DocumentName ?? "", status: j.Status ?? "" }));
    },

    invalidate() {
      statusCache.at = 0;
    },
  };
  return service;
}

/** Envío real a la impresora mediante pdf-to-printer (SumatraPDF). */
export function createSumatraDriver() {
  return { name: "sumatra", print: (file, options) => pdfToPrinter.print(file, options) };
}

/** Driver de prueba: registra lo que se habría enviado, sin imprimir. */
export function createDryRunDriver(ctx) {
  return {
    name: "dryrun",
    async print(file, options) {
      await ctx.log("info", `[DRYRUN] No se imprime. Archivo: ${file}`, options);
    },
  };
}
