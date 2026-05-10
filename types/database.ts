// Tipos generados que reflejan el schema de la base de datos Supabase

export type PrintType = "bw" | "color";

export type JobStatus =
  | "uploaded"
  | "pending_approval"
  | "approved"
  | "printing"
  | "printed"
  | "rejected"
  | "paid"
  | "failed";

export type UserRole = "admin" | "operator";

export interface Profile {
  id: string;
  email: string;
  full_name: string;
  role: UserRole;
  is_active: boolean;
  avatar_url: string | null;
  created_at: string;
  updated_at: string;
}

export interface QrToken {
  id: string;
  token: string;
  label: string;
  is_active: boolean;
  created_by: string | null;
  expires_at: string | null;
  last_used_at: string | null;
  use_count: number;
  is_auto: boolean;
  created_at: string;
  updated_at: string;
}

export interface Printer {
  id: string;
  name: string;
  system_name: string;
  print_type: PrintType;
  is_active: boolean;
  is_default_bw: boolean;
  is_default_color: boolean;
  location: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export interface Setting {
  id: string;
  key: string;
  value: string;
  description: string | null;
  created_at: string;
  updated_at: string;
}

export interface PrintJob {
  id: string;
  correlative: string;
  client_name: string;
  print_type: PrintType;
  page_count: number;
  copy_count: number;
  images_per_page: number | null;
  price_per_page_bw: number;
  price_per_page_color: number;
  total_price: number;
  status: JobStatus;
  file_path: string | null;
  original_file_name: string | null;
  thumbnail_path: string | null;
  printer_id: string | null;
  qr_token_id: string | null;
  approved_by: string | null;
  approved_at: string | null;
  rejected_reason: string | null;
  client_ip: string | null;
  notes: string | null;
  paper_size: string | null;
  page_from: number | null;
  page_to: number | null;
  paid_at: string | null;
  printed_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface PrintJobEvent {
  id: string;
  print_job_id: string;
  event_type: string;
  description: string;
  old_status: JobStatus | null;
  new_status: JobStatus | null;
  user_id: string | null;
  metadata: Record<string, unknown> | null;
  created_at: string;
}

export interface AuditLog {
  id: string;
  user_id: string | null;
  action: string;
  table_name: string | null;
  record_id: string | null;
  old_values: Record<string, unknown> | null;
  new_values: Record<string, unknown> | null;
  ip_address: string | null;
  user_agent: string | null;
  created_at: string;
}
