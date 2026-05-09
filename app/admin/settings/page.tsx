import { createClient } from "@/lib/supabase/server";
import { AdminHeader } from "@/components/admin/header";
import { SettingsForm } from "./settings-form";
import type { Profile, SystemSettings } from "@/types";
import type { Metadata } from "next";

export const metadata: Metadata = { title: "Configuración" };

export default async function SettingsPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  const [{ data: profile }, { data: settingsRows }] = await Promise.all([
    supabase.from("profiles").select("*").eq("id", user!.id).single(),
    supabase.from("settings").select("key, value"),
  ]);

  const raw = Object.fromEntries(
    (settingsRows ?? []).map((s) => [s.key, s.value])
  );

  const settings: SystemSettings = {
    price_bw: parseFloat(raw["price_bw"] ?? "0.50"),
    price_color: parseFloat(raw["price_color"] ?? "2.00"),
    max_pages_without_approval: parseInt(raw["max_pages_without_approval"] ?? "20"),
    max_file_size_mb: parseInt(raw["max_file_size_mb"] ?? "10"),
    allowed_file_types: (raw["allowed_file_types"] ?? "pdf,jpg,png,webp").split(","),
    system_active: raw["system_active"] !== "false",
    public_message: raw["public_message"] ?? "",
    business_name: raw["business_name"] ?? "Print QR System",
    timezone: raw["timezone"] ?? "America/Guatemala",
  };

  return (
    <>
      <AdminHeader profile={profile as Profile} title="Configuración" />
      <div className="flex-1 overflow-y-auto p-6">
        <div className="max-w-2xl">
          <SettingsForm settings={settings} />
        </div>
      </div>
    </>
  );
}
