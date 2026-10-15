"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { z } from "zod";

const PAPER_KEYS = ["carta", "a4", "oficio2", "legal"] as const;

const printerSchema = z.object({
  name: z.string().min(2, "Nombre requerido"),
  system_name: z.string().min(1, "Nombre del sistema requerido"),
  print_type: z.enum(["bw", "color"]),
  is_active: z.boolean().default(true),
  location: z.string().optional(),
  notes: z.string().optional(),
  supports_duplex: z.boolean().default(false),
  paper_sizes: z.array(z.enum(PAPER_KEYS)).min(1, "Marque al menos un tamaño de papel"),
  trays: z.record(z.enum(PAPER_KEYS), z.string().max(100)),
  priority: z.coerce.number().int().min(1).max(999).default(100),
  capabilities_checked: z.boolean().default(false),
});

// Las políticas RLS ya limitan la escritura a administradores; se comprueba
// también aquí para devolver un mensaje claro en lugar de un fallo silencioso.
async function requireAdmin() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { supabase, error: "No autorizado" };
  const { data: profile } = await supabase.from("profiles").select("role, is_active").eq("id", user.id).single();
  if (!profile?.is_active || profile.role !== "admin") return { supabase, error: "Se requieren permisos de administrador" };
  return { supabase, error: null };
}

function parseForm(formData: FormData) {
  const paper_sizes = PAPER_KEYS.filter((k) => formData.get(`paper_${k}`) === "on");
  const trays: Record<string, string> = {};
  for (const k of paper_sizes) {
    const tray = String(formData.get(`tray_${k}`) ?? "").trim();
    if (tray) trays[k] = tray;
  }
  const parsed = printerSchema.safeParse({
    name: formData.get("name") as string,
    system_name: formData.get("system_name") as string,
    print_type: formData.get("print_type") as string,
    is_active: formData.get("is_active") === "true",
    location: formData.get("location") as string,
    notes: formData.get("notes") as string,
    supports_duplex: formData.get("supports_duplex") === "on",
    paper_sizes,
    trays,
    priority: formData.get("priority") || 100,
    capabilities_checked: formData.get("capabilities_checked") === "true",
  });
  if (!parsed.success) return { error: parsed.error.errors[0].message };
  const { capabilities_checked, ...row } = parsed.data;
  return {
    row: {
      ...row,
      supports_color: row.print_type === "color",
      ...(capabilities_checked && { capabilities_checked_at: new Date().toISOString() }),
    },
  };
}

export async function createPrinter(formData: FormData) {
  const { supabase, error: authError } = await requireAdmin();
  if (authError) return { success: false, error: authError };

  const { row, error: formError } = parseForm(formData);
  if (!row) return { success: false, error: formError };

  const { error } = await supabase.from("printers").insert(row);
  if (error) return { success: false, error: error.message };

  revalidatePath("/admin/printers");
  return { success: true };
}

export async function updatePrinter(id: string, formData: FormData) {
  const { supabase, error: authError } = await requireAdmin();
  if (authError) return { success: false, error: authError };

  const { row, error: formError } = parseForm(formData);
  if (!row) return { success: false, error: formError };

  const { error } = await supabase
    .from("printers")
    .update(row)
    .eq("id", id);

  if (error) return { success: false, error: error.message };

  revalidatePath("/admin/printers");
  return { success: true };
}

export async function togglePrinterActive(id: string, isActive: boolean) {
  const { supabase, error: authError } = await requireAdmin();
  if (authError) return { success: false, error: authError };

  const { error } = await supabase
    .from("printers")
    .update({ is_active: isActive })
    .eq("id", id);

  if (error) return { success: false, error: error.message };
  revalidatePath("/admin/printers");
  return { success: true };
}

export async function setDefaultPrinter(
  id: string,
  type: "bw" | "color"
) {
  const { supabase, error: authError } = await requireAdmin();
  if (authError) return { success: false, error: authError };

  // Quitar default anterior
  const field = type === "bw" ? "is_default_bw" : "is_default_color";
  await supabase
    .from("printers")
    .update({ [field]: false })
    .eq(field, true);

  // Poner nuevo default
  const { error } = await supabase
    .from("printers")
    .update({ [field]: true })
    .eq("id", id);

  if (error) return { success: false, error: error.message };
  revalidatePath("/admin/printers");
  return { success: true };
}

export async function deletePrinter(id: string) {
  const { supabase, error: authError } = await requireAdmin();
  if (authError) return { success: false, error: authError };

  const { error } = await supabase.from("printers").delete().eq("id", id);
  if (error) return { success: false, error: error.message };
  revalidatePath("/admin/printers");
  return { success: true };
}
