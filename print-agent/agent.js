/**
 * Print QR System — Agente Local de Impresión v2.2
 *
 * Soporta PDF, Word (.doc/.docx) y PowerPoint (.ppt/.pptx).
 * Para DOCX/PPTX se usa LibreOffice para convertir a PDF antes de imprimir.
 * Para PPTX con múltiples diapositivas por hoja se usa pdf-lib para el layout.
 */

import "dotenv/config";
import { createClient } from "@supabase/supabase-js";
import pdfToPrinter from "pdf-to-printer";
const { print, getPrinters } = pdfToPrinter;
import { writeFile, mkdir, unlink, readFile, appendFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join, extname, basename } from "node:path";
import { exec, spawn } from "node:child_process";
import { promisify } from "node:util";
import { PDFDocument } from "pdf-lib";

const execAsync = promisify(exec);

// Ejecuta un proceso con stdin cerrado (evita prompts interactivos) y sin ventana
function spawnAsync(cmd, args, { timeout = 60000 } = {}) {
  return new Promise((resolve, reject) => {
    const proc = spawn(cmd, args, { stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
    let stdout = "", stderr = "";
    proc.stdout?.on("data", (d) => { stdout += d; });
    proc.stderr?.on("data", (d) => { stderr += d; });
    const timer = setTimeout(() => { proc.kill(); reject(new Error("Timeout")); }, timeout);
    proc.on("close", (code) => {
      clearTimeout(timer);
      if (code !== 0) reject(new Error(stderr.trim() || `Proceso terminó con código ${code}`));
      else resolve({ stdout, stderr });
    });
    proc.on("error", reject);
  });
}

// ── Configuración ────────────────────────────────────────────

const SUPABASE_URL      = process.env.SUPABASE_URL;
const SERVICE_KEY       = process.env.SUPABASE_SERVICE_ROLE_KEY;
const POLL_INTERVAL_MS  = parseInt(process.env.POLLING_INTERVAL_MS  ?? "5000");
const TEMP_DIR          = process.env.TEMP_DIR           ?? "./tmp";
const LOG_DIR           = process.env.LOG_DIR            ?? "./logs";
const MAX_RETRIES       = parseInt(process.env.MAX_RETRIES       ?? "3");
const STUCK_TIMEOUT_MIN = parseInt(process.env.STUCK_TIMEOUT_MIN ?? "10");

// Mapa clave DB ("carta"/"oficio2") → bandeja configurada en el .env
// Si el valor está vacío se omite el parámetro y el driver decide automáticamente.
const PAPER_TRAY_MAP = {
  "carta":   process.env.TRAY_CARTA   ?? "",
  "oficio2": process.env.TRAY_OFICIO2 ?? "",
  "legal":   process.env.TRAY_LEGAL   ?? "",
};

// Dimensiones en puntos PostScript y nombre de formulario Windows por clave DB
const PAPER_META = {
  carta:   { w: 612, h: 792,  formName: "Letter"    },
  oficio2: { w: 612, h: 936,  formName: "Oficio II" },
  legal:   { w: 612, h: 1008, formName: "Legal"     },
};

// ── Consultar bandejas y tamaños de papel disponibles en la impresora ──
// Escribe un .ps1 temporal para evitar problemas de escape en la línea de comandos.

async function runPsScript(scriptContent, timeout = 10000) {
  const { resolve: res } = await import("node:path");
  const scriptPath = res(TEMP_DIR, `ps_query_${Date.now()}.ps1`);
  try {
    await writeFile(scriptPath, scriptContent, "utf8");
    const { stdout, stderr } = await execAsync(
      `powershell -NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File "${scriptPath}"`,
      { timeout, windowsHide: true }
    );
    return { stdout: stdout ?? "", stderr: stderr ?? "" };
  } finally {
    await unlink(scriptPath).catch(() => {});
  }
}

async function queryPrinterBins(printerName) {
  const safe = printerName.replace(/'/g, "''");
  const script = [
    "Add-Type -AssemblyName System.Drawing",
    `$ps = New-Object System.Drawing.Printing.PrinterSettings`,
    `$ps.PrinterName = '${safe}'`,
    "$ps.PaperSources | ForEach-Object { Write-Output $_.SourceName }",
  ].join("\r\n");

  try {
    const { stdout, stderr } = await runPsScript(script);
    if (stderr.trim()) await log("warn", `  queryPrinterBins: ${stderr.trim().slice(0, 200)}`);
    return stdout.trim().split(/\r?\n/).map(s => s.trim()).filter(Boolean);
  } catch (err) {
    await log("warn", `  queryPrinterBins error: ${err.message?.slice(0, 150)}`);
    return [];
  }
}

async function queryPrinterPaperSizes(printerName) {
  const safe = printerName.replace(/'/g, "''");
  const script = [
    "Add-Type -AssemblyName System.Drawing",
    `$ps = New-Object System.Drawing.Printing.PrinterSettings`,
    `$ps.PrinterName = '${safe}'`,
    "$ps.PaperSizes | Where-Object { $_.Width -ge 840 -and $_.Width -le 870 } |",
    "  ForEach-Object { Write-Output ($_.PaperName + ' (' + $_.Width + 'x' + $_.Height + ')') }",
  ].join("\r\n");

  try {
    const { stdout } = await runPsScript(script);
    return stdout.trim().split(/\r?\n/).map(s => s.trim()).filter(Boolean);
  } catch {
    return [];
  }
}

// Ruta al ejecutable de LibreOffice (se busca en el PATH y luego en rutas habituales de Windows)
const LIBREOFFICE_PATHS = [
  "soffice",
  "libreoffice",
  "C:\\Program Files\\LibreOffice\\program\\soffice.exe",
  "C:\\Program Files (x86)\\LibreOffice\\program\\soffice.exe",
];

if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error("❌ Faltan SUPABASE_URL o SUPABASE_SERVICE_ROLE_KEY en .env");
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { persistSession: false },
});

let isShuttingDown = false;
let activeJobId    = null;

// ── Directorios ──────────────────────────────────────────────

for (const dir of [TEMP_DIR, LOG_DIR]) {
  if (!existsSync(dir)) await mkdir(dir, { recursive: true });
}

// ── Logging ──────────────────────────────────────────────────

const ICONS = { info: "ℹ️ ", warn: "⚠️ ", error: "❌", success: "✅" };

function getTimestamp() {
  // Guatemala es UTC-6 sin horario de verano
  const ts = new Intl.DateTimeFormat("sv-SE", {
    timeZone: "America/Guatemala",
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit",
    hour12: false,
  }).format(new Date());
  return ts.replace("T", " "); // "2026-05-10 11:43:51"
}

async function log(level, message, data) {
  const ts   = getTimestamp();
  const icon = ICONS[level] ?? " •";
  const line = `[${ts} GT] ${icon} ${message}${data ? "  " + JSON.stringify(data) : ""}`;
  console.log(line);
  const dateStr = ts.slice(0, 10);
  const file = join(LOG_DIR, `agent-${dateStr}.log`);
  await appendFile(file, line + "\n").catch(() => {});
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ── Helpers de base de datos ─────────────────────────────────

async function dbUpdateJob(jobId, fields) {
  const { error } = await supabase
    .from("print_jobs")
    .update({ ...fields, updated_at: new Date().toISOString() })
    .eq("id", jobId);
  if (error) throw new Error(`Error al actualizar job ${jobId}: ${error.message}`);
}

async function dbLogEvent(jobId, eventType, description, newStatus = null, metadata = null) {
  await supabase.from("print_job_events").insert({
    print_job_id: jobId,
    event_type:   eventType,
    description,
    new_status:   newStatus,
    metadata,
  });
}

// ── Conversión con LibreOffice ───────────────────────────────

async function findLibreOffice() {
  for (const candidate of LIBREOFFICE_PATHS) {
    try {
      await execAsync(`"${candidate}" --version`);
      return candidate;
    } catch { /* no encontrado */ }
  }
  return null;
}

async function convertToPdfWithLibreOffice(inputPath) {
  const loPath = await findLibreOffice();
  if (!loPath) {
    throw new Error(
      "LibreOffice no encontrado. Instálalo desde https://www.libreoffice.org/ " +
      "para imprimir archivos Word y PowerPoint."
    );
  }

  const ext = extname(inputPath).toLowerCase();
  const infilterMap = {
    ".pptx": "Impress MS PowerPoint 2007 XML",
    ".ppt":  "MS PowerPoint 97",
    ".docx": "MS Word 2007 XML",
    ".doc":  "MS Word 97",
  };

  // Rutas absolutas necesarias para que LibreOffice encuentre los archivos
  const { resolve: resolvePath } = await import("node:path");
  const absOutDir  = resolvePath(TEMP_DIR);
  const absInput   = resolvePath(inputPath);
  const profileDir = resolvePath(TEMP_DIR, "lo_profile");
  await mkdir(profileDir, { recursive: true }).catch(() => {});
  const profileUrl = "file:///" + profileDir.replace(/\\/g, "/");

  const infilter = infilterMap[ext] ?? "";

  // < NUL redirige stdin desde el dispositivo vacío de Windows a nivel de shell (cmd.exe).
  // Es el método más forzoso para que LibreOffice no pause con "Press Enter to continue".
  const parts = [
    `"${loPath}"`,
    `"--env:UserInstallation=${profileUrl}"`,
    "--headless", "--norestore", "--nofirststartwizard", "--nolockcheck", "--nologo",
    ...(infilter ? [`"--infilter=${infilter}"`] : []),
    "--convert-to", "pdf",
    `"--outdir"`, `"${absOutDir}"`,
    `"${absInput}"`,
  ];
  await execAsync(`${parts.join(" ")} < NUL`, { windowsHide: true, timeout: 90000 });

  const base    = basename(inputPath, extname(inputPath));
  const pdfPath = join(absOutDir, `${base}.pdf`);

  if (!existsSync(pdfPath)) {
    throw new Error(`LibreOffice no generó el PDF esperado en: ${pdfPath}`);
  }
  return pdfPath;
}

// ── Layout de diapositivas por hoja ──────────────────────────

const SLIDE_LAYOUT = {
  1: { cols: 1, rows: 1 },
  2: { cols: 1, rows: 2 },
  3: { cols: 1, rows: 3 },
  4: { cols: 2, rows: 2 },
  6: { cols: 2, rows: 3 },
  9: { cols: 3, rows: 3 },
};

async function arrangeSlidesPerPage(pdfPath, slidesPerPage) {
  if (!slidesPerPage || slidesPerPage <= 1) return pdfPath;

  const layout = SLIDE_LAYOUT[slidesPerPage] ?? { cols: 2, rows: 2 };
  const { cols, rows } = layout;

  const PAGE_W = 612;   // Oficio 2: 8.5" × 72
  const PAGE_H = 936;   // Oficio 2: 13" × 72
  const MARGIN = 20;
  const GAP    = 8;
  const cellW  = (PAGE_W - MARGIN * 2 - GAP * (cols - 1)) / cols;
  const cellH  = (PAGE_H - MARGIN * 2 - GAP * (rows - 1)) / rows;

  const srcBytes  = await readFile(pdfPath);
  const srcDoc    = await PDFDocument.load(srcBytes);
  const totalSlides = srcDoc.getPageCount();
  const newDoc    = await PDFDocument.create();

  for (let start = 0; start < totalSlides; start += slidesPerPage) {
    const page    = newDoc.addPage([PAGE_W, PAGE_H]);
    const batchN  = Math.min(slidesPerPage, totalSlides - start);

    for (let i = 0; i < batchN; i++) {
      const [embedded] = await newDoc.embedPdf(srcDoc, [start + i]);
      const col = i % cols;
      const row = Math.floor(i / cols);
      const x   = MARGIN + col * (cellW + GAP);
      const y   = PAGE_H - MARGIN - (row + 1) * cellH - row * GAP;

      page.drawPage(embedded, { x, y, width: cellW, height: cellH });
    }
  }

  const outPath = pdfPath.replace(".pdf", "_handout.pdf");
  await writeFile(outPath, await newDoc.save());
  return outPath;
}

// ── Redimensionar PDF al tamaño de papel objetivo ───────────
// Escala cada página para que entre en las dimensiones objetivo (fit-and-center).

async function resizePdfToTarget(pdfPath, paperKey) {
  const { w: targetW, h: targetH } = PAPER_META[paperKey] ?? PAPER_META.carta;
  const srcBytes = await readFile(pdfPath);
  const srcDoc   = await PDFDocument.load(srcBytes);
  const newDoc   = await PDFDocument.create();

  for (let i = 0; i < srcDoc.getPageCount(); i++) {
    const srcPage = srcDoc.getPage(i);
    const { width: srcW, height: srcH } = srcPage.getSize();

    const scale  = Math.min(targetW / srcW, targetH / srcH);
    const drawW  = srcW * scale;
    const drawH  = srcH * scale;
    const x      = (targetW - drawW) / 2;
    const y      = (targetH - drawH) / 2;

    const [embedded] = await newDoc.embedPdf(srcDoc, [i]);
    const page = newDoc.addPage([targetW, targetH]);
    page.drawPage(embedded, { x, y, width: drawW, height: drawH });
  }

  const outPath = pdfPath.replace(".pdf", `_${paperKey}.pdf`);
  await writeFile(outPath, await newDoc.save());
  return outPath;
}

// ── Detectar tamaño de papel del PDF ────────────────────────

async function getPaperSizeName(pdfPath) {
  try {
    const doc  = await PDFDocument.load(await readFile(pdfPath));
    const { width, height } = doc.getPage(0).getSize();
    const w = Math.min(width, height);
    const h = Math.max(width, height);

    if (Math.abs(w - 612) <= 12 && Math.abs(h - 792)  <= 12) return "Letter";
    if (Math.abs(w - 612) <= 12 && Math.abs(h - 936)  <= 12) return "Oficio II";
    if (Math.abs(w - 612) <= 12 && Math.abs(h - 1008) <= 12) return "Legal";

    return null;
  } catch {
    return null;
  }
}

// ── Claiming atómico ─────────────────────────────────────────

async function claimNextJob() {
  const { data, error } = await supabase.rpc("claim_next_print_job");

  if (!error) return data?.[0] ?? null;

  await log("warn", "RPC claim_next_print_job no disponible — usando fallback simple");
  const { data: jobs } = await supabase
    .from("print_jobs")
    .select("*")
    .eq("status", "approved")
    .order("created_at", { ascending: true })
    .limit(1);

  const job = jobs?.[0];
  if (!job) return null;

  await dbUpdateJob(job.id, { status: "printing" });
  return job;
}

// ── Recuperar trabajos atascados ─────────────────────────────

async function recoverStuckJobs() {
  const cutoff = new Date(Date.now() - STUCK_TIMEOUT_MIN * 60 * 1000).toISOString();
  const { data: stuck } = await supabase
    .from("print_jobs")
    .select("id, correlative")
    .eq("status", "printing")
    .lt("updated_at", cutoff);

  if (!stuck?.length) return;

  await log("warn", `Recuperando ${stuck.length} trabajo(s) atascado(s) en 'printing'`);
  for (const job of stuck) {
    await dbUpdateJob(job.id, { status: "approved" });
    await dbLogEvent(
      job.id,
      "note",
      `Trabajo recuperado al iniciar el agente (estaba en 'printing' > ${STUCK_TIMEOUT_MIN} min)`,
      "approved"
    );
    await log("info", `Restaurado a 'approved': ${job.correlative}`);
  }
}

// ── Procesar un trabajo ──────────────────────────────────────

async function processJob(job, attempt) {
  const ext          = extname(job.file_path).toLowerCase() || ".pdf";
  const tempOriginal = join(TEMP_DIR, `${job.id}${ext}`);
  const extraFiles   = [];   // archivos temporales adicionales a limpiar

  try {
    // Determinar impresora según tipo de impresión
    const { data: printers, error: printerErr } = await supabase
      .from("printers")
      .select("*")
      .eq("is_active", true);

    if (printerErr) throw new Error(`Error al leer impresoras de Supabase: ${printerErr.message}`);

    if (!printers?.length) {
      throw new Error(
        "No hay impresoras activas en la base de datos. " +
        "Ve a /admin/printers y agrega una impresora."
      );
    }

    await log("info", `  Impresoras en BD (activas): ${printers.map((p) => `${p.name} [bw_default=${p.is_default_bw}, color_default=${p.is_default_color}]`).join(" | ")}`);

    const printer = job.print_type === "bw"
      ? printers.find((p) => p.is_default_bw)
      : printers.find((p) => p.is_default_color);

    if (!printer) {
      const campo = job.print_type === "bw" ? "is_default_bw" : "is_default_color";
      throw new Error(
        `Ninguna impresora activa tiene ${campo}=true. ` +
        `Ve a /admin/printers y haz clic en "Default ${job.print_type === "bw" ? "B/N" : "Color"}".`
      );
    }

    await log("info", `  Impresora: ${printer.name} (${printer.system_name})`);

    // Descargar archivo desde Supabase Storage
    const { data: blob, error: dlErr } = await supabase.storage
      .from("print-files")
      .download(job.file_path);

    if (dlErr || !blob) throw new Error(`Descarga fallida: ${dlErr?.message}`);
    await writeFile(tempOriginal, Buffer.from(await blob.arrayBuffer()));

    // Determinar tamaño de papel desde el trabajo (guardado por el usuario en el formulario)
    const paperKey      = (job.paper_size ?? "carta").toLowerCase();  // "carta" | "oficio2"
    const paperMeta     = PAPER_META[paperKey] ?? PAPER_META.carta;
    const paperFormName = paperMeta.formName;                          // "Letter" | "Oficio II"
    const trayName      = PAPER_TRAY_MAP[paperKey] ?? "";

    await log("info", `  Tamaño de papel : ${paperFormName} (${paperKey})`);

    // Consultar bandejas reales del driver y validar el nombre configurado
    const availableBins = await queryPrinterBins(printer.system_name);
    let resolvedTray = trayName;
    if (availableBins.length > 0) {
      await log("info", `  Bandejas en driver: ${availableBins.join(" | ")}`);
      if (trayName && !availableBins.includes(trayName)) {
        await log("warn", `  ⚠ La bandeja "${trayName}" NO existe en esta impresora.`);
        await log("warn", `  → Actualiza TRAY_${paperKey.toUpperCase()} en .env con uno de: ${availableBins.join(" | ")}`);
        resolvedTray = "";  // omitir bin inválido; el driver elegirá según paperSize
      }
    }

    // Consultar tamaños de papel del driver para verificar que "Oficio II" esté registrado
    const availableSizes = await queryPrinterPaperSizes(printer.system_name);
    if (availableSizes.length > 0) {
      await log("info", `  Tamaños 8.5" en driver: ${availableSizes.join(" | ")}`);
      if (!availableSizes.some(s => s.startsWith(paperFormName))) {
        await log("warn", `  ⚠ El tamaño "${paperFormName}" puede no estar registrado. Tamaños disponibles: ${availableSizes.join(" | ")}`);
      }
    }

    await log("info", `  Bandeja usada   : ${resolvedTray || "automática (driver)"}`);

    // Determinar el archivo a imprimir (conversión si es necesario)
    let fileToPrint = tempOriginal;

    const needsConversion = [".docx", ".doc", ".pptx", ".ppt"].includes(ext);
    if (needsConversion) {
      await log("info", `  Convirtiendo ${ext.toUpperCase()} → PDF con LibreOffice…`);
      const convertedPdf = await convertToPdfWithLibreOffice(tempOriginal);
      extraFiles.push(convertedPdf);
      fileToPrint = convertedPdf;

      // Para PowerPoint: extraer rango de diapositivas si fue especificado
      if ((ext === ".pptx" || ext === ".ppt") && (job.page_from || job.page_to)) {
        const srcDoc      = await PDFDocument.load(await readFile(fileToPrint));
        const totalSlides = srcDoc.getPageCount();
        const from        = Math.max(0, (job.page_from ?? 1) - 1);
        const to          = Math.min(totalSlides - 1, (job.page_to ?? totalSlides) - 1);
        if (from > 0 || to < totalSlides - 1) {
          await log("info", `  Extrayendo diapositivas ${from + 1}–${to + 1} de ${totalSlides}…`);
          const newDoc  = await PDFDocument.create();
          const pages   = await newDoc.copyPages(srcDoc, Array.from({ length: to - from + 1 }, (_, i) => from + i));
          pages.forEach(p => newDoc.addPage(p));
          const rangePath = fileToPrint.replace(".pdf", "_range.pdf");
          await writeFile(rangePath, await newDoc.save());
          extraFiles.push(rangePath);
          fileToPrint = rangePath;
        }
      }

      // Para PowerPoint: aplicar layout de diapositivas por hoja
      const slidesPerPage = job.images_per_page ?? 1;
      if ((ext === ".pptx" || ext === ".ppt") && slidesPerPage > 1) {
        await log("info", `  Aplicando layout: ${slidesPerPage} diapositivas por hoja…`);
        const handoutPdf = await arrangeSlidesPerPage(fileToPrint, slidesPerPage);
        if (handoutPdf !== fileToPrint) extraFiles.push(handoutPdf);
        fileToPrint = handoutPdf;
      }

      // Redimensionar si el PDF resultante no coincide con el tamaño objetivo
      const detectedForm = await getPaperSizeName(fileToPrint);
      if (detectedForm !== paperFormName) {
        await log("info", `  Redimensionando ${detectedForm ?? "desconocido"} → ${paperFormName}…`);
        const resized = await resizePdfToTarget(fileToPrint, paperKey);
        extraFiles.push(resized);
        fileToPrint = resized;
      }
    }

    // Para PDFs directos: redimensionar si las dimensiones no coinciden con el tamaño objetivo
    if (ext === ".pdf") {
      const detectedForm = await getPaperSizeName(fileToPrint);
      if (detectedForm !== paperFormName) {
        await log("info", `  PDF ${detectedForm ?? "desconocido"} → redimensionando a ${paperFormName}…`);
        const resized = await resizePdfToTarget(fileToPrint, paperKey);
        extraFiles.push(resized);
        fileToPrint = resized;
      }
    }

    const printOptions = {
      printer: printer.system_name,
      copies:  job.copy_count,
      silent:  true,
      paperSize: paperFormName,
      ...(resolvedTray && { bin: resolvedTray }),
    };

    await log("info", `  printOptions: ${JSON.stringify(printOptions)}`);
    await print(fileToPrint, printOptions);

    // Éxito — actualizar estado
    await dbUpdateJob(job.id, {
      status:     "printed",
      printed_at: new Date().toISOString(),
      printer_id: printer.id,
    });
    await dbLogEvent(
      job.id,
      "printed",
      `Impreso en ${printer.name} (intento ${attempt})`,
      "printed",
      { printer: printer.name, attempt }
    );
    await log("success", `${job.correlative} → impreso en ${printer.name}`);

  } finally {
    await unlink(tempOriginal).catch(() => {});
    for (const f of extraFiles) await unlink(f).catch(() => {});
  }
}

// ── Reintentos con backoff exponencial ───────────────────────

async function processWithRetry(job) {
  await log("info", `Trabajo: ${job.correlative} — ${job.client_name}`);

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      await processJob(job, attempt);
      return;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      await log("error", `Intento ${attempt}/${MAX_RETRIES} fallido: ${msg}`);

      if (attempt < MAX_RETRIES) {
        const delay = Math.pow(2, attempt) * 2000;
        await dbLogEvent(job.id, "error", `Error intento ${attempt}: ${msg}`, null, { attempt, error: msg });
        await log("info", `Reintentando en ${delay / 1000} s…`);
        await sleep(delay);
      } else {
        await dbUpdateJob(job.id, { status: "failed" }).catch(() => {});
        await dbLogEvent(
          job.id,
          "error",
          `Fallido tras ${MAX_RETRIES} intentos: ${msg}`,
          "failed",
          { error: msg, attempts: MAX_RETRIES }
        );
        await supabase.from("audit_logs").insert({
          action:     "print_failed",
          table_name: "print_jobs",
          record_id:  job.id,
          new_values: { error: msg, correlative: job.correlative, attempts: MAX_RETRIES },
        }).then(() => {}, () => {});
        await log("error", `${job.correlative} marcado como FALLIDO`);
      }
    }
  }
}

// ── Ciclo de polling ─────────────────────────────────────────

async function poll() {
  if (isShuttingDown) {
    await log("info", "Agente detenido correctamente.");
    process.exit(0);
  }

  try {
    const job = await claimNextJob();
    if (job) {
      activeJobId = job.id;
      await processWithRetry(job);
      activeJobId = null;
    }
  } catch (err) {
    await log("error", "Error inesperado en poll()", { message: err?.message });
  }

  if (!isShuttingDown) {
    setTimeout(poll, POLL_INTERVAL_MS);
  } else {
    await log("info", "Agente detenido correctamente.");
    process.exit(0);
  }
}

// ── Apagado graceful ─────────────────────────────────────────

function setupGracefulShutdown() {
  const handler = async (signal) => {
    await log("info", `Señal ${signal} recibida. Finalizando agente…`);
    isShuttingDown = true;
    if (!activeJobId) {
      await log("info", "Sin trabajo activo. Saliendo.");
      process.exit(0);
    } else {
      await log("info", `Esperando que termine el trabajo activo: ${activeJobId}`);
    }
  };
  process.on("SIGTERM", () => void handler("SIGTERM"));
  process.on("SIGINT",  () => void handler("SIGINT"));
}

// ── Main ─────────────────────────────────────────────────────

async function main() {
  const sep = "═".repeat(52);
  await log("info", sep);
  await log("info", "Print QR System — Agente de Impresión v2.2");
  await log("info", `Supabase : ${SUPABASE_URL}`);
  await log("info", `Polling  : cada ${POLL_INTERVAL_MS / 1000} s`);
  await log("info", `Reintentos: ${MAX_RETRIES}  |  Stuck timeout: ${STUCK_TIMEOUT_MIN} min`);
  await log("info", sep);

  const { error: pingErr } = await supabase.from("settings").select("key").limit(1);
  if (pingErr) {
    await log("error", "No se pudo conectar con Supabase", { message: pingErr.message });
    process.exit(1);
  }
  await log("success", "Conexión con Supabase OK");

  // Verificar LibreOffice
  const loPath = await findLibreOffice();
  if (loPath) {
    await log("success", `LibreOffice encontrado: ${loPath}`);
  } else {
    await log("warn", "LibreOffice NO encontrado — los archivos Word/PowerPoint no podrán imprimirse");
  }

  await log("info", `Bandeja Carta   (.env): "${PAPER_TRAY_MAP.carta   || "(no configurada)"}"`);
  await log("info", `Bandeja Oficio2 (.env): "${PAPER_TRAY_MAP.oficio2 || "(no configurada)"}"`);

  try {
    const sysPrinters = await getPrinters();
    const names = sysPrinters.map((p) => p.deviceId).join(", ") || "ninguna detectada";
    await log("info", `Impresoras del sistema: ${names}`);
  } catch {
    await log("warn", "No se pudo obtener la lista de impresoras del sistema");
  }

  await recoverStuckJobs();
  setupGracefulShutdown();
  await log("info", "Iniciando ciclo de polling…");
  await poll();
}

main().catch(async (err) => {
  await log("error", "Error fatal al iniciar el agente", { message: err?.message });
  process.exit(1);
});
