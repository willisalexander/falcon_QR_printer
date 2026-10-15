import { createClient } from "@/lib/supabase/server";
import { AdminHeader } from "@/components/admin/header";
import { QueueClient } from "./queue-client";
import type { Profile } from "@/types";
import type { Metadata } from "next";

export const metadata: Metadata = { title: "Cola de impresión" };

export default async function PrintQueuePage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  const { data: profile } = await supabase.from("profiles").select("*").eq("id", user!.id).single();

  return (
    <>
      <AdminHeader profile={profile as Profile} title="Cola de impresión" />
      <div className="flex-1 overflow-y-auto p-6">
        <QueueClient />
      </div>
    </>
  );
}
