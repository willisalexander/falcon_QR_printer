import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";
import type { SystemSettings } from "@/types";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatCurrency(amount: number): string {
  return `Q ${amount.toFixed(2)}`;
}

const GT_OFFSET_MS = -6 * 60 * 60 * 1000; // UTC-6, Guatemala no usa horario de verano

function toGT(dateStr: string): Date {
  return new Date(new Date(dateStr).getTime() + GT_OFFSET_MS);
}

export function formatDate(dateStr: string): string {
  const d = toGT(dateStr);
  const day = String(d.getUTCDate()).padStart(2, "0");
  const months = ["enero","febrero","marzo","abril","mayo","junio","julio","agosto","septiembre","octubre","noviembre","diciembre"];
  const hour = String(d.getUTCHours()).padStart(2, "0");
  const min = String(d.getUTCMinutes()).padStart(2, "0");
  return `${day} de ${months[d.getUTCMonth()]} de ${d.getUTCFullYear()}, ${hour}:${min}`;
}

export function formatShortDate(dateStr: string): string {
  const d = toGT(dateStr);
  const day = String(d.getUTCDate()).padStart(2, "0");
  const month = String(d.getUTCMonth() + 1).padStart(2, "0");
  return `${day}/${month}/${d.getUTCFullYear()}`;
}

export function calculatePrice(
  pageCount: number,
  copyCount: number,
  printType: "bw" | "color",
  settings: Pick<SystemSettings, "price_bw" | "price_color">
): number {
  const pricePerPage =
    printType === "bw" ? settings.price_bw : settings.price_color;
  return Math.round(pricePerPage * pageCount * copyCount * 100) / 100;
}

export function getPrintTypeLabel(printType: "bw" | "color"): string {
  return printType === "bw" ? "Blanco y Negro" : "Color";
}

export function getStatusLabel(status: string): string {
  const labels: Record<string, string> = {
    uploaded: "Subido",
    pending_approval: "Pendiente Aprobación",
    approved: "Aprobado",
    printing: "Imprimiendo",
    printed: "Impreso",
    rejected: "Rechazado",
    paid: "Pagado",
    failed: "Fallido",
  };
  return labels[status] ?? status;
}

export function getStatusColor(status: string): string {
  const colors: Record<string, string> = {
    uploaded: "bg-gray-100 text-gray-700",
    pending_approval: "bg-yellow-100 text-yellow-700",
    approved: "bg-blue-100 text-blue-700",
    printing: "bg-purple-100 text-purple-700",
    printed: "bg-green-100 text-green-700",
    rejected: "bg-red-100 text-red-700",
    paid: "bg-emerald-100 text-emerald-700",
    failed: "bg-red-200 text-red-800",
  };
  return colors[status] ?? "bg-gray-100 text-gray-700";
}

export function bytesToMB(bytes: number): number {
  return Math.round((bytes / 1024 / 1024) * 100) / 100;
}

export function generateSecureToken(): string {
  const array = new Uint8Array(32);
  crypto.getRandomValues(array);
  return Array.from(array, (byte) => byte.toString(16).padStart(2, "0")).join(
    ""
  );
}

export const ALLOWED_MIME_TYPES = [
  "application/pdf",
  "image/jpeg",
  "image/png",
  "image/webp",
] as const;

export const IMAGES_PER_PAGE_OPTIONS = [1, 2, 4, 6, 9] as const;
