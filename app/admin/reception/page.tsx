import { createClient } from "@/lib/supabase/server";
import { AdminHeader } from "@/components/admin/header";
import { ReceptionClient } from "./reception-client";
import type { Profile } from "@/types";
import type { Metadata } from "next";

export const metadata: Metadata = { title: "Recepción de documentos" };

export default async function ReceptionPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  const { data: profile } = await supabase.from("profiles").select("*").eq("id", user!.id).single();

  return (
    <>
      <AdminHeader profile={profile as Profile} title="Recepción de documentos" />
      <div className="flex-1 overflow-hidden p-6">
        <ReceptionClient />
      </div>
    </>
  );
}
