"use client";

import { useState, useEffect } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import {
  FileText, X, CheckCircle, AlertCircle,
  Printer, Upload, Loader2, Eye, ChevronLeft, ChevronRight,
} from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { submitPrintJob } from "./actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import { cn, formatCurrency } from "@/lib/utils";

// ── Layout de imágenes ─────────────────────────────────────────

const LAYOUT_OPTIONS = [
  { value: 1,  cols: 1, rows: 1 },
  { value: 2,  cols: 1, rows: 2 },
  { value: 4,  cols: 2, rows: 2 },
  { value: 6,  cols: 2, rows: 3 },
  { value: 9,  cols: 3, rows: 3 },
  { value: 12, cols: 4, rows: 3 },
] as const;

type LayoutValue = (typeof LAYOUT_OPTIONS)[number]["value"];

// ── Tamaño de papel fijo: Oficio 2 ────────────────────────────
const PAPER_W     = 612;        // 8.5" × 72 pts
const PAPER_H     = 936;        // 13" × 72 pts
const PAPER_LABEL = "Oficio 2";
const PAPER_DESC  = "8.5 × 13 in";

// ── Diapositivas por hoja (solo PowerPoint) ───────────────────

const SLIDES_PER_PAGE_OPTIONS = [1, 2, 3, 4, 6, 9] as const;
type SlidesPerPage = (typeof SLIDES_PER_PAGE_OPTIONS)[number];

const SLIDE_LAYOUT: Record<SlidesPerPage, { cols: number; rows: number }> = {
  1: { cols: 1, rows: 1 },
  2: { cols: 1, rows: 2 },
  3: { cols: 1, rows: 3 },
  4: { cols: 2, rows: 2 },
  6: { cols: 2, rows: 3 },
  9: { cols: 3, rows: 3 },
};

type PrintRange = "all" | "single" | "range";

// ── Detectores de tipo de archivo ─────────────────────────────

function isPdfFile(file: File) {
  return file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf");
}

function isWordFile(file: File) {
  const name = file.name.toLowerCase();
  return (
    file.type === "application/vnd.openxmlformats-officedocument.wordprocessingml.document" ||
    file.type === "application/msword" ||
    name.endsWith(".docx") ||
    name.endsWith(".doc")
  );
}

function isPptxFile(file: File) {
  const name = file.name.toLowerCase();
  return (
    file.type === "application/vnd.openxmlformats-officedocument.presentationml.presentation" ||
    file.type === "application/vnd.ms-powerpoint" ||
    name.endsWith(".pptx") ||
    name.endsWith(".ppt")
  );
}

function isImageFile(file: File) {
  return ["image/jpeg", "image/jpg", "image/png", "image/webp"].includes(file.type) ||
    /\.(jpe?g|png|webp)$/i.test(file.name);
}

// ── Helpers de imagen ─────────────────────────────────────────

async function generateImageThumbnail(file: File, maxWidth = 400): Promise<Blob> {
  return new Promise((resolve, reject) => {
    const img = new window.Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      URL.revokeObjectURL(url);
      const scale = Math.min(1, maxWidth / img.width);
      const canvas = document.createElement("canvas");
      canvas.width  = Math.round(img.width  * scale);
      canvas.height = Math.round(img.height * scale);
      const ctx = canvas.getContext("2d");
      if (!ctx) return reject(new Error("Canvas no soportado"));
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      canvas.toBlob(
        (blob) => (blob ? resolve(blob) : reject(new Error("Error al generar miniatura"))),
        "image/jpeg",
        0.82
      );
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error("Error al cargar imagen")); };
    img.src = url;
  });
}

async function imageFileToJpegBytes(file: File, maxPx = 1600): Promise<ArrayBuffer> {
  return new Promise((resolve, reject) => {
    const img = new window.Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      URL.revokeObjectURL(url);
      const scale = Math.min(1, maxPx / Math.max(img.width, img.height));
      const canvas = document.createElement("canvas");
      canvas.width  = Math.round(img.width  * scale);
      canvas.height = Math.round(img.height * scale);
      const ctx = canvas.getContext("2d");
      if (!ctx) return reject(new Error("Canvas no soportado"));
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      canvas.toBlob(
        async (blob) =>
          blob ? resolve(await blob.arrayBuffer()) : reject(new Error("Error de conversión")),
        "image/jpeg",
        0.82
      );
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error("Error al cargar imagen")); };
    img.src = url;
  });
}

async function imageArrayToPdf(files: File[], imagesPerPage: LayoutValue): Promise<Blob> {
  const layout = LAYOUT_OPTIONS.find((l) => l.value === imagesPerPage) ?? LAYOUT_OPTIONS[0];
  const { PDFDocument } = await import("pdf-lib");
  const pdfDoc = await PDFDocument.create();

  const MARGIN = 20, GAP = 8;
  const { cols, rows } = layout;
  const cellW = (PAPER_W - MARGIN * 2 - GAP * (cols - 1)) / cols;
  const cellH = (PAPER_H - MARGIN * 2 - GAP * (rows - 1)) / rows;

  const cellPxW = Math.round(cellW * (150 / 72));
  const cellPxH = Math.round(cellH * (150 / 72));
  const maxPx   = Math.max(cellPxW, cellPxH);

  for (let pageIdx = 0; pageIdx < Math.ceil(files.length / imagesPerPage); pageIdx++) {
    const page  = pdfDoc.addPage([PAPER_W, PAPER_H]);
    const batch = files.slice(pageIdx * imagesPerPage, (pageIdx + 1) * imagesPerPage);

    for (let i = 0; i < batch.length; i++) {
      const col      = i % cols;
      const row      = Math.floor(i / cols);
      const imgBytes = await imageFileToJpegBytes(batch[i], maxPx);
      const img      = await pdfDoc.embedJpg(imgBytes);

      const scale  = Math.min(cellW / img.width, cellH / img.height);
      const drawW  = img.width  * scale;
      const drawH  = img.height * scale;
      const x      = MARGIN + col * (cellW + GAP) + (cellW - drawW) / 2;
      const y      = PAPER_H - MARGIN - (row + 1) * cellH - row * GAP + (cellH - drawH) / 2;

      page.drawImage(img, { x, y, width: drawW, height: drawH });
    }
  }

  const bytes = await pdfDoc.save();
  return new Blob([new Uint8Array(bytes)], { type: "application/pdf" });
}

async function generateLayoutPreview(files: File[], imagesPerPage: LayoutValue): Promise<string[]> {
  const layout = LAYOUT_OPTIONS.find((l) => l.value === imagesPerPage) ?? LAYOUT_OPTIONS[0];
  const { cols, rows } = layout;

  const CANVAS_W = 560;
  const CANVAS_H = Math.round(560 * (PAPER_H / PAPER_W)); // proporción Oficio 2
  const MARGIN   = 16;
  const GAP      = 6;

  const cellW = (CANVAS_W - MARGIN * 2 - GAP * (cols - 1)) / cols;
  const cellH = (CANVAS_H - MARGIN * 2 - GAP * (rows - 1)) / rows;

  const totalPages = Math.ceil(files.length / imagesPerPage);
  const previews: string[] = [];

  for (let pageIdx = 0; pageIdx < totalPages; pageIdx++) {
    const canvas = document.createElement("canvas");
    canvas.width  = CANVAS_W;
    canvas.height = CANVAS_H;
    const ctx = canvas.getContext("2d")!;
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);

    const batch = files.slice(pageIdx * imagesPerPage, (pageIdx + 1) * imagesPerPage);

    for (let i = 0; i < batch.length; i++) {
      const col   = i % cols;
      const row   = Math.floor(i / cols);
      const cellX = MARGIN + col * (cellW + GAP);
      const cellY = MARGIN + row * (cellH + GAP);

      ctx.fillStyle = "#f3f4f6";
      ctx.fillRect(cellX, cellY, cellW, cellH);

      await new Promise<void>((resolve) => {
        const img = new window.Image();
        const url = URL.createObjectURL(batch[i]);
        img.onload = () => {
          URL.revokeObjectURL(url);
          const scale = Math.min(cellW / img.width, cellH / img.height);
          const drawW = img.width  * scale;
          const drawH = img.height * scale;
          ctx.drawImage(img, cellX + (cellW - drawW) / 2, cellY + (cellH - drawH) / 2, drawW, drawH);
          resolve();
        };
        img.onerror = () => { URL.revokeObjectURL(url); resolve(); };
        img.src = url;
      });
    }

    ctx.strokeStyle = "#d1d5db";
    ctx.lineWidth   = 1;
    ctx.strokeRect(0.5, 0.5, CANVAS_W - 1, CANVAS_H - 1);
    previews.push(canvas.toDataURL("image/jpeg", 0.88));
  }

  return previews;
}

// ── Helper para contar diapositivas de PPTX ───────────────────

async function getPptxSlideCount(file: File): Promise<number> {
  try {
    const buffer  = await file.arrayBuffer();
    const text    = new TextDecoder("latin1").decode(new Uint8Array(buffer));
    const pattern = /ppt\/slides\/slide(\d+)\.xml/g;
    const nums    = new Set<number>();
    let m;
    while ((m = pattern.exec(text)) !== null) nums.add(parseInt(m[1]));
    return nums.size > 0 ? nums.size : 1;
  } catch {
    return 1;
  }
}

async function generatePdfThumbnail(file: File, maxWidth = 400): Promise<Blob> {
  const pdfjsLib = await import("pdfjs-dist");
  pdfjsLib.GlobalWorkerOptions.workerSrc =
    `https://unpkg.com/pdfjs-dist@${pdfjsLib.version}/build/pdf.worker.min.mjs`;

  const arrayBuffer = await file.arrayBuffer();
  const pdf  = await pdfjsLib.getDocument({ data: new Uint8Array(arrayBuffer) }).promise;
  const page = await pdf.getPage(1);

  const baseViewport = page.getViewport({ scale: 1 });
  const scale        = maxWidth / baseViewport.width;
  const viewport     = page.getViewport({ scale });

  const canvas = document.createElement("canvas");
  canvas.width  = Math.round(viewport.width);
  canvas.height = Math.round(viewport.height);
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  await page.render({ canvas, viewport }).promise;

  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error("Error al generar miniatura del PDF"))),
      "image/jpeg",
      0.85
    );
  });
}

// ── Tipos y schema ─────────────────────────────────────────────

interface PrintFormProps {
  qrTokenId:          string;
  priceBw:            number;
  priceColor:         number;
  maxPagesNoApproval: number;
  maxFileSizeMb:      number;
}

const printSchema = z.object({
  clientName: z.string().min(2, "Mínimo 2 caracteres").max(100),
  copyCount:  z.coerce.number().int().min(1, "Mínimo 1 copia").max(99),
  printType:  z.enum(["bw", "color"]),
});

type PrintFormData = z.infer<typeof printSchema>;
type Step = "form" | "summary" | "success";

interface SuccessData {
  correlative: string;
  totalPrice:  number;
  clientName:  string;
}

// ── Componente ─────────────────────────────────────────────────

export function PrintForm({
  qrTokenId, priceBw, priceColor, maxPagesNoApproval, maxFileSizeMb,
}: PrintFormProps) {
  const [step,         setStep        ] = useState<Step>("form");
  const [files,        setFiles       ] = useState<File[]>([]);
  const [fileError,    setFileError   ] = useState<string | null>(null);
  const [pageCount,    setPageCount   ] = useState(1);
  const [imagesPerPage,setImagesPerPage] = useState<LayoutValue>(1);
  const [slidesPerPage,setSlidesPerPage] = useState<SlidesPerPage>(1);
  const [successData,  setSuccessData ] = useState<SuccessData | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [serverError,  setServerError ] = useState<string | null>(null);
  const [formValues,   setFormValues  ] = useState<PrintFormData | null>(null);
  const [isConverting, setIsConverting] = useState(false);
  const [convertedPdf, setConvertedPdf] = useState<Blob | null>(null);
  const [thumbnailBlob,setThumbnailBlob] = useState<Blob | null>(null);
  const [thumbnailUrl, setThumbnailUrl] = useState<string | null>(null);

  // Rango de impresión (PDF y PPTX)
  const [printRange,      setPrintRange     ] = useState<PrintRange>("all");
  const [rangeSinglePage, setRangeSinglePage] = useState(1);
  const [rangeFrom,       setRangeFrom      ] = useState(1);
  const [rangeTo,         setRangeTo        ] = useState(1);

  // Vista previa de imágenes
  const [previewPages,        setPreviewPages       ] = useState<string[] | null>(null);
  const [showPreview,         setShowPreview        ] = useState(false);
  const [isGeneratingPreview, setIsGeneratingPreview] = useState(false);
  const [previewPageIdx,      setPreviewPageIdx     ] = useState(0);

  const { register, handleSubmit, watch, formState: { errors } } = useForm<PrintFormData>({
    resolver: zodResolver(printSchema),
    defaultValues: { copyCount: 1, printType: "bw" },
  });

  const currentPrintType = watch("printType") ?? "bw";
  const currentCopyCount = watch("copyCount") ?? 1;
  const pricePerPage     = currentPrintType === "bw" ? priceBw : priceColor;

  const pdfMode   = files.length > 0 && isPdfFile(files[0]);
  const imageMode = files.length > 0 && isImageFile(files[0]);
  const wordMode  = files.length > 0 && isWordFile(files[0]);
  const pptxMode  = files.length > 0 && isPptxFile(files[0]);

  // Páginas/diapositivas efectivas según el rango
  const rawEffectiveCount =
    printRange === "all"    ? pageCount :
    printRange === "single" ? 1 :
    Math.max(1, Math.min(rangeTo, pageCount) - Math.max(1, rangeFrom) + 1);

  // Para PPTX las hojas físicas se reducen según diapositivas por hoja
  const effectivePageCount = pptxMode
    ? Math.ceil(rawEffectiveCount / slidesPerPage)
    : rawEffectiveCount;

  const estimatedTotal =
    Math.round(pricePerPage * effectivePageCount * currentCopyCount * 100) / 100;

  // Altura del contenedor de miniatura (proporción Oficio 2)
  const thumbContainerHeight = Math.round(120 * (PAPER_H / PAPER_W)); // ≈ 184 px

  // URL de miniatura
  useEffect(() => {
    if (!thumbnailBlob) { setThumbnailUrl(null); return; }
    const url = URL.createObjectURL(thumbnailBlob);
    setThumbnailUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [thumbnailBlob]);

  // Invalidar preview cacheada al cambiar archivo o layout
  useEffect(() => {
    setPreviewPages(null);
    setPreviewPageIdx(0);
  }, [files, imagesPerPage]);

  // Conversión imágenes → PDF (en Oficio 2)
  useEffect(() => {
    if (files.length === 0 || !isImageFile(files[0])) return;

    let cancelled = false;
    setIsConverting(true);
    setConvertedPdf(null);
    setFileError(null);

    (async () => {
      try {
        const [thumb, pdf] = await Promise.all([
          generateImageThumbnail(files[0], 400),
          imageArrayToPdf(files, imagesPerPage),
        ]);
        if (cancelled) return;
        setThumbnailBlob(thumb);
        setConvertedPdf(pdf);
        setPageCount(Math.ceil(files.length / imagesPerPage));
      } catch (err) {
        if (cancelled) return;
        const msg = err instanceof Error ? err.message : "Error al procesar las imágenes";
        setFileError(`${msg}. Vuelve a seleccionarlas.`);
      } finally {
        if (!cancelled) setIsConverting(false);
      }
    })();

    return () => { cancelled = true; };
  }, [files, imagesPerPage]);

  // ── Manejo de archivo ──────────────────────────────────────

  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const selected = Array.from(e.target.files ?? []);
    if (!selected.length) return;

    setFileError(null);
    setConvertedPdf(null);
    setThumbnailBlob(null);
    setPrintRange("all");
    setRangeSinglePage(1);
    setRangeFrom(1);
    setRangeTo(1);
    setSlidesPerPage(1);

    const allowedMimes = [
      "application/pdf",
      "image/jpeg", "image/jpg", "image/png", "image/webp",
      "application/msword",
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      "application/vnd.ms-powerpoint",
      "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    ];
    const allowedExts = ["pdf", "jpg", "jpeg", "png", "webp", "doc", "docx", "ppt", "pptx"];

    for (const f of selected) {
      if (f.size > maxFileSizeMb * 1024 * 1024) {
        setFileError(`"${f.name}" supera el límite de ${maxFileSizeMb} MB.`);
        return;
      }
      const ext = f.name.split(".").pop()?.toLowerCase() ?? "";
      if (!allowedMimes.includes(f.type) && !allowedExts.includes(ext)) {
        setFileError(`Formato no permitido: "${f.name}". Solo PDF, Word, PowerPoint, JPG, PNG o WEBP.`);
        return;
      }
    }

    // Solo se puede mezclar un tipo a la vez
    const hasDoc  = selected.some((f) => isPdfFile(f) || isWordFile(f) || isPptxFile(f));
    const hasImg  = selected.some(isImageFile);
    if (hasDoc && hasImg) {
      setFileError("No puedes mezclar documentos e imágenes. Selecciona solo uno de cada tipo.");
      return;
    }
    if (hasDoc && selected.length > 1) {
      setFileError("Solo puedes seleccionar un documento (PDF, Word o PowerPoint) a la vez.");
      return;
    }

    const pdfFile  = selected.find(isPdfFile);
    const wordFile = selected.find(isWordFile);
    const pptxFile = selected.find(isPptxFile);

    if (pdfFile) {
      setFiles([pdfFile]);
      setIsConverting(true);
      try {
        const { PDFDocument } = await import("pdf-lib");
        const bytes = await pdfFile.arrayBuffer();
        const doc   = await PDFDocument.load(bytes);
        const count = doc.getPageCount();
        setPageCount(count);
        setRangeTo(count);
        try {
          const thumb = await generatePdfThumbnail(pdfFile, 400);
          setThumbnailBlob(thumb);
        } catch { /* miniatura no crítica */ }
      } catch {
        setPageCount(1);
        setRangeTo(1);
      } finally {
        setIsConverting(false);
      }
    } else if (pptxFile) {
      setFiles([pptxFile]);
      setIsConverting(true);
      try {
        const count = await getPptxSlideCount(pptxFile);
        setPageCount(count);
        setRangeTo(count);
      } catch {
        setPageCount(1);
        setRangeTo(1);
      } finally {
        setIsConverting(false);
      }
    } else if (wordFile) {
      setFiles([wordFile]);
      setPageCount(1);
      setRangeTo(1);
    } else {
      // Imágenes
      setImagesPerPage(1);
      setFiles(selected);
    }
  }

  function clearFiles() {
    setFiles([]);
    setImagesPerPage(1);
    setSlidesPerPage(1);
    setFileError(null);
    setPageCount(1);
    setConvertedPdf(null);
    setThumbnailBlob(null);
    setPreviewPages(null);
    setPrintRange("all");
    setRangeSinglePage(1);
    setRangeFrom(1);
    setRangeTo(1);
  }

  async function handleShowPreview() {
    setShowPreview(true);
    if (previewPages) return;
    setIsGeneratingPreview(true);
    try {
      const pages = await generateLayoutPreview(files, imagesPerPage);
      setPreviewPages(pages);
    } catch { /* no crítico */ } finally {
      setIsGeneratingPreview(false);
    }
  }

  function onFormSubmit(data: PrintFormData) {
    if (files.length === 0)  { setFileError("Debes seleccionar un archivo."); return; }
    if (isConverting) return;
    if (imageMode && !convertedPdf) {
      setFileError("No se pudo procesar las imágenes. Vuelve a seleccionarlas.");
      return;
    }
    if ((pdfMode || pptxMode) && printRange === "single" &&
        (rangeSinglePage < 1 || rangeSinglePage > pageCount)) {
      setFileError(`El número debe estar entre 1 y ${pageCount}.`);
      return;
    }
    if ((pdfMode || pptxMode) && printRange === "range" && rangeFrom > rangeTo) {
      setFileError("El rango no es válido.");
      return;
    }
    setFormValues(data);
    setStep("summary");
  }

  async function confirmAndSubmit() {
    if (!formValues || files.length === 0) return;
    setIsSubmitting(true);
    setServerError(null);

    let filePath:      string | null = null;
    let thumbnailPath: string | null = null;

    try {
      const supabase     = createClient();
      const fileToUpload = imageMode ? convertedPdf : files[0];
      if (!fileToUpload) throw new Error("El archivo no está listo. Espera unos segundos.");

      // Extensión y content type según tipo de archivo
      let ext         = "pdf";
      let contentType = "application/pdf";

      if (imageMode) {
        const name = files.length === 1
          ? files[0].name.replace(/\.[^.]+$/, ".pdf")
          : `${files.length}_imagenes.pdf`;
        ext = "pdf";
        filePath = `jobs/${Date.now()}-${Math.random().toString(36).slice(2)}.pdf`;
        const { error: uploadError } = await supabase.storage
          .from("print-files")
          .upload(filePath, fileToUpload, { contentType: "application/pdf", upsert: false });
        if (uploadError) throw new Error("Error al subir el archivo: " + uploadError.message);
      } else {
        ext = files[0].name.split(".").pop()?.toLowerCase() ?? "pdf";
        if (wordMode) {
          contentType = ext === "doc"
            ? "application/msword"
            : "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
        } else if (pptxMode) {
          contentType = ext === "ppt"
            ? "application/vnd.ms-powerpoint"
            : "application/vnd.openxmlformats-officedocument.presentationml.presentation";
        }
        filePath = `jobs/${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`;
        const { error: uploadError } = await supabase.storage
          .from("print-files")
          .upload(filePath, files[0], { contentType, upsert: false });
        if (uploadError) throw new Error("Error al subir el archivo: " + uploadError.message);
      }

      if (thumbnailBlob) {
        const tp = `jobs/${Date.now()}-${Math.random().toString(36).slice(2)}.jpg`;
        const { error: thumbErr } = await supabase.storage
          .from("thumbnails")
          .upload(tp, thumbnailBlob, { contentType: "image/jpeg", upsert: false });
        if (!thumbErr) thumbnailPath = tp;
      }

      const finalName = imageMode
        ? (files.length === 1
            ? files[0].name.replace(/\.[^.]+$/, ".pdf")
            : `${files.length}_imagenes.pdf`)
        : files[0].name;

      const result = await submitPrintJob({
        qrTokenId,
        clientName:       formValues.clientName,
        printType:        formValues.printType,
        pageCount:        effectivePageCount,
        copyCount:        formValues.copyCount,
        filePath,
        originalFileName: finalName,
        thumbnailPath:    thumbnailPath ?? undefined,
        slidesPerPage:    pptxMode ? slidesPerPage : undefined,
      });

      if (!result.success) {
        await supabase.storage.from("print-files").remove([filePath]);
        if (thumbnailPath)
          await supabase.storage.from("thumbnails").remove([thumbnailPath]);
        throw new Error(result.error);
      }

      setSuccessData({
        correlative: result.correlative,
        totalPrice:  result.totalPrice,
        clientName:  result.clientName,
      });
      setStep("success");
    } catch (err) {
      setServerError(err instanceof Error ? err.message : "Ocurrió un error inesperado.");
    } finally {
      setIsSubmitting(false);
    }
  }

  // ── Modal de vista previa (imágenes) ──────────────────────

  const previewModal = showPreview && (
    <div
      className="fixed inset-0 z-50 flex flex-col bg-black/80"
      onClick={() => setShowPreview(false)}
    >
      <div className="flex flex-1 flex-col overflow-hidden" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between bg-black/60 px-4 py-3">
          <p className="text-sm font-semibold text-white">Vista previa del documento</p>
          <div className="flex items-center gap-3">
            {previewPages && previewPages.length > 1 && (
              <span className="text-xs text-gray-300">
                Hoja {previewPageIdx + 1} / {previewPages.length}
              </span>
            )}
            <button
              type="button"
              onClick={() => setShowPreview(false)}
              className="rounded-lg p-1.5 text-gray-300 hover:bg-white/10 active:bg-white/20"
            >
              <X className="h-5 w-5" />
            </button>
          </div>
        </div>

        <div className="flex flex-1 items-center justify-center overflow-hidden p-4">
          {isGeneratingPreview ? (
            <div className="flex flex-col items-center gap-3 text-white">
              <Loader2 className="h-10 w-10 animate-spin" />
              <p className="text-sm">Generando vista previa…</p>
            </div>
          ) : previewPages && previewPages[previewPageIdx] ? (
            <img
              src={previewPages[previewPageIdx]}
              alt={`Hoja ${previewPageIdx + 1}`}
              className="max-h-full max-w-full rounded-lg object-contain shadow-2xl"
              style={{ maxHeight: "calc(100vh - 140px)" }}
            />
          ) : (
            <p className="text-sm text-gray-400">No se pudo generar la previsualización.</p>
          )}
        </div>

        {previewPages && previewPages.length > 1 && (
          <div className="flex items-center justify-center gap-4 bg-black/60 py-3">
            <button
              type="button"
              disabled={previewPageIdx === 0}
              onClick={() => setPreviewPageIdx((p) => p - 1)}
              className="flex h-9 w-9 items-center justify-center rounded-full bg-white/10 text-white disabled:opacity-30 active:bg-white/20"
            >
              <ChevronLeft className="h-5 w-5" />
            </button>
            <div className="flex gap-1.5">
              {previewPages.map((_, i) => (
                <button
                  key={i}
                  type="button"
                  onClick={() => setPreviewPageIdx(i)}
                  className={cn(
                    "h-2 rounded-full transition-all",
                    i === previewPageIdx ? "w-6 bg-white" : "w-2 bg-white/40"
                  )}
                />
              ))}
            </div>
            <button
              type="button"
              disabled={previewPageIdx === previewPages.length - 1}
              onClick={() => setPreviewPageIdx((p) => p + 1)}
              className="flex h-9 w-9 items-center justify-center rounded-full bg-white/10 text-white disabled:opacity-30 active:bg-white/20"
            >
              <ChevronRight className="h-5 w-5" />
            </button>
          </div>
        )}

        <div className="bg-black/60 px-4 pb-5 pt-2">
          <button
            type="button"
            onClick={() => setShowPreview(false)}
            className="w-full rounded-xl bg-white/10 py-2.5 text-sm font-semibold text-white active:bg-white/20"
          >
            Cerrar previa
          </button>
        </div>
      </div>
    </div>
  );

  // ── PASO 1: Formulario ─────────────────────────────────────

  if (step === "form") {
    return (
      <>
        {previewModal}
        <form method="post" onSubmit={handleSubmit(onFormSubmit)} className="space-y-6">

          {/* Nombre */}
          <Card>
            <h3 className="mb-4 text-sm font-semibold text-gray-700">Tus datos</h3>
            <Input
              {...register("clientName")}
              label="Nombre completo"
              placeholder="Ej: María García"
              error={errors.clientName?.message}
              autoComplete="name"
              required
            />
          </Card>

          {/* Archivo */}
          <Card>
            <h3 className="mb-4 text-sm font-semibold text-gray-700">Archivo</h3>

            {files.length === 0 ? (
              <label
                htmlFor="file-upload"
                className="relative flex cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed border-gray-300 p-8 text-center transition-colors active:bg-gray-50"
              >
                <input
                  id="file-upload"
                  type="file"
                  accept=".pdf,.doc,.docx,.ppt,.pptx,.jpg,.jpeg,.png,.webp"
                  multiple
                  className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
                  onChange={handleFileChange}
                />
                <Upload className="mb-3 h-10 w-10 text-blue-500" />
                <p className="text-base font-semibold text-gray-800">
                  Toca aquí para elegir archivo
                </p>
                <p className="mt-1 text-sm text-gray-500">
                  PDF · Word · PowerPoint · JPG · PNG · WEBP · Máx. {maxFileSizeMb} MB
                </p>
                <p className="mt-0.5 text-xs text-gray-400">
                  Puedes seleccionar varias imágenes a la vez
                </p>
              </label>
            ) : (
              <>
                {/* Tarjeta del archivo */}
                <div className="flex items-center gap-3 rounded-xl border border-green-200 bg-green-50 p-4">
                  {isConverting ? (
                    <div className="flex h-14 w-14 flex-shrink-0 items-center justify-center rounded-lg bg-blue-50">
                      <Loader2 className="h-6 w-6 animate-spin text-blue-500" />
                    </div>
                  ) : thumbnailUrl ? (
                    <div className="relative flex-shrink-0">
                      <img
                        src={thumbnailUrl}
                        alt="Vista previa"
                        className="h-14 w-14 rounded-lg object-cover border border-gray-200"
                      />
                      {files.length > 1 && (
                        <span className="absolute -top-1.5 -right-1.5 flex h-5 min-w-[20px] items-center justify-center rounded-full bg-blue-600 px-1 text-xs font-bold text-white">
                          {files.length}
                        </span>
                      )}
                    </div>
                  ) : (
                    <FileText className="h-8 w-8 flex-shrink-0 text-green-600" />
                  )}

                  <div className="flex-1 min-w-0">
                    <p className="truncate text-sm font-medium text-gray-900">
                      {files.length === 1
                        ? files[0].name
                        : `${files.length} imágenes seleccionadas`}
                    </p>
                    <p className="text-xs text-gray-500">
                      {isConverting ? "Procesando archivo…" : (
                        <>
                          {imageMode && <span className="text-blue-600">→ PDF · </span>}
                          {pdfMode   && `${pageCount} ${pageCount === 1 ? "página" : "páginas"} · `}
                          {pptxMode  && `${pageCount} ${pageCount === 1 ? "diapositiva" : "diapositivas"} · `}
                          {wordMode  && "Word · "}
                          {(files.reduce((s, f) => s + f.size, 0) / 1024 / 1024).toFixed(2)} MB
                        </>
                      )}
                    </p>
                  </div>

                  <button
                    type="button"
                    onClick={clearFiles}
                    disabled={isConverting}
                    className="rounded-lg p-2 text-gray-400 active:bg-gray-100 disabled:opacity-40"
                  >
                    <X className="h-5 w-5" />
                  </button>
                </div>

                {/* Info para PDF */}
                {pdfMode && !isConverting && (
                  <div className="mt-4 space-y-3">
                    <p className="text-xs text-gray-500">
                      Se imprimirá en formato{" "}
                      <span className="font-semibold text-gray-700">
                        {PAPER_LABEL} ({PAPER_DESC})
                      </span>
                    </p>
                    {thumbnailUrl && (
                      <div className="flex flex-col items-center gap-1.5">
                        <p className="text-xs text-gray-500">Vista previa (primera página)</p>
                        <div
                          className="overflow-hidden rounded-lg border-2 border-gray-300 bg-white shadow-sm"
                          style={{ width: 120, height: thumbContainerHeight }}
                        >
                          <img
                            src={thumbnailUrl}
                            alt="Vista previa"
                            className="h-full w-full object-contain"
                          />
                        </div>
                      </div>
                    )}
                  </div>
                )}

                {/* Info para PPTX */}
                {pptxMode && !isConverting && (
                  <p className="mt-3 text-xs text-gray-500">
                    Se imprimirá en formato{" "}
                    <span className="font-semibold text-gray-700">
                      {PAPER_LABEL} ({PAPER_DESC})
                    </span>
                  </p>
                )}

                {/* Info para Word */}
                {wordMode && (
                  <p className="mt-3 text-xs text-gray-500">
                    Se imprimirá en formato{" "}
                    <span className="font-semibold text-gray-700">
                      {PAPER_LABEL} ({PAPER_DESC})
                    </span>
                    . El precio final depende del número real de páginas.
                  </p>
                )}

                {/* Selector de layout — solo imágenes */}
                {imageMode && (
                  <div className="mt-3">
                    <p className="mb-2 text-xs font-medium text-gray-600">
                      Imágenes por hoja
                    </p>
                    <div className="flex flex-wrap gap-2">
                      {LAYOUT_OPTIONS.map((opt) => (
                        <button
                          key={opt.value}
                          type="button"
                          disabled={isConverting}
                          onClick={() => setImagesPerPage(opt.value)}
                          className={cn(
                            "flex flex-col items-center gap-1 rounded-xl border-2 p-2 transition-colors disabled:opacity-40",
                            imagesPerPage === opt.value
                              ? "border-blue-500 bg-blue-50"
                              : "border-gray-200 bg-white"
                          )}
                        >
                          <div
                            style={{
                              display: "grid",
                              gridTemplateColumns: `repeat(${opt.cols}, 1fr)`,
                              gridTemplateRows:    `repeat(${opt.rows}, 1fr)`,
                              width: opt.cols >= 4 ? 36 : 28,
                              height: 36,
                              gap: "2px",
                              padding: "2px",
                              backgroundColor: "#d1d5db",
                              borderRadius: 3,
                            }}
                          >
                            {Array.from({ length: opt.value }).map((_, i) => (
                              <div
                                key={i}
                                style={{
                                  backgroundColor:
                                    imagesPerPage === opt.value ? "#60a5fa" : "#f3f4f6",
                                  borderRadius: 1,
                                }}
                              />
                            ))}
                          </div>
                          <span className={cn(
                            "text-xs font-semibold",
                            imagesPerPage === opt.value ? "text-blue-700" : "text-gray-500"
                          )}>
                            {opt.value}
                          </span>
                        </button>
                      ))}
                    </div>

                    {convertedPdf && !isConverting && (
                      <button
                        type="button"
                        onClick={handleShowPreview}
                        className="mt-3 flex w-full items-center justify-center gap-2 rounded-xl border border-blue-200 bg-blue-50 py-2.5 text-sm font-medium text-blue-700 active:bg-blue-100"
                      >
                        <Eye className="h-4 w-4" />
                        Ver cómo quedará el documento
                      </button>
                    )}
                  </div>
                )}
              </>
            )}

            {fileError && (
              <p className="mt-2 flex items-center gap-1 text-sm text-red-600">
                <AlertCircle className="h-4 w-4 flex-shrink-0" />
                {fileError}
              </p>
            )}
          </Card>

          {/* Opciones de impresión */}
          <Card>
            <h3 className="mb-4 text-sm font-semibold text-gray-700">Opciones de impresión</h3>
            <div className="space-y-5">

              {/* Tipo: BN / Color */}
              <div>
                <p className="mb-3 text-sm font-medium text-gray-700">
                  Tipo de impresión <span className="text-red-500">*</span>
                </p>
                <div className="grid grid-cols-2 gap-3">
                  {(
                    [
                      { value: "bw",    label: "Blanco y Negro", price: priceBw    },
                      { value: "color", label: "Color",          price: priceColor },
                    ] as const
                  ).map((opt) => (
                    <label
                      key={opt.value}
                      htmlFor={`type-${opt.value}`}
                      className={cn(
                        "relative flex cursor-pointer flex-col items-center rounded-xl border-2 p-4 transition-colors",
                        currentPrintType === opt.value
                          ? "border-blue-500 bg-blue-50"
                          : "border-gray-200 bg-white"
                      )}
                    >
                      <input
                        id={`type-${opt.value}`}
                        type="radio"
                        value={opt.value}
                        {...register("printType")}
                        className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
                      />
                      <Printer
                        className={cn(
                          "mb-2 h-6 w-6",
                          currentPrintType === opt.value ? "text-blue-600" : "text-gray-400"
                        )}
                      />
                      <span className="text-sm font-semibold text-gray-900">{opt.label}</span>
                      <span className="text-xs text-gray-500">
                        {formatCurrency(opt.price)} / hoja
                      </span>
                    </label>
                  ))}
                </div>
                {errors.printType && (
                  <p className="mt-1 text-xs text-red-600">{errors.printType.message}</p>
                )}
              </div>

              {/* Rango de páginas — PDF y PPTX con más de 1 página/diapositiva */}
              {(pdfMode || pptxMode) && !isConverting && pageCount > 1 && (
                <div>
                  <p className="mb-3 text-sm font-medium text-gray-700">
                    {pptxMode ? "Diapositivas a imprimir" : "Páginas a imprimir"}
                  </p>
                  <div className="space-y-2">
                    {(
                      [
                        {
                          value: "all",
                          label: pptxMode ? "Todas las diapositivas" : "Todo el documento",
                          extra: `${pageCount} ${pptxMode ? "diapositivas" : "páginas"}`,
                        },
                        {
                          value: "single",
                          label: pptxMode ? "Una diapositiva" : "Una página",
                          extra: "",
                        },
                        {
                          value: "range",
                          label: pptxMode ? "Rango de diapositivas" : "Rango de páginas",
                          extra: "",
                        },
                      ] as const
                    ).map((opt) => (
                      <label
                        key={opt.value}
                        className={cn(
                          "flex cursor-pointer items-center gap-3 rounded-xl border-2 p-3 transition-colors",
                          printRange === opt.value
                            ? "border-blue-500 bg-blue-50"
                            : "border-gray-200 bg-white"
                        )}
                      >
                        <input
                          type="radio"
                          name="printRange"
                          value={opt.value}
                          checked={printRange === opt.value}
                          onChange={() => setPrintRange(opt.value)}
                          className="accent-blue-600"
                        />
                        <div className="flex-1">
                          <p className={cn(
                            "text-sm font-medium",
                            printRange === opt.value ? "text-blue-800" : "text-gray-700"
                          )}>
                            {opt.label}
                          </p>
                          {opt.extra && (
                            <p className="text-xs text-gray-400">{opt.extra}</p>
                          )}
                        </div>
                      </label>
                    ))}
                  </div>

                  {printRange === "single" && (
                    <div className="mt-3">
                      <Input
                        label={`Número de ${pptxMode ? "diapositiva" : "página"} (1 – ${pageCount})`}
                        type="number"
                        inputMode="numeric"
                        min={1}
                        max={pageCount}
                        value={rangeSinglePage}
                        onChange={(e) =>
                          setRangeSinglePage(
                            Math.min(pageCount, Math.max(1, parseInt(e.target.value) || 1))
                          )
                        }
                      />
                    </div>
                  )}

                  {printRange === "range" && (
                    <div className="mt-3 grid grid-cols-2 gap-3">
                      <Input
                        label="Desde"
                        type="number"
                        inputMode="numeric"
                        min={1}
                        max={pageCount}
                        value={rangeFrom}
                        onChange={(e) => {
                          const v = Math.min(pageCount, Math.max(1, parseInt(e.target.value) || 1));
                          setRangeFrom(v);
                          if (v > rangeTo) setRangeTo(v);
                        }}
                      />
                      <Input
                        label="Hasta"
                        type="number"
                        inputMode="numeric"
                        min={rangeFrom}
                        max={pageCount}
                        value={rangeTo}
                        onChange={(e) =>
                          setRangeTo(
                            Math.min(pageCount, Math.max(rangeFrom, parseInt(e.target.value) || rangeFrom))
                          )
                        }
                      />
                    </div>
                  )}

                  {printRange !== "all" && (
                    <p className="mt-2 text-xs font-medium text-blue-600">
                      {pptxMode
                        ? `${rawEffectiveCount} ${rawEffectiveCount === 1 ? "diapositiva" : "diapositivas"} seleccionadas`
                        : `Se imprimirán ${rawEffectiveCount} ${rawEffectiveCount === 1 ? "página" : "páginas"}`
                      }
                    </p>
                  )}
                </div>
              )}

              {/* Diapositivas por hoja — solo PPTX */}
              {pptxMode && !isConverting && (
                <div>
                  <p className="mb-2 text-sm font-medium text-gray-700">
                    Diapositivas por hoja
                  </p>
                  <div className="flex flex-wrap gap-2">
                    {SLIDES_PER_PAGE_OPTIONS.map((n) => {
                      const layout = SLIDE_LAYOUT[n];
                      return (
                        <button
                          key={n}
                          type="button"
                          onClick={() => setSlidesPerPage(n)}
                          className={cn(
                            "flex flex-col items-center gap-1 rounded-xl border-2 p-2 transition-colors",
                            slidesPerPage === n
                              ? "border-blue-500 bg-blue-50"
                              : "border-gray-200 bg-white"
                          )}
                        >
                          <div
                            style={{
                              display: "grid",
                              gridTemplateColumns: `repeat(${layout.cols}, 1fr)`,
                              gridTemplateRows:    `repeat(${layout.rows}, 1fr)`,
                              width: 28,
                              height: 36,
                              gap: "2px",
                              padding: "2px",
                              backgroundColor: "#d1d5db",
                              borderRadius: 3,
                            }}
                          >
                            {Array.from({ length: n }).map((_, i) => (
                              <div
                                key={i}
                                style={{
                                  backgroundColor:
                                    slidesPerPage === n ? "#60a5fa" : "#f3f4f6",
                                  borderRadius: 1,
                                }}
                              />
                            ))}
                          </div>
                          <span className={cn(
                            "text-xs font-semibold",
                            slidesPerPage === n ? "text-blue-700" : "text-gray-500"
                          )}>
                            {n}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                  {slidesPerPage > 1 && rawEffectiveCount > 0 && (
                    <p className="mt-2 text-xs text-gray-500">
                      {Math.ceil(rawEffectiveCount / slidesPerPage)}{" "}
                      {Math.ceil(rawEffectiveCount / slidesPerPage) === 1 ? "hoja" : "hojas"} de impresión
                      ({slidesPerPage} diapositiva{slidesPerPage !== 1 ? "s" : ""} por hoja)
                    </p>
                  )}
                </div>
              )}

              <Input
                {...register("copyCount")}
                label="Cantidad de copias"
                type="number"
                inputMode="numeric"
                min={1}
                max={99}
                error={errors.copyCount?.message}
                required
              />
            </div>
          </Card>

          {/* Estimación de precio */}
          {files.length > 0 && !isConverting && (
            <div className="rounded-xl border border-blue-200 bg-blue-50 p-4">
              <p className="text-sm font-semibold text-blue-900">Estimación de precio</p>
              <div className="mt-2 space-y-1 text-sm text-blue-700">
                {imageMode && files.length > 1 && (
                  <div className="flex justify-between">
                    <span>Imágenes:</span><span>{files.length}</span>
                  </div>
                )}
                {pptxMode && slidesPerPage > 1 && (
                  <div className="flex justify-between">
                    <span>Diapositivas:</span><span>{rawEffectiveCount}</span>
                  </div>
                )}
                <div className="flex justify-between">
                  <span>Hojas a imprimir:</span>
                  <span>{wordMode ? "?" : effectivePageCount}</span>
                </div>
                <div className="flex justify-between">
                  <span>Copias:</span><span>{currentCopyCount}</span>
                </div>
                <div className="flex justify-between">
                  <span>Precio por hoja:</span><span>{formatCurrency(pricePerPage)}</span>
                </div>
                {wordMode ? (
                  <p className="border-t border-blue-200 pt-1 text-xs text-blue-500">
                    El precio final se calcula al imprimir (páginas desconocidas).
                  </p>
                ) : (
                  <div className="flex justify-between border-t border-blue-200 pt-1 font-bold">
                    <span>Total estimado:</span><span>{formatCurrency(estimatedTotal)}</span>
                  </div>
                )}
              </div>
            </div>
          )}

          <Button
            type="submit"
            className="w-full"
            size="lg"
            disabled={isConverting}
            loading={isConverting}
          >
            {isConverting ? "Procesando archivo…" : "Revisar y confirmar"}
          </Button>
        </form>
      </>
    );
  }

  // ── PASO 2: Resumen ────────────────────────────────────────

  if (step === "summary" && formValues) {
    const rangeLabel =
      wordMode
        ? "Todo el documento"
        : imageMode
          ? `${pageCount} ${pageCount === 1 ? "página" : "páginas"}`
          : printRange === "all"
            ? `${pageCount} ${pptxMode ? "diapositivas" : (pageCount === 1 ? "página" : "páginas")} (todo)`
            : printRange === "single"
              ? `${pptxMode ? "Diapositiva" : "Página"} ${rangeSinglePage} (1 de ${pageCount})`
              : `${pptxMode ? "Diapositivas" : "Páginas"} ${rangeFrom}–${rangeTo} (${rawEffectiveCount} de ${pageCount})`;

    const fileTypeLabel = pdfMode ? "PDF" : wordMode ? "Word" : pptxMode ? "PowerPoint"
      : files.length === 1 ? "Imagen" : `${files.length} imágenes`;

    const summaryRows = [
      { label: "Nombre",          value: formValues.clientName },
      {
        label: "Archivo",
        value: pdfMode
          ? files[0].name
          : imageMode
            ? (files.length === 1 ? files[0].name : `${files.length} imágenes`)
            : files[0].name,
      },
      { label: "Tipo de archivo", value: fileTypeLabel },
      { label: "Formato",         value: `${PAPER_LABEL} (${PAPER_DESC})` },
      ...(imageMode ? [{ label: "Distribución", value: `${imagesPerPage} imagen${imagesPerPage !== 1 ? "es" : ""} por hoja` }] : []),
      { label: "Tipo",            value: formValues.printType === "bw" ? "Blanco y Negro" : "Color" },
      { label: pptxMode ? "Diapositivas" : "Páginas", value: rangeLabel },
      ...(pptxMode ? [{ label: "Por hoja", value: `${slidesPerPage} diapositiva${slidesPerPage !== 1 ? "s" : ""}` }] : []),
      { label: "Hojas a imprimir", value: wordMode ? "Según documento" : String(effectivePageCount) },
      { label: "Copias",           value: String(formValues.copyCount) },
      { label: "Precio por hoja",  value: formatCurrency(pricePerPage) },
    ];

    return (
      <>
        {previewModal}
        <div className="space-y-6">
          <Card>
            <h3 className="mb-4 text-base font-semibold text-gray-900">Revisa tu pedido</h3>

            {thumbnailUrl && (
              <div className="mb-4 flex justify-center">
                <div
                  className="overflow-hidden rounded-xl border border-gray-200 shadow-sm transition-all duration-300"
                  style={{
                    maxHeight: 180,
                    width: (pdfMode || imageMode)
                      ? Math.round(180 * (PAPER_W / PAPER_H))
                      : "auto",
                  }}
                >
                  <img
                    src={thumbnailUrl}
                    alt="Vista previa del archivo"
                    className="max-h-44 object-contain"
                  />
                </div>
              </div>
            )}

            <dl className="space-y-3">
              {summaryRows.map((row) => (
                <div key={row.label} className="flex justify-between text-sm">
                  <dt className="text-gray-500">{row.label}</dt>
                  <dd className="max-w-[200px] truncate text-right font-medium text-gray-900">
                    {row.value}
                  </dd>
                </div>
              ))}
              {!wordMode && (
                <div className="flex justify-between border-t border-gray-100 pt-3 text-base">
                  <dt className="font-semibold text-gray-900">Total a pagar</dt>
                  <dd className="font-bold text-blue-600">{formatCurrency(estimatedTotal)}</dd>
                </div>
              )}
            </dl>

            {imageMode && previewPages && (
              <button
                type="button"
                onClick={handleShowPreview}
                className="mt-4 flex w-full items-center justify-center gap-2 rounded-xl border border-blue-200 bg-blue-50 py-2.5 text-sm font-medium text-blue-700 active:bg-blue-100"
              >
                <Eye className="h-4 w-4" />
                Ver previa del documento
              </button>
            )}
          </Card>

          {!wordMode && effectivePageCount * formValues.copyCount > maxPagesNoApproval && (
            <div className="rounded-xl border border-yellow-200 bg-yellow-50 p-4">
              <p className="flex items-start gap-2 text-sm text-yellow-800">
                <AlertCircle className="mt-0.5 h-4 w-4 flex-shrink-0" />
                El total ({effectivePageCount} hojas × {formValues.copyCount}{" "}
                {formValues.copyCount === 1 ? "copia" : "copias"} ={" "}
                {effectivePageCount * formValues.copyCount} hojas) supera el límite de{" "}
                {maxPagesNoApproval} y requiere aprobación del administrador.
              </p>
            </div>
          )}

          {serverError && (
            <div className="rounded-xl border border-red-200 bg-red-50 p-4">
              <p className="text-sm text-red-700">{serverError}</p>
            </div>
          )}

          <div className="flex gap-3">
            <Button
              variant="outline"
              className="flex-1"
              onClick={() => setStep("form")}
              disabled={isSubmitting}
            >
              Editar
            </Button>
            <Button className="flex-1" onClick={confirmAndSubmit} loading={isSubmitting}>
              {isSubmitting ? "Enviando…" : "Confirmar y enviar"}
            </Button>
          </div>
        </div>
      </>
    );
  }

  // ── PASO 3: Éxito ──────────────────────────────────────────

  if (step === "success" && successData) {
    return (
      <div className="text-center">
        <div className="mb-6 flex flex-col items-center">
          <div className="mb-4 flex h-20 w-20 items-center justify-center rounded-full bg-green-100">
            <CheckCircle className="h-10 w-10 text-green-600" />
          </div>
          <h2 className="text-xl font-bold text-gray-900">¡Archivo recibido!</h2>
          <p className="mt-2 text-sm text-gray-500">Tu solicitud fue registrada con éxito.</p>
        </div>

        <Card>
          <dl className="space-y-3 text-sm">
            <div className="flex justify-between">
              <dt className="text-gray-500">Nombre</dt>
              <dd className="font-medium text-gray-900">{successData.clientName}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-gray-500">Correlativo</dt>
              <dd className="font-mono font-bold text-blue-700">{successData.correlative}</dd>
            </div>
            <div className="flex justify-between border-t border-gray-100 pt-3">
              <dt className="font-semibold text-gray-900">Total a pagar</dt>
              <dd className="font-bold text-blue-600">{formatCurrency(successData.totalPrice)}</dd>
            </div>
          </dl>
        </Card>

        <div className="mt-6 rounded-xl border border-blue-200 bg-blue-50 p-4">
          <p className="text-sm font-semibold text-blue-900">¿Qué sigue?</p>
          <p className="mt-1 text-sm text-blue-700">
            Acércate al mostrador con tu correlativo{" "}
            <strong>{successData.correlative}</strong> para pagar y retirar tu impresión.
          </p>
        </div>
      </div>
    );
  }

  return null;
}
