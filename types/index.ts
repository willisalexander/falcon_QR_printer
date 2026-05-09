export * from "./database";

// ============================================================
// Tipos de formularios y UI
// ============================================================

export interface PrintFormData {
  clientName: string;
  copyCount: number;
  printType: "bw" | "color";
  imagesPerPage?: 1 | 2 | 4 | 6 | 9;
  file: File | null;
}

export interface PriceCalculation {
  pageCount: number;
  copyCount: number;
  printType: "bw" | "color";
  pricePerPage: number;
  totalPrice: number;
}

export interface SystemSettings {
  price_bw: number;
  price_color: number;
  max_pages_without_approval: number;
  max_file_size_mb: number;
  allowed_file_types: string[];
  system_active: boolean;
  public_message: string;
  business_name: string;
  timezone: string;
}

export interface DashboardStats {
  totalJobsToday: number;
  totalRevenueToday: number;
  pendingJobs: number;
  approvedJobs: number;
  printedJobs: number;
  rejectedJobs: number;
  failedJobs: number;
}

// ============================================================
// Tipos de respuesta de la API
// ============================================================

export interface ApiResponse<T = unknown> {
  data: T | null;
  error: string | null;
  success: boolean;
}

export type ActionResult<T = unknown> =
  | { success: true; data: T }
  | { success: false; error: string };
