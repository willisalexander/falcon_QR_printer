"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle, XCircle, Printer, DollarSign, AlertTriangle, Eye } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
import { Textarea } from "@/components/ui/textarea";
import { approveJob, rejectJob, markAsPrinted, markAsPaid } from "./actions";
import type { JobStatus } from "@/types";

interface JobActionsProps {
  jobId: string;
  status: JobStatus;
  showView?: boolean;
}

export function JobActions({ jobId, status, showView = false }: JobActionsProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [rejectOpen, setRejectOpen] = useState(false);
  const [rejectReason, setRejectReason] = useState("");
  const [error, setError] = useState<string | null>(null);

  async function handleAction(action: () => Promise<{ success: boolean; error?: string }>) {
    setError(null);
    startTransition(async () => {
      const result = await action();
      if (!result.success) {
        setError(result.error ?? "Error desconocido");
      }
    });
  }

  async function handleReject() {
    if (!rejectReason.trim()) return;
    setError(null);
    startTransition(async () => {
      const result = await rejectJob(jobId, rejectReason);
      if (result.success) {
        setRejectOpen(false);
        setRejectReason("");
      } else {
        setError(result.error ?? "Error al rechazar");
      }
    });
  }

  return (
    <>
      <div className="flex items-center gap-1.5 flex-wrap">
        {showView && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => router.push(`/admin/print-jobs/${jobId}`)}
          >
            <Eye className="h-3.5 w-3.5" />
            Ver
          </Button>
        )}

        {(status === "uploaded" || status === "pending_approval") && (
          <Button
            variant="primary"
            size="sm"
            loading={isPending}
            onClick={() => handleAction(() => approveJob(jobId))}
          >
            <CheckCircle className="h-3.5 w-3.5" />
            Aprobar
          </Button>
        )}

        {(status === "uploaded" || status === "pending_approval" || status === "approved") && (
          <Button
            variant="danger"
            size="sm"
            disabled={isPending}
            onClick={() => setRejectOpen(true)}
          >
            <XCircle className="h-3.5 w-3.5" />
            Rechazar
          </Button>
        )}

        {status === "approved" && (
          <Button
            variant="secondary"
            size="sm"
            loading={isPending}
            onClick={() => handleAction(() => markAsPrinted(jobId))}
          >
            <Printer className="h-3.5 w-3.5" />
            Marcar impreso
          </Button>
        )}

        {status === "printed" && (
          <Button
            variant="secondary"
            size="sm"
            loading={isPending}
            onClick={() => handleAction(() => markAsPaid(jobId))}
          >
            <DollarSign className="h-3.5 w-3.5" />
            Marcar pagado
          </Button>
        )}

        {error && (
          <span className="flex items-center gap-1 text-xs text-red-600">
            <AlertTriangle className="h-3.5 w-3.5" />
            {error}
          </span>
        )}
      </div>

      <Modal
        open={rejectOpen}
        onClose={() => setRejectOpen(false)}
        title="Rechazar trabajo"
      >
        <div className="space-y-4">
          <p className="text-sm text-gray-600">
            Indica el motivo del rechazo. El cliente podrá verlo.
          </p>
          <Textarea
            label="Motivo del rechazo"
            value={rejectReason}
            onChange={(e) => setRejectReason(e.target.value)}
            placeholder="Ej: Archivo dañado, formato no compatible..."
            required
          />
          {error && <p className="text-xs text-red-600">{error}</p>}
          <div className="flex gap-3 justify-end">
            <Button
              variant="outline"
              onClick={() => setRejectOpen(false)}
              disabled={isPending}
            >
              Cancelar
            </Button>
            <Button
              variant="danger"
              loading={isPending}
              onClick={handleReject}
              disabled={!rejectReason.trim()}
            >
              Confirmar rechazo
            </Button>
          </div>
        </div>
      </Modal>
    </>
  );
}
