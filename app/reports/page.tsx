"use client";

import { useEffect, useMemo, useState } from "react";
import { useConcessionaires } from "@/lib/firebase/useConcessionaires";
import { fetchRecentBills } from "@/lib/firebase/bills";
import type { BillDocument } from "@/lib/firebase/types";
import { getCubicUsed, type ConcessionaireClassification } from "@/lib/firebase/types";
import {
  monthSortKey,
  sortHistoryDesc,
  waterChargeOf,
  concessionaireDaysOverdue,
  isAccountApproved,
  isDisconnectionEligible,
} from "@/lib/billing";
import { formatCompactPeso, getFullName, formatPeso } from "@/lib/utils";
import { isoWithinRange, monthWithinRange } from "@/lib/dateRange";
import { useDateRange } from "@/lib/useDateRange";
import { DateRangeFilter } from "@/components/DateRangeFilter";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Pagination, usePagination } from "@/components/ui/pagination";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  BarChart,
  Bar,
  PieChart,
  Pie,
  Cell,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
  AreaChart,
  Area,
} from "recharts";
import {
  TrendingUp,
  FileText,
  Droplets,
  AlertTriangle,
  RefreshCw,
  ChevronDown,
  Download,
  Layers,
  Loader2,
  type LucideIcon,
} from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useAuth } from "@/lib/auth/AuthContext";
import { displayNameFor } from "@/lib/firebase/auth";
import { userMessage } from "@/lib/userMessage";
import {
  ALL_REPORT_SECTIONS,
  createReportsPdf,
  loadPdfImage,
  reportsPdfFileName,
  type ReportSection,
} from "@/lib/reports/reportsPdf";

const TIER_LABELS: Record<ConcessionaireClassification, string> = {
  RESIDENTIAL: "Residential / Gov't",
  GOVERNMENT: "Residential / Gov't",
  "COMMERCIAL A": "Commercial A",
  "COMMERCIAL B": "Commercial B",
};

const TIER_COLORS: Record<string, string> = {
  "Residential / Gov't": "#3b82f6",
  "Commercial A": "#10b981",
  "Commercial B": "#8b5cf6",
};

// Half-open ranges: [min, max). Readings are stored as decimals, so the old
// closed ranges (0–10 then 11–20) dropped anything between them — a 10.5 m³
// consumption matched no bracket and vanished from the count and from the
// percentage denominator, quietly under-reporting the chart.
const CONSUMPTION_BRACKETS = [
  { label: "0-10 m³", min: 0, max: 10 },
  { label: "11-20 m³", min: 10, max: 20 },
  { label: "21-30 m³", min: 20, max: 30 },
  { label: "31-50 m³", min: 30, max: 50 },
  { label: "50+ m³", min: 50, max: Infinity },
];

const REPORT_TABS = ["collections", "consumption", "delinquency"];

const PDF_OPTIONS: {
  label: string;
  hint: string;
  sections: ReportSection[];
  icon: LucideIcon;
  /** Needs the monthly bills, which load separately from the accounts. */
  needsBills: boolean;
}[] = [
  { label: "All reports", hint: "Collections, consumption and delinquency", sections: ALL_REPORT_SECTIONS, icon: Layers, needsBills: true },
  { label: "Collection Summary", hint: "Billed and collected, by tier and month", sections: ["collections"], icon: FileText, needsBills: true },
  { label: "Consumption Analysis", hint: "Accounts by monthly consumption", sections: ["consumption"], icon: Droplets, needsBills: false },
  { label: "Delinquency Report", hint: "Unpaid balances and who can be disconnected", sections: ["delinquency"], icon: AlertTriangle, needsBills: false },
];

export default function ReportsPage() {
  const { concessionaires: allConcessionaires, loading } = useConcessionaires("all");

  // The open tab is mirrored in the URL hash (/reports#delinquency), so a link
  // — the disconnection notice in the header — can land on the right one.
  const [tab, setTab] = useState("collections");

  // The stretch of time the figures cover — a preset, or two dates off a
  // calendar. Anything that happened on a date (a bill issued, money taken) is
  // counted only inside it. What an account owes right now is a standing
  // figure, and the delinquency tab says so.
  const periodState = useDateRange();
  const { range, wholeArchive } = periodState;
  useEffect(() => {
    const applyHash = () => {
      const fromHash = window.location.hash.slice(1);
      if (REPORT_TABS.includes(fromHash)) setTab(fromHash);
    };
    applyHash();
    window.addEventListener("hashchange", applyHash);
    return () => window.removeEventListener("hashchange", applyHash);
  }, []);

  function changeTab(value: string) {
    setTab(value);
    // Kept in step so following the same link again still switches back.
    window.history.replaceState(window.history.state, "", `#${value}`);
  }

  // Accounts awaiting (or refused) admin approval aren't customers yet, so they
  // count toward nothing here.
  const concessionaires = useMemo(
    () => allConcessionaires.filter(isAccountApproved),
    [allConcessionaires]
  );

  // ── Monthly collections, stacked by tier ─────────────────────────────────
  //
  // The only figure here that genuinely needs per-month rows, so it is the one
  // place that reads bills across accounts. Bounded: the chart shows recent
  // months, not the whole archive.
  const [bills, setBills] = useState<BillDocument[] | null>(null);
  // Settled either way, so a failed read doesn't hold the PDF back forever —
  // the monthly figures then fall back to what the accounts carry inline.
  const [billsSettled, setBillsSettled] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetchRecentBills(1000)
      .then((rows) => !cancelled && setBills(rows))
      .catch((e) => !cancelled && console.error("Failed to read bills", e))
      .finally(() => !cancelled && setBillsSettled(true));
    return () => {
      cancelled = true;
    };
  }, []);


  // ── Collection summary, by tier ──────────────────────────────────────────
  //
  // "Billed" is the water actually sold — `waterChargeOf`, not `pesoAmount`.
  // Every bill's total folds in the prior unpaid balance plus surcharge and
  // extension fee, so summing `pesoAmount` counts the same debt once per month
  // it went unpaid: ₱100 unpaid in June shows up again inside July's ₱213 and
  // again inside August's ₱330, for ₱643 "billed" against ₱300 of water. The
  // inflation was worst in exactly the months collections were worst.
  // "Collected" has the mirror-image problem: once a rolled-forward bill is
  // settled, `amountPaid` is marked full on every earlier row too, so summing
  // it counts the same cash repeatedly.
  //
  // Both totals now come from `billingSummary` on the parent document, which
  // is maintained on every bill and payment write. That is the whole point of
  // keeping it: these figures no longer require reading a single bill, however
  // many years of history an account has. Accounts the storage migration
  // hasn't reached fall back to their inline arrays.
  //
  // Those lifetime totals are the wrong answer for a chosen period, so for one
  // the figures come from the bills issued inside it and the payments received
  // inside it — each counted once, on its own date.
  const collectionSummary = useMemo(() => {
    const byTier = new Map<string, { category: string; billed: number; collected: number; accounts: number }>();

    if (!wholeArchive) {
      const billedByAccount = new Map<string, number>();
      (bills ?? []).forEach((b) => {
        if (b.voided || !monthWithinRange(b.month, range)) return;
        billedByAccount.set(
          b.concessionaireId,
          (billedByAccount.get(b.concessionaireId) ?? 0) + waterChargeOf(b)
        );
      });

      concessionaires.forEach((c) => {
        const tier = TIER_LABELS[c.classification] ?? c.classification;
        const entry = byTier.get(tier) || { category: tier, billed: 0, collected: 0, accounts: 0 };
        entry.accounts += 1;

        // Accounts the storage migration hasn't reached keep bills inline.
        const inlineBilled = (c.billingHistory || [])
          .filter((h) => monthWithinRange(h.month, range))
          .reduce((sum, h) => sum + waterChargeOf(h), 0);
        entry.billed += billedByAccount.get(c.id) ?? inlineBilled;

        entry.collected += (c.payments || [])
          .filter((p) => !p.voided && isoWithinRange(p.date, range))
          .reduce((sum, p) => sum + p.amount, 0);

        byTier.set(tier, entry);
      });
      return Array.from(byTier.values());
    }

    concessionaires.forEach((c) => {
      const tier = TIER_LABELS[c.classification] ?? c.classification;
      const entry = byTier.get(tier) || { category: tier, billed: 0, collected: 0, accounts: 0 };
      entry.accounts += 1;

      if (c.billingSummary) {
        entry.billed += c.billingSummary.totalWaterCharged;
        entry.collected += c.billingSummary.totalCollected;
      } else {
        const history = c.billingHistory || [];
        const billed = history.reduce((sum, h) => sum + waterChargeOf(h), 0);
        const payments = c.payments || [];
        // "Collected" from the ledger double-counts once a rolled-forward bill
        // is settled, so it is capped at what was billed.
        const collected =
          payments.length > 0
            ? payments.reduce((sum, p) => (p.voided ? sum : sum + p.amount), 0)
            : Math.min(
                history.reduce((sum, h) => sum + h.amountPaid, 0),
                billed
              );
        entry.billed += billed;
        entry.collected += collected;
      }

      byTier.set(tier, entry);
    });
    return Array.from(byTier.values());
  }, [concessionaires, bills, range, wholeArchive]);

  const pieData = useMemo(
    () =>
      collectionSummary
        .filter((s) => s.billed > 0)
        .map((s) => ({ name: s.category, value: s.billed, color: TIER_COLORS[s.category] ?? "#94a3b8" })),
    [collectionSummary]
  );

  const monthlyCollections = useMemo(() => {
    const byMonth = new Map<string, Record<string, number | string>>();

    const add = (month: string, classification: string, charge: number) => {
      const tier = TIER_LABELS[classification as keyof typeof TIER_LABELS] ?? classification;
      const entry = byMonth.get(month) || { month };
      entry[tier] = ((entry[tier] as number) || 0) + charge;
      byMonth.set(month, entry);
    };

    if (bills && bills.length > 0) {
      bills.forEach((b) => {
        if (b.voided || !monthWithinRange(b.month, range)) return;
        add(b.month, b.classification, waterChargeOf(b));
      });
    }

    // Accounts not yet migrated still hold their history inline.
    const seen = new Set(
      (bills ?? []).map((b) => `${b.concessionaireId}|${b.month}`)
    );
    concessionaires.forEach((c) => {
      (c.billingHistory || []).forEach((h) => {
        if (seen.has(`${c.id}|${h.month}`) || !monthWithinRange(h.month, range)) return;
        add(h.month, c.classification, waterChargeOf(h));
      });
    });

    return Array.from(byMonth.values()).sort(
      (a, b) => monthSortKey(a.month as string) - monthSortKey(b.month as string)
    );
  }, [concessionaires, bills, range]);

  const tiers = useMemo(() => Array.from(new Set(collectionSummary.map((s) => s.category))), [collectionSummary]);

  // ── Consumption brackets, by latest reading per concessionaire ───────────
  const consumptionBrackets = useMemo(() => {
    const counts = CONSUMPTION_BRACKETS.map((b) => ({ ...b, count: 0 }));
    let totalWithReadings = 0;

    // For a chosen period, "latest" means the newest bill inside it — an
    // account's current reading says nothing about what it used last March.
    const latestInRange = new Map<string, BillDocument>();
    if (!wholeArchive) {
      (bills ?? []).forEach((b) => {
        if (b.voided || !monthWithinRange(b.month, range)) return;
        const held = latestInRange.get(b.concessionaireId);
        if (!held || monthSortKey(b.month) > monthSortKey(held.month)) latestInRange.set(b.concessionaireId, b);
      });
    }

    concessionaires.forEach((c) => {
      // billingSummary.latestBill is maintained on every write, so the whole
      // archive needs no read of the bills sub-collection.
      const latest = wholeArchive
        ? c.billingSummary?.latestBill ?? sortHistoryDesc(c.billingHistory || [])[0] ?? null
        : latestInRange.get(c.id) ??
          sortHistoryDesc((c.billingHistory || []).filter((h) => monthWithinRange(h.month, range)))[0] ??
          null;
      if (!latest) return;
      const consumption = getCubicUsed(latest);
      const bracket =
        counts.find((b) => consumption > b.min && consumption <= b.max) ?? counts[0];
      bracket.count += 1;
      totalWithReadings += 1;
    });

    return counts.map((b) => ({
      bracket: b.label,
      count: b.count,
      percentage: totalWithReadings > 0 ? Math.round((b.count / totalWithReadings) * 100) : 0,
    }));
  }, [concessionaires, bills, range, wholeArchive]);

  // ── Delinquency ───────────────────────────────────────────────────────────
  //
  // Aged from `delinquentSince` (via concessionaireDaysOverdue), not from the
  // newest bill's date. Ageing the newest bill reset the clock every billing
  // cycle, so an account unpaid since March 2025 read as "3 days overdue" the
  // moment September's bill landed — the one screen meant to surface chronic
  // delinquents was hiding exactly the worst ones.
  const delinquentAccounts = useMemo(() => {
    return concessionaires
      .filter((c) => c.totalBalance > 0)
      .map((c) => {
        const overdueDays = concessionaireDaysOverdue(c);
        return {
          id: c.id,
          name: getFullName(c),
          meterNumber: c.meterNumber ?? "",
          barangay: c.barangay ?? "",
          tier: TIER_LABELS[c.classification] ?? c.classification,
          balance: c.totalBalance,
          overdueDays,
          disconnectionEligible: isDisconnectionEligible(overdueDays),
        };
      })
      .sort((a, b) => b.balance - a.balance);
  }, [concessionaires]);

  const pagedDelinquents = usePagination(delinquentAccounts);

  const delinquencySummary = useMemo(
    () => ({
      count: delinquentAccounts.length,
      rate: concessionaires.length > 0 ? (delinquentAccounts.length / concessionaires.length) * 100 : 0,
      outstanding: delinquentAccounts.reduce((sum, a) => sum + a.balance, 0),
      disconnectionEligible: delinquentAccounts.filter((a) => a.disconnectionEligible).length,
    }),
    [delinquentAccounts, concessionaires]
  );

  // ── PDF download ─────────────────────────────────────────────────────────
  const { user } = useAuth();
  const [downloading, setDownloading] = useState(false);
  const [downloadError, setDownloadError] = useState<string | null>(null);

  async function downloadPdf(sections: ReportSection[]) {
    setDownloading(true);
    setDownloadError(null);
    try {
      const generatedAt = new Date();
      const doc = await createReportsPdf(
        sections,
        {
          collectionSummary,
          monthlyCollections,
          tiers,
          tierColors: TIER_COLORS,
          consumptionBrackets,
          totalAccounts: concessionaires.length,
          delinquentAccounts,
          delinquencySummary,
        },
        {
          generatedAt,
          generatedBy: user ? displayNameFor(user) : "",
          logo: await loadPdfImage("/logo.png"),
        }
      );
      doc.save(reportsPdfFileName(sections, generatedAt));
    } catch (e) {
      console.error("Couldn't create the report PDF", e);
      setDownloadError(userMessage(e, "Couldn't create the PDF. Please try again."));
    } finally {
      setDownloading(false);
    }
  }

  if (loading) {
    return (
      <div className="flex justify-center items-center h-64">
        <RefreshCw className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h2 className="text-2xl font-bold tracking-tight text-slate-900">
            Reports & Analytics
          </h2>
          <p className="text-sm text-slate-500">
            Real collections, consumption, and delinquency data drawn from every concessionaire&apos;s billing history.
          </p>
        </div>

        <div className="flex items-end gap-3">
          <DateRangeFilter state={periodState} />

        <DropdownMenu>
          <DropdownMenuTrigger
            disabled={downloading}
            className="inline-flex h-9 shrink-0 items-center gap-2 self-start rounded-md bg-sky-600 px-3.5 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-sky-700 outline-none focus-visible:ring-2 focus-visible:ring-sky-500 focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-70"
          >
            {downloading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
            {downloading ? "Preparing PDF…" : "Download PDF"}
            {!downloading && <ChevronDown className="h-3.5 w-3.5 opacity-80" />}
          </DropdownMenuTrigger>
          <DropdownMenuContent
            align="end"
            sideOffset={6}
            className="w-72 rounded-xl border border-slate-200 bg-white p-1.5 shadow-lg"
          >
            {/* Base UI requires a label to sit inside the group it names. */}
            <DropdownMenuGroup>
              <DropdownMenuLabel className="px-2 py-1.5 text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                Choose what to include
              </DropdownMenuLabel>
              {PDF_OPTIONS.map((option) => {
                const waiting = option.needsBills && !billsSettled;
                return (
                  <DropdownMenuItem
                    key={option.label}
                    disabled={waiting}
                    onClick={() => downloadPdf(option.sections)}
                    className="cursor-pointer items-start gap-2.5 rounded-lg px-2 py-2 focus:bg-slate-50"
                  >
                    <option.icon className="mt-0.5 size-4 text-slate-500" />
                    <span className="min-w-0 flex-1">
                      <span className="block text-sm font-medium text-slate-900">{option.label}</span>
                      <span className="block text-xs text-slate-500">
                        {waiting ? "Loading monthly figures…" : option.hint}
                      </span>
                    </span>
                  </DropdownMenuItem>
                );
              })}
            </DropdownMenuGroup>
          </DropdownMenuContent>
        </DropdownMenu>
        </div>
      </div>

      {downloadError && (
        <div className="flex items-start gap-3 rounded-xl border border-red-200 bg-red-50 px-4 py-3">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-red-500" />
          <p className="text-sm text-red-700">{downloadError}</p>
        </div>
      )}

      <Tabs value={tab} onValueChange={(value) => changeTab(String(value))} className="space-y-6">
        <TabsList className="bg-slate-100">
          <TabsTrigger value="collections" className="text-xs">
            <FileText className="mr-1.5 h-3.5 w-3.5" />
            Collection Summary
          </TabsTrigger>
          <TabsTrigger value="consumption" className="text-xs">
            <Droplets className="mr-1.5 h-3.5 w-3.5" />
            Consumption Analysis
          </TabsTrigger>
          <TabsTrigger value="delinquency" className="text-xs">
            <AlertTriangle className="mr-1.5 h-3.5 w-3.5" />
            Delinquency Report
          </TabsTrigger>
        </TabsList>

        {/* Collections Tab */}
        <TabsContent value="collections" className="space-y-6">
          <div className="grid gap-6 lg:grid-cols-5">
            <Card className="lg:col-span-3">
              <CardHeader>
                <CardTitle className="text-base font-semibold text-slate-800">
                  Monthly Water Sales by Tier
                </CardTitle>
                <CardDescription className="text-xs text-slate-500">
                  Water charged each month, split by classification. Excludes balances rolled forward from earlier months, which would otherwise be counted again every month they stay unpaid.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="h-[300px]">
                  {monthlyCollections.length === 0 ? (
                    <div className="flex h-full items-center justify-center text-sm text-slate-400">
                      No billing history yet.
                    </div>
                  ) : (
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={monthlyCollections}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" vertical={false} />
                        <XAxis dataKey="month" tick={{ fill: "#94a3b8", fontSize: 11 }} tickLine={false} axisLine={{ stroke: "#e2e8f0" }} />
                        <YAxis tick={{ fill: "#94a3b8", fontSize: 11 }} tickLine={false} axisLine={false} tickFormatter={(v) => formatCompactPeso(Number(v))} />
                        <Tooltip contentStyle={{ backgroundColor: "#fff", border: "1px solid #e2e8f0", borderRadius: "8px", fontSize: "12px" }} formatter={(v) => formatPeso(Number(v))} />
                        <Legend wrapperStyle={{ fontSize: "11px", paddingTop: "8px" }} />
                        {tiers.map((tier, i) => (
                          <Bar
                            key={tier}
                            dataKey={tier}
                            name={tier}
                            fill={TIER_COLORS[tier] ?? "#94a3b8"}
                            stackId="a"
                            radius={i === tiers.length - 1 ? [2, 2, 0, 0] : [0, 0, 0, 0]}
                          />
                        ))}
                      </BarChart>
                    </ResponsiveContainer>
                  )}
                </div>
              </CardContent>
            </Card>

            <Card className="lg:col-span-2">
              <CardHeader>
                <CardTitle className="text-base font-semibold text-slate-800">
                  Water Sales Distribution
                </CardTitle>
                <CardDescription className="text-xs text-slate-500">
                  All-time water charged, by tier
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="h-[220px]">
                  {pieData.length === 0 ? (
                    <div className="flex h-full items-center justify-center text-sm text-slate-400">
                      No data yet.
                    </div>
                  ) : (
                    <ResponsiveContainer width="100%" height="100%">
                      <PieChart>
                        <Pie data={pieData} cx="50%" cy="50%" innerRadius={55} outerRadius={85} paddingAngle={4} dataKey="value">
                          {pieData.map((entry) => (
                            <Cell key={entry.name} fill={entry.color} />
                          ))}
                        </Pie>
                        <Tooltip contentStyle={{ fontSize: "12px", borderRadius: "8px", border: "1px solid #e2e8f0" }} formatter={(v) => formatPeso(Number(v))} />
                      </PieChart>
                    </ResponsiveContainer>
                  )}
                </div>
                <div className="space-y-2 mt-2">
                  {pieData.map((item) => (
                    <div key={item.name} className="flex items-center justify-between text-xs">
                      <div className="flex items-center gap-2">
                        <div className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: item.color }} />
                        <span className="text-slate-600">{item.name}</span>
                      </div>
                      <span className="font-semibold text-slate-800">{formatPeso(item.value)}</span>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          </div>

          <Card>
            <CardHeader>
              <CardTitle className="text-base font-semibold text-slate-800">
                Collection Performance by Tier
              </CardTitle>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow className="hover:bg-transparent">
                    <TableHead className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">Category</TableHead>
                    <TableHead className="text-right text-[11px] font-semibold uppercase tracking-wider text-slate-500">Accounts</TableHead>
                    <TableHead className="text-right text-[11px] font-semibold uppercase tracking-wider text-slate-500">Billed</TableHead>
                    <TableHead className="text-right text-[11px] font-semibold uppercase tracking-wider text-slate-500">Collected</TableHead>
                    <TableHead className="text-right text-[11px] font-semibold uppercase tracking-wider text-slate-500">Collection Rate</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {collectionSummary.map((row) => {
                    const rate = row.billed > 0 ? (row.collected / row.billed) * 100 : 0;
                    return (
                      <TableRow key={row.category}>
                        <TableCell className="text-sm font-medium text-slate-800">{row.category}</TableCell>
                        <TableCell className="text-right text-sm text-slate-600">{row.accounts.toLocaleString()}</TableCell>
                        <TableCell className="text-right text-sm text-slate-500">{formatPeso(row.billed)}</TableCell>
                        <TableCell className="text-right text-sm font-semibold text-emerald-600">{formatPeso(row.collected)}</TableCell>
                        <TableCell className="text-right">
                          <Badge variant="secondary" className={rate >= 90 ? "bg-emerald-50 text-emerald-700 border-emerald-200" : "bg-amber-50 text-amber-700 border-amber-200"}>
                            {rate.toFixed(1)}%
                          </Badge>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Consumption Tab */}
        <TabsContent value="consumption" className="space-y-6">
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle className="text-base font-semibold text-slate-800">
                    Consumption Distribution
                  </CardTitle>
                  <CardDescription className="text-xs text-slate-500">
                    Concessionaires bucketed by their most recent month&apos;s consumption
                  </CardDescription>
                </div>
                <Badge variant="secondary" className="bg-blue-50 text-blue-700 border-blue-200 text-[10px]">
                  <TrendingUp className="mr-0.5 h-3 w-3" />
                  {concessionaires.length.toLocaleString()} Total Accounts
                </Badge>
              </div>
            </CardHeader>
            <CardContent>
              <div className="h-[300px]">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={consumptionBrackets}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" vertical={false} />
                    <XAxis dataKey="bracket" tick={{ fill: "#94a3b8", fontSize: 11 }} tickLine={false} axisLine={{ stroke: "#e2e8f0" }} />
                    <YAxis tick={{ fill: "#94a3b8", fontSize: 11 }} tickLine={false} axisLine={false} />
                    <Tooltip contentStyle={{ backgroundColor: "#fff", border: "1px solid #e2e8f0", borderRadius: "8px", fontSize: "12px" }} />
                    <Area type="monotone" dataKey="count" name="Accounts" stroke="#3b82f6" fill="#3b82f6" fillOpacity={0.15} strokeWidth={2} />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base font-semibold text-slate-800">
                Consumption Bracket Breakdown
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-3">
                {consumptionBrackets.map((bracket) => (
                  <div key={bracket.bracket} className="flex items-center gap-4">
                    <span className="w-20 text-xs font-medium text-slate-600">{bracket.bracket}</span>
                    <div className="flex-1 h-6 bg-slate-100 rounded-full overflow-hidden">
                      <div
                        className="h-full bg-blue-500 rounded-full transition-all duration-500"
                        style={{ width: `${bracket.percentage}%` }}
                      />
                    </div>
                    <span className="w-16 text-right text-xs font-semibold text-slate-700">{bracket.count.toLocaleString()}</span>
                    <span className="w-10 text-right text-xs text-slate-400">{bracket.percentage}%</span>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Delinquency Tab */}
        <TabsContent value="delinquency" className="space-y-6">
          {/* What is owed is owed today, whatever period the rest is showing. */}
          {!wholeArchive && (
            <p className="text-xs text-slate-500">
              Balances and overdue days are as they stand today — the {range.label.toLowerCase()}{" "}
              filter applies to collections and consumption, not to what an account owes now.
            </p>
          )}
          <div className="grid gap-4 sm:grid-cols-3">
            <Card className="border-amber-100">
              <CardContent className="pt-6">
                <p className="text-xs font-medium text-slate-500 uppercase tracking-wider">Total Delinquent</p>
                <p className="text-2xl font-bold text-amber-600">{delinquencySummary.count.toLocaleString()}</p>
                <p className="text-xs text-slate-400">{delinquencySummary.rate.toFixed(1)}% of all accounts</p>
              </CardContent>
            </Card>
            <Card className="border-red-100">
              <CardContent className="pt-6">
                <p className="text-xs font-medium text-slate-500 uppercase tracking-wider">Outstanding Balance</p>
                <p className="text-2xl font-bold text-red-600">{formatPeso(delinquencySummary.outstanding)}</p>
                <p className="text-xs text-slate-400">total unpaid amount</p>
              </CardContent>
            </Card>
            <Card className="border-slate-200">
              <CardContent className="pt-6">
                <p className="text-xs font-medium text-slate-500 uppercase tracking-wider">Disconnection Eligible</p>
                <p className="text-2xl font-bold text-slate-800">{delinquencySummary.disconnectionEligible.toLocaleString()}</p>
                <p className="text-xs text-slate-400">20+ days overdue</p>
              </CardContent>
            </Card>
          </div>

          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <CardTitle className="text-base font-semibold text-slate-800">
                  Delinquent Accounts
                </CardTitle>
                <Badge variant="secondary" className="bg-amber-50 text-amber-700 border-amber-200 text-[10px]">
                  Sorted by balance
                </Badge>
              </div>
            </CardHeader>
            <CardContent>
              {delinquentAccounts.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-16 text-center">
                  <AlertTriangle className="h-10 w-10 text-slate-300 mb-3" />
                  <p className="text-sm font-medium text-slate-500">No delinquent accounts</p>
                </div>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow className="hover:bg-transparent">
                      <TableHead className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">Concessionaire</TableHead>
                      <TableHead className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">Tier</TableHead>
                      <TableHead className="text-right text-[11px] font-semibold uppercase tracking-wider text-slate-500">Outstanding</TableHead>
                      <TableHead className="text-right text-[11px] font-semibold uppercase tracking-wider text-slate-500">Days Overdue</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {pagedDelinquents.rows.map((account) => (
                      <TableRow key={account.id}>
                        <TableCell className="text-sm font-medium text-slate-800">{account.name}</TableCell>
                        <TableCell>
                          <Badge variant="secondary" className="bg-slate-100 text-slate-600 border-slate-200 text-[10px]">
                            {account.tier}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-right text-sm font-bold text-red-600">
                          {formatPeso(account.balance)}
                        </TableCell>
                        <TableCell className="text-right">
                          {account.overdueDays === null ? (
                            <span className="text-xs text-slate-400">unknown</span>
                          ) : (
                            <Badge
                              variant="secondary"
                              className={
                                account.disconnectionEligible
                                  ? "bg-red-50 text-red-700 border-red-200"
                                  : "bg-amber-50 text-amber-700 border-amber-200"
                              }
                            >
                              {account.overdueDays}d{account.disconnectionEligible ? " • eligible" : ""}
                            </Badge>
                          )}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
              <Pagination paged={pagedDelinquents} noun="accounts" className="mt-3" />
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
