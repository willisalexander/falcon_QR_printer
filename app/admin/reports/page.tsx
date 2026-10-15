import { createClient } from "@/lib/supabase/server";
import { AdminHeader } from "@/components/admin/header";
import { ReportsClient } from "./reports-client";
import {
  dayEndGT, dayStartGT, fetchDeliveredOrders, localByColor, localPages, localRevenue, periodStartsGT,
  type DeliveredOrder,
} from "@/lib/local-revenue";
import type { Profile, PrintJob } from "@/types";
import type { Metadata } from "next";

export const metadata: Metadata = { title: "Reportes" };

interface PageProps {
  searchParams: Promise<{ from?: string; to?: string }>;
}

function sumRevenue(list: PrintJob[]) {
  return list
    .filter((j) => j.status === "paid")
    .reduce((acc, j) => acc + Number(j.total_price), 0);
}

function sumPages(list: PrintJob[]) {
  return list
    .filter((j) => j.status === "paid")
    .reduce((acc, j) => acc + j.page_count * j.copy_count, 0);
}

export default async function ReportsPage({ searchParams }: PageProps) {
  const { from, to } = await searchParams;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  // Todos los cortes de fecha según la hora de Guatemala, corra donde corra el panel
  const { today: startOfToday, week: startOfWeek, month: startOfMonth } = periodStartsGT();

  // Query principal (filtrada si hay from/to, o últimos 200 si no)
  let query = supabase
    .from("print_jobs")
    .select("*")
    .order("created_at", { ascending: false });

  if (from) query = query.gte("created_at", dayStartGT(from));
  if (to) query = query.lte("created_at", dayEndGT(to));
  if (!from && !to) query = query.limit(200);

  // Pedidos entregados del flujo local (recepción por carpeta), por fecha de entrega
  const localRange = from || to
    ? { since: from ? dayStartGT(from) : undefined, until: to ? dayEndGT(to) : undefined }
    : { limit: 200 };

  const [
    { data: profileData }, { data: allData }, { data: todayData }, { data: weekData }, { data: monthData },
    localAll, localToday, localWeek, localMonth,
  ] =
    await Promise.all([
      supabase.from("profiles").select("*").eq("id", user!.id).single(),
      query,
      supabase.from("print_jobs").select("*").gte("created_at", startOfToday),
      supabase.from("print_jobs").select("*").gte("created_at", startOfWeek),
      supabase.from("print_jobs").select("*").gte("created_at", startOfMonth),
      fetchDeliveredOrders(supabase, localRange),
      fetchDeliveredOrders(supabase, { since: startOfToday }),
      fetchDeliveredOrders(supabase, { since: startOfWeek }),
      fetchDeliveredOrders(supabase, { since: startOfMonth }),
    ]);

  const jobs = (allData ?? []) as PrintJob[];
  const today = (todayData ?? []) as PrintJob[];
  const week = (weekData ?? []) as PrintJob[];
  const month = (monthData ?? []) as PrintJob[];

  // QR: cuenta lo marcado como pagado. Local: cuenta lo entregado.
  const period = (label: string, qr: PrintJob[], local: DeliveredOrder[]) => ({
    label,
    jobs: qr.length + local.length,
    revenue: sumRevenue(qr) + localRevenue(local),
    pages: sumPages(qr) + localPages(local),
  });
  const periodStats = [
    period("Hoy", today, localToday),
    period("Esta semana", week, localWeek),
    period("Este mes", month, localMonth),
    period("Total", jobs, localAll),
  ];

  const bwJobs = jobs.filter((j) => j.print_type === "bw");
  const colorJobs = jobs.filter((j) => j.print_type === "color");
  const localBw = localByColor(localAll, "bw");
  const localColor = localByColor(localAll, "color");

  return (
    <>
      <AdminHeader profile={profileData as Profile} title="Reportes" />
      <div className="flex-1 overflow-y-auto p-6">
        <ReportsClient
          jobs={jobs}
          periodStats={periodStats}
          localOrders={localAll.map(({ reception_print_jobs, ...o }) => ({
            ...o,
            pages: localPages([{ ...o, reception_print_jobs }]),
          }))}
          bwRevenue={sumRevenue(bwJobs) + localBw.revenue}
          bwJobs={bwJobs.length + localBw.jobs}
          bwPages={sumPages(bwJobs) + localBw.pages}
          colorRevenue={sumRevenue(colorJobs) + localColor.revenue}
          colorJobs={colorJobs.length + localColor.jobs}
          colorPages={sumPages(colorJobs) + localColor.pages}
          from={from ?? ""}
          to={to ?? ""}
        />
      </div>
    </>
  );
}
