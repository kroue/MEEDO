"use client";

import { useEffect, useMemo, useState } from "react";
import { useConcessionaires } from "@/lib/firebase/useConcessionaires";
import { fetchRecentBills, fetchRecentPayments } from "@/lib/firebase/bills";
import type { BillDocument, PaymentDocument } from "@/lib/firebase/types";
import { getCubicUsed } from "@/lib/firebase/types";
import { isAccountApproved, monthSortKey, waterChargeOf } from "@/lib/billing";
import { isoWithinRange, monthWithinRange } from "@/lib/dateRange";
import { useDateRange } from "@/lib/useDateRange";
import { DateRangeFilter } from "@/components/DateRangeFilter";
import { formatCompact, formatCompactPeso, getFullName, formatPeso } from "@/lib/utils";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  DollarSign,
  Users,
  AlertTriangle,
  Droplets,
  ArrowUpRight,
  RefreshCw,
} from "lucide-react";
import {
  ComposedChart,
  Bar,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from "recharts";

const accentStyles = {
  emerald: {
    icon: "bg-emerald-100 text-emerald-600 border border-emerald-200/50",
    bg: "bg-gradient-to-br from-emerald-50/80 to-white/90 border border-emerald-100/60 shadow-sm backdrop-blur-md",
  },
  sky: {
    icon: "bg-sky-100 text-sky-600 border border-sky-200/50",
    bg: "bg-gradient-to-br from-sky-50/80 to-white/90 border border-sky-100/60 shadow-sm backdrop-blur-md",
  },
  red: {
    icon: "bg-red-100 text-red-600 border border-red-200/50",
    bg: "bg-gradient-to-br from-red-50/80 to-white/90 border border-red-100/60 shadow-sm backdrop-blur-md",
  },
  amber: {
    icon: "bg-amber-100 text-amber-600 border border-amber-200/50",
    bg: "bg-gradient-to-br from-amber-50/80 to-white/90 border border-amber-100/60 shadow-sm backdrop-blur-md",
  },
} as const;

export default function DashboardPage() {
  const { concessionaires: allConcessionaires, loading } = useConcessionaires("all");

  // Accounts awaiting (or refused) admin approval aren't customers yet.
  const concessionaires = useMemo(
    () => allConcessionaires.filter(isAccountApproved),
    [allConcessionaires]
  );

  // The stretch of time the figures cover — a preset, or two dates off a
  // calendar. What happened on a date (money taken, water billed) is counted
  // only inside it; how many accounts exist and what they owe are standing
  // figures either way.
  const periodState = useDateRange();
  const { range, wholeArchive } = periodState;

  // Bills and payments live in sub-collections now, so the chart and the feed
  // read them directly instead of from arrays that new accounts no longer have.
  const [recentBills, setRecentBills] = useState<BillDocument[]>([]);
  const [recentPaymentDocs, setRecentPaymentDocs] = useState<PaymentDocument[]>([]);

  useEffect(() => {
    let cancelled = false;
    fetchRecentBills(1000)
      .then((rows) => !cancelled && setRecentBills(rows))
      .catch((e) => console.warn("Couldn't load bills for the dashboard", e));
    fetchRecentPayments(8)
      .then((rows) => !cancelled && setRecentPaymentDocs(rows))
      .catch((e) => console.warn("Couldn't load payments for the dashboard", e));
    return () => {
      cancelled = true;
    };
  }, []);

  const stats = useMemo(() => {
    const totalAccounts = concessionaires.length;
    const activeAccounts = concessionaires.filter((c) => c.status === "CONNECTED").length;
    const delinquent = concessionaires.filter((c) => (c.totalBalance ?? 0) > 0);
    const totalOutstanding = delinquent.reduce((sum, c) => sum + (c.totalBalance ?? 0), 0);
    const delinquencyRate = totalAccounts > 0 ? (delinquent.length / totalAccounts) * 100 : 0;

    // Cash actually received. Summing each bill's amountPaid counted the same
    // money once per month it was carried forward — the same double-count
    // Reports had — so this uses the maintained summary, then real receipts.
    //
    // For a chosen period the summary's lifetime figure is the wrong answer,
    // so the receipts are counted by their own dates instead.
    let totalCollections = 0;
    if (wholeArchive) {
      concessionaires.forEach((c) => {
        if (c.billingSummary) {
          totalCollections += c.billingSummary.totalCollected;
        } else {
          (c.payments || []).forEach((p) => {
            if (!p.voided) totalCollections += p.amount;
          });
        }
      });
    } else {
      const approvedIds = new Set(concessionaires.map((c) => c.id));
      const counted = new Set<string>();
      recentPaymentDocs.forEach((p) => {
        if (p.voided || !approvedIds.has(p.concessionaireId)) return;
        if (!isoWithinRange(p.date, range)) return;
        counted.add(p.orNumber);
        totalCollections += p.amount;
      });
      // Accounts the storage migration hasn't reached keep receipts inline.
      concessionaires.forEach((c) => {
        (c.payments || []).forEach((p) => {
          if (p.voided || counted.has(p.orNumber)) return;
          if (isoWithinRange(p.date, range)) totalCollections += p.amount;
        });
      });
    }

    return { totalAccounts, activeAccounts, delinquentCount: delinquent.length, totalOutstanding, delinquencyRate, totalCollections };
  }, [concessionaires, recentPaymentDocs, range, wholeArchive]);

  const kpis = [
    {
      title: "Total Collections",
      value: formatPeso(stats.totalCollections),
      subtitle: wholeArchive ? "all-time, all barangays" : `${range.label}, all barangays`,
      icon: DollarSign,
      accent: "emerald" as const,
    },
    {
      title: "Active Accounts",
      value: stats.activeAccounts.toLocaleString(),
      subtitle: `of ${stats.totalAccounts.toLocaleString()} total`,
      icon: Users,
      accent: "sky" as const,
    },
    {
      title: "Delinquency Rate",
      value: `${stats.delinquencyRate.toFixed(1)}%`,
      subtitle: `${stats.delinquentCount.toLocaleString()} accounts`,
      icon: AlertTriangle,
      accent: "red" as const,
    },
    {
      title: "Outstanding Balance",
      value: formatPeso(stats.totalOutstanding),
      subtitle: "across delinquent accounts",
      icon: Droplets,
      accent: "amber" as const,
    },
  ];

  const monthlyChartData = useMemo(() => {
    const byMonth = new Map<string, { month: string; consumption: number; revenue: number }>();
    const approvedIds = new Set(concessionaires.map((c) => c.id));

    const add = (h: { month: string; reading: number; previousReading: number; voided?: boolean } & Parameters<typeof waterChargeOf>[0]) => {
      if (h.voided) return;
      const entry = byMonth.get(h.month) || { month: h.month, consumption: 0, revenue: 0 };
      entry.consumption += getCubicUsed(h);
      // Water sold, not the bill total: each bill already carries the last
      // one forward, so summing pesoAmount inflated every delinquent month.
      entry.revenue += waterChargeOf(h);
      byMonth.set(h.month, entry);
    };

    const seen = new Set<string>();
    recentBills.forEach((b) => {
      if (!approvedIds.has(b.concessionaireId)) return;
      seen.add(`${b.concessionaireId}|${b.month}`);
      if (monthWithinRange(b.month, range)) add(b);
    });
    // Accounts the storage migration hasn't reached still hold history inline.
    concessionaires.forEach((c) => {
      (c.billingHistory || []).forEach((h) => {
        if (!seen.has(`${c.id}|${h.month}`) && monthWithinRange(h.month, range)) add(h);
      });
    });

    return Array.from(byMonth.values())
      .sort((a, b) => monthSortKey(a.month) - monthSortKey(b.month))
      .slice(-12);
  }, [concessionaires, recentBills, range]);

  const recentPayments = useMemo(() => {
    const rows: { orNumber: string; concessionaireName: string; amount: number; date: string; recordedBy: string }[] = [];
    const seen = new Set<string>();
    recentPaymentDocs.forEach((p) => {
      if (p.voided) return;
      seen.add(p.orNumber);
      rows.push({ ...p });
    });
    // Accounts not yet migrated still hold payments inline.
    concessionaires.forEach((c) => {
      (c.payments || []).forEach((p) => {
        if (p.voided || seen.has(p.orNumber)) return;
        rows.push({ ...p, concessionaireName: getFullName(c) });
      });
    });
    return rows.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()).slice(0, 8);
  }, [concessionaires, recentPaymentDocs]);

  return (
    <div className="space-y-6 max-w-[1400px] mx-auto">
      {/* Page Header */}
      <div className="mb-6 flex flex-col gap-4 animate-in fade-in slide-in-from-top-4 duration-500 ease-snappy sm:flex-row sm:items-start sm:justify-between">
        <div className="flex flex-col gap-1">
          <h2 className="text-2xl md:text-3xl font-bold tracking-tight text-slate-900">
            Overview
          </h2>
          <p className="text-sm font-medium text-slate-600">
            Water district operations & key performance indicators
          </p>
        </div>
        <DateRangeFilter state={periodState} />
      </div>

      {loading ? (
        <div className="flex justify-center items-center h-64">
          <RefreshCw className="h-8 w-8 animate-spin text-muted-foreground" />
        </div>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4 auto-rows-min">
          {/* KPI Cards */}
          {kpis.map((kpi) => {
            const styles = accentStyles[kpi.accent];
            return (
              <Card
                key={kpi.title}
                className={`relative overflow-hidden group animate-in fade-in slide-in-from-bottom-4 duration-500 ease-snappy fill-mode-backwards transition-all hover:-translate-y-[2px] hover:shadow-md ${styles.bg}`}
              >
                <CardHeader className="flex flex-row items-center justify-between pb-2">
                  <CardTitle className="text-[11px] font-semibold uppercase tracking-widest text-slate-600">
                    {kpi.title}
                  </CardTitle>
                  <div
                    className={`flex h-8 w-8 items-center justify-center rounded-md transition-transform duration-300 group-hover:scale-110 ${styles.icon}`}
                  >
                    <kpi.icon className="h-4 w-4" />
                  </div>
                </CardHeader>
                <CardContent>
                  <div className="text-2xl lg:text-3xl font-bold tracking-tight text-slate-900 mb-2">
                    {kpi.value}
                  </div>
                  <span className="text-[11px] font-medium text-slate-600">{kpi.subtitle}</span>
                </CardContent>
              </Card>
            );
          })}

          {/* Chart Card */}
          <Card className="bg-white/80 backdrop-blur-md border-slate-200/60 shadow-sm transition-all hover:shadow-md lg:col-span-4 animate-in fade-in slide-in-from-bottom-4 duration-500 ease-snappy delay-300 fill-mode-backwards">
            <CardHeader>
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle className="text-base font-semibold text-slate-900">
                    Monthly Consumption vs. Revenue
                  </CardTitle>
                  <CardDescription className="text-xs font-medium text-slate-600 mt-1">
                    Water consumption (m³) and revenue billed (₱) — real billing history, last 12 months
                  </CardDescription>
                </div>
                <Badge
                  variant="secondary"
                  className="bg-sky-50 text-sky-700 border-sky-100 text-[10px] font-medium hover:bg-sky-100"
                >
                  <ArrowUpRight className="mr-1 h-3 w-3 text-sky-600" />
                  Real Data
                </Badge>
              </div>
            </CardHeader>
            <CardContent>
              {monthlyChartData.length === 0 ? (
                <div className="flex h-[200px] items-center justify-center text-sm text-slate-400">
                  No billing history yet.
                </div>
              ) : (
                <div className="h-[360px] w-full mt-4">
                  <ResponsiveContainer width="100%" height="100%">
                    <ComposedChart
                      data={monthlyChartData}
                      margin={{ top: 5, right: 20, left: 10, bottom: 5 }}
                    >
                      <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" vertical={false} />
                      <XAxis
                        dataKey="month"
                        tick={{ fill: "#475569", fontSize: 11, fontWeight: 500 }}
                        tickLine={false}
                        axisLine={{ stroke: "#e2e8f0" }}
                        dy={10}
                      />
                      <YAxis
                        yAxisId="left"
                        tick={{ fill: "#475569", fontSize: 11, fontWeight: 500 }}
                        tickLine={false}
                        axisLine={false}
                        tickFormatter={(v) => formatCompact(Number(v))}
                        dx={-10}
                      />
                      <YAxis
                        yAxisId="right"
                        orientation="right"
                        tick={{ fill: "#475569", fontSize: 11, fontWeight: 500 }}
                        tickLine={false}
                        axisLine={false}
                        tickFormatter={(v) => formatCompactPeso(Number(v))}
                        dx={10}
                      />
                      <Tooltip
                        contentStyle={{
                          backgroundColor: "rgba(255, 255, 255, 0.95)",
                          border: "1px solid #E2E8F0",
                          borderRadius: "8px",
                          fontSize: "12px",
                          fontWeight: 500,
                          color: "#0F172A",
                        }}
                        formatter={(value, name) => {
                          const v = Number(value);
                          if (name === "consumption") return [`${v.toLocaleString()} m³`, "Consumption"];
                          return [formatPeso(v), "Revenue"];
                        }}
                      />
                      <Legend
                        wrapperStyle={{ fontSize: "11px", paddingTop: "20px", color: "#475569", fontWeight: 500 }}
                        formatter={(value) =>
                          value === "consumption" ? "Water Consumption (m³)" : "Revenue Billed (₱)"
                        }
                      />
                      <Bar
                        yAxisId="left"
                        dataKey="consumption"
                        fill="#0284C7"
                        fillOpacity={0.7}
                        radius={[4, 4, 0, 0]}
                        barSize={28}
                      />
                      <Line
                        yAxisId="right"
                        type="monotone"
                        dataKey="revenue"
                        stroke="#0284C7"
                        strokeWidth={2.5}
                        dot={{ fill: "#ffffff", stroke: "#0284C7", strokeWidth: 2, r: 4 }}
                        activeDot={{ r: 6, fill: "#0284C7", stroke: "#fff", strokeWidth: 2 }}
                      />
                    </ComposedChart>
                  </ResponsiveContainer>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Recent Payments Table */}
          <Card className="bg-white/80 backdrop-blur-md border-slate-200/60 shadow-sm transition-all hover:shadow-md lg:col-span-4 animate-in fade-in slide-in-from-bottom-4 duration-500 ease-snappy delay-500 fill-mode-backwards overflow-hidden">
            <CardHeader>
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle className="text-base font-semibold text-slate-900">
                    Recent Payments
                  </CardTitle>
                  <CardDescription className="text-xs font-medium text-slate-600 mt-1">
                    Latest water bill payments recorded via the Collection Module
                  </CardDescription>
                </div>
                <Badge
                  variant="secondary"
                  className="bg-slate-100/80 text-slate-600 border-slate-200/50 text-[10px] font-medium"
                >
                  {recentPayments.length} records
                </Badge>
              </div>
            </CardHeader>
            <div className="px-6 pb-6">
              {recentPayments.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-8 text-center">
                  <Droplets className="h-8 w-8 text-slate-300 mb-2" />
                  <p className="text-xs text-slate-400">No payments recorded yet</p>
                </div>
              ) : (
                <div className="rounded-md border border-slate-200/60 overflow-hidden bg-white/60">
                  <Table>
                    <TableHeader className="bg-slate-50/80 backdrop-blur-sm">
                      <TableRow className="hover:bg-transparent border-slate-200/60">
                        <TableHead className="text-[10px] font-semibold uppercase tracking-wider text-slate-600">
                          Concessionaire
                        </TableHead>
                        <TableHead className="text-[10px] font-semibold uppercase tracking-wider text-slate-600">
                          OR Number
                        </TableHead>
                        <TableHead className="text-[10px] font-semibold uppercase tracking-wider text-slate-600">
                          Recorded By
                        </TableHead>
                        <TableHead className="text-right text-[10px] font-semibold uppercase tracking-wider text-slate-600">
                          Amount
                        </TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {recentPayments.map((p, i) => (
                        <TableRow key={`${p.orNumber}-${i}`} className="group border-slate-200/40 hover:bg-white/80 transition-colors">
                          <TableCell className="text-[13px] font-medium text-slate-900">
                            {p.concessionaireName}
                          </TableCell>
                          <TableCell>
                            <code className="rounded bg-slate-100/80 px-1.5 py-0.5 text-[11px] font-medium text-slate-600 tracking-tight">
                              {p.orNumber}
                            </code>
                          </TableCell>
                          <TableCell className="text-[12px] text-slate-500">{p.recordedBy}</TableCell>
                          <TableCell className="text-right text-[13px] font-bold text-emerald-600">
                            {formatPeso(p.amount)}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
            </div>
          </Card>
        </div>
      )}
    </div>
  );
}
