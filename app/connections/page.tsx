"use client";

import { userMessage } from "@/lib/userMessage";
import { useMemo, useState } from "react";
import {
  Card,
  CardContent,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
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
import { useRouter } from "next/navigation";
import {
  Search,
  AlertCircle,
  Plug,
  Plus,
} from "lucide-react";
import { useConcessionaires } from "@/lib/firebase/useConcessionaires";
import { isAccountApproved } from "@/lib/billing";
import {
  BARANGAYS,
  type Concessionaire,
} from "@/lib/firebase/types";
import { formatPeso, getFullName } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { NewConnectionDialog } from "@/components/NewConnectionDialog";
import { Pagination, usePagination } from "@/components/ui/pagination";
import { SortSelect } from "@/components/SortSelect";
import { accountSorts, byText, sortRows, thenBy, type SortOption } from "@/lib/sorting";
import { useSortChoice } from "@/lib/useSortChoice";

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

/**
 * Where an account's connection stands, as a sortable key: not yet approved,
 * not set up, owing, part paid, fully paid — the order work gets done in.
 */
function connectionStage(c: Concessionaire): string {
  if (!isAccountApproved(c)) return "0";
  if (!c.connectionFeeDetails) return "1";
  const paid = (c.meterPayments || []).reduce((sum, p) => (p.voided ? sum : sum + p.amount), 0);
  if (paid >= c.connectionFeeDetails.total && c.connectionFeeDetails.total > 0) return "4";
  return paid > 0 ? "3" : "2";
}

function ConnectionStatusBadge({ concessionaire }: { concessionaire: Concessionaire }) {
  // An unapproved account has nothing to show here — say so instead of
  // "Not Applied", which reads as something staff still need to do.
  if (!isAccountApproved(concessionaire)) {
    return concessionaire.approvalStatus === "REJECTED" ? (
      <Badge variant="outline" className="text-red-600 border-red-200 bg-red-50">Rejected</Badge>
    ) : (
      <Badge variant="outline" className="text-amber-600 border-amber-200 bg-amber-50">Awaiting Approval</Badge>
    );
  }

  if (!concessionaire.connectionFeeDetails) {
    return <Badge variant="secondary" className="bg-slate-100 text-slate-500 hover:bg-slate-200">Not Applied</Badge>;
  }

  const totalPaid = (concessionaire.meterPayments || []).reduce((sum, p) => sum + p.amount, 0);
  const total = concessionaire.connectionFeeDetails.total;

  if (totalPaid >= total && total > 0) {
    return <Badge className="bg-emerald-500 hover:bg-emerald-600">Fully Paid</Badge>;
  }
  
  if (totalPaid > 0) {
    return <Badge className="bg-sky-500 hover:bg-sky-600">Installment ({formatPeso(totalPaid)} paid)</Badge>;
  }

  return <Badge variant="outline" className="text-amber-600 border-amber-200 bg-amber-50">Pending Payment</Badge>;
}

function ConcessionaireRow({ concessionaire }: { concessionaire: Concessionaire }) {
  const router = useRouter();
  // Still clickable — it lands on a page that explains why nothing can be
  // done there rather than a dead end — but dimmed so staff aren't drawn to
  // rows that can't go anywhere yet.
  const awaitingDecision = !isAccountApproved(concessionaire);

  return (
    <TableRow
      className={`group transition-colors hover:bg-sky-50/60 cursor-pointer ${awaitingDecision ? "opacity-60" : ""}`}
      onClick={() => router.push(`/connections/${concessionaire.id}`)}
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
          {concessionaire.meterNumber || "—"}
        </code>
      </TableCell>
      <TableCell>
        <span className="text-[12px] font-medium text-slate-700 bg-slate-100/80 px-2 py-0.5 rounded-md">
          {concessionaire.classification || "—"}
        </span>
      </TableCell>
      <TableCell>
        <ConnectionStatusBadge concessionaire={concessionaire} />
      </TableCell>
    </TableRow>
  );
}

export default function ConnectionsPage() {
  const [selectedBarangay, setSelectedBarangay] = useState<string | null>("all");
  const [search, setSearch] = useState("");
  const [newDialogOpen, setNewDialogOpen] = useState(false);

  const { concessionaires, loading, error } = useConcessionaires(selectedBarangay);

  const filteredConcessionaires = useMemo(
    () =>
      concessionaires.filter((c) => {
        if (!search) return true;
        const q = search.toLowerCase();
        const fullName = getFullName(c).toLowerCase();
        return (
          fullName.includes(q) ||
          (c.meterNumber || "").toLowerCase().includes(q) ||
          (c.purok || "").toLowerCase().includes(q)
        );
      }),
    [concessionaires, search]
  );

  // Alphabetical by default. The extra order here groups accounts by where
  // their connection stands, so the ones still to set up come first.
  const sortOptions = useMemo<SortOption<Concessionaire>[]>(
    () => [
      ...accountSorts<Concessionaire>(),
      {
        id: "connection",
        label: "Connection status",
        compare: thenBy(byText((c) => connectionStage(c)), byText((c) => getFullName(c))),
      },
    ],
    []
  );
  const { option: sort, setSort } = useSortChoice("connections", sortOptions);
  const sortedConcessionaires = useMemo(
    () => sortRows(filteredConcessionaires, sort.compare),
    [filteredConcessionaires, sort]
  );

  const pagedConcessionaires = usePagination(sortedConcessionaires);

  return (
    <div className="space-y-6 max-w-[1400px] mx-auto p-4 md:p-8">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 animate-in fade-in slide-in-from-top-4 duration-500 ease-snappy">
        <div>
          <h2 className="text-2xl md:text-3xl font-bold tracking-tight text-slate-900">
            Connections
          </h2>
          <p className="text-sm text-slate-500 mt-1 flex items-center gap-2">
            <Plug className="h-4 w-4 text-sky-500" />
            Manage connection applications, meter fees, and installments
          </p>
        </div>
        <Button 
          className="bg-sky-600 hover:bg-sky-700 text-white font-semibold shadow-sm"
          onClick={() => setNewDialogOpen(true)}
        >
          <Plus className="h-4 w-4 mr-2" />
          New Connection
        </Button>
      </div>

      <Card className="border-slate-200/60 shadow-sm bg-white/50 backdrop-blur-xl animate-in fade-in slide-in-from-bottom-4 duration-500 delay-100">
        <CardContent className="p-0">
          {/* Toolbar */}
          <div className="flex flex-col sm:flex-row sm:items-center gap-4 p-4 border-b border-slate-100 bg-white rounded-t-xl">
            <div className="flex items-end gap-3 flex-1">
              <div className="relative flex-1 max-w-sm space-y-1.5">
                <Label htmlFor="connections-search" className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                  Search
                </Label>
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
                  <Input
                    id="connections-search"
                    placeholder="Search by name, meter, or purok..."
                    className="pl-9 bg-slate-50/50 border-slate-200 focus-visible:ring-sky-500 transition-shadow h-9 text-sm"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                  />
                </div>
              </div>
              <div className="max-w-[200px] w-full space-y-1.5">
                <Label htmlFor="connections-barangay" className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                  Barangay
                </Label>
                <Select
                  value={selectedBarangay || "all"}
                  onValueChange={setSelectedBarangay}
                >
                  <SelectTrigger id="connections-barangay" className="h-9 w-full text-sm bg-white border-slate-200">
                    <SelectValue>
                      {(value) =>
                        !value || value === "all"
                          ? "All barangays"
                          : value === "CG"
                            ? "Cebuano Group"
                            : String(value)
                      }
                    </SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all" className="text-sm font-medium">All Barangays</SelectItem>
                    {BARANGAYS.map((b) => (
                      <SelectItem key={b} value={b} className="text-sm font-medium">
                        {b === "CG" ? "Cebuano Group" : b}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <SortSelect
                options={sortOptions}
                value={sort}
                onChange={(id) => {
                  setSort(id);
                  pagedConcessionaires.setPage(1);
                }}
                className="w-full max-w-[220px]"
              />
            </div>
          </div>

          {/* Table */}
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow className="bg-slate-50/50 hover:bg-slate-50/50">
                  <TableHead className="text-xs font-semibold text-slate-500 uppercase tracking-wider h-10 w-[300px]">Concessionaire</TableHead>
                  <TableHead className="text-xs font-semibold text-slate-500 uppercase tracking-wider h-10">Meter #</TableHead>
                  <TableHead className="text-xs font-semibold text-slate-500 uppercase tracking-wider h-10">Class</TableHead>
                  <TableHead className="text-xs font-semibold text-slate-500 uppercase tracking-wider h-10">Connection Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {loading ? (
                  <>
                    <SkeletonRow />
                    <SkeletonRow />
                    <SkeletonRow />
                    <SkeletonRow />
                    <SkeletonRow />
                  </>
                ) : error ? (
                  <TableRow>
                    <TableCell colSpan={4} className="h-32 text-center">
                      <div className="flex flex-col items-center justify-center text-red-500">
                        <AlertCircle className="h-8 w-8 mb-2" />
                        <p className="text-sm font-medium">{userMessage(error)}</p>
                      </div>
                    </TableCell>
                  </TableRow>
                ) : filteredConcessionaires.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={4} className="h-32 text-center text-slate-500">
                      <p className="text-sm">No concessionaires found.</p>
                    </TableCell>
                  </TableRow>
                ) : (
                  pagedConcessionaires.rows.map((c) => (
                    <ConcessionaireRow key={c.id} concessionaire={c} />
                  ))
                )}
              </TableBody>
            </Table>
          </div>
          <Pagination paged={pagedConcessionaires} noun="connections" className="mt-3" />
        </CardContent>
      </Card>

      <NewConnectionDialog 
        open={newDialogOpen} 
        onOpenChange={setNewDialogOpen} 
        allConcessionaires={concessionaires} 
      />
    </div>
  );
}
