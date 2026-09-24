"use client";

import { userMessage } from "@/lib/userMessage";
import { useState, useRef, useTransition, useCallback, useMemo, useEffect } from "react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  FileSpreadsheet,
  Upload,
  CheckCircle2,
  AlertCircle,
  Loader2,
  ChevronDown,
  ChevronRight,
  CloudUpload,
  Eye,
  Trash2,
  FileX,
  Download,
} from "lucide-react";
import {
  parseXlsxFile,
  downloadImportTemplate,
  type ParsedSheet,
  type XlsxParseResult,
} from "@/lib/firebase/xlsxParser";
import { ImportIssues } from "@/components/ImportIssues";
import {
  batchImportConcessionaires,
  fetchMeterNumberIndex,
  meterKeyOf,
  type DuplicateStrategy,
  type ImportResult,
} from "@/lib/firebase/concessionaires";
import { useAuth } from "@/lib/auth/AuthContext";
import { getFullName } from "@/lib/utils";
import type { NewConcessionaireInput } from "@/lib/firebase/types";

// ── Helpers ────────────────────────────────────────────────────────────────

function formatPeso(v: number) {
  return new Intl.NumberFormat("en-PH", {
    style: "currency",
    currency: "PHP",
    minimumFractionDigits: 2,
  }).format(v);
}

function fileSizeMB(bytes: number) {
  return (bytes / 1024 / 1024).toFixed(2);
}

// ── Sheet preview accordion ────────────────────────────────────────────────

function SheetPreview({
  sheet,
  isSelected,
  onToggle,
}: {
  sheet: ParsedSheet;
  isSelected: boolean;
  onToggle: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const preview = sheet.concessionaires.slice(0, 6);

  return (
    <div
      className={`rounded-xl border transition-all duration-200 ${
        isSelected
          ? "border-sky-300 bg-sky-50/40"
          : "border-slate-200/60 bg-white/60"
      }`}
    >
      {/* Sheet header row */}
      <div className="flex items-center gap-3 px-4 py-3">
        <input
          type="checkbox"
          id={`sheet-${sheet.barangay}`}
          checked={isSelected}
          onChange={onToggle}
          className="h-4 w-4 rounded border-slate-300 accent-sky-600 cursor-pointer"
        />
        <label
          htmlFor={`sheet-${sheet.barangay}`}
          className="flex-1 flex items-center gap-3 cursor-pointer"
        >
          <span className="text-sm font-bold text-slate-900">{sheet.barangay}</span>
          <Badge
            variant="secondary"
            className="bg-sky-100 text-sky-700 border-sky-200 text-[10px] font-semibold"
          >
            {sheet.concessionaires.length} concessionaires
          </Badge>
          {sheet.skipped > 0 && (
            <Badge
              variant="secondary"
              className="bg-amber-100 text-amber-700 border-amber-200 text-[10px] font-semibold"
            >
              {sheet.skipped} skipped
            </Badge>
          )}
        </label>
        <button
          onClick={() => setExpanded((v) => !v)}
          className="flex items-center gap-1 text-[11px] font-medium text-slate-400 hover:text-sky-600 transition-colors"
        >
          <Eye className="h-3.5 w-3.5" />
          Preview
          {expanded ? (
            <ChevronDown className="h-3 w-3" />
          ) : (
            <ChevronRight className="h-3 w-3" />
          )}
        </button>
      </div>

      {/* Preview table */}
      {expanded && (
        <div className="border-t border-slate-200/60 px-4 pb-4">
          <div className="mt-3 rounded-lg border border-slate-200/40 overflow-hidden text-xs">
            <table className="w-full">
              <thead>
                <tr className="bg-slate-50 text-slate-500">
                  {["Name", "Purok", "Meter #", "Months", "Billing Bal.", "Total Bal.", "Remarks"].map(
                    (h) => (
                      <th
                        key={h}
                        className="px-3 py-2 text-left font-semibold text-[10px] uppercase tracking-wider whitespace-nowrap"
                      >
                        {h}
                      </th>
                    )
                  )}
                </tr>
              </thead>
              <tbody>
                {preview.map((c, i) => (
                  <tr
                    key={i}
                    className="border-t border-slate-100 bg-white hover:bg-slate-50/60 transition-colors"
                  >
                    <td className="px-3 py-2 font-semibold text-slate-800 whitespace-nowrap">
                      {getFullName(c)}
                    </td>
                    <td className="px-3 py-2 text-slate-500">{c.purok || "—"}</td>
                    <td className="px-3 py-2 font-mono text-slate-600 whitespace-nowrap">
                      {c.meterNumber || "—"}
                    </td>
                    <td className="px-3 py-2 text-sky-700 font-semibold">
                      {c.billingHistory.length}
                    </td>
                    <td className="px-3 py-2 font-semibold text-slate-700 whitespace-nowrap">
                      {formatPeso(c.billingBalance)}
                    </td>
                    <td
                      className={`px-3 py-2 font-bold whitespace-nowrap ${
                        c.totalBalance > 0 ? "text-red-600" : "text-emerald-600"
                      }`}
                    >
                      {formatPeso(c.totalBalance)}
                    </td>
                    <td className="px-3 py-2 text-slate-400 max-w-[180px] truncate">
                      {c.remarks?.length ? `${c.remarks.length} remark(s)` : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {sheet.concessionaires.length > 6 && (
              <div className="border-t border-slate-100 px-3 py-2 text-[10px] font-medium text-slate-400 bg-slate-50">
                + {sheet.concessionaires.length - 6} more concessionaires not shown
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Upload progress bar ────────────────────────────────────────────────────

function ProgressBar({ value, max }: { value: number; max: number }) {
  const pct = max > 0 ? Math.round((value / max) * 100) : 0;
  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between text-xs font-semibold text-slate-600">
        <span>Uploading records…</span>
        <span>{pct}%</span>
      </div>
      <div className="h-2 rounded-full bg-slate-200 overflow-hidden">
        <div
          className="h-full rounded-full bg-sky-500 transition-all duration-300 ease-out"
          style={{ width: `${pct}%` }}
        />
      </div>
      <p className="text-[11px] text-slate-500">
        {value.toLocaleString()} / {max.toLocaleString()} records written
      </p>
    </div>
  );
}

// ── Main page ──────────────────────────────────────────────────────────────

type ImportStatus = "idle" | "parsing" | "ready" | "uploading" | "done" | "error";

export default function ImportPage() {
  const { user } = useAuth();
  const actorEmail = user?.email ?? "unknown";
  const inputRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [parsed, setParsed] = useState<XlsxParseResult | null>(null);
  const [selectedSheets, setSelectedSheets] = useState<Set<string>>(new Set());
  const [status, setStatus] = useState<ImportStatus>("idle");
  const [uploadProgress, setUploadProgress] = useState({ done: 0, total: 0 });
  const [uploadResult, setUploadResult] = useState<ImportResult | null>(null);
  // How many of the selected rows match a concessionaire that already exists,
  // matched on meter number. Checked before writing anything: re-running the
  // same workbook used to silently create a second copy of every account.
  const [duplicateCount, setDuplicateCount] = useState<number | null>(null);
  const [checkingDuplicates, setCheckingDuplicates] = useState(false);
  const [duplicateStrategy, setDuplicateStrategy] = useState<DuplicateStrategy>("update");
  const [parseError, setParseError] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  // ── Drag & Drop ──────────────────────────────────────────────────────────

  const [dragging, setDragging] = useState(false);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragging(false);
    const f = e.dataTransfer.files[0];
    if (f) handleFile(f);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ── File selection ───────────────────────────────────────────────────────

  async function handleFile(f: File) {
    if (!f.name.endsWith(".xlsx") && !f.name.endsWith(".xls")) {
      setParseError("Please select an .xlsx or .xls file.");
      return;
    }
    setFile(f);
    setParsed(null);
    setParseError(null);
    setStatus("parsing");
    setUploadResult(null);

    try {
      const result = await parseXlsxFile(f);
      setParsed(result);
      // Pre-select all valid sheets
      setSelectedSheets(new Set(result.sheets.map((s) => s.barangay)));
      setStatus("ready");
    } catch (err) {
      setParseError(userMessage(err, "Failed to parse file."));
      setStatus("error");
    }
  }

  // ── Sheet toggle ─────────────────────────────────────────────────────────

  function toggleSheet(barangay: string) {
    setSelectedSheets((prev) => {
      const next = new Set(prev);
      next.has(barangay) ? next.delete(barangay) : next.add(barangay);
      return next;
    });
  }

  function toggleAll() {
    if (!parsed) return;
    const allSelected = parsed.sheets.every((s) => selectedSheets.has(s.barangay));
    setSelectedSheets(
      allSelected ? new Set() : new Set(parsed.sheets.map((s) => s.barangay))
    );
  }

  // ── Upload ─────────────────────────────────────────────────────────────

  const selectedRows = useMemo<NewConcessionaireInput[]>(() => {
    if (!parsed) return [];
    return parsed.sheets
      .filter((s) => selectedSheets.has(s.barangay))
      .flatMap((s) => s.concessionaires);
  }, [parsed, selectedSheets]);

  // Look up how many selected rows already exist, so the office is told
  // before anything is written rather than discovering duplicates afterwards.
  useEffect(() => {
    let cancelled = false;
    if (selectedRows.length === 0) {
      setDuplicateCount(null);
      return;
    }
    setCheckingDuplicates(true);
    fetchMeterNumberIndex()
      .then((index) => {
        if (cancelled) return;
        const matches = selectedRows.filter((r) => {
          const key = meterKeyOf(r.meterNumber);
          return key !== "" && index.has(key);
        }).length;
        setDuplicateCount(matches);
      })
      .catch(() => {
        if (!cancelled) setDuplicateCount(null);
      })
      .finally(() => {
        if (!cancelled) setCheckingDuplicates(false);
      });
    return () => {
      cancelled = true;
    };
  }, [selectedRows]);

  async function handleUpload() {
    if (selectedRows.length === 0) return;

    setStatus("uploading");
    setUploadProgress({ done: 0, total: selectedRows.length });

    startTransition(async () => {
      const result = await batchImportConcessionaires(selectedRows, actorEmail, {
        strategy: duplicateStrategy,
        onProgress: (done, total) => setUploadProgress({ done, total }),
      });
      setUploadResult(result);
      setStatus("done");
    });
  }

  // ── Reset ────────────────────────────────────────────────────────────────

  function reset() {
    setFile(null);
    setParsed(null);
    setSelectedSheets(new Set());
    setStatus("idle");
    setUploadResult(null);
    setParseError(null);
    setUploadProgress({ done: 0, total: 0 });
    setDuplicateCount(null);
    if (inputRef.current) inputRef.current.value = "";
  }

  const totalSelected = parsed
    ? parsed.sheets
        .filter((s) => selectedSheets.has(s.barangay))
        .reduce((s, sh) => s + sh.concessionaires.length, 0)
    : 0;

  // ── Render ───────────────────────────────────────────────────────────────

  return (
    <div className="space-y-6 max-w-[1100px] mx-auto">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-3 animate-in fade-in slide-in-from-top-4 duration-500 ease-snappy">
        <div className="flex flex-col gap-1">
          <h2 className="text-2xl md:text-3xl font-bold tracking-tight text-slate-900">
            Import XLSX Data
          </h2>
          <p className="text-sm font-medium text-slate-500">
            Upload a workbook built from the template — concessionaires, billing history, and
            connection payments are read from the file and saved.
          </p>
        </div>
        <Button
          variant="outline"
          onClick={() => downloadImportTemplate()}
          className="shrink-0 border-slate-200 text-slate-700 hover:bg-slate-50 font-semibold gap-2"
        >
          <Download className="h-4 w-4" />
          Download Template
        </Button>
      </div>

      {/* Drop Zone / File Picker */}
      <Card
        className={`bg-white/80 backdrop-blur-md border-2 border-dashed transition-all duration-200 animate-in fade-in slide-in-from-bottom-4 ease-snappy delay-100 fill-mode-backwards ${
          dragging
            ? "border-sky-400 bg-sky-50/60"
            : status === "ready" || status === "done"
            ? "border-emerald-300 bg-emerald-50/30"
            : "border-slate-300 hover:border-sky-300 hover:bg-sky-50/20"
        }`}
        onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
        onDragLeave={() => setDragging(false)}
        onDrop={handleDrop}
      >
        <CardContent className="flex flex-col items-center justify-center py-12 gap-4 text-center">
          {status === "idle" || status === "error" ? (
            <>
              <div
                className={`flex h-16 w-16 items-center justify-center rounded-2xl border shadow-sm ${
                  dragging ? "bg-sky-100 border-sky-300" : "bg-slate-100 border-slate-200"
                }`}
              >
                <FileSpreadsheet
                  className={`h-8 w-8 ${dragging ? "text-sky-500" : "text-slate-400"}`}
                />
              </div>
              <div>
                <p className="text-base font-semibold text-slate-700">
                  {dragging ? "Drop your file here" : "Drag & drop your XLSX file"}
                </p>
                <p className="text-sm text-slate-400 mt-0.5">
                  or click to browse — supports .xlsx files
                </p>
              </div>
              {parseError && (
                <div className="flex items-center gap-2 text-sm font-medium text-red-600 bg-red-50 border border-red-200 rounded-lg px-4 py-2">
                  <AlertCircle className="h-4 w-4 shrink-0" />
                  {parseError}
                </div>
              )}
              <Button
                onClick={() => inputRef.current?.click()}
                className="bg-sky-600 hover:bg-sky-700 text-white font-semibold gap-2 mt-2"
              >
                <Upload className="h-4 w-4" />
                Select File
              </Button>
              <input
                ref={inputRef}
                type="file"
                accept=".xlsx,.xls"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) handleFile(f);
                }}
              />
            </>
          ) : status === "parsing" ? (
            <>
              <Loader2 className="h-10 w-10 text-sky-500 animate-spin" />
              <p className="text-base font-semibold text-slate-700">
                Parsing spreadsheet…
              </p>
              <p className="text-sm text-slate-400">{file?.name}</p>
            </>
          ) : (
            /* File selected successfully */
            <div className="flex items-center gap-4 w-full max-w-lg">
              <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-emerald-100 border border-emerald-200 shrink-0">
                <FileSpreadsheet className="h-6 w-6 text-emerald-600" />
              </div>
              <div className="flex-1 text-left min-w-0">
                <p className="text-sm font-bold text-slate-800 truncate">{file?.name}</p>
                <p className="text-xs text-slate-400">
                  {fileSizeMB(file?.size ?? 0)} MB ·{" "}
                  {parsed?.sheets.length} barangay sheets ·{" "}
                  {parsed?.totalConcessionaires.toLocaleString()} concessionaires
                </p>
              </div>
              <Button
                variant="ghost"
                size="sm"
                onClick={reset}
                className="text-slate-400 hover:text-red-500 hover:bg-red-50 shrink-0"
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Upload result */}
      {status === "done" && uploadResult && (
        <div
          className={`rounded-xl border px-5 py-4 flex items-start gap-3 animate-in fade-in duration-300 ${
            uploadResult.errors.length > 0
              ? "bg-amber-50 border-amber-200"
              : "bg-emerald-50 border-emerald-200"
          }`}
        >
          {uploadResult.errors.length === 0 ? (
            <CheckCircle2 className="h-5 w-5 text-emerald-500 shrink-0 mt-0.5" />
          ) : (
            <AlertCircle className="h-5 w-5 text-amber-500 shrink-0 mt-0.5" />
          )}
          <div>
            <p className="text-sm font-bold text-slate-800">
              {uploadResult.imported.toLocaleString()} created
              {uploadResult.updated > 0 && `, ${uploadResult.updated.toLocaleString()} updated`}
              {uploadResult.skipped > 0 && `, ${uploadResult.skipped.toLocaleString()} skipped`}
            </p>
            {uploadResult.accountNumbers && (
              <p className="text-xs font-medium text-slate-600 mt-0.5">
                Account numbers assigned:{" "}
                <span className="font-mono">{uploadResult.accountNumbers.first}</span>
                {uploadResult.accountNumbers.first !== uploadResult.accountNumbers.last && (
                  <>
                    {" – "}
                    <span className="font-mono">{uploadResult.accountNumbers.last}</span>
                  </>
                )}
              </p>
            )}
            <p className="text-xs text-slate-500 mt-0.5">
              Existing accounts are matched by meter number, so re-importing the same workbook
              never creates a duplicate.
            </p>
            {uploadResult.errors.length > 0 && (
              <ul className="mt-1 list-disc list-inside space-y-0.5">
                {uploadResult.errors.map((e, i) => (
                  <li key={i} className="text-xs text-amber-700">
                    {e}
                  </li>
                ))}
              </ul>
            )}
            <Button
              variant="outline"
              size="sm"
              onClick={reset}
              className="mt-3 text-xs font-semibold border-slate-200 text-slate-600 hover:bg-slate-50"
            >
              Import Another File
            </Button>
          </div>
        </div>
      )}

      {/* What cleaning did to the workbook — shown before anything is saved */}
      {parsed && status === "ready" && <ImportIssues issues={parsed.issues} />}

      {/* Sheet selector & preview */}
      {parsed && (status === "ready" || status === "uploading") && (
        <Card className="bg-white/80 backdrop-blur-md border-slate-200/60 shadow-sm animate-in fade-in slide-in-from-bottom-4 duration-500 ease-snappy delay-150 fill-mode-backwards">
          <CardHeader>
            <div className="flex items-center justify-between">
              <div>
                <CardTitle className="text-base font-semibold text-slate-900">
                  Select Barangay Sheets to Import
                </CardTitle>
                <CardDescription className="text-xs text-slate-500 mt-0.5">
                  Expand each sheet to preview parsed data before uploading.
                </CardDescription>
              </div>
              <div className="flex items-center gap-3">
                <button
                  onClick={toggleAll}
                  className="text-[11px] font-semibold text-sky-600 hover:text-sky-700 underline underline-offset-2"
                >
                  {parsed.sheets.every((s) => selectedSheets.has(s.barangay))
                    ? "Deselect all"
                    : "Select all"}
                </button>
                <Badge
                  variant="secondary"
                  className="bg-sky-100 text-sky-700 border-sky-200 text-[11px] font-bold"
                >
                  {totalSelected.toLocaleString()} concessionaires selected
                </Badge>
              </div>
            </div>
          </CardHeader>
          <CardContent className="space-y-2">
            {parsed.sheets.map((sheet) => (
              <SheetPreview
                key={sheet.barangay}
                sheet={sheet}
                isSelected={selectedSheets.has(sheet.barangay)}
                onToggle={() => toggleSheet(sheet.barangay)}
              />
            ))}
          </CardContent>
        </Card>
      )}

      {/* Upload progress */}
      {status === "uploading" && (
        <Card className="bg-white/80 backdrop-blur-md border-slate-200/60 shadow-sm">
          <CardContent className="pt-6">
            <ProgressBar value={uploadProgress.done} max={uploadProgress.total} />
          </CardContent>
        </Card>
      )}

      {/* Sticky action bar */}
      {parsed && (status === "ready" || status === "uploading") && (
        <div className="sticky bottom-0 z-20 py-4 space-y-3">
          {/* Existing accounts are matched on meter number, so the office is
              told what will be overwritten before anything is written. */}
          {duplicateCount !== null && duplicateCount > 0 && (
            <div className="rounded-xl border border-amber-200 bg-amber-50 px-5 py-4 space-y-3">
              <div className="flex items-start gap-3">
                <AlertCircle className="h-5 w-5 text-amber-500 shrink-0 mt-0.5" />
                <div>
                  <p className="text-sm font-bold text-slate-800">
                    {duplicateCount.toLocaleString()} of these meter numbers already exist
                  </p>
                  <p className="text-xs text-amber-800 mt-0.5">
                    Choose what happens to those accounts. Payments, remarks and billing history
                    already on record are kept either way.
                  </p>
                </div>
              </div>
              <div className="flex flex-wrap gap-2 pl-8">
                <Button
                  size="sm"
                  variant={duplicateStrategy === "update" ? "default" : "outline"}
                  onClick={() => setDuplicateStrategy("update")}
                  className="text-xs font-semibold"
                >
                  Update them
                </Button>
                <Button
                  size="sm"
                  variant={duplicateStrategy === "skip" ? "default" : "outline"}
                  onClick={() => setDuplicateStrategy("skip")}
                  className="text-xs font-semibold"
                >
                  Leave them alone
                </Button>
              </div>
            </div>
          )}

          <div className="rounded-xl border border-slate-200 bg-white/90 backdrop-blur-md shadow-lg px-5 py-4 flex items-center justify-between gap-4">
            <div>
              <p className="text-sm font-bold text-slate-800">
                Ready to import {totalSelected.toLocaleString()} concessionaires
              </p>
              <p className="text-xs text-slate-400">
                from {selectedSheets.size} barangay sheet
                {selectedSheets.size !== 1 ? "s" : ""}
                {checkingDuplicates && " • checking for existing accounts…"}
              </p>
            </div>
            <Button
              onClick={handleUpload}
              disabled={totalSelected === 0 || status === "uploading"}
              className="bg-sky-600 hover:bg-sky-700 text-white font-semibold gap-2 min-w-[160px]"
            >
              {status === "uploading" ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Uploading…
                </>
              ) : (
                <>
                  <CloudUpload className="h-4 w-4" />
                  Upload Records
                </>
              )}
            </Button>
          </div>
        </div>
      )}

      {/* Workbook format */}
      <Card className="bg-white/80 backdrop-blur-md border-slate-200/60 shadow-sm animate-in fade-in duration-700 delay-200 fill-mode-backwards">
        <CardHeader>
          <CardTitle className="text-sm font-semibold text-slate-800">Workbook format</CardTitle>
          <CardDescription className="text-xs text-slate-500">
            Three sheets, matched by name and header text — column order doesn&apos;t matter.
            Click &quot;Download Template&quot; above for a ready-to-fill copy with example rows.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div>
            <p className="text-xs font-bold text-slate-700 mb-1">
              &quot;Concessionaires&quot; — one row per concessionaire (required)
            </p>
            <p className="text-xs text-slate-500">
              Meter No, Barangay, Purok, First/Middle/Last Name, Classification (RESIDENTIAL /
              COMMERCIAL A / COMMERCIAL B / GOVERNMENT), Status (CONNECTED / DISCONNECTED /
              DROPPED), Disconnected Reason, Billing Balance, Water Meter Fee, Application Fee,
              Inspection Fee, Other Payables, Remarks. No account number column — the meter number
              is what you type, and each new account is given its account number on import.
            </p>
          </div>
          <div>
            <p className="text-xs font-bold text-slate-700 mb-1">
              &quot;Billing History&quot; — one row per past bill (optional)
            </p>
            <p className="text-xs text-slate-500">
              Meter No (links to the row above), Month, Previous Reading, Current Reading, Peso
              Amount, OR Number, Amount Paid, Billing Date. Add as many rows per Meter No as that
              account has bills.
            </p>
          </div>
          <div>
            <p className="text-xs font-bold text-slate-700 mb-1">
              &quot;Connection Payments&quot; — one row per installment (optional)
            </p>
            <p className="text-xs text-slate-500">
              Meter No, Slot (1st / 2nd / 3rd / 4th / Full), Amount, OR Number, Date.
            </p>
          </div>
        </CardContent>
      </Card>

      {/* Cleaning notes */}
      <Card className="bg-slate-50/60 border-slate-200/40 shadow-none animate-in fade-in duration-700 delay-300 fill-mode-backwards">
        <CardHeader>
          <CardTitle className="text-sm font-semibold text-slate-700">
            What gets computed automatically
          </CardTitle>
        </CardHeader>
        <CardContent>
          <ul className="grid sm:grid-cols-2 gap-2 text-xs text-slate-600">
            {[
              "Billing Balance, if left blank, defaults to the most recent Billing History row's Peso Amount",
              "Water Meter Balance = (Water Meter Fee + Application Fee + Inspection Fee + Other Payables) − sum of Connection Payments",
              "Total Balance = Billing Balance + Water Meter Balance",
              "Rows with no Meter No or no name are skipped, not imported as blank accounts",
              "Account numbers are not in the workbook — each new account is given one on import, like 2026-000042",
              "An account already in the system keeps the account number it was given",
              "Header text matching is case-insensitive — \"Meter No\", \"meter no.\", and \"Meter Number\" all work",
              "Spellings are tidied before import — \"Bo ot\" → BO-OT, \"Comm A\" → COMMERCIAL A, \"₱1,250.00\" → 1,250.00, \"Purok 3\" → 3 — and every change is listed",
              "A row that can't be read safely — an unknown barangay, an amount like \"paid\", a meter number already used — is left out and listed, not imported wrong",
              "Billing History / Connection Payments rows for a meter that isn't being imported are left out and listed",
              "Excel date cells (e.g. Billing Date) are converted automatically — no need to format as text",
              "A blank or unrecognised Classification / Status imports as RESIDENTIAL / CONNECTED — and is listed for checking",
            ].map((note) => (
              <li key={note} className="flex items-start gap-2">
                <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500 mt-0.5 shrink-0" />
                {note}
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>
    </div>
  );
}
