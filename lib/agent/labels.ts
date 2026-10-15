import type { AgentDoc, AgentJob, JobStatus, PaperKey } from "./types";

export const PAPER_LABELS: Record<PaperKey | "custom" | "mixed", string> = {
  carta: "Carta",
  a4: "A4",
  oficio2: "Oficio II",
  legal: "Legal",
  custom: "Personalizado",
  mixed: "Mixto",
};

export const PAPER_OPTIONS: { value: PaperKey; label: string }[] = [
  { value: "carta", label: "Carta (8.5 × 11 in)" },
  { value: "oficio2", label: "Oficio II (8.5 × 13 in)" },
  { value: "legal", label: "Legal (8.5 × 14 in)" },
  { value: "a4", label: "A4 (210 × 297 mm)" },
];

export const DUPLEX_LABELS = { simplex: "Simple", long: "Dúplex", short: "Dúplex (borde corto)" } as const;
export const COLOR_LABELS = { bw: "B/N", color: "Color" } as const;
export const SCALE_LABELS = { noscale: "Sin escalar", fit: "Ajustar al papel", shrink: "Reducir si no cabe" } as const;

const JOB_LABELS: Record<JobStatus, string> = {
  ready: "Listo para imprimir",
  sending: "Enviando…",
  sent: "Enviado a cola Windows",
  printing: "Imprimiendo",
  printed: "Impreso confirmado",
  error: "Error",
  unknown: "Envío incierto",
  cancelled: "Cancelado",
};

const JOB_COLORS: Record<JobStatus, string> = {
  ready: "bg-blue-100 text-blue-700",
  sending: "bg-purple-100 text-purple-700",
  sent: "bg-indigo-100 text-indigo-700",
  printing: "bg-purple-100 text-purple-700",
  printed: "bg-green-100 text-green-700",
  error: "bg-red-100 text-red-700",
  unknown: "bg-orange-100 text-orange-800",
  cancelled: "bg-gray-100 text-gray-600",
};

export function jobStatus(job: Pick<AgentJob, "status" | "hold_reason">) {
  if (job.status === "ready" && job.hold_reason) {
    return { label: "En espera de impresora", color: "bg-yellow-100 text-yellow-800" };
  }
  return { label: JOB_LABELS[job.status], color: JOB_COLORS[job.status] };
}

export function docStatus(doc: AgentDoc, lastJob?: AgentJob) {
  if (doc.status === "queued") return { label: "En cola de conversión", color: "bg-gray-100 text-gray-700" };
  if (doc.status === "converting") return { label: "Convirtiendo…", color: "bg-purple-100 text-purple-700" };
  if (doc.status === "error") return { label: "Error", color: "bg-red-100 text-red-700" };
  if (doc.status === "deleted") return { label: "Eliminado", color: "bg-gray-100 text-gray-500" };
  if (doc.status === "discarded") return { label: "Descartado", color: "bg-gray-100 text-gray-500" };
  if (lastJob && lastJob.status !== "cancelled") return jobStatus(lastJob);
  if (!doc.order_id) return { label: "Pendiente de identificación", color: "bg-yellow-100 text-yellow-800" };
  if (doc.plan?.ok) return { label: "Listo para autorizar", color: "bg-emerald-100 text-emerald-700" };
  return { label: "Faltan datos", color: "bg-amber-100 text-amber-800" };
}

export function sizeLabel(doc: Pick<AgentDoc, "size_class" | "groups">) {
  if (!doc.size_class) return "—";
  if (doc.size_class === "mixed") return `Mixto (${doc.groups.map((g) => `${g.label}: ${g.count}`).join(", ")})`;
  if (doc.size_class === "custom") return doc.groups[0]?.label ?? "Personalizado";
  return PAPER_LABELS[doc.size_class];
}

export function timeGT(iso: string | null | undefined) {
  if (!iso) return "—";
  return new Intl.DateTimeFormat("es-GT", {
    timeZone: "America/Guatemala", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false,
  }).format(new Date(iso));
}

export function dateGT(iso: string | null | undefined) {
  if (!iso) return "—";
  return new Intl.DateTimeFormat("es-GT", {
    timeZone: "America/Guatemala", day: "2-digit", month: "2-digit", year: "numeric",
  }).format(new Date(iso));
}
