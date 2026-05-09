import QRCode from "qrcode";
import { createServiceClient } from "@/lib/supabase/server";
import { getOrCreateAutoToken } from "./actions";
import { MAX_USES, MAX_AGE_MS } from "./constants";
import { DisplayClient } from "./display-client";
import type { Metadata } from "next";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Pantalla QR" };

export default async function DisplayPage() {
  const { tokenSlug, createdAt, useCount } = await getOrCreateAutoToken();

  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
  const printUrl = `${appUrl}/print/${tokenSlug}`;

  const svgQr = await QRCode.toString(printUrl, {
    type: "svg",
    margin: 1,
    width: 270,
    color: { dark: "#000000", light: "#ffffff" },
  });

  const supabase = await createServiceClient();
  const { data: biz } = await supabase
    .from("settings")
    .select("value")
    .eq("key", "business_name")
    .single();

  const businessName = biz?.value ?? "Print QR System";

  return (
    <DisplayClient
      tokenSlug={tokenSlug}
      tokenCreatedAt={createdAt}
      useCount={useCount}
      maxUses={MAX_USES}
      maxAgeMs={MAX_AGE_MS}
      svgQr={svgQr}
      businessName={businessName}
    />
  );
}