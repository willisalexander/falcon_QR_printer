"use client";

import { useEffect } from "react";
import { Printer } from "lucide-react";
import { getOrCreateAutoToken } from "./actions";

interface DisplayClientProps {
  tokenSlug: string;
  tokenCreatedAt: string;
  useCount: number;
  maxUses: number;
  maxAgeMs: number;
  svgQr: string;
  businessName: string;
}

const POLL_MS = 10_000;

export function DisplayClient({
  tokenSlug,
  tokenCreatedAt,
  maxAgeMs,
  svgQr,
  businessName,
}: DisplayClientProps) {
  // Recarga cuando el token expira por tiempo
  useEffect(() => {
    const expiresAt = new Date(tokenCreatedAt).getTime() + maxAgeMs;
    const ms = Math.max(0, expiresAt - Date.now());
    const id = setTimeout(() => window.location.reload(), ms);
    return () => clearTimeout(id);
  }, [tokenCreatedAt, maxAgeMs]);

  // Polling: detecta cambio de token y recarga si hay uno nuevo
  useEffect(() => {
    const id = setInterval(async () => {
      try {
        const info = await getOrCreateAutoToken();
        if (info.tokenSlug !== tokenSlug) {
          window.location.reload();
        }
      } catch {
        // ignorar errores de red
      }
    }, POLL_MS);
    return () => clearInterval(id);
  }, [tokenSlug]);

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-gray-950 px-6 py-10 text-white">
      <div className="mb-8 flex items-center gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-blue-600">
          <Printer className="h-5 w-5 text-white" />
        </div>
        <h1 className="text-2xl font-bold tracking-tight">{businessName}</h1>
      </div>

      <p className="mb-6 text-center text-lg text-gray-300">
        Escanea el codigo QR con tu celular<br />
        para enviar tu archivo a imprimir
      </p>

      <div
        className="rounded-2xl bg-white p-5 shadow-2xl"
        dangerouslySetInnerHTML={{ __html: svgQr }}
        style={{ width: 280, height: 280 }}
      />
    </div>
  );
}
