"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import { Download, Filter } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardTitle } from "@/components/ui/card";
import { StatusBadge } from "@/components/ui/badge";
import { formatCurrency, formatShortDate } from "@/lib/utils";
import type { PrintJob } from "@/types";

interface PeriodStat {
  label: string;
  jobs: number;
  revenue: number;
  pages: number;
}

interface ReportsClientProps {
  jobs: PrintJob[];
  periodStats: PeriodStat[];
  bwRevenue: number;
  bwJobs: number;
  bwPages: number;
  colorRevenue: number;
  colorJobs: number;
  colorPages: number;
  from: string;
  to: string;
}

export function ReportsClient({
  jobs,
  periodStats,
  bwRevenue, bwJobs, bwPages,
  colorRevenue, colorJobs, colorPages,
  from,
  to,
}: ReportsClientProps) {
  const router = useRouter();
  const [fromVal, setFromVal] = useState(from);
  const [toVal, setToVal] = useState(to);

  function applyFilter() {
    const params = new URLSearchParams();
    if (fromVal) params.set("from", fromVal);
    if (toVal) params.set("to", toVal);
    router.push(`/admin/reports?${params.toString()}`);
  }

  function exportCsv() {
    const headers = ["Correlativo", "Cliente", "Tipo", "Páginas", "Copias", "Total", "Estado", "Fecha"];
    const rows = jobs.map((j) => [
      j.correlative,
      j.client_name,
      j.print_type === "bw" ? "B/N" : "Color",
      j.page_count,
      j.copy_count,
      j.total_price,
      j.status,
      formatShortDate(j.created_at),
    ]);
    const csv = [headers, ...rows]
      .map((row) => row.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(","))
      .join("\n");

    const blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `reporte-${fromVal || "inicio"}-${toVal || "hoy"}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="space-y-6">

      {/* Filtro de fechas */}
      <Card>
        <div className="flex flex-wrap items-end gap-3">
          <div className="flex flex-col gap-1">
            <label className="text-xs font-medium text-gray-600">Desde</label>
            <input
              type="date"
              value={fromVal}
              onChange={(e) => setFromVal(e.target.value)}
              className="rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs font-medium text-gray-600">Hasta</label>
            <input
              type="date"
              value={toVal}
              onChange={(e) => setToVal(e.target.value)}
              className="rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
          <Button onClick={applyFilter}>
            <Filter className="h-4 w-4" />
            Filtrar
          </Button>
          <Button variant="outline" onClick={exportCsv} disabled={jobs.length === 0}>
            <Download className="h-4 w-4" />
            Exportar CSV
          </Button>
        </div>
      </Card>

      {/* Resumen por período fijo */}
      <div>
        <h2 className="mb-3 text-base font-semibold text-gray-900">Resumen por período</h2>
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          {periodStats.map((p) => (
            <Card key={p.label}>
              <p className="text-sm font-medium text-gray-500">{p.label}</p>
              <p className="mt-1 text-2xl font-bold text-gray-900">{formatCurrency(p.revenue)}</p>
              <p className="mt-0.5 text-xs text-gray-400">
                {p.jobs} trabajos · {p.pages} páginas
              </p>
            </Card>
          ))}
        </div>
      </div>

      {/* Por tipo */}
      <div>
        <h2 className="mb-3 text-base font-semibold text-gray-900">Por tipo de impresión</h2>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Card>
            <CardTitle className="mb-2">Blanco y Negro</CardTitle>
            <p className="text-2xl font-bold text-gray-900">{formatCurrency(bwRevenue)}</p>
            <p className="text-sm text-gray-500">{bwJobs} trabajos · {bwPages} páginas</p>
          </Card>
          <Card>
            <CardTitle className="mb-2">Color</CardTitle>
            <p className="text-2xl font-bold text-gray-900">{formatCurrency(colorRevenue)}</p>
            <p className="text-sm text-gray-500">{colorJobs} trabajos · {colorPages} páginas</p>
          </Card>
        </div>
      </div>

      {/* Tabla de trabajos */}
      <div>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-base font-semibold text-gray-900">
            Trabajos {from || to ? "del período seleccionado" : "recientes"}
            <span className="ml-2 text-sm font-normal text-gray-400">({jobs.length})</span>
          </h2>
        </div>
        <Card noPadding>
          <div className="overflow-x-auto">
            {jobs.length === 0 ? (
              <p className="px-4 py-10 text-center text-sm text-gray-400">
                No hay trabajos para el período seleccionado.
              </p>
            ) : (
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-100 bg-gray-50/50">
                    {["Correlativo", "Cliente", "Tipo", "Págs × Copias", "Total", "Estado", "Fecha"].map((h) => (
                      <th key={h} className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-gray-500">
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {jobs.map((job) => (
                    <tr key={job.id} className="border-b border-gray-50 last:border-0 hover:bg-gray-50/60">
                      <td className="px-4 py-2.5 font-mono text-xs font-semibold text-blue-700">{job.correlative}</td>
                      <td className="px-4 py-2.5 text-gray-900">{job.client_name}</td>
                      <td className="px-4 py-2.5 text-gray-600">{job.print_type === "bw" ? "B/N" : "Color"}</td>
                      <td className="px-4 py-2.5 text-gray-600">{job.page_count} × {job.copy_count}</td>
                      <td className="px-4 py-2.5 font-semibold text-gray-900">{formatCurrency(job.total_price)}</td>
                      <td className="px-4 py-2.5"><StatusBadge status={job.status} /></td>
                      <td className="px-4 py-2.5 text-xs text-gray-500">{formatShortDate(job.created_at)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </Card>
      </div>
    </div>
  );
}
