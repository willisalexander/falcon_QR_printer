import { createClient } from "@/lib/supabase/server";
import { AdminHeader } from "@/components/admin/header";
import { ReportsClient } from "./reports-client";
import type { Profile, PrintJob } from "@/types";
import type { Metadata } from "next";

export const metadata: Metadata = { title: "Reportes" };

interface PageProps {
  searchParams: Promise<{ from?: string; to?: string }>;
}

function sumRevenue(list: PrintJob[]) {
  return list
    .filter((j) => j.status === "paid" || j.status === "printed")
    .reduce((acc, j) => acc + Number(j.total_price), 0);
}

function sumPages(list: PrintJob[]) {
  return list
    .filter((j) => j.status === "paid" || j.status === "printed")
    .reduce((acc, j) => acc + j.page_count * j.copy_count, 0);
}

export default async function ReportsPage({ searchParams }: PageProps) {
  const { from, to } = await searchParams;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  const now = new Date();

  // Inicia las 4 consultas en paralelo
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString();
  const startOfWeek = new Date(now.getFullYear(), now.getMonth(), now.getDate() - now.getDay()).toISOString();
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();

  // Query principal (filtrada si hay from/to, o últimos 200 si no)
  let query = supabase
    .from("print_jobs")
    .select("*")
    .order("created_at", { ascending: false });

  if (from) query = query.gte("created_at", `${from}T00:00:00`);
  if (to) query = query.lte("created_at", `${to}T23:59:59`);
  if (!from && !to) query = query.limit(200);

  const [{ data: profileData }, { data: allData }, { data: todayData }, { data: weekData }, { data: monthData }] =
    await Promise.all([
      supabase.from("profiles").select("*").eq("id", user!.id).single(),
      query,
      supabase.from("print_jobs").select("*").gte("created_at", startOfToday),
      supabase.from("print_jobs").select("*").gte("created_at", startOfWeek),
      supabase.from("print_jobs").select("*").gte("created_at", startOfMonth),
    ]);

  const jobs = (allData ?? []) as PrintJob[];
  const today = (todayData ?? []) as PrintJob[];
  const week = (weekData ?? []) as PrintJob[];
  const month = (monthData ?? []) as PrintJob[];

  const periodStats = [
    { label: "Hoy",         jobs: today.length,  revenue: sumRevenue(today),  pages: sumPages(today) },
    { label: "Esta semana", jobs: week.length,   revenue: sumRevenue(week),   pages: sumPages(week) },
    { label: "Este mes",    jobs: month.length,  revenue: sumRevenue(month),  pages: sumPages(month) },
    { label: "Total",       jobs: jobs.length,   revenue: sumRevenue(jobs),   pages: sumPages(jobs) },
  ];

  const bwJobs = jobs.filter((j) => j.print_type === "bw");
  const colorJobs = jobs.filter((j) => j.print_type === "color");

  return (
    <>
      <AdminHeader profile={profileData as Profile} title="Reportes" />
      <div className="flex-1 overflow-y-auto p-6">
        <ReportsClient
          jobs={jobs}
          periodStats={periodStats}
          bwRevenue={sumRevenue(bwJobs)}
          bwJobs={bwJobs.length}
          bwPages={sumPages(bwJobs)}
          colorRevenue={sumRevenue(colorJobs)}
          colorJobs={colorJobs.length}
          colorPages={sumPages(colorJobs)}
          from={from ?? ""}
          to={to ?? ""}
        />
      </div>
    </>
  );
}
