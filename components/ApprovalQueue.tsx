"use client";

import { userMessage } from "@/lib/userMessage";
import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useAuth } from "@/lib/auth/AuthContext";
import {
  approveConcessionaire,
  rejectConcessionaire,
  subscribeToApprovalQueue,
} from "@/lib/firebase/concessionaires";
import type { Concessionaire } from "@/lib/firebase/types";
import { getFullName } from "@/lib/utils";
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
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { AlertCircle, CheckCircle2, Clock, Loader2, XCircle } from "lucide-react";

function when(iso?: string): string {
  if (!iso) return "";
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? ""
    : d.toLocaleString("en-PH", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

/**
 * Concessionaire accounts that staff have asked for and an admin hasn't decided
 * on yet.
 *
 * An admin sees every pending request and approves or rejects it here. A staff
 * member sees only their own requests — pending ones, and recent rejections with
 * the reason — so they know what happened without having to ask. Renders nothing
 * when there's nothing to show.
 */
export function ApprovalQueue({ onChanged }: { onChanged?: () => void }) {
  const { user, role } = useAuth();
  const isAdmin = role === "admin";
  const email = user?.email ?? "";

  const [accounts, setAccounts] = useState<Concessionaire[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const [rejectTarget, setRejectTarget] = useState<Concessionaire | null>(null);
  const [reason, setReason] = useState("");
  const [rejectError, setRejectError] = useState<string | null>(null);
  const [rejecting, setRejecting] = useState(false);

  useEffect(
    () =>
      subscribeToApprovalQueue(
        (rows) => {
          setAccounts(rows);
          setLoadError(null);
        },
        (e) => setLoadError(userMessage(e, "Couldn't load approval requests."))
      ),
    []
  );

  const mine = (a: Concessionaire) => isAdmin || a.approvalRequestedBy === email;

  const pending = useMemo(
    () =>
      accounts
        .filter((a) => a.approvalStatus === "PENDING" && mine(a))
        .sort((a, b) => (a.approvalRequestedAt ?? "").localeCompare(b.approvalRequestedAt ?? "")),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [accounts, isAdmin, email]
  );

  const rejected = useMemo(
    () =>
      accounts
        .filter((a) => a.approvalStatus === "REJECTED" && mine(a))
        .sort((a, b) => (b.approvalReviewedAt ?? "").localeCompare(a.approvalReviewedAt ?? ""))
        .slice(0, 5),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [accounts, isAdmin, email]
  );

  if (!role || (pending.length === 0 && rejected.length === 0 && !loadError)) return null;

  async function approve(a: Concessionaire) {
    setBusyId(a.id);
    setActionError(null);
    try {
      await approveConcessionaire(a.id, email);
      onChanged?.();
    } catch (e) {
      setActionError(userMessage(e, "Couldn't approve that account."));
    } finally {
      setBusyId(null);
    }
  }

  async function confirmReject() {
    if (!rejectTarget) return;
    setRejecting(true);
    setRejectError(null);
    try {
      await rejectConcessionaire(rejectTarget.id, reason, email);
      setRejectTarget(null);
      setReason("");
      onChanged?.();
    } catch (e) {
      setRejectError(userMessage(e, "Couldn't reject that account."));
    } finally {
      setRejecting(false);
    }
  }

  return (
    <Card className="border-amber-200 bg-white/90">
      <CardHeader>
        <div className="flex items-center gap-2">
          <Clock className="h-4 w-4 text-amber-500" />
          <CardTitle className="text-sm font-semibold text-slate-800">
            {isAdmin ? "Accounts waiting for your approval" : "Your account requests"}
          </CardTitle>
          {pending.length > 0 && (
            <Badge variant="secondary" className="bg-amber-50 text-amber-700 border-amber-200 text-[10px]">
              {pending.length} pending
            </Badge>
          )}
        </div>
        <CardDescription className="text-xs text-slate-500">
          {isAdmin
            ? "Added by staff. Until you approve one, it can't be assigned for reading, billed, or take payments."
            : "An admin has to approve each account before it can be read, billed, or take payments."}
        </CardDescription>
      </CardHeader>

      <CardContent className="space-y-4">
        {loadError && (
          <Alert variant="destructive">
            <AlertCircle className="h-4 w-4" />
            <AlertDescription>Couldn&apos;t load pending accounts: {loadError}</AlertDescription>
          </Alert>
        )}
        {actionError && (
          <Alert variant="destructive">
            <AlertCircle className="h-4 w-4" />
            <AlertDescription>{actionError}</AlertDescription>
          </Alert>
        )}

        {pending.length > 0 && (
          <ul className="divide-y divide-slate-100 rounded-lg border border-slate-200">
            {pending.map((a) => (
              <li key={a.id} className="flex flex-col gap-3 p-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0">
                  <Link
                    href={`/concessionaires/${a.id}`}
                    className="text-sm font-semibold text-slate-900 hover:text-sky-600 hover:underline"
                  >
                    {getFullName(a)}
                  </Link>
                  <p className="text-xs text-slate-500">
                    <code className="rounded bg-slate-100 px-1 font-mono text-[11px]">{a.meterNumber}</code>
                    {" · "}
                    {a.barangay}, Purok {a.purok} · {a.classification}
                  </p>
                  <p className="text-[11px] text-slate-400">
                    Requested by {a.approvalRequestedBy || "unknown"}
                    {a.approvalRequestedAt ? ` · ${when(a.approvalRequestedAt)}` : ""}
                  </p>
                </div>

                {isAdmin ? (
                  <div className="flex shrink-0 gap-2">
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-8 text-xs font-semibold text-red-600 border-red-200 hover:bg-red-50"
                      disabled={busyId !== null}
                      onClick={() => {
                        setRejectTarget(a);
                        setReason("");
                        setRejectError(null);
                      }}
                    >
                      <XCircle className="mr-1.5 h-3.5 w-3.5" />
                      Reject
                    </Button>
                    <Button
                      size="sm"
                      className="h-8 bg-emerald-600 text-xs font-semibold text-white hover:bg-emerald-700"
                      disabled={busyId !== null}
                      onClick={() => approve(a)}
                    >
                      {busyId === a.id ? (
                        <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <CheckCircle2 className="mr-1.5 h-3.5 w-3.5" />
                      )}
                      Approve
                    </Button>
                  </div>
                ) : (
                  <Badge variant="secondary" className="w-fit bg-amber-50 text-amber-700 border-amber-200 text-[10px]">
                    Waiting for an admin
                  </Badge>
                )}
              </li>
            ))}
          </ul>
        )}

        {rejected.length > 0 && (
          <div>
            <p className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-slate-400">
              Recently rejected
            </p>
            <ul className="space-y-2">
              {rejected.map((a) => (
                <li key={a.id} className="rounded-lg border border-red-100 bg-red-50/50 p-3">
                  <p className="text-sm font-medium text-slate-800">
                    {getFullName(a)}{" "}
                    <code className="rounded bg-white px-1 font-mono text-[11px] text-slate-500">{a.meterNumber}</code>
                  </p>
                  <p className="text-xs text-red-700">{a.approvalRejectionReason}</p>
                  <p className="text-[11px] text-slate-400">
                    Rejected by {a.approvalReviewedBy}
                    {a.approvalReviewedAt ? ` · ${when(a.approvalReviewedAt)}` : ""}
                  </p>
                </li>
              ))}
            </ul>
          </div>
        )}
      </CardContent>

      <Dialog open={rejectTarget !== null} onOpenChange={(open) => !open && setRejectTarget(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Reject {rejectTarget ? getFullName(rejectTarget) : ""}</DialogTitle>
            <DialogDescription>
              The request stays on record, marked rejected, and the staff member who made it sees your
              reason. Its meter number is freed so a corrected request can be submitted.
            </DialogDescription>
          </DialogHeader>

          {rejectError && (
            <Alert variant="destructive">
              <AlertCircle className="h-4 w-4" />
              <AlertDescription>{rejectError}</AlertDescription>
            </Alert>
          )}

          <div className="space-y-1.5">
            <Label className="text-xs font-medium text-slate-700">
              Reason <span className="text-red-500">*</span>
            </Label>
            <Input
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="e.g. Meter number doesn't match the installed meter"
              className="text-sm"
            />
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setRejectTarget(null)} className="text-sm">
              Cancel
            </Button>
            <Button
              className="bg-red-600 text-sm text-white hover:bg-red-700"
              disabled={rejecting || !reason.trim()}
              onClick={confirmReject}
            >
              {rejecting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Reject request
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
