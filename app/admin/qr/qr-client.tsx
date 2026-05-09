"use client";

import { useState, useTransition } from "react";
import Image from "next/image";
import {
  Plus, Download, Copy, Check, Trash2,
  ToggleLeft, ToggleRight, QrCode,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Modal } from "@/components/ui/modal";
import { cn } from "@/lib/utils";
import { createToken, deleteToken, toggleQrActive } from "./actions";
import type { QrToken } from "@/types";

interface TokenEntry {
  token: QrToken;
  qrDataUrl: string;
  printUrl: string;
}

export function QrClient({ tokens }: { tokens: TokenEntry[] }) {
  const [isPending, startTransition] = useTransition();
  const [createOpen, setCreateOpen] = useState(false);
  const [label, setLabel] = useState("");
  const [createError, setCreateError] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  function handleCreate() {
    setCreateError(null);
    startTransition(async () => {
      const res = await createToken(label);
      if (res.success) {
        setCreateOpen(false);
        setLabel("");
      } else {
        setCreateError(res.error ?? "Error al crear el QR");
      }
    });
  }

  function handleDelete(id: string) {
    if (!confirm("¿Eliminar este código QR? Los trabajos existentes no se verán afectados.")) return;
    startTransition(() => { void deleteToken(id); });
  }

  function handleToggle(id: string, current: boolean) {
    startTransition(() => { void toggleQrActive(id, !current); });
  }

  function handleCopy(id: string, url: string) {
    navigator.clipboard.writeText(url);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
  }

  function handleDownload(qrDataUrl: string, tokenStr: string) {
    const a = document.createElement("a");
    a.href = qrDataUrl;
    a.download = `qr-${tokenStr.slice(0, 8)}.png`;
    a.click();
  }

  return (
    <>
      {/* Cabecera */}
      <div className="mb-6 flex items-center justify-between">
        <p className="text-sm text-gray-500">
          {tokens.length === 0
            ? "No hay códigos QR. Crea el primero."
            : `${tokens.length} código${tokens.length !== 1 ? "s" : ""} QR`}
        </p>
        <Button onClick={() => setCreateOpen(true)}>
          <Plus className="h-4 w-4" />
          Nuevo QR
        </Button>
      </div>

      {/* Sin tokens */}
      {tokens.length === 0 && (
        <div className="flex flex-col items-center justify-center rounded-2xl border-2 border-dashed border-gray-200 py-20 text-center">
          <QrCode className="mb-4 h-12 w-12 text-gray-300" />
          <p className="text-gray-400">Crea tu primer código QR para empezar a recibir trabajos.</p>
          <Button className="mt-6" onClick={() => setCreateOpen(true)}>
            <Plus className="h-4 w-4" />
            Crear primer QR
          </Button>
        </div>
      )}

      {/* Grid de tokens */}
      <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
        {tokens.map(({ token, qrDataUrl, printUrl }) => (
          <div
            key={token.id}
            className={cn(
              "rounded-2xl border p-5 transition-colors",
              token.is_active ? "border-gray-200 bg-white" : "border-gray-100 bg-gray-50 opacity-75"
            )}
          >
            {/* QR image */}
            <div className="flex justify-center">
              <div
                className={cn(
                  "rounded-xl border-4 p-1",
                  token.is_active ? "border-blue-400" : "border-gray-300"
                )}
              >
                <Image
                  src={qrDataUrl}
                  alt={`QR ${token.label}`}
                  width={160}
                  height={160}
                  unoptimized
                />
              </div>
            </div>

            {/* Info */}
            <div className="mt-4 text-center">
              <p className="text-base font-semibold text-gray-900">{token.label}</p>
              <div className="mt-1 flex items-center justify-center gap-2">
                <span
                  className={cn(
                    "rounded-full px-2.5 py-0.5 text-xs font-medium",
                    token.is_active
                      ? "bg-green-100 text-green-700"
                      : "bg-gray-100 text-gray-500"
                  )}
                >
                  {token.is_active ? "Activo" : "Inactivo"}
                </span>
                <span className="text-xs text-gray-400">{token.use_count} usos</span>
              </div>
            </div>

            {/* URL */}
            <div className="mt-3 flex items-center gap-1 rounded-lg border border-gray-200 bg-gray-50 px-2 py-1.5">
              <span className="flex-1 truncate font-mono text-[10px] text-gray-500">{printUrl}</span>
              <button
                onClick={() => handleCopy(token.id, printUrl)}
                className="rounded p-1 text-gray-400 hover:text-gray-700"
                title="Copiar URL"
              >
                {copiedId === token.id ? (
                  <Check className="h-3.5 w-3.5 text-green-600" />
                ) : (
                  <Copy className="h-3.5 w-3.5" />
                )}
              </button>
            </div>

            {/* Acciones */}
            <div className="mt-4 flex flex-wrap gap-2 border-t border-gray-100 pt-3">
              <Button
                size="sm"
                variant="outline"
                onClick={() => handleDownload(qrDataUrl, token.token)}
              >
                <Download className="h-3.5 w-3.5" />
                Descargar
              </Button>
              <Button
                size="sm"
                variant="ghost"
                disabled={isPending}
                onClick={() => handleToggle(token.id, token.is_active)}
              >
                {token.is_active ? (
                  <ToggleRight className="h-3.5 w-3.5" />
                ) : (
                  <ToggleLeft className="h-3.5 w-3.5" />
                )}
                {token.is_active ? "Desactivar" : "Activar"}
              </Button>
              <Button
                size="sm"
                variant="ghost"
                disabled={isPending}
                onClick={() => handleDelete(token.id)}
                className="ml-auto text-red-500 hover:bg-red-50 hover:text-red-700"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </Button>
            </div>
          </div>
        ))}
      </div>

      {/* Modal crear QR */}
      <Modal
        open={createOpen}
        onClose={() => { setCreateOpen(false); setLabel(""); setCreateError(null); }}
        title="Crear nuevo código QR"
        className="max-w-sm"
      >
        <div className="space-y-4">
          <Input
            label="Etiqueta"
            placeholder="Ej: Mostrador principal"
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleCreate()}
            autoFocus
          />
          {createError && <p className="text-sm text-red-600">{createError}</p>}
          <div className="flex justify-end gap-3 pt-1">
            <Button variant="outline" onClick={() => setCreateOpen(false)} disabled={isPending}>
              Cancelar
            </Button>
            <Button onClick={handleCreate} loading={isPending} disabled={!label.trim()}>
              Crear QR
            </Button>
          </div>
        </div>
      </Modal>
    </>
  );
}
