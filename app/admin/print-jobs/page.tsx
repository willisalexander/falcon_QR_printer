import { Suspense } from "react";
import { createClient } from "@/lib/supabase/server";
import { AdminHeader } from "@/components/admin/header";
import { Card } from "@/components/ui/card";
import { StatusBadge } from "@/components/ui/badge";
import { PrintJobFilters } from "./filters";
import { JobActions } from "./job-actions";
import { PrintJobsRealtime } from "./realtime-refresh";
import { formatCurrency, formatDate } from "@/lib/utils";
import { FileText } from "lucide-react";
import type { Profile, PrintJob } from "@/types";
import type { Metadata } from "next";

export const metadata: Metadata = { title: "Trabajos de Impresión" };

interface PageProps {
  searchParams: Promise<{
    status?: string;
    date?: string;
    q?: string;
    page?: string;
  }>;
}

function buildDateFilter(date: string | undefined): string | null {
  const now = new Date();
  if (date === "today") {
    const start = new Date(now);
    start.setHours(0, 0, 0, 0);
    return start.toISOString();
  }
  if (date === "week") {
    const start = new Date(now);
    start.setDate(now.getDate() - 7);
    return start.toISOString();
  }
  if (date === "month") {
    const start = new Date(now);
    start.setDate(1);
    start.setHours(0, 0, 0, 0);
    return start.toISOString();
  }
  return null;
}

export default async function PrintJobsPage({ searchParams }: PageProps) {
  const params = await searchParams;
  const supabase = await createClient();

  const { data: { user } } = await supabase.auth.getUser();
  const { data: profile } = await supabase
    .from("profiles")
    .select("*")
    .eq("id", user!.id)
    .single();

  let query = supabase
    .from("print_jobs")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(100);

  if (params.status) {
    query = query.eq("status", params.status);
  }

  const dateFrom = buildDateFilter(params.date);
  if (dateFrom) {
    query = query.gte("created_at", dateFrom);
  }

  if (params.q) {
    query = query.or(
      `client_name.ilike.%${params.q}%,correlative.ilike.%${params.q}%`
    );
  }

  const { data: jobs } = await query;
  const printJobs = (jobs ?? []) as PrintJob[];

  // Generar signed URLs para miniaturas (bucket privado)
  const thumbPaths = printJobs
    .filter((j) => j.thumbnail_path)
    .map((j) => j.thumbnail_path as string);

  const signedThumbMap = new Map<string, string>();
  if (thumbPaths.length > 0) {
    const { data: signedData } = await supabase.storage
      .from("thumbnails")
      .createSignedUrls(thumbPaths, 3600);
    (signedData ?? []).forEach((item) => {
      if (item.path && item.signedUrl) signedThumbMap.set(item.path, item.signedUrl);
    });
  }

  return (
    <>
      <AdminHeader profile={profile as Profile} title="Trabajos de Impresión" />

      <div className="flex-1 overflow-y-auto p-6">
        {/* Filtros + indicador en vivo */}
        <div className="mb-4 flex items-center justify-between gap-4">
          <Suspense fallback={null}>
            <PrintJobFilters />
          </Suspense>
          <PrintJobsRealtime />
        </div>

        {/* Tabla */}
        <Card noPadding>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-100 bg-gray-50/50">
                  <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-gray-500">Correlativo</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-gray-500">Cliente</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-gray-500">Tipo</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-gray-500">Formato</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-gray-500">Págs × Copias</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-gray-500">Total</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-gray-500">Estado</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-gray-500">Fecha</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-gray-500">Acciones</th>
                </tr>
              </thead>
              <tbody>
                {printJobs.length === 0 ? (
                  <tr>
                    <td colSpan={9} className="px-4 py-12 text-center text-gray-400">
                      No hay trabajos que coincidan con los filtros.
                    </td>
                  </tr>
                ) : (
                  printJobs.map((job) => (
                    <tr
                      key={job.id}
                      className="border-b border-gray-50 last:border-0 hover:bg-gray-50/60"
                    >
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          {job.thumbnail_path && signedThumbMap.get(job.thumbnail_path) ? (
                            <img
                              src={signedThumbMap.get(job.thumbnail_path)!}
                              alt=""
                              width={32}
                              height={32}
                              className="h-8 w-8 flex-shrink-0 rounded object-cover"
                            />
                          ) : (
                            <FileText className="h-6 w-6 flex-shrink-0 text-gray-300" />
                          )}
                          <span className="font-mono text-xs font-semibold text-blue-700">
                            {job.correlative}
                          </span>
                        </div>
                      </td>
                      <td className="px-4 py-3 font-medium text-gray-900">
                        {job.client_name}
                      </td>
                      <td className="px-4 py-3 text-gray-600">
                        {job.print_type === "bw" ? "B/N" : "Color"}
                      </td>
                      <td className="px-4 py-3 text-gray-600 whitespace-nowrap">
                        {job.paper_size === "oficio2" ? "Oficio 2" : "Carta"}
                      </td>
                      <td className="px-4 py-3 text-gray-600">
                        {job.page_count} × {job.copy_count}
                      </td>
                      <td className="px-4 py-3 font-semibold text-gray-900">
                        {formatCurrency(job.total_price)}
                      </td>
                      <td className="px-4 py-3">
                        <StatusBadge status={job.status} />
                      </td>
                      <td className="px-4 py-3 text-xs text-gray-500 whitespace-nowrap">
                        {formatDate(job.created_at)}
                      </td>
                      <td className="px-4 py-3">
                        <JobActions
                          jobId={job.id}
                          status={job.status}
                          showView
                        />
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>

          {printJobs.length > 0 && (
            <div className="border-t border-gray-100 px-4 py-3">
              <p className="text-xs text-gray-500">
                {printJobs.length} {printJobs.length === 1 ? "trabajo" : "trabajos"} encontrados
              </p>
            </div>
          )}
        </Card>
      </div>
    </>
  );
}
