import { createClient } from "@/lib/supabase/server";
import { AdminHeader } from "@/components/admin/header";
import { RulesClient } from "./rules-client";
import type { Profile, Printer, PrinterRule } from "@/types";
import type { Metadata } from "next";

export const metadata: Metadata = { title: "Reglas de impresión" };

export default async function RulesPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  const [{ data: profile }, { data: rules, error }, { data: printers }] = await Promise.all([
    supabase.from("profiles").select("*").eq("id", user!.id).single(),
    supabase.from("printer_rules").select("*").order("priority").order("name"),
    supabase.from("printers").select("*").order("priority").order("name"),
  ]);

  return (
    <>
      <AdminHeader profile={profile as Profile} title="Reglas de impresión" />
      <div className="flex-1 overflow-y-auto p-6">
        {error ? (
          <p className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
            No se pudo leer la tabla de reglas. Ejecute la migración <code>sql/008_local_reception.sql</code> en Supabase.
          </p>
        ) : (
          <RulesClient
            rules={(rules ?? []) as PrinterRule[]}
            printers={(printers ?? []) as Printer[]}
            isAdmin={(profile as Profile | null)?.role === "admin"}
          />
        )}
      </div>
    </>
  );
}
