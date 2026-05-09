"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

// Actualización en tiempo real vía Supabase Realtime (WebSocket).
// Requiere: ALTER PUBLICATION supabase_realtime ADD TABLE print_jobs;
// Si Realtime no está habilitado, el polling de respaldo actualiza cada 30 s.
const POLL_FALLBACK_MS = 30_000;

export function PrintJobsRealtime() {
  const router = useRouter();
  const [realtimeOk, setRealtimeOk] = useState(false);
  const [flashing, setFlashing] = useState(false);
  const flashTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  function triggerRefresh() {
    router.refresh();
    setFlashing(true);
    if (flashTimer.current) clearTimeout(flashTimer.current);
    flashTimer.current = setTimeout(() => setFlashing(false), 1500);
  }

  useEffect(() => {
    const supabase = createClient();

    // ── Realtime WebSocket ──────────────────────────────────
    const channel = supabase
      .channel("admin_print_jobs")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "print_jobs" },
        () => triggerRefresh()
      )
      .subscribe((status) => {
        setRealtimeOk(status === "SUBSCRIBED");
      });

    // ── Polling de respaldo (siempre activo) ────────────────
    // Garantiza actualizaciones aunque Realtime no esté configurado.
    const poll = setInterval(() => router.refresh(), POLL_FALLBACK_MS);

    return () => {
      if (flashTimer.current) clearTimeout(flashTimer.current);
      clearInterval(poll);
      supabase.removeChannel(channel);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <span
      className={`flex items-center gap-1.5 text-xs transition-colors duration-300 ${
        flashing ? "text-blue-600 font-medium" : "text-gray-400"
      }`}
    >
      <span
        className={`h-2 w-2 rounded-full ${
          flashing
            ? "bg-blue-500 animate-ping"
            : realtimeOk
            ? "bg-green-400"
            : "bg-yellow-400"
        }`}
      />
      {flashing ? "Actualizado" : realtimeOk ? "En vivo" : "Auto-refresh 30 s"}
    </span>
  );
}
