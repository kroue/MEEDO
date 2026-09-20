"use client";

/**
 * Approvals — everything waiting on an admin's word.
 *
 * Two queues, because they are stored differently: new accounts carry their
 * own approval state on the account record, while payments, connection setups
 * and reconnections are submitted requests that have not touched an account
 * yet. Staff see the same page narrowed to what they submitted.
 */

import { useAuth } from "@/lib/auth/AuthContext";
import { ApprovalQueue } from "@/components/ApprovalQueue";
import { ServiceRequestQueue } from "@/components/ServiceRequestQueue";
import { ShieldCheck } from "lucide-react";

export default function ApprovalsPage() {
  const { role } = useAuth();
  const isAdmin = role === "admin";

  return (
    <div className="max-w-5xl space-y-6">
      <div className="flex items-start gap-3">
        <span className="mt-1 flex h-9 w-9 items-center justify-center rounded-lg bg-amber-50 text-amber-600">
          <ShieldCheck className="h-5 w-5" />
        </span>
        <div>
          <h2 className="text-2xl font-bold tracking-tight text-slate-900">Approvals</h2>
          <p className="text-sm text-slate-500">
            {isAdmin
              ? "New accounts, payments, connection setups and reconnections submitted by staff. Nothing here has changed an account yet."
              : "What you have sent for approval, and what an admin decided."}
          </p>
        </div>
      </div>

      <ApprovalQueue />
      <ServiceRequestQueue />
    </div>
  );
}
