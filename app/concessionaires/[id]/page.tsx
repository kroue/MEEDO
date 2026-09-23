"use client";

import { userMessage } from "@/lib/userMessage";
import React, { useEffect, useState, useSyncExternalStore } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import {
  ArrowLeft,
  Edit,
  Loader2,
  AlertCircle,
  FileText,
  CheckCircle2,
  XCircle,
  Plug,
  RotateCcw,
  Truck,
} from "lucide-react";
import { useConcessionaire } from "@/lib/firebase/useConcessionaires";
import { addRemark, resubmitConcessionaire } from "@/lib/firebase/concessionaires";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ConcessionaireDialog } from "@/components/ConcessionaireDialog";
import { ReconnectionDialog } from "@/components/ReconnectionDialog";
import { isOpenRequest, subscribeToAccountRequests } from "@/lib/firebase/requests";
import type { ServiceRequest } from "@/lib/firebase/types";
import { RECONNECTION_FEE, canRequestReconnection, isAwaitingFirstConnection } from "@/lib/billing";
import { formatPeso } from "@/lib/utils";
import { getFullName } from "@/lib/utils";
import { useAuth } from "@/lib/auth/AuthContext";

export default function ConcessionaireDetailsPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const { user, role } = useAuth();
  const canEdit = role === "admin";

  const { concessionaire, loading, error, refresh } = useConcessionaire(id, { realtime: true });
  const [editOpen, setEditOpen] = useState(false);
  const [newRemark, setNewRemark] = useState("");
  const [isAddingRemark, setIsAddingRemark] = useState(false);
  const [remarkError, setRemarkError] = useState<string | null>(null);
  const [reconnectOpen, setReconnectOpen] = useState(false);
  const [openRequests, setOpenRequests] = useState<ServiceRequest[]>([]);
  const [resubmitting, setResubmitting] = useState(false);
  const [resubmitError, setResubmitError] = useState<string | null>(null);

  // Where the back arrow goes. Opened from the approval queue, it goes back
  // there rather than dropping the admin into the full account list, which is
  // what the queue's links carry ?from=approvals for.
  //
  // Read from the address bar rather than with useSearchParams, which forces
  // the whole page behind a Suspense boundary at build time for one string.
  const backHref = useSyncExternalStore(
    () => () => {},
    () =>
      new URLSearchParams(window.location.search).get("from") === "approvals"
        ? "/approvals"
        : "/concessionaires",
    () => "/concessionaires"
  );

  useEffect(() => {
    if (!id) return;
    return subscribeToAccountRequests(
      id,
      (rows) => setOpenRequests(rows.filter(isOpenRequest)),
      (e) => console.warn("Couldn't load pending requests for this account", e)
    );
  }, [id]);

  const reconnection = openRequests.find((r) => r.kind === "RECONNECTION");
  // A brand new account is DISCONNECTED because it has never been connected —
  // that is a connection to set up, not a line to restore.
  const awaitingFirstConnection = concessionaire ? isAwaitingFirstConnection(concessionaire) : false;
  const reconnectable = concessionaire ? canRequestReconnection(concessionaire) : false;

  async function handleAddRemark() {
    if (!newRemark.trim() || !concessionaire) return;
    setIsAddingRemark(true);
    setRemarkError(null);
    try {
      await addRemark(concessionaire.id, {
        text: newRemark.trim(),
        date: new Date().toISOString(),
        author: user?.email ?? "unknown",
      });
      setNewRemark("");
    } catch (err) {
      console.error(err);
      setRemarkError(userMessage(err, "Failed to add the remark."));
    } finally {
      setIsAddingRemark(false);
    }
  }

  if (loading && !concessionaire) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[50vh]">
        <Loader2 className="h-8 w-8 animate-spin text-sky-500 mb-4" />
        <p className="text-sm font-medium text-slate-500">Loading concessionaire details...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-6">
        <div className="rounded-xl border border-red-200 bg-red-50 p-6 flex flex-col items-center">
          <AlertCircle className="h-10 w-10 text-red-500 mb-3" />
          <h2 className="text-lg font-bold text-red-700">Error Loading Details</h2>
          <p className="text-sm text-red-600 mt-1 mb-4">{userMessage(error)}</p>
          <Button variant="outline" onClick={() => router.push("/concessionaires")}>
            <ArrowLeft className="h-4 w-4 mr-2" />
            Back to Concessionaires
          </Button>
        </div>
      </div>
    );
  }

  if (!concessionaire) {
    return (
      <div className="p-6">
        <div className="rounded-xl border border-slate-200 bg-slate-50 p-6 flex flex-col items-center">
          <FileText className="h-10 w-10 text-slate-400 mb-3" />
          <h2 className="text-lg font-bold text-slate-700">Concessionaire Not Found</h2>
          <p className="text-sm text-slate-500 mt-1 mb-4">The record you are looking for does not exist or has been removed.</p>
          <Button variant="outline" onClick={() => router.push("/concessionaires")}>
            <ArrowLeft className="h-4 w-4 mr-2" />
            Back to Concessionaires
          </Button>
        </div>
      </div>
    );
  }

  const { requirements } = concessionaire;

  // An account an admin hasn't approved isn't an account yet: it can't be
  // edited, connected, billed or take payments. A rejected one can still be
  // corrected, which is what re-submitting it is for.
  const pendingApproval = concessionaire.approvalStatus === "PENDING";
  const rejected = concessionaire.approvalStatus === "REJECTED";
  const awaitingDecision = pendingApproval || rejected;
  const mayResubmit =
    rejected && (role === "admin" || concessionaire.approvalRequestedBy === user?.email);

  async function handleResubmit() {
    setResubmitting(true);
    setResubmitError(null);
    try {
      await resubmitConcessionaire(id, user?.email ?? "");
      refresh();
    } catch (e) {
      setResubmitError(userMessage(e, "Couldn't re-submit this account."));
    } finally {
      setResubmitting(false);
    }
  }

  return (
    <div className="p-4 md:p-8 space-y-6 max-w-5xl mx-auto">
      {/* Header & Actions */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="flex items-center gap-4">
          <Link href={backHref} aria-label="Back">
            <Button variant="outline" size="icon" className="h-10 w-10 rounded-xl shrink-0">
              <ArrowLeft className="h-4 w-4 text-slate-600" />
            </Button>
          </Link>
          <div>
            <h1 className="text-2xl font-bold text-slate-900 tracking-tight">
              {getFullName(concessionaire)}
            </h1>
            <p className="text-sm font-medium text-slate-500">
              {concessionaire.barangay === "CG" ? "Cebuano Group" : concessionaire.barangay} • Purok {concessionaire.purok}
            </p>
          </div>
        </div>
        <div className="flex gap-2 items-center">
          {!awaitingDecision && (
            <Link href={`/connections/${concessionaire.id}`}>
              <Button variant="outline" className="bg-white border-slate-200 text-slate-700 hover:bg-slate-50 font-semibold shadow-sm">
                <Plug className="h-4 w-4 mr-2 text-sky-500" />
                View Connection
              </Button>
            </Link>
          )}
          {canEdit && !pendingApproval && (
            <Button
              className="bg-sky-600 hover:bg-sky-700 text-white font-semibold shadow-sm"
              onClick={() => setEditOpen(true)}
            >
              <Edit className="h-4 w-4 mr-2" />
              Edit Details
            </Button>
          )}
        </div>
      </div>

      {/* Nothing may be done to an account an admin hasn't decided on — so the
          page says so plainly rather than offering buttons that would fail. */}
      {awaitingDecision && (
        <div
          className={`rounded-2xl border p-4 ${
            pendingApproval ? "border-amber-200 bg-amber-50" : "border-red-200 bg-red-50"
          }`}
        >
          <p className={`text-sm font-semibold ${pendingApproval ? "text-amber-900" : "text-red-900"}`}>
            {pendingApproval ? "Waiting for an admin's approval" : "This request was rejected"}
          </p>
          <p className={`mt-1 text-sm ${pendingApproval ? "text-amber-800" : "text-red-800"}`}>
            {pendingApproval
              ? "Until an admin approves it, this account can't be edited, connected, assigned for reading, billed, or take payments."
              : concessionaire.approvalRejectionReason ||
                "An admin sent this back. Fix what they asked for and submit it again."}
          </p>
          {rejected && (
            <p className="mt-1 text-xs text-red-700">
              Correct the details, then re-submit it. Nothing else can be done with it until an
              admin approves it.
            </p>
          )}
          {resubmitError && (
            <p className="mt-2 text-xs font-medium text-red-700">{resubmitError}</p>
          )}
          {mayResubmit && (
            <Button
              className="mt-3 bg-slate-900 text-white hover:bg-slate-800"
              disabled={resubmitting}
              onClick={handleResubmit}
            >
              {resubmitting ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <RotateCcw className="mr-2 h-4 w-4" />
              )}
              Re-submit for approval
            </Button>
          )}
        </div>
      )}

      {/* Main Content Grid */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {/* Left Column: Identity & Info */}
        <div className="md:col-span-2 space-y-6">
          <div className="rounded-2xl border border-slate-200 bg-white shadow-sm overflow-hidden">
            <div className="border-b border-slate-100 bg-slate-50/50 px-6 py-4">
              <h3 className="text-[13px] font-bold uppercase tracking-widest text-slate-600">
                Identity & Status
              </h3>
            </div>
            <div className="p-6">
              <div className="grid grid-cols-2 gap-6">
                <div>
                  <p className="text-xs font-medium text-slate-400 uppercase tracking-wider mb-1">Account Number</p>
                  <code className="text-base font-mono font-bold text-slate-800 bg-slate-100 px-2 py-0.5 rounded">
                    {concessionaire.accountNumber || "—"}
                  </code>
                </div>
                <div>
                  <p className="text-xs font-medium text-slate-400 uppercase tracking-wider mb-1">Meter Number</p>
                  <code className="text-base font-mono font-bold text-slate-800 bg-slate-100 px-2 py-0.5 rounded">
                    {concessionaire.meterNumber}
                  </code>
                </div>
                <div>
                  <p className="text-xs font-medium text-slate-400 uppercase tracking-wider mb-1">Status</p>
                  <Badge
                    variant={concessionaire.status === "CONNECTED" ? "default" : "destructive"}
                    className={concessionaire.status === "CONNECTED" ? "bg-emerald-500 hover:bg-emerald-600" : ""}
                  >
                    {concessionaire.status || "CONNECTED"}
                  </Badge>
                </div>
                <div>
                  <p className="text-xs font-medium text-slate-400 uppercase tracking-wider mb-1">Classification</p>
                  <span className="text-sm font-semibold text-slate-700">
                    {concessionaire.classification || "—"}
                  </span>
                </div>
                {concessionaire.status === "DISCONNECTED" && concessionaire.disconnectedReason && (
                  <div>
                    <p className="text-xs font-medium text-red-400 uppercase tracking-wider mb-1">Reason</p>
                    <span className="text-sm font-semibold text-red-700 bg-red-50 px-2 py-0.5 rounded border border-red-100">
                      {concessionaire.disconnectedReason}
                    </span>
                  </div>
                )}
              </div>

              {awaitingFirstConnection && (
                <div className="mt-6 flex flex-col gap-3 rounded-xl border border-slate-200 bg-slate-50 p-4 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <p className="text-sm font-semibold text-slate-800">No connection yet</p>
                    <p className="text-xs text-slate-600">
                      This account has never been connected, so there is nothing to reconnect. Set
                      up its connection fee to put it in service.
                    </p>
                  </div>
                  <Link href={`/connections/${concessionaire.id}`}>
                    <Button variant="outline" className="border-slate-200 bg-white">
                      <Plug className="mr-2 h-4 w-4 text-sky-500" />
                      Set up connection
                    </Button>
                  </Link>
                </div>
              )}

              {reconnectable && (
                <div className="mt-6 flex flex-col gap-3 rounded-xl border border-sky-100 bg-sky-50/60 p-4 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <p className="text-sm font-semibold text-slate-800">Reconnection</p>
                    <p className="text-xs text-slate-600">
                      {reconnection
                        ? reconnection.status === "PENDING"
                          ? `Requested by ${reconnection.requestedBy} — waiting for an admin to send a crew.`
                          : "Approved — a crew is going out. An admin marks the account connected once the water is back on."
                        : `${formatPeso(RECONNECTION_FEE)} is collected at the counter, then an admin sends someone to reconnect the line.`}
                    </p>
                  </div>
                  {!reconnection && (
                    <Button
                      className="bg-sky-600 text-white hover:bg-sky-700"
                      onClick={() => setReconnectOpen(true)}
                    >
                      <Truck className="mr-2 h-4 w-4" />
                      Request reconnection
                    </Button>
                  )}
                </div>
              )}

              {Array.isArray(concessionaire.remarks) && concessionaire.remarks.length > 0 && (
                <div className="mt-6 p-4 rounded-xl bg-amber-50 border border-amber-100">
                  <p className="text-xs font-bold uppercase tracking-wider text-amber-700 mb-3">Remarks History</p>
                  <div className="space-y-4">
                    {concessionaire.remarks.map((r, i) => (
                      <div key={i} className="bg-white/60 p-3 rounded-lg border border-amber-200/50">
                        <p className="text-[10px] font-semibold text-amber-600 mb-1">
                          {new Date(r.date).toLocaleString(undefined, {
                            year: 'numeric', month: 'short', day: 'numeric',
                            hour: 'numeric', minute: 'numeric'
                          })}
                        </p>
                        <p className="text-sm text-amber-900 whitespace-pre-wrap leading-relaxed">
                          {r.text}
                        </p>
                      </div>
                    ))}
                  </div>
                </div>
              )}
              
              {/* Add New Remark Form */}
              {canEdit && (
                <div className="mt-4 flex flex-col gap-3">
                  {remarkError && (
                    <p className="flex items-start gap-1.5 text-xs text-red-600">
                      <AlertCircle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
                      {remarkError}
                    </p>
                  )}
                  <textarea
                    value={newRemark}
                    onChange={(e) => setNewRemark(e.target.value)}
                    placeholder="Add a new remark..."
                    rows={2}
                    className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 placeholder:text-slate-400 focus:outline-none focus:ring-1 focus:ring-sky-500 focus:border-sky-500 resize-none shadow-sm"
                  />
                  <Button
                    onClick={handleAddRemark}
                    disabled={isAddingRemark || !newRemark.trim()}
                    className="self-end bg-sky-600 hover:bg-sky-700 text-white font-semibold text-xs h-8 px-4 rounded-lg"
                  >
                    {isAddingRemark ? <Loader2 className="h-3 w-3 mr-2 animate-spin" /> : null}
                    Add Remark
                  </Button>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Right Column: Requirements Checklist */}
        <div className="space-y-6">
          <div className="rounded-2xl border border-slate-200 bg-white shadow-sm overflow-hidden">
            <div className="border-b border-slate-100 bg-amber-50/50 px-6 py-4">
              <h3 className="text-[13px] font-bold uppercase tracking-widest text-amber-700">
                Requirements
              </h3>
            </div>
            <div className="p-6 space-y-4">
              <RequirementItem 
                label="Barangay Clearance" 
                checked={requirements?.barangayClearance} 
              />
              <RequirementItem 
                label="Cedula" 
                checked={requirements?.cedula} 
              />
              <RequirementItem 
                label="2x2 Picture" 
                checked={requirements?.picture2x2} 
              />
            </div>
          </div>
        </div>
      </div>

      <ReconnectionDialog
        concessionaire={concessionaire}
        open={reconnectOpen}
        onClose={() => setReconnectOpen(false)}
        onSubmitted={refresh}
      />

      {/* Edit Modal */}
      {editOpen && (
        <ConcessionaireDialog
          open={editOpen}
          onClose={() => setEditOpen(false)}
          onSuccess={() => {
            setEditOpen(false);
          }}
          selectedBarangay={concessionaire.barangay}
          editData={concessionaire}
        />
      )}
    </div>
  );
}

function RequirementItem({ label, checked }: { label: string; checked?: boolean }) {
  return (
    <div className="flex items-center justify-between p-3 rounded-lg border border-slate-100 bg-slate-50/50">
      <span className="text-sm font-medium text-slate-700">{label}</span>
      {checked ? (
        <CheckCircle2 className="h-5 w-5 text-emerald-500" />
      ) : (
        <XCircle className="h-5 w-5 text-slate-300" />
      )}
    </div>
  );
}
