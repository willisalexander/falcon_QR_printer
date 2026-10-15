/**
 * Conversión DOC/DOCX → PDF con LibreOffice en modo headless.
 * Cada conversión usa un perfil propio y desechable (aislamiento entre
 * documentos y entre conversiones simultáneas) con las macros bloqueadas.
 */
import { spawn, execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, open, rm, writeFile } from "node:fs/promises";
import { basename, extname, join } from "node:path";
import { DocError } from "./util.js";

const LIBREOFFICE_PATHS = [
  "C:\\Program Files\\LibreOffice\\program\\soffice.exe",
  "C:\\Program Files (x86)\\LibreOffice\\program\\soffice.exe",
];

/**
 * Filtro de importación según el CONTENIDO real, no la extensión: es habitual
 * recibir un ".doc" que en realidad es RTF o un .docx renombrado, y forzar el
 * filtro equivocado hace que LibreOffice no pueda abrirlo.
 */
async function detectInfilter(path) {
  const fh = await open(path, "r");
  try {
    const head = Buffer.alloc(8);
    await fh.read(head, 0, 8, 0);
    if (head[0] === 0x50 && head[1] === 0x4b) return "MS Word 2007 XML";
    if (head.toString("hex") === "d0cf11e0a1b11ae1") return "MS Word 97";
    if (head.subarray(0, 5).toString("latin1") === "{\\rtf") return "Rich Text Format";
    return null; // que LibreOffice lo detecte
  } finally {
    await fh.close();
  }
}

// Perfil endurecido: macros deshabilitadas, sin actualizar vínculos externos.
const PROFILE_XCU = `<?xml version="1.0" encoding="UTF-8"?>
<oor:items xmlns:oor="http://openoffice.org/2001/registry" xmlns:xs="http://www.w3.org/2001/XMLSchema" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
<item oor:path="/org.openoffice.Office.Common/Security/Scripting"><prop oor:name="MacroSecurityLevel" oor:op="fuse"><value>3</value></prop></item>
<item oor:path="/org.openoffice.Office.Common/Security/Scripting"><prop oor:name="DisableMacrosExecution" oor:op="fuse"><value>true</value></prop></item>
<item oor:path="/org.openoffice.Office.Common/Security/Scripting"><prop oor:name="BlockUntrustedRefererLinks" oor:op="fuse"><value>true</value></prop></item>
<item oor:path="/org.openoffice.Office.Writer/Content/Update"><prop oor:name="Link" oor:op="fuse"><value>0</value></prop></item>
<item oor:path="/org.openoffice.Office.Common/Misc"><prop oor:name="FirstRun" oor:op="fuse"><value>false</value></prop></item>
</oor:items>
`;

function whereSoffice() {
  return new Promise((resolve) => {
    execFile("where", ["soffice"], { windowsHide: true }, (err, stdout) => {
      resolve(err ? null : stdout.split(/\r?\n/).map((s) => s.trim()).find(Boolean) ?? null);
    });
  });
}

function killTree(pid) {
  if (process.platform === "win32") {
    execFile("taskkill", ["/PID", String(pid), "/T", "/F"], { windowsHide: true }, () => {});
  } else {
    try { process.kill(pid, "SIGKILL"); } catch { /* ya terminó */ }
  }
}

// stdin cerrado (evita prompts interactivos) y sin ventana
function run(cmd, args, timeoutMs) {
  return new Promise((resolve, reject) => {
    const proc = spawn(cmd, args, { stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
    let stderr = "";
    proc.stderr?.on("data", (d) => { stderr += d; });
    proc.stdout?.resume();
    const timer = setTimeout(() => {
      killTree(proc.pid);
      reject(new DocError("CONVERT_TIMEOUT", `La conversión superó el tiempo máximo (${Math.round(timeoutMs / 1000)} s).`));
    }, timeoutMs);
    proc.on("close", (code) => {
      clearTimeout(timer);
      if (code !== 0) reject(new DocError("CONVERT_FAILED", stderr.trim().slice(0, 300) || `LibreOffice terminó con código ${code}`));
      else resolve();
    });
    proc.on("error", (err) => {
      clearTimeout(timer);
      reject(new DocError("CONVERT_FAILED", err.message));
    });
  });
}

export function createConverter(ctx) {
  const { config } = ctx;
  let cachedPath;

  async function findLibreOffice() {
    if (cachedPath !== undefined) return cachedPath;
    const candidates = [config.libreOfficePath, ...LIBREOFFICE_PATHS].filter(Boolean);
    cachedPath = candidates.find((p) => existsSync(p)) ?? (await whereSoffice());
    return cachedPath;
  }

  return {
    findLibreOffice,

    /** Convierte y devuelve la ruta del PDF dentro de una carpeta temporal propia. */
    async convert(inputPath, { timeoutMs = 120000 } = {}) {
      const soffice = await findLibreOffice();
      if (!soffice) {
        throw new DocError("NO_LIBREOFFICE",
          "LibreOffice no está instalado en esta computadora. Instálelo para convertir documentos Word.");
      }
      const workDir = join(config.dirs.temporales, `conv_${randomUUID()}`);
      const profileDir = join(workDir, "perfil");
      const outDir = join(workDir, "salida");
      await mkdir(join(profileDir, "user"), { recursive: true });
      await mkdir(outDir, { recursive: true });
      await writeFile(join(profileDir, "user", "registrymodifications.xcu"), PROFILE_XCU, "utf8");

      const infilter = await detectInfilter(inputPath);
      const args = [
        `-env:UserInstallation=file:///${profileDir.replace(/\\/g, "/")}`,
        "--headless", "--invisible", "--norestore", "--nofirststartwizard", "--nolockcheck", "--nologo", "--nodefault",
        ...(infilter ? [`--infilter=${infilter}`] : []),
        "--convert-to", "pdf:writer_pdf_Export",
        "--outdir", outDir,
        inputPath,
      ];
      try {
        await run(soffice, args, timeoutMs);
      } catch (err) {
        await rm(workDir, { recursive: true, force: true }).catch(() => {});
        throw err;
      }
      const pdf = join(outDir, `${basename(inputPath, extname(inputPath))}.pdf`);
      if (!existsSync(pdf)) {
        await rm(workDir, { recursive: true, force: true }).catch(() => {});
        throw new DocError("CONVERT_FAILED",
          "LibreOffice no generó el PDF. El documento puede estar dañado o protegido con contraseña.");
      }
      return { pdf, cleanup: () => rm(workDir, { recursive: true, force: true }).catch(() => {}) };
    },
  };
}
