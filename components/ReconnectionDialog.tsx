"use client";

/**
 * components/ReconnectionDialog.tsx
 *
 * Asks for a disconnected line to be put back in service.
 *
 * The ₱200 reconnection fee is taken at the counter as the request is made, so
 * the receipt is written before this is submitted and its OR number is typed
 * in here. An admin then sends a crew out, and only confirms the account as
 * connected once the water is actually back on.
 */

import { useState } from "react";
import { useAuth } from "@/lib/auth/AuthContext";
import { userMessage } from "@/lib/userMessage";
import { submitReconnectionRequest } from "@/lib/firebase/requests";
import { orNumberProblem } from "@/lib/receipts";
import { RECONNECTION_FEE } from "@/lib/billing";
import type { Concessionaire } from "@/lib/firebase/types";
import { formatPeso, getFullName } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { AlertCircle, Loader2, Truck } from "lucide-react";

export function ReconnectionDialog({
  concessionaire,
  open,
  onClose,
  onSubmitted,
}: {
  concessionaire: Concessionaire;
  open: boolean;
  onClose: () => void;
  onSubmitted?: () => void;
}) {
  const { user } = useAuth();
  const actorEmail = user?.email ?? "unknown";

  const [orNumber, setOrNumber] = useState("");
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const orProblem = orNumber.trim() ? orNumberProblem(orNumber) : null;

  async function submit() {
    setSubmitting(true);
    setError(null);
    try {
      await submitReconnectionRequest(concessionaire, { orNumber, note }, actorEmail);
      setOrNumber("");
      setNote("");
      onSubmitted?.();
      onClose();
    } catch (e) {
      setError(userMessage(e, "Couldn't submit the reconnection request."));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Request reconnection</DialogTitle>
          <DialogDescription>
            {getFullName(concessionaire)} · Meter {concessionaire.meterNumber || "N/A"}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="rounded-lg border border-slate-200 bg-slate-50 px-4 py-3">
            <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">
              Reconnection fee
            </p>
            <p className="text-2xl font-bold text-slate-900">{formatPeso(RECONNECTION_FEE)}</p>
            <p className="mt-1 text-xs text-slate-500">
              Collect this at the counter and write the receipt before submitting.
            </p>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="reconnect-or" className="text-xs font-medium text-slate-700">
              OR number from the receipt *
            </Label>
            <Input
              id="reconnect-or"
              value={orNumber}
              onChange={(e) => setOrNumber(e.target.value)}
              placeholder="e.g. 1234567"
              className="font-mono"
              autoComplete="off"
            />
            {orProblem && <p className="text-xs text-red-600">{orProblem}</p>}
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="reconnect-note" className="text-xs font-medium text-slate-700">
              Note for the admin (optional)
            </Label>
            <Textarea
              id="reconnect-note"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="e.g. Household is home all day; meter is behind the gate"
              rows={3}
            />
          </div>

          <p className="text-xs text-slate-500">
            An admin sends someone to reconnect the line, then marks the account connected once it
            is back on.
          </p>

          {error && (
            <Alert variant="destructive">
              <AlertCircle className="h-4 w-4" />
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button
            className="bg-sky-600 text-white hover:bg-sky-700"
            disabled={submitting || !orNumber.trim() || orProblem !== null}
            onClick={submit}
          >
            {submitting ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <Truck className="mr-2 h-4 w-4" />
            )}
            Submit request
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
