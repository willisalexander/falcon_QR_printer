import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { PrintForm } from "./print-form";
import { Printer } from "lucide-react";
import type { Metadata } from "next";

interface PageProps {
  params: Promise<{ token: string }>;
}

export const metadata: Metadata = {
  title: "Enviar Impresión",
};

export default async function PrintPage({ params }: PageProps) {
  const { token } = await params;
  const supabase = await createClient();

  // Validar el token QR
  const { data: qrToken } = await supabase
    .from("qr_tokens")
    .select("id, is_active, expires_at")
    .eq("token", token)
    .single();

  if (!qrToken) {
    notFound();
  }

  if (!qrToken.is_active) {
    notFound();
  }

  if (qrToken.expires_at && new Date(qrToken.expires_at) < new Date()) {
    notFound();
  }

  // Obtener configuración del sistema
  const { data: settingsRows } = await supabase
    .from("settings")
    .select("key, value");

  const settings = Object.fromEntries(
    (settingsRows ?? []).map((s) => [s.key, s.value])
  );

  const systemActive = settings["system_active"] !== "false";
  const publicMessage =
    settings["public_message"] ??
    "Escanea el código QR para enviar tu impresión.";
  const businessName = settings["business_name"] ?? "Print QR System";
  const priceBw = parseFloat(settings["price_bw"] ?? "0.50");
  const priceColor = parseFloat(settings["price_color"] ?? "2.00");
  const maxPagesNoApproval = parseInt(
    settings["max_pages_without_approval"] ?? "20"
  );
  const maxFileSizeMb = parseInt(settings["max_file_size_mb"] ?? "10");

  if (!systemActive) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center bg-gray-50 px-4 text-center">
        <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-yellow-100">
          <Printer className="h-8 w-8 text-yellow-600" />
        </div>
        <h1 className="text-xl font-bold text-gray-900">
          Sistema temporalmente inactivo
        </h1>
        <p className="mt-2 text-sm text-gray-500">
          {publicMessage}
          <br />
          Por favor, acércate al mostrador.
        </p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <header className="border-b border-gray-200 bg-white shadow-sm">
        <div className="mx-auto flex max-w-lg items-center gap-3 px-4 py-4">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-blue-600">
            <Printer className="h-5 w-5 text-white" />
          </div>
          <div>
            <h1 className="text-base font-bold text-gray-900">{businessName}</h1>
            <p className="text-xs text-gray-500">Servicio de Impresión</p>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-lg px-4 py-8">
        <div className="mb-6">
          <h2 className="text-xl font-bold text-gray-900">
            Enviar archivo para impresión
          </h2>
          <p className="mt-1 text-sm text-gray-500">{publicMessage}</p>
        </div>

        <PrintForm
          qrTokenId={qrToken.id}
          priceBw={priceBw}
          priceColor={priceColor}
          maxPagesNoApproval={maxPagesNoApproval}
          maxFileSizeMb={maxFileSizeMb}
        />
      </main>
    </div>
  );
}
