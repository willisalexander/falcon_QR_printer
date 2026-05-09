import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { AdminSidebar } from "@/components/admin/sidebar";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: {
    default: "Admin",
    template: "%s | Admin — Print QR System",
  },
};

export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return <>{children}</>;
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("*")
    .eq("id", user.id)
    .single();

  if (!profile || !profile.is_active) {
    redirect("/admin/login?error=access_denied");
  }

  const { data: bizSetting } = await supabase
    .from("settings")
    .select("value")
    .eq("key", "business_name")
    .single();

  const businessName = bizSetting?.value ?? "Print QR System";

  return (
    <div className="flex h-screen overflow-hidden bg-gray-50">
      <AdminSidebar businessName={businessName} />
      <main className="flex flex-1 flex-col overflow-hidden">
        {children}
      </main>
    </div>
  );
}
