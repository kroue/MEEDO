"use client";

/**
 * components/ServiceRequestQueue.tsx
 *
 * Payments, connection setups and reconnections that staff have submitted.
 *
 * An admin works the queue: approving a payment posts it to the account,
 * rejecting one leaves the account untouched. A reconnection takes two turns —
 * approve it to send a crew out, then confirm once the line is live.
 *
 * A staff member sees the same list narrowed to their own submissions, so they
 * can tell what has been posted and what was turned down, and why.
 */

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useAuth } from "@/lib/auth/AuthContext";
import { userMessage } from "@/lib/userMessage";
import {
  REQUEST_KIND_LABELS,
  approveRequest,
  confirmReconnection,
  isOpenRequest,
  rejectRequest,
  subscribeToMyServiceRequests,
  subscribeToServiceRequests,
} from "@/lib/firebase/requests";
import type { ServiceRequest, ServiceRequestKind } from "@/lib/firebase/types";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { formatPeso } from "@/lib/utils";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Pagination, usePagination } from "@/components/ui/pagination";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertCircle,
  Banknote,
  CheckCircle2,
  Clock,
  Loader2,
  Plug,
  Truck,
  Wrench,
  XCircle,
} from "lucide-react";

const KIND_ICONS: Record<ServiceRequestKind, React.ElementType> = {
  WATER_PAYMENT: Banknote,
  CONNECTION_PAYMENT: Plug,
  CONNECTION_SETUP: Wrench,
  RECONNECTION: Truck,
};

const RECENTLY_DECIDED = 8;

function when(iso?: string): string {
  if (!iso) return "";
  const date = new Date(iso);
  return Number.isNaN(date.getTime())
    ? ""
    : date.toLocaleString("en-PH", {
        month: "short",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      });
}

function StatusBadge({ request }: { request: ServiceRequest }) {
  if (request.status === "PENDING") {
    return (
      <Badge variant="secondary" className="border-amber-200 bg-amber-50 text-[10px] text-amber-700">
        Waiting for admin
      </Badge>
    );
  }
  if (request.status === "APPROVED") {
    return (
      <Badge variant="secondary" className="border-sky-200 bg-sky-50 text-[10px] text-sky-700">
        Crew sent out
      </Badge>
    );
  }
  if (request.status === "COMPLETED") {
    return (
      <Badge variant="secondary" className="border-emerald-200 bg-emerald-50 text-[10px] text-emerald-700">
        Done
      </Badge>
    );
  }
  return (
    <Badge variant="secondary" className="border-red-200 bg-red-50 text-[10px] text-red-700">
      Rejected
    </Badge>
  );
}

function RequestRow({
  request,
  children,
}: {
  request: ServiceRequest;
  children?: React.ReactNode;
}) {
  const Icon = KIND_ICONS[request.kind];
  return (
    <div className="flex flex-col gap-3 rounded-xl border border-slate-200 bg-white p-4 sm:flex-row sm:items-start">
      <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-slate-100 text-slate-500">
        <Icon className="h-4 w-4" />
      </span>

      <div className="min-w-0 flex-1 space-y-1">
        <div className="flex flex-wrap items-center gap-2">
          <p className="text-sm font-semibold text-slate-900">
            {REQUEST_KIND_LABELS[request.kind]}
            {request.amount ? ` — ${formatPeso(request.amount)}` : ""}
          </p>
          <StatusBadge request={request} />
        </div>

        <p className="text-xs text-slate-600">
          <Link
            href={`/concessionaires/${request.concessionaireId}`}
            className="font-medium text-sky-700 hover:underline"
          >
            {request.concessionaireName || "Unnamed account"}
          </Link>
          {request.meterNumber ? ` · Meter ${request.meterNumber}` : ""}
          {request.barangay ? ` · ${request.barangay === "CG" ? "Cebuano Group" : request.barangay}` : ""}
        </p>

        {request.cashTendered && request.amount && request.cashTendered > request.amount ? (
          <p className="text-xs text-slate-500">
            Cash received {formatPeso(request.cashTendered)} · change given{" "}
            {formatPeso(request.cashTendered - request.amount)}
          </p>
        ) : null}

        <p className="text-xs text-slate-500">
          {request.orNumber ? `OR ${request.orNumber} · ` : ""}
          {request.slot ? `${request.slot} installment · ` : ""}
          Submitted by {request.requestedBy} · {when(request.requestedAt)}
        </p>

        {request.note && <p className="text-xs italic text-slate-500">“{request.note}”</p>}

        {request.status === "REJECTED" && (
          <p className="text-xs text-red-700">
            Rejected by {request.reviewedBy}: {request.rejectionReason}
            {request.orNumber ? " — the amount collected has to be handed back." : ""}
          </p>
        )}

        {request.status === "COMPLETED" && request.outcome && (
          <p className="text-xs text-emerald-700">{request.outcome}</p>
        )}

        {request.status === "APPROVED" && (
          <p className="text-xs text-sky-700">
            Approved by {request.reviewedBy} · waiting for the line to be reconnected.
          </p>
        )}
      </div>

      {children && <div className="flex shrink-0 flex-wrap items-center gap-2">{children}</div>}
    </div>
  );
}

export function ServiceRequestQueue({ onChanged }: { onChanged?: () => void }) {
  const { user, role } = useAuth();
  const isAdmin = role === "admin";
  const email = user?.email ?? "";

  const [requests, setRequests] = useState<ServiceRequest[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const [rejectTarget, setRejectTarget] = useState<ServiceRequest | null>(null);
  const [reason, setReason] = useState("");
  const [rejectError, setRejectError] = useState<string | null>(null);
  const [rejecting, setRejecting] = useState(false);

  /** Approving moves money or sends a crew, so it is confirmed first. */
  const [approveTarget, setApproveTarget] = useState<ServiceRequest | null>(null);

  useEffect(() => {
    if (!role) return;
    const onError = (e: Error) => setLoadError(userMessage(e, "Couldn't load the request queue."));
    const onData = (rows: ServiceRequest[]) => {
      setRequests(rows);
      setLoadError(null);
    };
    if (isAdmin) return subscribeToServiceRequests(onData, onError);
    if (email) return subscribeToMyServiceRequests(email, onData, onError);
  }, [isAdmin, role, email]);

  const waiting = useMemo(
    () => requests.filter((r) => r.status === "PENDING"),
    [requests]
  );
  const outForReconnection = useMemo(
    () => requests.filter((r) => r.status === "APPROVED"),
    [requests]
  );
  const decided = useMemo(
    () => requests.filter((r) => !isOpenRequest(r)).slice(0, RECENTLY_DECIDED),
    [requests]
  );

  // A queue nobody has worked for a while can get long.
  const pagedWaiting = usePagination(waiting, 10);

  async function run(requestId: string, action: () => Promise<unknown>, fallback: string) {
    setBusyId(requestId);
    setActionError(null);
    try {
      await action();
      onChanged?.();
    } catch (e) {
      setActionError(userMessage(e, fallback));
    } finally {
      setBusyId(null);
    }
  }

  async function confirmReject() {
    if (!rejectTarget) return;
    setRejecting(true);
    setRejectError(null);
    try {
      await rejectRequest(rejectTarget.id, reason, email);
      setRejectTarget(null);
      setReason("");
      onChanged?.();
    } catch (e) {
      setRejectError(userMessage(e, "Couldn't reject that request."));
    } finally {
      setRejecting(false);
    }
  }

  const nothingToShow =
    waiting.length === 0 && outForReconnection.length === 0 && decided.length === 0 && !loadError;

  return (
    <>
      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <Clock className="h-4 w-4 text-amber-500" />
            <CardTitle className="text-sm font-semibold text-slate-800">
              {isAdmin ? "Payments and service requests" : "Your submissions"}
            </CardTitle>
            {waiting.length > 0 && (
              <Badge variant="secondary" className="border-amber-200 bg-amber-50 text-[10px] text-amber-700">
                {waiting.length} waiting
              </Badge>
            )}
          </div>
          <CardDescription className="text-xs text-slate-500">
            {isAdmin
              ? "Nothing here has touched an account yet. Approving a payment posts it; rejecting one leaves the account as it was."
              : "What you have sent to an admin. Payments post to the account once approved."}
          </CardDescription>
        </CardHeader>

        <CardContent className="space-y-5">
          {loadError && (
            <Alert variant="destructive">
              <AlertCircle className="h-4 w-4" />
              <AlertDescription>{loadError}</AlertDescription>
            </Alert>
          )}
          {actionError && (
            <Alert variant="destructive">
              <AlertCircle className="h-4 w-4" />
              <AlertDescription>{actionError}</AlertDescription>
            </Alert>
          )}

          {nothingToShow && (
            <div className="flex flex-col items-center gap-1.5 py-10 text-center">
              <CheckCircle2 className="mb-1 h-6 w-6 text-emerald-500" />
              <p className="text-sm font-medium text-slate-600">Nothing waiting</p>
              <p className="text-xs text-slate-400">
                {isAdmin
                  ? "Payments and requests from staff will appear here."
                  : "Payments you record are sent here for an admin to approve."}
              </p>
            </div>
          )}

          {waiting.length > 0 && (
            <div className="space-y-2">
              <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                {isAdmin ? "Waiting for you" : "Waiting for an admin"}
              </p>
              {pagedWaiting.rows.map((request) => (
                <RequestRow key={request.id} request={request}>
                  {isAdmin && (
                    <>
                      <Button
                        size="sm"
                        className="bg-emerald-600 text-white hover:bg-emerald-700"
                        disabled={busyId === request.id}
                        // Approving posts the money (or sends a crew), so it is
                        // confirmed against the account and amount first.
                        onClick={() => setApproveTarget(request)}
                      >
                        {busyId === request.id ? (
                          <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                        ) : (
                          <CheckCircle2 className="mr-1.5 h-3.5 w-3.5" />
                        )}
                        {request.kind === "RECONNECTION" ? "Approve & send crew" : "Approve"}
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        className="border-red-200 text-red-700 hover:bg-red-50"
                        disabled={busyId === request.id}
                        onClick={() => {
                          setRejectTarget(request);
                          setReason("");
                          setRejectError(null);
                        }}
                      >
                        <XCircle className="mr-1.5 h-3.5 w-3.5" />
                        Reject
                      </Button>
                    </>
                  )}
                </RequestRow>
              ))}
              <Pagination paged={pagedWaiting} noun="requests" />
            </div>
          )}

          {outForReconnection.length > 0 && (
            <div className="space-y-2">
              <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                Out for reconnection
              </p>
              {outForReconnection.map((request) => (
                <RequestRow key={request.id} request={request}>
                  {isAdmin && (
                    <>
                      <Button
                        size="sm"
                        className="bg-sky-600 text-white hover:bg-sky-700"
                        disabled={busyId === request.id}
                        onClick={() =>
                          run(
                            request.id,
                            () => confirmReconnection(request.id, email),
                            "Couldn't confirm that reconnection."
                          )
                        }
                      >
                        {busyId === request.id ? (
                          <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                        ) : (
                          <Plug className="mr-1.5 h-3.5 w-3.5" />
                        )}
                        Confirm reconnected
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        className="border-red-200 text-red-700 hover:bg-red-50"
                        disabled={busyId === request.id}
                        onClick={() => {
                          setRejectTarget(request);
                          setReason("");
                          setRejectError(null);
                        }}
                      >
                        <XCircle className="mr-1.5 h-3.5 w-3.5" />
                        Couldn&apos;t reconnect
                      </Button>
                    </>
                  )}
                </RequestRow>
              ))}
            </div>
          )}

          {decided.length > 0 && (
            <div className="space-y-2">
              <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                Recently decided
              </p>
              {decided.map((request) => (
                <RequestRow key={request.id} request={request} />
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <ConfirmDialog
        open={approveTarget !== null}
        onOpenChange={(open) => !open && setApproveTarget(null)}
        title={approveTarget ? `${REQUEST_KIND_LABELS[approveTarget.kind]}?` : ""}
        description={
          approveTarget?.kind === "RECONNECTION"
            ? "The ₱200 is already collected. Approving sends a crew; you confirm the line separately once it is back on."
            : "This posts against the account as soon as you approve it, and undoing it means voiding the entry."
        }
        confirmLabel={approveTarget?.kind === "RECONNECTION" ? "Approve & send crew" : "Approve"}
        busy={busyId === approveTarget?.id}
        onConfirm={() => {
          const target = approveTarget;
          setApproveTarget(null);
          if (target) {
            run(target.id, () => approveRequest(target.id, email), "Couldn't approve that request.");
          }
        }}
      >
        {approveTarget && (
          <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-xs text-slate-600">
            <p className="text-sm font-semibold text-slate-900">
              {approveTarget.concessionaireName || "Unnamed account"}
              {approveTarget.amount ? ` — ${formatPeso(approveTarget.amount)}` : ""}
            </p>
            <p className="mt-1">
              {approveTarget.orNumber ? `OR ${approveTarget.orNumber} · ` : ""}
              Submitted by {approveTarget.requestedBy}
            </p>
          </div>
        )}
      </ConfirmDialog>

      <Dialog open={rejectTarget !== null} onOpenChange={(open) => !open && setRejectTarget(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Reject this request</DialogTitle>
            <DialogDescription>
              {rejectTarget?.concessionaireName} · {rejectTarget && REQUEST_KIND_LABELS[rejectTarget.kind]}
              {rejectTarget?.amount ? ` · ${formatPeso(rejectTarget.amount)}` : ""}
              {rejectTarget?.orNumber
                ? `. OR ${rejectTarget.orNumber} was already written, so the money has to be handed back.`
                : "."}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-2">
            <Label htmlFor="reject-reason" className="text-xs font-medium text-slate-700">
              Reason (the person who submitted it sees this) *
            </Label>
            <Input
              id="reject-reason"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="e.g. Amount does not match the receipt"
            />
            {rejectError && (
              <Alert variant="destructive">
                <AlertCircle className="h-4 w-4" />
                <AlertDescription>{rejectError}</AlertDescription>
              </Alert>
            )}
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setRejectTarget(null)}>
              Cancel
            </Button>
            <Button
              className="bg-red-600 text-white hover:bg-red-700"
              disabled={rejecting || !reason.trim()}
              onClick={confirmReject}
            >
              {rejecting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Reject request
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
