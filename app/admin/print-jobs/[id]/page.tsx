import { notFound } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { AdminHeader } from "@/components/admin/header";
import { Card, CardTitle } from "@/components/ui/card";
import { StatusBadge } from "@/components/ui/badge";
import { JobActions } from "../job-actions";
import {
  formatCurrency,
  formatDate,
  getPrintTypeLabel,
} from "@/lib/utils";
import {
  ArrowLeft,
  FileText,
  Download,
  User,
  Clock,
  Printer,
  Hash,
} from "lucide-react";
import type { PrintJob, PrintJobEvent, Profile } from "@/types";
import type { Metadata } from "next";

export const metadata: Metadata = { title: "Detalle del Trabajo" };

interface PageProps {
  params: Promise<{ id: string }>;
}

function EventDot({ type }: { type: string }) {
  const colors: Record<string, string> = {
    created: "bg-blue-500",
    status_change: "bg-purple-500",
    printed: "bg-green-500",
    error: "bg-red-500",
    note: "bg-gray-400",
  };
  return (
    <div
      className={`h-2.5 w-2.5 rounded-full flex-shrink-0 mt-1 ${colors[type] ?? "bg-gray-400"}`}
    />
  );
}

export default async function PrintJobDetailPage({ params }: PageProps) {
  const { id } = await params;
  const supabase = await createClient();

  const { data: { user } } = await supabase.auth.getUser();
  const { data: profile } = await supabase
    .from("profiles")
    .select("*")
    .eq("id", user!.id)
    .single();

  const [jobResult, eventsResult] = await Promise.all([
    supabase.from("print_jobs").select("*").eq("id", id).single(),
    supabase
      .from("print_job_events")
      .select("*")
      .eq("print_job_id", id)
      .order("created_at", { ascending: true }),
  ]);

  if (!jobResult.data) notFound();

  const job = jobResult.data as PrintJob;
  const events = (eventsResult.data ?? []) as PrintJobEvent[];

  // URLs de archivo y miniatura
  let fileUrl: string | null = null;
  if (job.file_path) {
    const { data: signed } = await supabase.storage
      .from("print-files")
      .createSignedUrl(job.file_path, 3600);
    fileUrl = signed?.signedUrl ?? null;
  }

  let thumbnailUrl: string | null = null;
  if (job.thumbnail_path) {
    const { data: signedThumb } = await supabase.storage
      .from("thumbnails")
      .createSignedUrl(job.thumbnail_path, 3600);
    thumbnailUrl = signedThumb?.signedUrl ?? null;
  }

  return (
    <>
      <AdminHeader
        profile={profile as Profile}
        title={`Trabajo ${job.correlative}`}
      />

      <div className="flex-1 overflow-y-auto p-6">
        {/* Back */}
        <Link
          href="/admin/print-jobs"
          className="mb-4 inline-flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-800"
        >
          <ArrowLeft className="h-4 w-4" />
          Volver a trabajos
        </Link>

        <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
          {/* Columna principal */}
          <div className="lg:col-span-2 space-y-6">
            {/* Info general */}
            <Card>
              <div className="mb-4 flex items-start justify-between">
                <div>
                  <p className="font-mono text-sm font-bold text-blue-700">
                    {job.correlative}
                  </p>
                  <p className="text-xs text-gray-500">
                    {formatDate(job.created_at)}
                  </p>
                </div>
                <StatusBadge status={job.status} />
              </div>

              <dl className="grid grid-cols-2 gap-4 text-sm">
                <div className="flex flex-col gap-0.5">
                  <dt className="flex items-center gap-1.5 text-xs font-medium text-gray-500">
                    <User className="h-3.5 w-3.5" /> Cliente
                  </dt>
                  <dd className="font-medium text-gray-900">
                    {job.client_name}
                  </dd>
                </div>

                <div className="flex flex-col gap-0.5">
                  <dt className="flex items-center gap-1.5 text-xs font-medium text-gray-500">
                    <Printer className="h-3.5 w-3.5" /> Tipo impresión
                  </dt>
                  <dd className="font-medium text-gray-900">
                    {getPrintTypeLabel(job.print_type)}
                  </dd>
                </div>

                <div className="flex flex-col gap-0.5">
                  <dt className="flex items-center gap-1.5 text-xs font-medium text-gray-500">
                    <Hash className="h-3.5 w-3.5" /> Páginas × Copias
                  </dt>
                  <dd className="font-medium text-gray-900">
                    {job.page_count} páginas × {job.copy_count}{" "}
                    {job.copy_count === 1 ? "copia" : "copias"}
                  </dd>
                </div>

                <div className="flex flex-col gap-0.5">
                  <dt className="text-xs font-medium text-gray-500">
                    Precio por página
                  </dt>
                  <dd className="font-medium text-gray-900">
                    {formatCurrency(
                      job.print_type === "bw"
                        ? job.price_per_page_bw
                        : job.price_per_page_color
                    )}
                  </dd>
                </div>

                <div className="flex flex-col gap-0.5 col-span-2 border-t border-gray-100 pt-3">
                  <dt className="text-xs font-medium text-gray-500">
                    Total a cobrar
                  </dt>
                  <dd className="text-xl font-bold text-blue-700">
                    {formatCurrency(job.total_price)}
                  </dd>
                </div>
              </dl>

              {job.rejected_reason && (
                <div className="mt-4 rounded-lg border border-red-200 bg-red-50 p-3">
                  <p className="text-xs font-medium text-red-700">
                    Motivo de rechazo/fallo:
                  </p>
                  <p className="mt-0.5 text-sm text-red-800">
                    {job.rejected_reason}
                  </p>
                </div>
              )}
            </Card>

            {/* Archivo */}
            <Card>
              <CardTitle className="mb-4">Archivo</CardTitle>
              {job.file_path ? (
                <div className="space-y-3">
                  {/* Miniatura */}
                  {thumbnailUrl && (
                    <div className="flex justify-center rounded-xl border border-gray-100 bg-gray-50 p-3">
                      <img
                        src={thumbnailUrl}
                        alt="Vista previa"
                        className="max-h-52 rounded-lg object-contain shadow-sm"
                      />
                    </div>
                  )}
                  <div className="flex items-center justify-between rounded-xl border border-gray-200 p-4">
                    <div className="flex items-center gap-3">
                      <FileText className="h-8 w-8 text-blue-500 flex-shrink-0" />
                      <div>
                        <p className="text-sm font-medium text-gray-900">
                          {job.original_file_name ?? "Archivo de impresión"}
                        </p>
                        <p className="text-xs text-gray-500">{job.page_count} páginas</p>
                      </div>
                    </div>
                    {fileUrl && (
                      <a
                        href={fileUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex items-center gap-1.5 rounded-lg border border-gray-300 px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-50"
                      >
                        <Download className="h-4 w-4" />
                        Descargar
                      </a>
                    )}
                  </div>
                </div>
              ) : (
                <p className="text-sm text-gray-400">No hay archivo disponible.</p>
              )}
            </Card>

            {/* Historial de eventos */}
            <Card>
              <CardTitle className="mb-4">Historial de eventos</CardTitle>
              {events.length === 0 ? (
                <p className="text-sm text-gray-400">Sin eventos registrados.</p>
              ) : (
                <ol className="space-y-4">
                  {events.map((event) => (
                    <li key={event.id} className="flex gap-3">
                      <EventDot type={event.event_type} />
                      <div className="flex-1 min-w-0">
                        <p className="text-sm text-gray-900">
                          {event.description}
                        </p>
                        <p className="flex items-center gap-1 mt-0.5 text-xs text-gray-400">
                          <Clock className="h-3 w-3" />
                          {formatDate(event.created_at)}
                        </p>
                      </div>
                    </li>
                  ))}
                </ol>
              )}
            </Card>
          </div>

          {/* Columna lateral — Acciones */}
          <div className="space-y-6">
            <Card>
              <CardTitle className="mb-4">Acciones</CardTitle>
              <JobActions jobId={job.id} status={job.status} />
            </Card>

            {/* Timestamps adicionales */}
            <Card>
              <CardTitle className="mb-3">Tiempos</CardTitle>
              <dl className="space-y-2 text-sm">
                <div>
                  <dt className="text-xs text-gray-500">Recibido</dt>
                  <dd className="text-gray-800">{formatDate(job.created_at)}</dd>
                </div>
                {job.approved_at && (
                  <div>
                    <dt className="text-xs text-gray-500">Aprobado</dt>
                    <dd className="text-gray-800">{formatDate(job.approved_at)}</dd>
                  </div>
                )}
                {job.printed_at && (
                  <div>
                    <dt className="text-xs text-gray-500">Impreso</dt>
                    <dd className="text-gray-800">{formatDate(job.printed_at)}</dd>
                  </div>
                )}
                {job.paid_at && (
                  <div>
                    <dt className="text-xs text-gray-500">Pagado</dt>
                    <dd className="text-gray-800">{formatDate(job.paid_at)}</dd>
                  </div>
                )}
              </dl>
            </Card>
          </div>
        </div>
      </div>
    </>
  );
}
