import QRCode from "qrcode";
import { createClient } from "@/lib/supabase/server";
import { AdminHeader } from "@/components/admin/header";
import { QrClient } from "./qr-client";
import type { QrToken, Profile } from "@/types";
import type { Metadata } from "next";

export const metadata: Metadata = { title: "Códigos QR" };

export default async function QrPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  const [{ data: profileData }, { data: tokensData }] = await Promise.all([
    supabase.from("profiles").select("*").eq("id", user!.id).single(),
    supabase.from("qr_tokens").select("*").order("created_at", { ascending: false }),
  ]);

  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";

  const tokens = await Promise.all(
    (tokensData ?? []).map(async (t) => {
      const printUrl = `${appUrl}/print/${t.token}`;
      const qrDataUrl = await QRCode.toDataURL(printUrl, {
        width: 300,
        margin: 2,
        color: { dark: "#1e40af", light: "#ffffff" },
      });
      return { token: t as QrToken, qrDataUrl, printUrl };
    })
  );

  return (
    <>
      <AdminHeader profile={profileData as Profile} title="Códigos QR" />
      <div className="flex-1 overflow-y-auto p-6">
        <QrClient tokens={tokens} />
      </div>
    </>
  );
}
