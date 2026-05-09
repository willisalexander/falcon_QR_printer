"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { z } from "zod";

const uuidSchema = z.string().uuid();

async function requireStaff() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error("No autorizado");

  const { data: profile } = await supabase
    .from("profiles")
    .select("role, is_active")
    .eq("id", user.id)
    .single();

  if (!profile?.is_active || !["admin", "operator"].includes(profile.role ?? "")) {
    throw new Error("No autorizado");
  }
  return { supabase, user };
}

function validateUuid(id: string): string | null {
  const r = uuidSchema.safeParse(id);
  return r.success ? null : "ID inválido";
}

export async function approveJob(jobId: string) {
  const uuidErr = validateUuid(jobId);
  if (uuidErr) return { success: false, error: uuidErr };

  try {
    const { supabase, user } = await requireStaff();
    const { error } = await supabase
      .from("print_jobs")
      .update({ status: "approved", approved_by: user.id, approved_at: new Date().toISOString() })
      .eq("id", jobId);

    if (error) return { success: false, error: error.message };
    revalidatePath("/admin/print-jobs");
    revalidatePath(`/admin/print-jobs/${jobId}`);
    revalidatePath("/admin/dashboard");
    return { success: true };
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : "Error" };
  }
}

export async function rejectJob(jobId: string, reason: string) {
  const uuidErr = validateUuid(jobId);
  if (uuidErr) return { success: false, error: uuidErr };

  const safeReason = String(reason).slice(0, 500);

  try {
    const { supabase, user } = await requireStaff();
    const { error } = await supabase
      .from("print_jobs")
      .update({ status: "rejected", rejected_reason: safeReason, approved_by: user.id })
      .eq("id", jobId);

    if (error) return { success: false, error: error.message };
    revalidatePath("/admin/print-jobs");
    revalidatePath(`/admin/print-jobs/${jobId}`);
    revalidatePath("/admin/dashboard");
    return { success: true };
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : "Error" };
  }
}

export async function markAsPrinted(jobId: string) {
  const uuidErr = validateUuid(jobId);
  if (uuidErr) return { success: false, error: uuidErr };

  try {
    const { supabase } = await requireStaff();
    const { error } = await supabase
      .from("print_jobs")
      .update({ status: "printed", printed_at: new Date().toISOString() })
      .eq("id", jobId);

    if (error) return { success: false, error: error.message };
    revalidatePath("/admin/print-jobs");
    revalidatePath(`/admin/print-jobs/${jobId}`);
    revalidatePath("/admin/dashboard");
    return { success: true };
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : "Error" };
  }
}

export async function markAsPaid(jobId: string) {
  const uuidErr = validateUuid(jobId);
  if (uuidErr) return { success: false, error: uuidErr };

  try {
    const { supabase } = await requireStaff();
    const { error } = await supabase
      .from("print_jobs")
      .update({ status: "paid", paid_at: new Date().toISOString() })
      .eq("id", jobId);

    if (error) return { success: false, error: error.message };
    revalidatePath("/admin/print-jobs");
    revalidatePath(`/admin/print-jobs/${jobId}`);
    revalidatePath("/admin/dashboard");
    return { success: true };
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : "Error" };
  }
}

export async function markAsFailed(jobId: string, reason?: string) {
  const uuidErr = validateUuid(jobId);
  if (uuidErr) return { success: false, error: uuidErr };

  try {
    const { supabase } = await requireStaff();
    const { error } = await supabase
      .from("print_jobs")
      .update({ status: "failed", rejected_reason: String(reason ?? "Fallo al imprimir").slice(0, 500) })
      .eq("id", jobId);

    if (error) return { success: false, error: error.message };
    revalidatePath("/admin/print-jobs");
    revalidatePath(`/admin/print-jobs/${jobId}`);
    return { success: true };
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : "Error" };
  }
}
