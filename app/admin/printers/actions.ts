"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { z } from "zod";

const printerSchema = z.object({
  name: z.string().min(2, "Nombre requerido"),
  system_name: z.string().min(1, "Nombre del sistema requerido"),
  print_type: z.enum(["bw", "color"]),
  is_active: z.boolean().default(true),
  location: z.string().optional(),
  notes: z.string().optional(),
});

export async function createPrinter(formData: FormData) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { success: false, error: "No autorizado" };

  const raw = {
    name: formData.get("name") as string,
    system_name: formData.get("system_name") as string,
    print_type: formData.get("print_type") as string,
    is_active: formData.get("is_active") === "true",
    location: formData.get("location") as string,
    notes: formData.get("notes") as string,
  };

  const parsed = printerSchema.safeParse(raw);
  if (!parsed.success) {
    return { success: false, error: parsed.error.errors[0].message };
  }

  const { error } = await supabase.from("printers").insert(parsed.data);
  if (error) return { success: false, error: error.message };

  revalidatePath("/admin/printers");
  return { success: true };
}

export async function updatePrinter(id: string, formData: FormData) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { success: false, error: "No autorizado" };

  const raw = {
    name: formData.get("name") as string,
    system_name: formData.get("system_name") as string,
    print_type: formData.get("print_type") as string,
    is_active: formData.get("is_active") === "true",
    location: formData.get("location") as string,
    notes: formData.get("notes") as string,
  };

  const parsed = printerSchema.safeParse(raw);
  if (!parsed.success) {
    return { success: false, error: parsed.error.errors[0].message };
  }

  const { error } = await supabase
    .from("printers")
    .update(parsed.data)
    .eq("id", id);

  if (error) return { success: false, error: error.message };

  revalidatePath("/admin/printers");
  return { success: true };
}

export async function togglePrinterActive(id: string, isActive: boolean) {
  const supabase = await createClient();
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
  const supabase = await createClient();

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
  const supabase = await createClient();
  const { error } = await supabase.from("printers").delete().eq("id", id);
  if (error) return { success: false, error: error.message };
  revalidatePath("/admin/printers");
  return { success: true };
}
