"use client";

import React, { useState, useTransition } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { Users, AlertCircle, Loader2, Pencil, Plus } from "lucide-react";
import { addConcessionaire, updateConcessionaireDetails } from "@/lib/firebase/concessionaires";
import { useAuth } from "@/lib/auth/AuthContext";
import {
  BARANGAYS,
  CONCESSIONAIRE_CLASSIFICATIONS,
  CONCESSIONAIRE_STATUSES,
  DISCONNECTED_REASONS,
  type Concessionaire,
  type NewConcessionaireInput,
} from "@/lib/firebase/types";

const emptyForm = (): NewConcessionaireInput => ({
  barangay: "",
  purok: "",
  meterNumber: "",
  firstName: "",
  middleName: "",
  lastName: "",
  classification: "RESIDENTIAL",
  status: "DISCONNECTED",
  disconnectedReason: "NO CONNECTION YET",
  billingBalance: 0,
  waterMeterBalance: 0,
  totalBalance: 0,
  billingHistory: [],
  meterPayments: [],
  remarks: [],
  requirements: {
    barangayClearance: false,
    cedula: false,
    picture2x2: false,
  },
});

export interface ConcessionaireDialogProps {
  open: boolean;
  onClose: () => void;
  selectedBarangay: string | null;
  onSuccess: () => void;
  editData?: Concessionaire | null;
}

export function ConcessionaireDialog({
  open,
  onClose,
  selectedBarangay,
  onSuccess,
  editData,
}: ConcessionaireDialogProps) {
  const { user } = useAuth();
  const isEditing = !!editData;
  const [form, setForm] = useState<Partial<Concessionaire>>(() => {
    if (editData) return { ...editData };
    const f = emptyForm();
    f.barangay = selectedBarangay ?? "";
    return f;
  });

  const [newRemark, setNewRemark] = useState("");

  // Re-sync form when editData changes
  const prevEditId = React.useRef(editData?.id);
  if (editData?.id !== prevEditId.current) {
    prevEditId.current = editData?.id;
    if (editData) {
      setForm({ ...editData });
      setNewRemark("");
    } else {
      const f = emptyForm();
      f.barangay = selectedBarangay ?? "";
      setForm(f);
      setNewRemark("");
    }
  }

  const [isPending, startTransition] = useTransition();
  const [submitError, setSubmitError] = useState<string | null>(null);

  function handleChange(field: keyof Concessionaire, value: string | number) {
    setForm((prev) => {
      const updated = { ...prev, [field]: value };
      
      if (field === "status" && value !== "DISCONNECTED") {
        delete updated.disconnectedReason;
      }
      return updated;
    });
  }

  async function handleSubmit() {
    setSubmitError(null);
    if (!form.barangay || !form.firstName || !form.lastName || !form.meterNumber) {
      setSubmitError("Barangay, First Name, Last Name, and Meter Number are required.");
      return;
    }
    
    startTransition(async () => {
      try {
        const actorEmail = user?.email ?? "unknown";
        const finalRemarks = Array.isArray(form.remarks) ? [...form.remarks] : [];
        if (newRemark.trim()) {
          finalRemarks.push({
            text: newRemark.trim(),
            date: new Date().toISOString(),
            author: actorEmail,
          });
        }

        if (isEditing && form.id) {
          await updateConcessionaireDetails(
            form.id,
            {
              firstName: form.firstName,
              middleName: form.middleName,
              lastName: form.lastName,
              barangay: form.barangay,
              purok: form.purok,
              meterNumber: form.meterNumber,
              classification: form.classification,
              status: form.status,
              disconnectedReason: form.disconnectedReason,
              requirements: form.requirements,
              remarks: finalRemarks,
            } as any,
            actorEmail
          );
        } else {
          const payload = { ...form, remarks: finalRemarks } as NewConcessionaireInput;
          await addConcessionaire(payload, actorEmail);
          setForm(emptyForm());
          setNewRemark("");
        }
        onSuccess();
        onClose();
      } catch (err) {
        setSubmitError(
          err instanceof Error ? err.message : `Failed to ${isEditing ? "update" : "save"} concessionaire.`
        );
      }
    });
  }

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="sm:max-w-3xl max-h-[90vh] overflow-y-auto bg-white p-0 shadow-2xl">
        {/* Header */}
        <div className="sticky top-0 z-10 bg-white/90 backdrop-blur-xl border-b border-slate-100 px-6 py-5">
          <DialogHeader>
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-sky-50 border border-sky-100 shadow-sm">
                <Users className="h-5 w-5 text-sky-600" />
              </div>
              <div>
                <DialogTitle className="text-lg font-bold text-slate-900 tracking-tight">
                  {isEditing ? "Edit Concessionaire" : "New Concessionaire"}
                </DialogTitle>
                <DialogDescription className="text-xs font-medium text-slate-500 mt-0.5">
                  {isEditing ? "Update details and status." : "Register a new concessionaire account."}
                </DialogDescription>
              </div>
            </div>
          </DialogHeader>
        </div>

        <div className="p-6 space-y-6">
          {submitError && (
            <div className="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 p-3">
              <AlertCircle className="h-4 w-4 text-red-500 mt-0.5 shrink-0" />
              <p className="text-xs font-medium text-red-700">{submitError}</p>
            </div>
          )}

          {/* Identity */}
          <div className="space-y-4">
            <div className="flex items-center gap-2">
              <div className="h-4 w-1 rounded-full bg-sky-500" />
              <h4 className="text-[11px] font-bold uppercase tracking-widest text-slate-900">
                Identity
              </h4>
            </div>
            <div className="rounded-xl border border-slate-200/60 bg-slate-50/50 p-4 space-y-4 shadow-sm">
              <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
                <div className="space-y-1.5 col-span-1">
                  <Label htmlFor="c-fname" className="text-xs font-semibold text-slate-700">
                    First Name <span className="text-red-500">*</span>
                  </Label>
                  <Input
                    id="c-fname"
                    value={form.firstName || ""}
                    onChange={(e) => handleChange("firstName", e.target.value)}
                    placeholder="e.g. Maria"
                    className="text-sm bg-white border-slate-200 h-9"
                  />
                </div>
                <div className="space-y-1.5 col-span-1">
                  <Label htmlFor="c-mname" className="text-xs font-semibold text-slate-700">
                    Middle Name
                  </Label>
                  <Input
                    id="c-mname"
                    value={form.middleName || ""}
                    onChange={(e) => handleChange("middleName", e.target.value)}
                    placeholder="e.g. Dela Cruz"
                    className="text-sm bg-white border-slate-200 h-9"
                  />
                </div>
                <div className="space-y-1.5 col-span-1">
                  <Label htmlFor="c-lname" className="text-xs font-semibold text-slate-700">
                    Last Name <span className="text-red-500">*</span>
                  </Label>
                  <Input
                    id="c-lname"
                    value={form.lastName || ""}
                    onChange={(e) => handleChange("lastName", e.target.value)}
                    placeholder="e.g. Santos"
                    className="text-sm bg-white border-slate-200 h-9"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="c-barangay" className="text-xs font-semibold text-slate-700">
                    Barangay <span className="text-red-500">*</span>
                  </Label>
                  <Select
                    value={form.barangay}
                    onValueChange={(v) => v && handleChange("barangay", v)}
                  >
                    <SelectTrigger id="c-barangay" className="text-sm bg-white border-slate-200 h-9">
                      <SelectValue placeholder="Select" />
                    </SelectTrigger>
                    <SelectContent>
                      {BARANGAYS.map((b) => (
                        <SelectItem key={b} value={b} className="text-sm font-medium">
                          {b === "CG" ? "Cebuano Group" : b}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="c-purok" className="text-xs font-semibold text-slate-700">
                    Purok
                  </Label>
                  <Input
                    id="c-purok"
                    value={form.purok || ""}
                    onChange={(e) => handleChange("purok", e.target.value)}
                    placeholder="e.g. 1, 2A"
                    className="text-sm bg-white border-slate-200 h-9"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="c-classification" className="text-xs font-semibold text-slate-700">
                    Classification <span className="text-red-500">*</span>
                  </Label>
                  <Select
                    value={form.classification}
                    onValueChange={(v) => v && handleChange("classification", v)}
                  >
                    <SelectTrigger id="c-classification" className="text-sm bg-white border-slate-200 h-9">
                      <SelectValue placeholder="Select" />
                    </SelectTrigger>
                    <SelectContent>
                      {CONCESSIONAIRE_CLASSIFICATIONS.map((c) => (
                        <SelectItem key={c} value={c} className="text-sm font-medium">
                          {c}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5 md:col-span-3 lg:col-span-1">
                  <Label htmlFor="c-meter" className="text-xs font-semibold text-slate-700">
                    Meter Number <span className="text-red-500">*</span>
                  </Label>
                  <Input
                    id="c-meter"
                    value={form.meterNumber || ""}
                    onChange={(e) => handleChange("meterNumber", e.target.value)}
                    placeholder="e.g. MTR-001234"
                    className="text-sm bg-white border-slate-200 h-9 font-mono"
                  />
                </div>
              </div>
            </div>
          </div>

          {/* Requirements */}
          <div className="space-y-4">
            <div className="flex items-center gap-2">
              <div className="h-4 w-1 rounded-full bg-amber-500" />
              <h4 className="text-[11px] font-bold uppercase tracking-widest text-slate-900">
                Requirements Checklist
              </h4>
            </div>
            <div className="rounded-xl border border-slate-200/60 bg-slate-50/50 p-4 shadow-sm flex flex-col sm:flex-row gap-6">
              <div className="flex items-center space-x-2">
                <Checkbox
                  id="req-barangay"
                  checked={form.requirements?.barangayClearance}
                  onCheckedChange={(checked) =>
                    setForm((prev) => ({
                      ...prev,
                      requirements: {
                        barangayClearance: !!checked,
                        cedula: prev.requirements?.cedula ?? false,
                        picture2x2: prev.requirements?.picture2x2 ?? false,
                      },
                    }))
                  }
                />
                <Label htmlFor="req-barangay" className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70">
                  Barangay Clearance
                </Label>
              </div>
              <div className="flex items-center space-x-2">
                <Checkbox
                  id="req-cedula"
                  checked={form.requirements?.cedula}
                  onCheckedChange={(checked) =>
                    setForm((prev) => ({
                      ...prev,
                      requirements: {
                        barangayClearance: prev.requirements?.barangayClearance ?? false,
                        cedula: !!checked,
                        picture2x2: prev.requirements?.picture2x2 ?? false,
                      },
                    }))
                  }
                />
                <Label htmlFor="req-cedula" className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70">
                  Cedula
                </Label>
              </div>
              <div className="flex items-center space-x-2">
                <Checkbox
                  id="req-picture"
                  checked={form.requirements?.picture2x2}
                  onCheckedChange={(checked) =>
                    setForm((prev) => ({
                      ...prev,
                      requirements: {
                        barangayClearance: prev.requirements?.barangayClearance ?? false,
                        cedula: prev.requirements?.cedula ?? false,
                        picture2x2: !!checked,
                      },
                    }))
                  }
                />
                <Label htmlFor="req-picture" className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70">
                  2x2 Picture
                </Label>
              </div>
            </div>
          </div>

          {/* Status (Only show on Edit) */}
          {isEditing && (
            <div className="space-y-4">
              <div className="flex items-center gap-2">
                <div className="h-4 w-1 rounded-full bg-indigo-500" />
                <h4 className="text-[11px] font-bold uppercase tracking-widest text-slate-900">
                  Status
                </h4>
              </div>
              <div className="rounded-xl border border-slate-200/60 bg-slate-50/50 p-4 space-y-4 shadow-sm">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                  <div className="space-y-1.5">
                    <Label htmlFor="c-status" className="text-xs font-semibold text-slate-700">
                      Connection Status <span className="text-red-500">*</span>
                    </Label>
                    <Select
                      value={form.status || "CONNECTED"}
                      onValueChange={(v) => v && handleChange("status", v)}
                    >
                      <SelectTrigger id="c-status" className="text-sm bg-white border-slate-200 h-9">
                        <SelectValue placeholder="Select" />
                      </SelectTrigger>
                      <SelectContent>
                        {CONCESSIONAIRE_STATUSES.map((s) => (
                          <SelectItem key={s} value={s} className="text-sm font-medium">
                            {s}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  {form.status === "DISCONNECTED" && (
                    <div className="space-y-1.5 animate-in slide-in-from-top-2 duration-300">
                      <Label htmlFor="c-reason" className="text-xs font-semibold text-slate-700">
                        Disconnection Reason <span className="text-red-500">*</span>
                      </Label>
                      <Select
                        value={form.disconnectedReason || ""}
                        onValueChange={(v) => v && handleChange("disconnectedReason", v)}
                      >
                        <SelectTrigger id="c-reason" className="text-sm bg-white border-slate-200 h-9">
                          <SelectValue placeholder="Select Reason" />
                        </SelectTrigger>
                        <SelectContent>
                          {DISCONNECTED_REASONS.map((r) => (
                            <SelectItem key={r} value={r} className="text-sm font-medium">
                              {r}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* Remarks */}
          <div className="space-y-4">
            <div className="flex items-center gap-2">
              <div className="h-4 w-1 rounded-full bg-emerald-500" />
              <h4 className="text-[11px] font-bold uppercase tracking-widest text-slate-900">
                Remarks History
              </h4>
            </div>
            {Array.isArray(form.remarks) && form.remarks.length > 0 && (
              <div className="space-y-3 mb-4">
                {form.remarks.map((r, i) => (
                  <div key={i} className="rounded-lg bg-emerald-50/50 border border-emerald-100 p-3">
                    <p className="text-[10px] font-semibold text-emerald-600 mb-1">
                      {new Date(r.date).toLocaleString(undefined, {
                        year: 'numeric', month: 'short', day: 'numeric',
                        hour: 'numeric', minute: 'numeric'
                      })}
                    </p>
                    <p className="text-sm text-emerald-900 whitespace-pre-wrap">{r.text}</p>
                  </div>
                ))}
              </div>
            )}
            <textarea
              value={newRemark}
              onChange={(e) => setNewRemark(e.target.value)}
              placeholder="Add a new remark..."
              rows={3}
              className="w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 placeholder:text-slate-400 focus:outline-none focus:ring-1 focus:ring-sky-500 focus:border-sky-500 resize-none shadow-sm"
            />
          </div>
        </div>

        {/* Footer */}
        <div className="sticky bottom-0 z-10 bg-white/90 backdrop-blur-xl border-t border-slate-100 px-6 py-4">
          <DialogFooter className="flex gap-3 sm:justify-end">
            <Button
              variant="outline"
              className="text-sm font-semibold text-slate-600 border-slate-200 hover:bg-slate-50 flex-1 sm:flex-none"
              onClick={onClose}
              disabled={isPending}
            >
              Cancel
            </Button>
            <Button
              className="bg-sky-600 hover:bg-sky-700 text-white text-sm font-semibold flex-1 sm:flex-none gap-2"
              onClick={handleSubmit}
              disabled={isPending}
            >
              {isPending ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Saving…
                </>
              ) : (
                <>
                  {isEditing ? <Pencil className="h-4 w-4" /> : <Plus className="h-4 w-4" />}
                  {isEditing ? "Save Changes" : "Add Concessionaire"}
                </>
              )}
            </Button>
          </DialogFooter>
        </div>
      </DialogContent>
    </Dialog>
  );
}
