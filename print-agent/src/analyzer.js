/** Validación y análisis de PDF: páginas, dimensiones reales, orientación, tamaños mixtos. */
import { open, readFile } from "node:fs/promises";
import { PDFDocument } from "pdf-lib";
import { classifySize, PAPER_SIZES } from "./paper.js";
import { DocError } from "./util.js";

const OLE_MAGIC = "d0cf11e0a1b11ae1";

async function readHead(path, n = 1024) {
  const fh = await open(path, "r");
  try {
    const buf = Buffer.alloc(n);
    const { bytesRead } = await fh.read(buf, 0, n, 0);
    return buf.subarray(0, bytesRead);
  } finally {
    await fh.close();
  }
}

/** Comprueba que el contenido corresponde a la extensión antes de procesarlo. */
export async function validateFileFormat(path, ext) {
  let head;
  try {
    head = await readHead(path);
  } catch (err) {
    throw new DocError("UNREADABLE", `No se puede abrir el archivo: ${err.message}`);
  }
  if (head.length === 0) throw new DocError("EMPTY", "El archivo está vacío.");
  const isZip = head[0] === 0x50 && head[1] === 0x4b;
  const isOle = head.subarray(0, 8).toString("hex") === OLE_MAGIC;
  const isRtf = head.subarray(0, 5).toString("latin1") === "{\\rtf";
  const isPdf = head.toString("latin1").includes("%PDF-");

  if (ext === ".pdf") {
    if (!isPdf) throw new DocError("INVALID_FORMAT", "El archivo no es un PDF válido.");
  } else if (ext === ".docx") {
    // Un .docx cifrado con contraseña deja de ser ZIP y pasa a ser un contenedor OLE.
    if (isOle) throw new DocError("PASSWORD", "Documento Word protegido con contraseña. Pida al cliente una copia sin contraseña.");
    if (!isZip) throw new DocError("INVALID_FORMAT", "El archivo no es un documento Word (.docx) válido o está dañado.");
  } else if (ext === ".doc") {
    if (!isOle && !isZip && !isRtf) throw new DocError("INVALID_FORMAT", "El archivo no es un documento Word (.doc) válido o está dañado.");
  }
}

function toRanges(pageNumbers) {
  const out = [];
  let start = pageNumbers[0], prev = pageNumbers[0];
  for (const n of pageNumbers.slice(1)) {
    if (n === prev + 1) { prev = n; continue; }
    out.push(start === prev ? `${start}` : `${start}-${prev}`);
    start = prev = n;
  }
  out.push(start === prev ? `${start}` : `${start}-${prev}`);
  return out.join(",");
}

/**
 * @returns {{pageCount:number, sizeClass:string, orientation:string, encrypted:boolean,
 *   groups:{key:string, cls:string, label:string, widthPt:number, heightPt:number, count:number, ranges:string}[]}}
 */
export async function analyzePdf(path, { tolerancePt = 8 } = {}) {
  await validateFileFormat(path, ".pdf");
  const bytes = await readFile(path);
  let doc, encrypted = false;
  try {
    doc = await PDFDocument.load(bytes, { updateMetadata: false });
  } catch (err) {
    if (!/encrypt/i.test(err?.message ?? "")) {
      throw new DocError("PDF_CORRUPT", "El PDF está dañado y no puede leerse.");
    }
    try {
      doc = await PDFDocument.load(bytes, { updateMetadata: false, ignoreEncryption: true });
      encrypted = true;
    } catch {
      throw new DocError("PASSWORD", "PDF protegido con contraseña. Pida al cliente una copia sin contraseña.");
    }
  }

  let pages;
  try {
    pages = doc.getPages();
  } catch {
    throw new DocError(encrypted ? "PASSWORD" : "PDF_CORRUPT",
      encrypted ? "PDF protegido con contraseña. Pida al cliente una copia sin contraseña." : "El PDF está dañado y no puede leerse.");
  }
  if (pages.length === 0) throw new DocError("PDF_EMPTY", "El PDF no contiene páginas.");

  const groups = new Map();
  const orientations = new Set();
  pages.forEach((page, i) => {
    let width, height;
    try {
      ({ width, height } = page.getCropBox());
      if (page.getRotation().angle % 180 !== 0) [width, height] = [height, width];
    } catch {
      throw new DocError("PDF_CORRUPT", `No se pudieron leer las dimensiones de la página ${i + 1}.`);
    }
    if (!(width > 0 && height > 0)) throw new DocError("PDF_CORRUPT", `La página ${i + 1} tiene dimensiones inválidas.`);

    const cls = classifySize(width, height, tolerancePt);
    const short = Math.min(width, height), long = Math.max(width, height);
    orientations.add(width > height ? "landscape" : "portrait");
    const key = cls === "custom" ? `custom:${Math.round(short)}x${Math.round(long)}` : cls;
    if (!groups.has(key)) {
      groups.set(key, {
        key, cls,
        label: cls === "custom"
          ? `Personalizado ${(short / 72).toFixed(2)} × ${(long / 72).toFixed(2)} in`
          : PAPER_SIZES[cls].label,
        widthPt: Math.round(short * 100) / 100,
        heightPt: Math.round(long * 100) / 100,
        pageNumbers: [],
      });
    }
    groups.get(key).pageNumbers.push(i + 1);
  });

  const list = [...groups.values()].map(({ pageNumbers, ...g }) => ({
    ...g, count: pageNumbers.length, ranges: toRanges(pageNumbers),
  }));

  return {
    pageCount: pages.length,
    sizeClass: list.length > 1 ? "mixed" : list[0].cls,
    orientation: orientations.size > 1 ? "mixed" : [...orientations][0],
    encrypted,
    groups: list,
  };
}
