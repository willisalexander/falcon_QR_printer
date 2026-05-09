"use server";

import { revalidatePath } from "next/cache";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { z } from "zod";

async function requireAdmin() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error("No autorizado");

  const { data: profile } = await supabase
    .from("profiles")
    .select("role, is_active")
    .eq("id", user.id)
    .single();

  if (!profile?.is_active || profile.role !== "admin") {
    throw new Error("Se requieren permisos de administrador");
  }
  return user;
}

const uuidSchema = z.string().uuid();

export async function createUser(formData: FormData) {
  try { await requireAdmin(); } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : "No autorizado" };
  }

  const supabase = await createServiceClient();

  const email    = String(formData.get("email") ?? "").trim();
  const password = String(formData.get("password") ?? "");
  const fullName = String(formData.get("full_name") ?? "").trim();
  const role     = String(formData.get("role") ?? "operator");

  if (!email || !password || !fullName) {
    return { success: false, error: "Todos los campos son requeridos" };
  }
  if (password.length < 6) {
    return { success: false, error: "La contraseña debe tener mínimo 6 caracteres" };
  }
  if (!["admin", "operator"].includes(role)) {
    return { success: false, error: "Rol inválido" };
  }

  const { data, error } = await supabase.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { full_name: fullName, role },
  });

  if (error) return { success: false, error: error.message };

  if (data.user) {
    await supabase
      .from("profiles")
      .update({ role, full_name: fullName })
      .eq("id", data.user.id);
  }

  revalidatePath("/admin/users");
  return { success: true };
}

export async function updateUser(userId: string, formData: FormData) {
  try { await requireAdmin(); } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : "No autorizado" };
  }

  if (!uuidSchema.safeParse(userId).success) {
    return { success: false, error: "ID inválido" };
  }

  const supabase = await createServiceClient();

  const fullName = String(formData.get("full_name") ?? "").trim().slice(0, 100);
  const email    = String(formData.get("email") ?? "").trim();

  if (!fullName || !email) {
    return { success: false, error: "Nombre y correo son requeridos" };
  }

  // Actualizar email en Auth
  const { error: authError } = await supabase.auth.admin.updateUserById(userId, { email });
  if (authError) return { success: false, error: authError.message };

  // Actualizar perfil
  const { error: profileError } = await supabase
    .from("profiles")
    .update({ full_name: fullName, email })
    .eq("id", userId);

  if (profileError) return { success: false, error: profileError.message };

  revalidatePath("/admin/users");
  return { success: true };
}

export async function updateUserRole(userId: string, role: "admin" | "operator") {
  try { await requireAdmin(); } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : "No autorizado" };
  }

  if (!uuidSchema.safeParse(userId).success) {
    return { success: false, error: "ID inválido" };
  }

  const supabase = await createServiceClient();
  const { error } = await supabase.from("profiles").update({ role }).eq("id", userId);
  if (error) return { success: false, error: error.message };

  revalidatePath("/admin/users");
  return { success: true };
}

export async function toggleUserActive(userId: string, isActive: boolean) {
  try { await requireAdmin(); } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : "No autorizado" };
  }

  if (!uuidSchema.safeParse(userId).success) {
    return { success: false, error: "ID inválido" };
  }

  const supabase = await createServiceClient();
  const { error } = await supabase
    .from("profiles")
    .update({ is_active: Boolean(isActive) })
    .eq("id", userId);

  if (error) return { success: false, error: error.message };
  revalidatePath("/admin/users");
  return { success: true };
}

export async function changeUserPassword(userId: string, password: string) {
  try { await requireAdmin(); } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : "No autorizado" };
  }

  if (!uuidSchema.safeParse(userId).success) {
    return { success: false, error: "ID inválido" };
  }
  if (!password || password.length < 6) {
    return { success: false, error: "La contraseña debe tener mínimo 6 caracteres" };
  }

  const supabase = await createServiceClient();
  const { error } = await supabase.auth.admin.updateUserById(userId, { password });
  if (error) return { success: false, error: error.message };

  return { success: true };
}

export async function deleteUser(userId: string) {
  try { await requireAdmin(); } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : "No autorizado" };
  }

  if (!uuidSchema.safeParse(userId).success) {
    return { success: false, error: "ID inválido" };
  }

  const supabase = await createServiceClient();
  const { error } = await supabase.auth.admin.deleteUser(userId);
  if (error) return { success: false, error: error.message };

  revalidatePath("/admin/users");
  return { success: true };
}
