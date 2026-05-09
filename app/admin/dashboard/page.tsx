import { createClient } from "@/lib/supabase/server";
import { AdminHeader } from "@/components/admin/header";
import { Card } from "@/components/ui/card";
import { StatusBadge } from "@/components/ui/badge";
import {
  FileText,
  DollarSign,
  Clock,
  CheckCircle,
  Printer,
  XCircle,
  AlertTriangle,
} from "lucide-react";
import { formatCurrency, formatDate } from "@/lib/utils";
import type { Profile, PrintJob } from "@/types";
import type { Metadata } from "next";

export const metadata: Metadata = { title: "Dashboard" };

interface StatCardProps {
  title: string;
  value: string | number;
  icon: React.ReactNode;
  color: string;
}

function StatCard({ title, value, icon, color }: StatCardProps) {
  return (
    <Card>
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm font-medium text-gray-500">{title}</p>
          <p className="mt-1 text-2xl font-bold text-gray-900">{value}</p>
        </div>
        <div className={`flex h-12 w-12 items-center justify-center rounded-xl ${color}`}>
          {icon}
        </div>
      </div>
    </Card>
  );
}

export default async function DashboardPage() {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const [profileResult, jobsResult] = await Promise.all([
    supabase
      .from("profiles")
      .select("*")
      .eq("id", user!.id)
      .single(),
    supabase
      .from("print_jobs")
      .select("*")
      .gte("created_at", new Date(new Date().setHours(0, 0, 0, 0)).toISOString()),
  ]);

  const profile = profileResult.data as Profile | null;
  const todayJobs = (jobsResult.data as PrintJob[]) ?? [];

  const stats = {
    total: todayJobs.length,
    revenue: todayJobs
      .filter((j) => j.status === "paid" || j.status === "printed")
      .reduce((acc, j) => acc + Number(j.total_price), 0),
    pending: todayJobs.filter((j) => j.status === "pending_approval").length,
    approved: todayJobs.filter((j) => j.status === "approved").length,
    printed: todayJobs.filter((j) => j.status === "printed").length,
    rejected: todayJobs.filter((j) => j.status === "rejected").length,
    failed: todayJobs.filter((j) => j.status === "failed").length,
  };

  return (
    <>
      <AdminHeader profile={profile} title="Dashboard" />

      <div className="flex-1 overflow-y-auto p-6">
        {/* Stats Grid */}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <StatCard
            title="Trabajos Hoy"
            value={stats.total}
            icon={<FileText className="h-6 w-6 text-blue-600" />}
            color="bg-blue-50"
          />
          <StatCard
            title="Ingresos Hoy"
            value={formatCurrency(stats.revenue)}
            icon={<DollarSign className="h-6 w-6 text-emerald-600" />}
            color="bg-emerald-50"
          />
          <StatCard
            title="Pendientes"
            value={stats.pending}
            icon={<Clock className="h-6 w-6 text-yellow-600" />}
            color="bg-yellow-50"
          />
          <StatCard
            title="Impresos"
            value={stats.printed}
            icon={<Printer className="h-6 w-6 text-purple-600" />}
            color="bg-purple-50"
          />
        </div>

        <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-3">
          <StatCard
            title="Aprobados"
            value={stats.approved}
            icon={<CheckCircle className="h-6 w-6 text-green-600" />}
            color="bg-green-50"
          />
          <StatCard
            title="Rechazados"
            value={stats.rejected}
            icon={<XCircle className="h-6 w-6 text-red-600" />}
            color="bg-red-50"
          />
          <StatCard
            title="Fallidos"
            value={stats.failed}
            icon={<AlertTriangle className="h-6 w-6 text-orange-600" />}
            color="bg-orange-50"
          />
        </div>

        {/* Recent Jobs Table */}
        <div className="mt-8">
          <h2 className="mb-4 text-base font-semibold text-gray-900">
            Trabajos Recientes de Hoy
          </h2>
          <Card noPadding>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-100">
                    <th className="px-4 py-3 text-left font-medium text-gray-500">
                      Correlativo
                    </th>
                    <th className="px-4 py-3 text-left font-medium text-gray-500">
                      Cliente
                    </th>
                    <th className="px-4 py-3 text-left font-medium text-gray-500">
                      Tipo
                    </th>
                    <th className="px-4 py-3 text-left font-medium text-gray-500">
                      Páginas
                    </th>
                    <th className="px-4 py-3 text-left font-medium text-gray-500">
                      Total
                    </th>
                    <th className="px-4 py-3 text-left font-medium text-gray-500">
                      Estado
                    </th>
                    <th className="px-4 py-3 text-left font-medium text-gray-500">
                      Hora
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {todayJobs.length === 0 ? (
                    <tr>
                      <td
                        colSpan={7}
                        className="px-4 py-8 text-center text-gray-400"
                      >
                        No hay trabajos registrados hoy.
                      </td>
                    </tr>
                  ) : (
                    todayJobs.slice(0, 10).map((job) => (
                      <tr
                        key={job.id}
                        className="border-b border-gray-50 last:border-0 hover:bg-gray-50"
                      >
                        <td className="px-4 py-3 font-mono text-xs text-blue-700">
                          {job.correlative}
                        </td>
                        <td className="px-4 py-3 text-gray-900">
                          {job.client_name}
                        </td>
                        <td className="px-4 py-3 text-gray-600">
                          {job.print_type === "bw" ? "B/N" : "Color"}
                        </td>
                        <td className="px-4 py-3 text-gray-600">
                          {job.page_count} × {job.copy_count}
                        </td>
                        <td className="px-4 py-3 font-medium text-gray-900">
                          {formatCurrency(job.total_price)}
                        </td>
                        <td className="px-4 py-3">
                          <StatusBadge status={job.status} />
                        </td>
                        <td className="px-4 py-3 text-gray-500">
                          {new Date(job.created_at).toLocaleTimeString(
                            "es-GT",
                            { hour: "2-digit", minute: "2-digit" }
                          )}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </Card>
        </div>
      </div>
    </>
  );
}
