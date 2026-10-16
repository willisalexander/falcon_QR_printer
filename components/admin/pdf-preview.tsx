"use client";

import { useEffect, useRef, useState } from "react";
import { Download, ExternalLink } from "lucide-react";

interface Props {
  /** URL temporal (blob) del PDF que entregó el agente local. */
  url: string;
  /** Nombre original del documento, para descargar con un nombre reconocible. */
  name: string;
}

const MAX_PAGES = 40;

/**
 * Vista previa que dibuja el PDF en el propio panel, con pdf.js.
 * No depende del visor del navegador: funciona aunque esté configurado
 * para descargar los PDF en lugar de mostrarlos.
 */
export function PdfPreview({ url, name }: Props) {
  const container = useRef<HTMLDivElement>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [pages, setPages] = useState(0);
  const downloadName = name.replace(/\.(docx?|pdf)$/i, "") + ".pdf";

  useEffect(() => {
    let cancelled = false;
    const host = container.current;
    if (!host) return;
    host.innerHTML = "";
    setStatus("loading");

    (async () => {
      try {
        const pdfjs = await import("pdfjs-dist");
        // Mismo origen del "worker" que usa el formulario QR, con la versión exacta instalada.
        pdfjs.GlobalWorkerOptions.workerSrc = `https://unpkg.com/pdfjs-dist@${pdfjs.version}/build/pdf.worker.min.mjs`;
        const data = new Uint8Array(await (await fetch(url)).arrayBuffer());
        const doc = await pdfjs.getDocument({ data }).promise;
        if (cancelled) return;
        setPages(doc.numPages);
        const width = Math.max(200, host.clientWidth - 24);
        const ratio = window.devicePixelRatio || 1;

        for (let n = 1; n <= Math.min(doc.numPages, MAX_PAGES) && !cancelled; n++) {
          const page = await doc.getPage(n);
          const base = page.getViewport({ scale: 1 });
          const viewport = page.getViewport({ scale: (width / base.width) * ratio });
          const canvas = document.createElement("canvas");
          canvas.width = viewport.width;
          canvas.height = viewport.height;
          canvas.style.width = `${viewport.width / ratio}px`;
          canvas.style.height = `${viewport.height / ratio}px`;
          canvas.className = "mx-auto mb-3 block bg-white shadow";
          canvas.setAttribute("aria-label", `Página ${n}`);
          host.appendChild(canvas);
          await page.render({ canvas, viewport }).promise;
          if (n === 1 && !cancelled) setStatus("ready");
        }
        if (!cancelled) setStatus("ready");
      } catch {
        if (!cancelled) setStatus("error");
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [url]);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-center gap-3 border-b border-gray-100 px-3 py-1.5 text-xs">
        <span className="text-gray-500">{pages ? `${pages} página(s)` : ""}</span>
        <a href={url} target="_blank" rel="noopener noreferrer" className="ml-auto flex items-center gap-1 text-blue-600 hover:underline">
          <ExternalLink className="h-3.5 w-3.5" />
          Abrir en pestaña nueva
        </a>
        <a href={url} download={downloadName} className="flex items-center gap-1 text-blue-600 hover:underline">
          <Download className="h-3.5 w-3.5" />
          Descargar
        </a>
      </div>
      <div className="relative min-h-0 flex-1 overflow-auto bg-gray-100 p-3">
        {status === "loading" && <p className="absolute inset-x-0 top-8 text-center text-sm text-gray-500">Cargando vista previa…</p>}
        {status === "error" && (
          <p className="px-4 py-8 text-center text-sm text-red-600">
            No se pudo dibujar la vista previa. Use “Abrir en pestaña nueva” o “Descargar”.
          </p>
        )}
        {pages > MAX_PAGES && status === "ready" && (
          <p className="mb-3 text-center text-xs text-gray-500">
            Se muestran las primeras {MAX_PAGES} páginas de {pages}. Abra el documento para ver el resto.
          </p>
        )}
        <div ref={container} />
      </div>
    </div>
  );
}
