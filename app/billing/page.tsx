"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useConcessionaires } from "@/lib/firebase/useConcessionaires";
import { BARANGAYS, getCubicUsed } from "@/lib/firebase/types";
import { getFullName, formatPeso } from "@/lib/utils";
import {
  monthSortKey,
  paymentStatus,
  PAYMENT_STATUS_STYLES,
  waterChargeOf,
  concessionaireDaysOverdue,
  isDisconnectionEligible,
} from "@/lib/billing";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import {
  AlertCircle,
  AlertTriangle,
  CircleDollarSign,
  Droplets,
  Receipt,
  RefreshCw,
  Search,
  Wallet,
} from "lucide-react";

// ── Flattened row: one per billingHistory entry across all concessionaires ──

interface BillRow {
  concessionaireId: string;
  name: string;
  barangay: string;
  meterNumber: string;
  classification: string;
  month: string;
  reading: number;
  previousReading: number;
  consumption: number;
  pesoAmount: number;
  /** Water actually sold this cycle — pesoAmount minus anything rolled forward. */
  waterCharge: number;
  orNumber: string;
  amountPaid: number;
  billingDate?: string;
  /**
   * How long the ACCOUNT has been carrying a balance, not how old this
   * particular bill is. Ageing the individual bill resets every cycle, so a
   * long-standing debt never reached the 20-day disconnection threshold.
   */
  accountOverdueDays: number | null;
}

export default function BillingPage() {
  const router = useRouter();
  const { concessionaires, loading, error } = useConcessionaires("all", { realtime: true });
  const [search, setSearch] = useState("");
  const [barangayFilter, setBarangayFilter] = useState("all");
  const [monthFilter, setMonthFilter] = useState("all");

  const allBills = useMemo<BillRow[]>(() => {
    if (!concessionaires) return [];
    const rows: BillRow[] = [];
    concessionaires.forEach((c) => {
      const accountOverdueDays = concessionaireDaysOverdue(c);
      (c.billingHistory || []).forEach((h) => {
        rows.push({
          concessionaireId: c.id,
          name: getFullName(c),
          barangay: c.barangay,
          meterNumber: c.meterNumber,
          classification: c.classification,
          month: h.month,
          reading: h.reading,
          previousReading: h.previousReading,
          consumption: getCubicUsed(h),
          pesoAmount: h.pesoAmount,
          waterCharge: waterChargeOf(h),
          orNumber: h.orNumber,
          amountPaid: h.amountPaid,
          billingDate: h.billingDate,
          accountOverdueDays,
        });
      });
    });
    return rows.sort((a, b) => monthSortKey(b.month) - monthSortKey(a.month));
  }, [concessionaires]);

  const availableMonths = useMemo(() => {
    const set = new Set(allBills.map((b) => b.month));
    return Array.from(set).sort((a, b) => monthSortKey(b) - monthSortKey(a));
  }, [allBills]);

  const filteredBills = useMemo(() => {
    const q = search.trim().toLowerCase();
    return allBills.filter((b) => {
      if (barangayFilter !== "all" && b.barangay !== barangayFilter) return false;
      if (monthFilter !== "all" && b.month !== monthFilter) return false;
      if (
        q &&
        !b.name.toLowerCase().includes(q) &&
        !b.meterNumber.toLowerCase().includes(q)
      )
        return false;
      return true;
    });
  }, [allBills, barangayFilter, monthFilter, search]);

  // Water sold, not bill totals: each bill's `pesoAmount` already folds in the
  // prior unpaid balance, so summing it counts the same debt once per month it
  // stayed unpaid. Disconnection-eligible counts distinct ACCOUNTS — one
  // delinquent concessionaire with eight unpaid months is one account to
  // disconnect, not eight.
  const summary = useMemo(() => {
    const eligibleAccounts = new Set<string>();
    const accountsInView = new Set<string>();
    let totalWaterCharged = 0;

    filteredBills.forEach((b) => {
      totalWaterCharged += b.waterCharge;
      accountsInView.add(b.concessionaireId);
      if (b.amountPaid < b.pesoAmount && isDisconnectionEligible(b.accountOverdueDays)) {
        eligibleAccounts.add(b.concessionaireId);
      }
    });

    // Outstanding is the accounts' current running balances, not the sum of
    // per-bill shortfalls — those overlap, since each bill carries the last
    // one forward.
    const outstanding = concessionaires
      .filter((c) => accountsInView.has(c.id))
      .reduce((sum, c) => sum + (c.billingBalance ?? 0), 0);

    return {
      totalWaterCharged,
      outstanding,
      disconnectionEligible: eligibleAccounts.size,
    };
  }, [filteredBills, concessionaires]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-slate-900">Billing</h1>
        <p className="text-sm text-slate-500">
          Every meter read and bill captured by field readers via the mobile app.
        </p>
      </div>

      {error && (
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertTitle>Error</AlertTitle>
          <AlertDescription>{error.message}</AlertDescription>
        </Alert>
      )}

      {/* Summary */}
      <div className="grid gap-4 sm:grid-cols-4">
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-2 text-slate-400 mb-1">
              <Receipt className="h-3.5 w-3.5" />
              <span className="text-[10px] font-semibold uppercase tracking-wider">Bills</span>
            </div>
            <p className="text-2xl font-bold text-slate-900">{filteredBills.length}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-2 text-slate-400 mb-1">
              <CircleDollarSign className="h-3.5 w-3.5" />
              <span className="text-[10px] font-semibold uppercase tracking-wider">Water Charged</span>
            </div>
            <p className="text-2xl font-bold text-blue-600">{formatPeso(summary.totalWaterCharged)}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-2 text-slate-400 mb-1">
              <Wallet className="h-3.5 w-3.5" />
              <span className="text-[10px] font-semibold uppercase tracking-wider">Outstanding</span>
            </div>
            <p className="text-2xl font-bold text-amber-600">
              {formatPeso(summary.outstanding)}
            </p>
          </CardContent>
        </Card>
        <Card className={summary.disconnectionEligible > 0 ? "border-red-200" : undefined}>
          <CardContent className="pt-6">
            <div className="flex items-center gap-2 text-slate-400 mb-1">
              <AlertTriangle className="h-3.5 w-3.5" />
              <span className="text-[10px] font-semibold uppercase tracking-wider">Disconnection Eligible</span>
            </div>
            <p className="text-2xl font-bold text-red-600">{summary.disconnectionEligible}</p>
          </CardContent>
        </Card>
      </div>

      {/* Filters */}
      <Card>
        <CardContent className="pt-6">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <Input
                placeholder="Search by name or meter number..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-9 text-sm"
              />
            </div>
            <Select value={barangayFilter} onValueChange={(v) => v && setBarangayFilter(v)}>
              <SelectTrigger className="w-full sm:w-44 text-sm">
                <SelectValue placeholder="Barangay" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Barangays</SelectItem>
                {BARANGAYS.map((b) => (
                  <SelectItem key={b} value={b}>
                    {b}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={monthFilter} onValueChange={(v) => v && setMonthFilter(v)}>
              <SelectTrigger className="w-full sm:w-40 text-sm">
                <SelectValue placeholder="Month" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Months</SelectItem>
                {availableMonths.map((m) => (
                  <SelectItem key={m} value={m}>
                    {m}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      {/* Table */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base font-semibold text-slate-800">Reads &amp; Bills</CardTitle>
          <CardDescription className="text-xs text-slate-500">
            Newest first. Tap a name to see that concessionaire&rsquo;s full billing history.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="flex justify-center items-center h-32">
              <RefreshCw className="h-8 w-8 animate-spin text-muted-foreground" />
            </div>
          ) : filteredBills.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-center">
              <Droplets className="h-10 w-10 text-slate-300 mb-3" />
              <p className="text-sm font-medium text-slate-500">No bills found</p>
              <p className="text-xs text-slate-400 mt-1">
                Bills appear here once field readers submit readings from the mobile app.
              </p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow className="hover:bg-transparent">
                    <TableHead className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                      Concessionaire
                    </TableHead>
                    <TableHead className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                      Barangay
                    </TableHead>
                    <TableHead className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                      Month
                    </TableHead>
                    <TableHead className="text-right text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                      Reading
                    </TableHead>
                    <TableHead className="text-right text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                      Consumption
                    </TableHead>
                    <TableHead className="text-right text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                      Amount Due
                    </TableHead>
                    <TableHead className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                      Status
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredBills.map((b, i) => {
                    const status = paymentStatus(b.pesoAmount, b.amountPaid);
                    const overdueDays = status !== "PAID" ? b.accountOverdueDays : null;
                    const disconnectionEligible = isDisconnectionEligible(overdueDays);
                    return (
                      <TableRow
                        key={`${b.concessionaireId}-${b.month}-${i}`}
                        className="cursor-pointer"
                        onClick={() => router.push(`/billing/${b.concessionaireId}`)}
                      >
                        <TableCell>
                          <Link
                            href={`/billing/${b.concessionaireId}`}
                            onClick={(e) => e.stopPropagation()}
                            className="text-sm font-medium text-slate-800 hover:text-sky-600 hover:underline"
                          >
                            {b.name}
                          </Link>
                          <p className="text-xs text-slate-400">
                            {b.meterNumber} • {b.classification}
                          </p>
                        </TableCell>
                        <TableCell className="text-sm text-slate-600">{b.barangay}</TableCell>
                        <TableCell className="text-sm text-slate-600">{b.month}</TableCell>
                        <TableCell className="text-right text-sm text-slate-600">
                          {b.previousReading} → {b.reading} m³
                        </TableCell>
                        <TableCell className="text-right text-sm font-semibold text-blue-600">
                          {b.consumption} m³
                        </TableCell>
                        <TableCell className="text-right text-sm font-bold text-slate-800">
                          {formatPeso(b.pesoAmount)}
                        </TableCell>
                        <TableCell>
                          <div className="flex flex-col gap-1 items-start">
                            <Badge variant="secondary" className={PAYMENT_STATUS_STYLES[status]}>
                              {status}
                            </Badge>
                            {overdueDays !== null && overdueDays > 0 && (
                              <span
                                className={
                                  disconnectionEligible
                                    ? "text-[10px] font-semibold text-red-600 flex items-center gap-1"
                                    : "text-[10px] text-slate-400"
                                }
                              >
                                {disconnectionEligible && <AlertTriangle className="h-3 w-3" />}
                                {overdueDays}d overdue
                                {disconnectionEligible && " • disconnection eligible"}
                              </span>
                            )}
                          </div>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
