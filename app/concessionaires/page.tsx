"use client";

import { useState, useTransition } from "react";
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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Checkbox } from "@/components/ui/checkbox";
import { ConcessionaireDialog } from "@/components/ConcessionaireDialog";
import { useRouter } from "next/navigation";
import {
  MapPin,
  Plus,
  RefreshCw,
  ChevronDown,
  ChevronRight,
  AlertCircle,
  Loader2,
  ReceiptText,
  Wallet,
  Users,
  Search,
  Pencil,
  Database,
} from "lucide-react";
import { useConcessionaires } from "@/lib/firebase/useConcessionaires";
import { addConcessionaire, updateConcessionaireDetails } from "@/lib/firebase/concessionaires";
import { useAuth } from "@/lib/auth/AuthContext";
import {
  BARANGAYS,
  CONCESSIONAIRE_CLASSIFICATIONS,
  CONCESSIONAIRE_STATUSES,
  DISCONNECTED_REASONS,
  getCubicUsed,
  type Concessionaire,
  type NewConcessionaireInput,
} from "@/lib/firebase/types";
import { formatPeso, getFullName } from "@/lib/utils";

// ── Skeleton rows ──────────────────────────────────────────────────────────

function SkeletonRow() {
  return (
    <TableRow className="animate-pulse">
      {[1, 2, 3, 4].map((i) => (
        <TableCell key={i}>
          <div className="h-4 rounded bg-slate-200" style={{ width: `${55 + i * 7}%` }} />
        </TableCell>
      ))}
    </TableRow>
  );
}

// ── Concessionaire Row ─────────────────────────────────────────

function ConcessionaireRow({
  concessionaire,
}: {
  concessionaire: Concessionaire;
}) {
  const router = useRouter();

  return (
    <TableRow
      className="group transition-colors hover:bg-sky-50/60 cursor-pointer"
      onClick={() => router.push(`/concessionaires/${concessionaire.id}`)}
    >
      <TableCell>
        <div className="flex items-center gap-2">
          <div>
            <p className="text-[13px] font-semibold text-slate-900">
              {getFullName(concessionaire)}
            </p>
            <p className="text-[11px] text-slate-400 font-medium">
              Purok {concessionaire.purok}
            </p>
          </div>
        </div>
      </TableCell>
      <TableCell>
        <code className="rounded bg-slate-100 px-1.5 py-0.5 text-[11px] font-mono text-slate-600">
          {concessionaire.meterNumber}
        </code>
      </TableCell>
      <TableCell>
        <span className="text-[12px] font-medium text-slate-700 bg-slate-100/80 px-2 py-0.5 rounded-md">
          {concessionaire.classification || "—"}
        </span>
      </TableCell>
      <TableCell>
        <Badge
          variant={concessionaire.status === "CONNECTED" ? "default" : "destructive"}
          className={concessionaire.status === "CONNECTED" ? "bg-emerald-500 hover:bg-emerald-600" : ""}
        >
          {concessionaire.status || "CONNECTED"}
        </Badge>
      </TableCell>
    </TableRow>
  );
}

// ── Main Page ──────────────────────────────────────────────────────────────
import React from "react";

export default function ConcessionairesPage() {
  const { role } = useAuth();
  const canEdit = role === "admin";
  const [selectedBarangay, setSelectedBarangay] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [sheetOpen, setSheetOpen] = useState(false);
  const [editData, setEditData] = useState<Concessionaire | null>(null);

  const { concessionaires, loading, error, refresh } = useConcessionaires(selectedBarangay);

  const filteredConcessionaires = concessionaires.filter((c) => {
    if (!search) return true;
    const q = search.toLowerCase();
    const fullName = getFullName(c).toLowerCase();
    return (
      fullName.includes(q) ||
      c.meterNumber.toLowerCase().includes(q) ||
      c.purok.toLowerCase().includes(q)
    );
  });

  // KPI aggregates (removed)

  return (
    <div className="space-y-6 max-w-[1400px] mx-auto">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 animate-in fade-in slide-in-from-top-4 duration-500 ease-snappy">
        <div>
          <h2 className="text-2xl md:text-3xl font-bold tracking-tight text-slate-900">
            Concessionaires
          </h2>
          <p className="text-sm font-medium text-slate-500 mt-0.5">
            Firestore-backed concessionaire records, organized by barangay.
          </p>
        </div>
        {canEdit && (
          <Button
            onClick={() => {
              setEditData(null);
              setSheetOpen(true);
            }}
            disabled={!selectedBarangay}
            className="bg-sky-600 hover:bg-sky-700 text-white font-semibold gap-2 shadow-sm"
          >
            <Plus className="h-4 w-4" />
            Add Concessionaire
          </Button>
        )}
      </div>

      {/* Barangay Selector */}
      <Card className="bg-white/80 backdrop-blur-md border-slate-200/60 shadow-sm animate-in fade-in slide-in-from-bottom-4 duration-500 ease-snappy delay-100 fill-mode-backwards">
        <CardHeader>
          <div className="flex items-center gap-2">
            <MapPin className="h-4 w-4 text-sky-500" />
            <CardTitle className="text-sm font-semibold text-slate-800">
              Select Barangay
            </CardTitle>
          </div>
          <CardDescription className="text-xs text-slate-500">
            Choose a barangay to load its concessionaire records from Firestore.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex flex-col sm:flex-row gap-3">
            <Select
              value={selectedBarangay ?? ""}
              onValueChange={(v) => {
                setSearch("");
                setSelectedBarangay(v || null);
              }}
            >
              <SelectTrigger
                id="barangay-selector"
                className="w-full sm:w-[280px] bg-white border-slate-200 text-sm font-medium"
              >
                <SelectValue placeholder="— Choose a Barangay —" />
              </SelectTrigger>
              <SelectContent>
                {BARANGAYS.map((b) => (
                  <SelectItem key={b} value={b} className="text-sm font-medium">
                    {b === "CG" ? "Cebuano Group" : b}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            {selectedBarangay && (
              <Button
                variant="outline"
                size="sm"
                onClick={refresh}
                disabled={loading}
                className="gap-2 text-xs font-semibold text-slate-600 border-slate-200 hover:bg-slate-50"
              >
                <RefreshCw
                  className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`}
                />
                Refresh
              </Button>
            )}
          </div>
        </CardContent>
      </Card>

      {/* KPI summary — only when a barangay is loaded */}

      {/* Error Banner */}
      {error && (
        <div className="flex items-start gap-3 rounded-xl border border-red-200 bg-red-50 px-5 py-4 animate-in fade-in duration-300">
          <AlertCircle className="h-5 w-5 text-red-500 mt-0.5 shrink-0" />
          <div>
            <p className="text-sm font-semibold text-red-800">
              Failed to load concessionaires
            </p>
            <p className="text-xs text-red-600 mt-0.5">
              {error.message}. Check your Firebase config in{" "}
              <code className="font-mono bg-red-100 px-1 py-0.5 rounded">
                .env.local
              </code>{" "}
              and your Firestore security rules.
            </p>
          </div>
        </div>
      )}

      {/* Empty / no selection state */}
      {!selectedBarangay && (
        <div className="flex flex-col items-center justify-center py-24 text-center animate-in fade-in duration-500">
          <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-sky-100 border border-sky-200 mb-4">
            <Database className="h-7 w-7 text-sky-400" />
          </div>
          <h3 className="text-base font-semibold text-slate-700">
            No barangay selected
          </h3>
          <p className="text-sm text-slate-400 mt-1 max-w-xs">
            Select a barangay from the dropdown above to load its concessionaire
            records from Firestore.
          </p>
        </div>
      )}

      {/* Concessionaire Table */}
      {selectedBarangay && (
        <Card className="bg-white/80 backdrop-blur-md border-slate-200/60 shadow-sm animate-in fade-in slide-in-from-bottom-4 duration-500 ease-snappy delay-200 fill-mode-backwards overflow-hidden">
          <CardHeader>
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div>
                <div className="flex items-center gap-2">
                  <CardTitle className="text-base font-semibold text-slate-900">
                    {selectedBarangay}
                  </CardTitle>
                  <Badge
                    variant="secondary"
                    className="bg-sky-100 text-sky-700 border-sky-200 text-[10px] font-semibold"
                  >
                    {loading ? "Loading…" : `${filteredConcessionaires.length} records`}
                  </Badge>
                </div>
                <CardDescription className="text-xs text-slate-500 mt-0.5">
                  Click a row to expand monthly billing history.
                </CardDescription>
              </div>

              {/* Search */}
              {!loading && concessionaires.length > 0 && (
                <div className="relative w-full sm:w-64">
                  <Search className="absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
                  <Input
                    placeholder="Search name, meter, purok…"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    className="pl-9 text-xs h-8 bg-white border-slate-200"
                  />
                </div>
              )}
            </div>
          </CardHeader>

          <div className="px-6 pb-6">
            <div className="rounded-lg border border-slate-200/60 overflow-hidden bg-white/60">
              <Table>
                <TableHeader className="bg-slate-50/80">
                  <TableRow className="hover:bg-transparent border-slate-200/60">
                    {[
                      "Concessionaire",
                      "Meter #",
                      "Class",
                      "Status",
                    ].map((h, i) => (
                      <TableHead
                        key={i}
                        className="text-[10px] font-bold uppercase tracking-wider text-slate-500"
                      >
                        {h}
                      </TableHead>
                    ))}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {loading ? (
                    Array.from({ length: 6 }).map((_, i) => (
                      <SkeletonRow key={i} />
                    ))
                  ) : filteredConcessionaires.length === 0 ? (
                    <TableRow>
                      <TableCell
                        colSpan={4}
                        className="py-16 text-center text-sm text-slate-400"
                      >
                        {search
                          ? `No concessionaires match "${search}"`
                          : `No concessionaires found in ${selectedBarangay}.`}
                      </TableCell>
                    </TableRow>
                  ) : (
                    filteredConcessionaires.map((c) => (
                      <ConcessionaireRow 
                        key={c.id} 
                        concessionaire={c}
                      />
                    ))
                  )}
                </TableBody>
              </Table>
            </div>
          </div>
        </Card>
      )}

      {/* Add/Edit Concessionaire Dialog */}
      <ConcessionaireDialog
        open={sheetOpen}
        onClose={() => {
          setSheetOpen(false);
          setEditData(null);
        }}
        selectedBarangay={selectedBarangay}
        onSuccess={refresh}
        editData={editData}
      />
    </div>
  );
}
