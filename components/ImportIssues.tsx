"use client";

/**
 * What the import did to a workbook, shown before anything is written: rows
 * left out, guesses to check, and values tidied automatically — each grouped
 * by kind, with the spreadsheet rows it happened on.
 *
 * Rows left out come first because they are the ones that won't be in the
 * system at all; tidying comes last because it needs no action.
 */

import { useMemo, useState } from "react";
import { AlertCircle, AlertTriangle, CheckCircle2, ChevronDown, ChevronRight } from "lucide-react";
import type { ImportIssue, ImportIssueLevel } from "@/lib/firebase/xlsxParser";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

/** Enough to act on; the rest are the same fix repeated. */
const ROWS_SHOWN = 100;

const LEVELS: {
  level: ImportIssueLevel;
  heading: (count: number) => string;
  explain: string;
  icon: typeof AlertCircle;
  tone: { icon: string; badge: string; border: string };
}[] = [
  {
    level: "skipped",
    heading: (n) => `${n.toLocaleString()} ${n === 1 ? "row" : "rows"} won't be imported`,
    explain: "Fix these in the spreadsheet and upload it again to bring them in.",
    icon: AlertCircle,
    tone: { icon: "text-red-500", badge: "bg-red-50 text-red-700 border-red-200", border: "border-red-100" },
  },
  {
    level: "check",
    heading: (n) => `${n.toLocaleString()} ${n === 1 ? "value" : "values"} to check`,
    explain: "Imported using a best guess. If a guess is wrong, correct the spreadsheet and upload it again.",
    icon: AlertTriangle,
    tone: { icon: "text-amber-500", badge: "bg-amber-50 text-amber-700 border-amber-200", border: "border-amber-100" },
  },
  {
    level: "fixed",
    heading: (n) => `${n.toLocaleString()} ${n === 1 ? "value" : "values"} tidied automatically`,
    explain: "Spelling, capitals and number formats written the way the system stores them. Nothing to do.",
    icon: CheckCircle2,
    tone: {
      icon: "text-emerald-500",
      badge: "bg-emerald-50 text-emerald-700 border-emerald-200",
      border: "border-emerald-100",
    },
  },
];

export function ImportIssues({ issues }: { issues: ImportIssue[] }) {
  const [open, setOpen] = useState<Set<string>>(new Set());

  const byLevel = useMemo(() => {
    const grouped = new Map<ImportIssueLevel, Map<string, ImportIssue[]>>();
    for (const issue of issues) {
      const kinds = grouped.get(issue.level) ?? new Map<string, ImportIssue[]>();
      kinds.set(issue.kind, [...(kinds.get(issue.kind) ?? []), issue]);
      grouped.set(issue.level, kinds);
    }
    return grouped;
  }, [issues]);

  function toggle(key: string) {
    setOpen((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  if (issues.length === 0) {
    return (
      <div className="flex items-center gap-3 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3">
        <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-600" />
        <p className="text-sm text-emerald-900">Nothing in this workbook needed tidying.</p>
      </div>
    );
  }

  return (
    <Card className="bg-white/80 backdrop-blur-md border-slate-200/60 shadow-sm">
      <CardHeader>
        <CardTitle className="text-base font-semibold text-slate-900">Before you import</CardTitle>
        <CardDescription className="text-xs text-slate-500 mt-0.5">
          What the import changed in this workbook, and what it left out. Nothing has been saved yet.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        {LEVELS.map(({ level, heading, explain, icon: Icon, tone }) => {
          const kinds = byLevel.get(level);
          if (!kinds) return null;
          // Rows left out are counted as rows — one row can fail for one reason
          // only — while the others count every value changed.
          const count =
            level === "skipped"
              ? new Set([...kinds.values()].flat().map((i) => `${i.sheet}|${i.row}`)).size
              : [...kinds.values()].reduce((sum, list) => sum + list.length, 0);
          return (
            <section key={level} className="space-y-2">
              <div className="flex items-start gap-2">
                <Icon className={`mt-0.5 h-4 w-4 shrink-0 ${tone.icon}`} />
                <div>
                  <h3 className="text-sm font-semibold text-slate-800">{heading(count)}</h3>
                  <p className="text-xs text-slate-500">{explain}</p>
                </div>
              </div>
              <div className={`divide-y rounded-lg border ${tone.border}`}>
                {[...kinds.entries()].map(([kind, list]) => {
                  const key = `${level}|${kind}`;
                  const expanded = open.has(key);
                  return (
                    <div key={kind}>
                      <button
                        type="button"
                        onClick={() => toggle(key)}
                        aria-expanded={expanded}
                        className="flex w-full items-center gap-2 px-3 py-2 text-left hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-sky-500"
                      >
                        {expanded ? (
                          <ChevronDown className="h-3.5 w-3.5 shrink-0 text-slate-400" />
                        ) : (
                          <ChevronRight className="h-3.5 w-3.5 shrink-0 text-slate-400" />
                        )}
                        <span className="flex-1 text-xs font-medium text-slate-700">{kind}</span>
                        <span className={`rounded-full border px-2 py-0.5 text-[10px] font-bold ${tone.badge}`}>
                          {list.length.toLocaleString()}
                        </span>
                      </button>
                      {expanded && (
                        <ul className="space-y-1 bg-slate-50/60 px-3 pb-3 pt-1">
                          {list.slice(0, ROWS_SHOWN).map((issue, i) => (
                            <li key={i} className="flex flex-wrap gap-x-2 text-xs">
                              <span className="shrink-0 font-mono text-slate-500">
                                {issue.sheet} · row {issue.row}
                              </span>
                              <span className="shrink-0 text-slate-400">{issue.column}</span>
                              {issue.note && <span className="text-slate-700">{issue.note}</span>}
                            </li>
                          ))}
                          {list.length > ROWS_SHOWN && (
                            <li className="text-xs italic text-slate-500">
                              …and {(list.length - ROWS_SHOWN).toLocaleString()} more like these
                            </li>
                          )}
                        </ul>
                      )}
                    </div>
                  );
                })}
              </div>
            </section>
          );
        })}
      </CardContent>
    </Card>
  );
}
