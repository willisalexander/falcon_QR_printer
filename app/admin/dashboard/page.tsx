import { createClient } from "@/lib/supabase/server";
import { AdminHeader } from "@/components/admin/header";
import { Card } from "@/components/ui/card";
import {
  FileText,
  DollarSign,
  Clock,
  CheckCircle,
  Printer,
  XCircle,
  AlertTriangle,
} from "lucide-react";
import { formatCurrency } from "@/lib/utils";
import type { Profile, PrintJob } from "@/types";
import type { Metadata } from "next";

export const metadata: Metadata = { title: "Dashboard" };

function Ring({
  pct,
  color,
  size = 72,
  stroke = 10,
  children,
}: {
  pct: number;
  color: string;
  size?: number;
  stroke?: number;
  children?: React.ReactNode;
}) {
  const r = (size - stroke) / 2;
  const circ = 2 * Math.PI * r;
  const filled = Math.min(pct, 1) * circ;
  return (
    <div className="relative flex items-center justify-center" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90" style={{ position: "absolute" }}>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="#f3f4f6" strokeWidth={stroke} />
        <circle
          cx={size / 2} cy={size / 2} r={r} fill="none"
          stroke={color} strokeWidth={stroke}
          strokeDasharray={`${filled} ${circ}`}
          strokeLinecap="round"
        />
      </svg>
      <div className="relative z-10 text-center">{children}</div>
    </div>
  );
}

function Bar({ value, total, color }: { value: number; total: number; color: string }) {
  const pct = total > 0 ? Math.min(Math.round((value / total) * 100), 100) : 0;
  return (
    <div className="flex items-center gap-2">
      <div className="h-2.5 flex-1 rounded-full bg-gray-100 overflow-hidden">
        <div
          className="h-2.5 rounded-full"
          style={{ width: `${pct}%`, backgroundColor: color }}
        />
      </div>
      <span className="w-8 text-right text-xs font-medium text-gray-500">{pct}%</span>
    </div>
  );
}

export default async function DashboardPage() {
  const supabase = await createClient();

  const { data: { user } } = await supabase.auth.getUser();

  const [profileResult, jobsResult] = await Promise.all([
    supabase.from("profiles").select("*").eq("id", user!.id).single(),
    supabase
      .from("print_jobs")
      .select("*")
      .gte("created_at", new Date(new Date().setHours(0, 0, 0, 0)).toISOString()),
  ]);

  const profile = profileResult.data as Profile | null;
  const todayJobs = (jobsResult.data as PrintJob[]) ?? [];

  const stats = {
    total:    todayJobs.length,
    revenue:  todayJobs
      .filter((j) => j.status === "paid" || j.status === "printed")
      .reduce((acc, j) => acc + Number(j.total_price), 0),
    pending:  todayJobs.filter((j) => j.status === "pending_approval").length,
    approved: todayJobs.filter((j) => j.status === "approved").length,
    printed:  todayJobs.filter((j) => j.status === "printed").length,
    rejected: todayJobs.filter((j) => j.status === "rejected").length,
    failed:   todayJobs.filter((j) => j.status === "failed").length,
    bw:       todayJobs.filter((j) => j.print_type === "bw").length,
    color:    todayJobs.filter((j) => j.print_type === "color").length,
    carta:    todayJobs.filter((j) => !j.paper_size || j.paper_size === "carta").length,
    oficio:   todayJobs.filter((j) => j.paper_size === "oficio2").length,
  };

  const statusRows = [
    { label: "Pendientes",  value: stats.pending,  color: "#eab308", Icon: Clock,         iconBg: "bg-yellow-50",  iconClr: "text-yellow-600" },
    { label: "Aprobados",   value: stats.approved,  color: "#22c55e", Icon: CheckCircle,   iconBg: "bg-green-50",   iconClr: "text-green-600"  },
    { label: "Impresos",    value: stats.printed,   color: "#8b5cf6", Icon: Printer,       iconBg: "bg-purple-50",  iconClr: "text-purple-600" },
    { label: "Rechazados",  value: stats.rejected,  color: "#ef4444", Icon: XCircle,       iconBg: "bg-red-50",     iconClr: "text-red-600"    },
    { label: "Fallidos",    value: stats.failed,    color: "#f97316", Icon: AlertTriangle,  iconBg: "bg-orange-50",  iconClr: "text-orange-600" },
  ];

  return (
    <>
      <AdminHeader profile={profile} title="Dashboard" />

      <div className="flex-1 overflow-y-auto p-6 space-y-5">

        {/* ── Fila 1: métricas principales ─────────────────────── */}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">

          {/* Total trabajos */}
          <Card>
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-gray-500">Trabajos hoy</p>
                <p className="mt-1 text-5xl font-black text-gray-900">{stats.total}</p>
                <p className="mt-2 flex items-center gap-1.5 text-xs text-gray-400">
                  <FileText className="h-3.5 w-3.5" />
                  documentos recibidos
                </p>
              </div>
              <Ring pct={stats.total > 0 ? 1 : 0} color="#3b82f6" size={80} stroke={10}>
                <span className="text-lg font-black text-blue-600">{stats.total}</span>
              </Ring>
            </div>
          </Card>

          {/* Ingresos */}
          <Card>
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-gray-500">Ingresos hoy</p>
                <p className="mt-1 text-4xl font-black text-emerald-700">
                  {formatCurrency(stats.revenue)}
                </p>
                <p className="mt-2 flex items-center gap-1.5 text-xs text-gray-400">
                  <DollarSign className="h-3.5 w-3.5" />
                  trabajos pagados e impresos
                </p>
              </div>
              <div className="flex h-16 w-16 items-center justify-center rounded-full bg-emerald-50">
                <DollarSign className="h-8 w-8 text-emerald-600" />
              </div>
            </div>
          </Card>
        </div>

        {/* ── Fila 2: estado + tipo + formato ──────────────────── */}
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">

          {/* Estado de trabajos */}
          <Card>
            <p className="mb-4 text-sm font-semibold text-gray-700">Estado de trabajos</p>
            <div className="space-y-3.5">
              {statusRows.map(({ label, value, color, Icon, iconBg, iconClr }) => (
                <div key={label}>
                  <div className="mb-1.5 flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <div className={`flex h-6 w-6 items-center justify-center rounded-md ${iconBg}`}>
                        <Icon className={`h-3.5 w-3.5 ${iconClr}`} />
                      </div>
                      <span className="text-xs font-medium text-gray-600">{label}</span>
                    </div>
                    <span className="text-sm font-bold text-gray-900">{value}</span>
                  </div>
                  <Bar value={value} total={stats.total} color={color} />
                </div>
              ))}
            </div>
          </Card>

          {/* Tipo + Formato */}
          <div className="space-y-4">

            {/* B/N vs Color */}
            <Card>
              <p className="mb-3 text-sm font-semibold text-gray-700">Tipo de impresión</p>
              <div className="space-y-3">
                <div>
                  <div className="mb-1.5 flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <span className="h-2.5 w-2.5 rounded-full bg-indigo-500 inline-block" />
                      <span className="text-xs font-medium text-gray-600">Blanco y Negro</span>
                    </div>
                    <span className="text-sm font-bold text-gray-900">{stats.bw}</span>
                  </div>
                  <Bar value={stats.bw} total={stats.total} color="#6366f1" />
                </div>
                <div>
                  <div className="mb-1.5 flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <span className="h-2.5 w-2.5 rounded-full bg-pink-500 inline-block" />
                      <span className="text-xs font-medium text-gray-600">Color</span>
                    </div>
                    <span className="text-sm font-bold text-gray-900">{stats.color}</span>
                  </div>
                  <Bar value={stats.color} total={stats.total} color="#ec4899" />
                </div>
              </div>
            </Card>

            {/* Carta vs Oficio */}
            <Card>
              <p className="mb-3 text-sm font-semibold text-gray-700">Formato de papel</p>
              <div className="space-y-3">
                <div>
                  <div className="mb-1.5 flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <span className="h-2.5 w-2.5 rounded-full bg-sky-500 inline-block" />
                      <span className="text-xs font-medium text-gray-600">Carta (8.5 × 11)</span>
                    </div>
                    <span className="text-sm font-bold text-gray-900">{stats.carta}</span>
                  </div>
                  <Bar value={stats.carta} total={stats.total} color="#0ea5e9" />
                </div>
                <div>
                  <div className="mb-1.5 flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <span className="h-2.5 w-2.5 rounded-full bg-teal-500 inline-block" />
                      <span className="text-xs font-medium text-gray-600">Oficio 2 (8.5 × 13)</span>
                    </div>
                    <span className="text-sm font-bold text-gray-900">{stats.oficio}</span>
                  </div>
                  <Bar value={stats.oficio} total={stats.total} color="#14b8a6" />
                </div>
              </div>
            </Card>
          </div>
        </div>

        {/* ── Fila 3: tarjetas de estado individuales ──────────── */}
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-5">
          {statusRows.map(({ label, value, color, Icon, iconBg, iconClr }) => (
            <Card key={label}>
              <div className="flex flex-col items-center text-center gap-2">
                <div className={`flex h-10 w-10 items-center justify-center rounded-full ${iconBg}`}>
                  <Icon className={`h-5 w-5 ${iconClr}`} />
                </div>
                <p className="text-3xl font-black text-gray-900">{value}</p>
                <p className="text-xs text-gray-500 leading-tight">{label}</p>
                <div className="h-1 w-full rounded-full" style={{ backgroundColor: color, opacity: 0.3 }}>
                  <div
                    className="h-1 rounded-full"
                    style={{
                      width: stats.total > 0 ? `${Math.round((value / stats.total) * 100)}%` : "0%",
                      backgroundColor: color,
                    }}
                  />
                </div>
              </div>
            </Card>
          ))}
        </div>

      </div>
    </>
  );
}
