"use server";

import { createServiceClient } from "@/lib/supabase/server";
import { z } from "zod";

const submitSchema = z.object({
  qrTokenId:        z.string().uuid("Token inválido"),
  clientName:       z.string().min(2, "Nombre muy corto").max(100).trim(),
  printType:        z.enum(["bw", "color"]),
  pageCount:        z.number().int().min(1).max(500),
  copyCount:        z.number().int().min(1).max(99),
  filePath:         z.string().min(5).max(500),
  originalFileName: z.string().min(1).max(255),
  thumbnailPath:    z.string().max(500).optional(),
  slidesPerPage:    z.number().int().min(1).max(9).optional(),
});

type PrintJobInput = z.infer<typeof submitSchema>;

type PrintJobResult =
  | { success: true; correlative: string; totalPrice: number; clientName: string }
  | { success: false; error: string };

export async function submitPrintJob(input: unknown): Promise<PrintJobResult> {
  const supabase = await createServiceClient();

  // 1. Validar schema
  const parsed = submitSchema.safeParse(input);
  if (!parsed.success) {
    return { success: false, error: "Datos inválidos: " + parsed.error.errors[0].message };
  }
  const data: PrintJobInput = parsed.data;

  // 2. Validar QR token activo
  const { data: qrToken } = await supabase
    .from("qr_tokens")
    .select("id, is_active, expires_at")
    .eq("id", data.qrTokenId)
    .single();

  if (!qrToken || !qrToken.is_active) {
    return { success: false, error: "Token QR inválido o inactivo." };
  }
  if (qrToken.expires_at && new Date(qrToken.expires_at) < new Date()) {
    return { success: false, error: "El código QR ha expirado." };
  }

  // 3. Rate limiting: máx 10 trabajos por token por hora
  const since = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  const { count: recentCount } = await supabase
    .from("print_jobs")
    .select("id", { count: "exact", head: true })
    .eq("qr_token_id", data.qrTokenId)
    .gte("created_at", since);

  if ((recentCount ?? 0) >= 10) {
    return { success: false, error: "Demasiados envíos. Espera unos minutos e intenta de nuevo." };
  }

  // 4. Leer precios y límites desde la BD (no confiar en el cliente)
  const { data: settingsRows } = await supabase
    .from("settings")
    .select("key, value")
    .in("key", ["price_bw", "price_color", "max_pages_without_approval"]);

  const settings = Object.fromEntries((settingsRows ?? []).map((s) => [s.key, s.value]));
  const priceBw             = parseFloat(settings["price_bw"] ?? "0.50");
  const priceColor          = parseFloat(settings["price_color"] ?? "2.00");
  const maxPagesNoApproval  = parseInt(settings["max_pages_without_approval"] ?? "20");

  if (isNaN(priceBw) || isNaN(priceColor) || priceBw <= 0 || priceColor <= 0) {
    return { success: false, error: "Configuración de precios inválida. Contacta al administrador." };
  }

  // 5. Calcular precio en el servidor
  const pricePerPage = data.printType === "bw" ? priceBw : priceColor;
  const totalPrice   = Math.round(pricePerPage * data.pageCount * data.copyCount * 100) / 100;
  const totalSheets = data.pageCount * data.copyCount;
  const initialStatus = totalSheets > maxPagesNoApproval ? "pending_approval" : "approved";

  // 6. Generar correlativo
  const { data: correlative, error: corrError } = await supabase.rpc("generate_daily_correlative");
  if (corrError || !correlative) {
    return { success: false, error: "Error al generar el correlativo." };
  }

  // 7. Insertar trabajo
  const { data: job, error: jobError } = await supabase
    .from("print_jobs")
    .insert({
      correlative,
      client_name:          data.clientName,
      print_type:           data.printType,
      page_count:           data.pageCount,
      copy_count:           data.copyCount,
      price_per_page_bw:    priceBw,
      price_per_page_color: priceColor,
      total_price:          totalPrice,
      status:               initialStatus,
      file_path:            data.filePath,
      original_file_name:   data.originalFileName,
      thumbnail_path:       data.thumbnailPath ?? null,
      qr_token_id:          data.qrTokenId,
      images_per_page:      data.slidesPerPage ?? 1,
    })
    .select("id, correlative, total_price, client_name")
    .single();

  if (jobError || !job) {
    return { success: false, error: "Error al registrar el trabajo: " + (jobError?.message ?? "desconocido") };
  }

  await supabase.from("print_job_events").insert({
    print_job_id: job.id,
    event_type:   "created",
    description:  `Trabajo creado desde formulario QR. Estado: ${initialStatus}`,
    new_status:   initialStatus,
  });

  // Incrementar contador de usos del token QR
  await supabase.rpc("increment_qr_use_count", { token_id: data.qrTokenId });

  return {
    success:    true,
    correlative: job.correlative,
    totalPrice:  Number(job.total_price),
    clientName:  job.client_name,
  };
}
