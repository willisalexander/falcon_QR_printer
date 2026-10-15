import { createClient } from "@/lib/supabase/server";
import { AdminHeader } from "@/components/admin/header";
import { PrintersClient } from "./printers-client";
import type { Profile, Printer } from "@/types";
import type { Metadata } from "next";

export const metadata: Metadata = { title: "Impresoras" };

export default async function PrintersPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  const [{ data: profile }, { data: printers }] = await Promise.all([
    supabase.from("profiles").select("*").eq("id", user!.id).single(),
    supabase.from("printers").select("*").order("created_at", { ascending: false }),
  ]);

  return (
    <>
      <AdminHeader profile={profile as Profile} title="Impresoras" />
      <div className="flex-1 overflow-y-auto p-6">
        <div className="mb-2">
          <p className="text-sm text-gray-500">
            Registra las impresoras conectadas, los tamaños de papel que tienen cargados y sus capacidades.
            La impresora de cada trabajo se elige con las <a href="/admin/rules" className="text-blue-600 underline">reglas de impresión</a>;
            los valores “por defecto” solo aplican al flujo QR anterior.
          </p>
        </div>
        <PrintersClient printers={(printers ?? []) as Printer[]} />
      </div>
    </>
  );
}
