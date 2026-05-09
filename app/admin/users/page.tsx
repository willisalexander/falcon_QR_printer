import { createClient } from "@/lib/supabase/server";
import { AdminHeader } from "@/components/admin/header";
import { UsersClient } from "./users-client";
import type { Profile } from "@/types";
import type { Metadata } from "next";

export const metadata: Metadata = { title: "Usuarios" };

export default async function UsersPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  const [{ data: profile }, { data: users }] = await Promise.all([
    supabase.from("profiles").select("*").eq("id", user!.id).single(),
    supabase.from("profiles").select("*").order("created_at", { ascending: false }),
  ]);

  return (
    <>
      <AdminHeader profile={profile as Profile} title="Usuarios" />
      <div className="flex-1 overflow-y-auto p-6">
        <UsersClient
          users={(users ?? []) as Profile[]}
          currentUserId={user!.id}
        />
      </div>
    </>
  );
}
