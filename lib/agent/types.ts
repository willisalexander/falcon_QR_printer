// Tipos de las respuestas del agente local (print-agent/src/api.js)

export type ColorMode = "bw" | "color";
export type DuplexMode = "simplex" | "long" | "short";
export type PaperKey = "carta" | "a4" | "oficio2" | "legal";
export type ScaleMode = "noscale" | "fit" | "shrink";

export interface PlanPart {
  paper: PaperKey;
  pages: string | null;
  pageCount: number;
  scale: ScaleMode;
  printerId: string;
  printerName: string;
  tray: string | null;
  ruleName: string | null;
  available: boolean;
}

export interface Plan {
  ok: boolean;
  problems: string[];
  warnings: string[];
  parts: PlanPart[];
  allAvailable?: boolean;
  autoBlocked?: boolean;
}

export interface PageGroup {
  key: string;
  cls: PaperKey | "custom";
  label: string;
  count: number;
  ranges: string;
}

export interface AgentDoc {
  id: string;
  seq: number;
  original_name: string;
  ext: string;
  status: "queued" | "converting" | "ready" | "error" | "discarded" | "deleted";
  error_code: string | null;
  error_message: string | null;
  received_at: string;
  page_count: number | null;
  size_class: PaperKey | "custom" | "mixed" | null;
  orientation: string | null;
  groups: PageGroup[];
  encrypted: boolean;
  duplicate_of: string | null;
  review_ack: boolean;
  order_id: string | null;
  copies: number | null;
  color_mode: ColorMode | null;
  duplex: DuplexMode | null;
  paper_size: PaperKey | null;
  scale_mode: ScaleMode | null;
  mixed_strategy: "split" | "fit" | null;
  printer_id: string | null;
  notes: string | null;
  deleted_at: string | null;
  has_pdf: boolean;
  pdf_available?: boolean;
  plan: Plan | null;
}

export interface AgentOrder {
  id: string;
  correlative: string;
  customer_name: string;
  notes: string | null;
  status: "open" | "finished" | "cancelled";
  is_complete: boolean;
  priority: number;
  keep_documents: boolean;
  total_price: number;
  created_at: string;
  finished_at: string | null;
  purge_after: string | null;
  documents_deleted_at: string | null;
}

export type JobStatus = "ready" | "sending" | "sent" | "printing" | "printed" | "error" | "unknown" | "cancelled";

export interface AgentJob {
  id: string;
  seq: number;
  document_id: string;
  order_id: string | null;
  kind: "print" | "reprint";
  retry_of: string | null;
  pages: string | null;
  page_count: number;
  copies: number;
  color_mode: ColorMode;
  duplex: DuplexMode;
  paper_size: PaperKey;
  scale_mode: ScaleMode;
  printer_id: string | null;
  printer_name: string | null;
  tray: string | null;
  priority: number;
  status: JobStatus;
  hold_reason: string | null;
  error_message: string | null;
  spooler_status: string | null;
  price: number;
  authorized_by: string | null;
  created_at: string;
  sent_at: string | null;
  spooler_done_at: string | null;
  confirmed_at: string | null;
  updated_at: string;
  original_name?: string;
  customer_name?: string | null;
  correlative?: string | null;
}

export interface AgentPrinter {
  id: string;
  name: string;
  system_name: string;
  is_active: boolean;
  supports_color: boolean;
  supports_duplex: boolean;
  paper_sizes: PaperKey[];
  trays: Record<string, string>;
  available: boolean;
}

export interface AgentInfo {
  version: number;
  intake: { folder: string; waiting: string[]; ignored: { name: string; reason: string }[] };
  processing: { queued: number; converting: number };
  sync: { enabled: boolean; online: boolean | null; lastOkAt: string | null; lastError: string | null; pending: number };
  libreOffice: boolean;
  printDriver: string;
  retentionDays: number;
  settings: Record<string, string>;
  watchFolder: string;
}

export interface AgentState {
  mode: "supervised" | "auto";
  documents: AgentDoc[];
  orders: AgentOrder[];
  jobs: AgentJob[];
  printers: AgentPrinter[];
  paperSizes: Record<PaperKey, { label: string; inches: string }>;
  agent: AgentInfo;
}

export interface HistoryOrder extends AgentOrder {
  documents: AgentDoc[];
  jobs: AgentJob[];
}
