"use client";

import { useCallback, useEffect, useState } from "react";
import {
  backfillSubcollections,
  dropLegacyArrays,
  surveyMigration,
  type MigrationProgress,
} from "@/lib/firebase/migrateToSubcollections";
import { useAuth } from "@/lib/auth/AuthContext";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { AlertCircle, CheckCircle2, Database, Loader2, RefreshCw } from "lucide-react";

type Survey = Awaited<ReturnType<typeof surveyMigration>>;

/**
 * One-off data migration: billing history and payments move from arrays on the
 * concessionaire document into `bills` and `payments` sub-collections.
 *
 * Run from the browser as the signed-in admin rather than as a script, because
 * the security rules already give an admin exactly the access this needs — no
 * service-account key to create, distribute, and then worry about.
 *
 * Deliberately two buttons. The backfill is safe and repeatable and changes
 * nothing about how the apps read; the cleanup is the only step that removes
 * anything, and it verifies each account before it does.
 */
export default function MigratePage() {
  const { user, role } = useAuth();
  const actorEmail = user?.email ?? "unknown";

  const [survey, setSurvey] = useState<Survey | null>(null);
  const [surveying, setSurveying] = useState(false);
  const [progress, setProgress] = useState<MigrationProgress | null>(null);
  const [running, setRunning] = useState<"backfill" | "cleanup" | null>(null);
  const [finished, setFinished] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refreshSurvey = useCallback(async () => {
    setSurveying(true);
    setError(null);
    try {
      setSurvey(await surveyMigration());
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't read the collection.");
    } finally {
      setSurveying(false);
    }
  }, []);

  useEffect(() => {
    if (role === "admin") void refreshSurvey();
  }, [role, refreshSurvey]);

  async function run(kind: "backfill" | "cleanup") {
    setRunning(kind);
    setProgress(null);
    setFinished(null);
    setError(null);
    try {
      const fn = kind === "backfill" ? backfillSubcollections : dropLegacyArrays;
      const result = await fn(actorEmail, setProgress);
      setFinished(
        kind === "backfill"
          ? `Backfilled ${result.migrated} account(s): ${result.billsWritten} bill(s) and ${result.paymentsWritten} payment(s) written. ${result.skipped} were already done.`
          : `Cleaned ${result.migrated} account(s). ${result.skipped} were already clean.`
      );
      await refreshSurvey();
    } catch (e) {
      setError(e instanceof Error ? e.message : "The migration stopped with an error.");
    } finally {
      setRunning(null);
    }
  }

  if (role !== "admin") {
    return (
      <Alert variant="destructive">
        <AlertCircle className="h-4 w-4" />
        <AlertTitle>Admins only</AlertTitle>
        <AlertDescription>This page changes how every account&apos;s data is stored.</AlertDescription>
      </Alert>
    );
  }

  const backfillDone = survey ? survey.withSummary >= survey.total && survey.total > 0 : false;
  const cleanupDone = survey ? survey.withLegacyArrays === 0 : false;
  const pct = progress && progress.scanned > 0 ? Math.min(100, (progress.scanned / (survey?.total || progress.scanned)) * 100) : 0;

  return (
    <div className="space-y-6 max-w-3xl">
      <div>
        <h2 className="text-2xl font-bold tracking-tight text-slate-900">Storage Migration</h2>
        <p className="text-sm text-slate-500">
          Moves billing history and payments out of arrays on each concessionaire and into
          sub-collections. Firestore caps a document at 1&nbsp;MiB and rewrites the whole thing on
          every write, so arrays that grow by a row a month were always going to become a problem —
          this is that problem dealt with before it arrives.
        </p>
      </div>

      {error && (
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertTitle>Something went wrong</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {finished && (
        <Alert>
          <CheckCircle2 className="h-4 w-4" />
          <AlertTitle>Done</AlertTitle>
          <AlertDescription>{finished}</AlertDescription>
        </Alert>
      )}

      <Card>
        <CardHeader className="flex-row items-center justify-between space-y-0">
          <div>
            <CardTitle className="text-base font-semibold text-slate-800">Current state</CardTitle>
            <CardDescription className="text-xs text-slate-500">
              Read fresh from Firestore. Nothing here changes anything.
            </CardDescription>
          </div>
          <Button variant="outline" size="sm" onClick={refreshSurvey} disabled={surveying}>
            {surveying ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <RefreshCw className="h-3.5 w-3.5" />
            )}
            <span className="ml-1.5 text-xs">Refresh</span>
          </Button>
        </CardHeader>
        <CardContent>
          {!survey ? (
            <p className="text-sm text-slate-400">Reading…</p>
          ) : (
            <dl className="grid gap-4 sm:grid-cols-4">
              <div>
                <dt className="text-[10px] uppercase tracking-wider text-slate-400">Accounts</dt>
                <dd className="text-2xl font-bold text-slate-900">{survey.total}</dd>
              </div>
              <div>
                <dt className="text-[10px] uppercase tracking-wider text-slate-400">Migrated</dt>
                <dd className="text-2xl font-bold text-emerald-600">{survey.withSummary}</dd>
              </div>
              <div>
                <dt className="text-[10px] uppercase tracking-wider text-slate-400">
                  Still holding arrays
                </dt>
                <dd className="text-2xl font-bold text-amber-600">{survey.withLegacyArrays}</dd>
              </div>
              <div>
                <dt className="text-[10px] uppercase tracking-wider text-slate-400">
                  Longest history
                </dt>
                <dd className="text-2xl font-bold text-slate-900">
                  {survey.largestHistory}
                  <span className="text-sm font-normal text-slate-400"> mo</span>
                </dd>
              </div>
            </dl>
          )}
        </CardContent>
      </Card>

      {running && progress && (
        <Card>
          <CardContent className="pt-6 space-y-3">
            <div className="flex items-center gap-2 text-sm text-slate-700">
              <Loader2 className="h-4 w-4 animate-spin text-sky-500" />
              Scanned {progress.scanned}
              {survey ? ` of ${survey.total}` : ""} · {progress.migrated} changed ·{" "}
              {progress.skipped} skipped
            </div>
            <Progress value={pct} />
            {progress.errors.length > 0 && (
              <p className="text-xs text-amber-700">
                {progress.errors.length} account(s) reported a problem — listed when this finishes.
              </p>
            )}
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <Database className="h-4 w-4 text-slate-400" />
            <CardTitle className="text-base font-semibold text-slate-800">
              Step 1 — Backfill
            </CardTitle>
            {backfillDone && (
              <Badge variant="secondary" className="bg-emerald-50 text-emerald-700 border-emerald-200">
                Complete
              </Badge>
            )}
          </div>
          <CardDescription className="text-xs text-slate-500">
            Writes each bill and payment as its own document and builds the summary the parent now
            carries. The arrays stay exactly where they are, and every screen keeps reading them as a
            fallback, so this cannot break anything that is currently working. Safe to run more than
            once.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Button onClick={() => run("backfill")} disabled={running !== null}>
            {running === "backfill" && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
            Run backfill
          </Button>
        </CardContent>
      </Card>

      <Card className={cleanupDone ? undefined : "border-amber-200"}>
        <CardHeader>
          <div className="flex items-center gap-2">
            <AlertCircle className="h-4 w-4 text-amber-500" />
            <CardTitle className="text-base font-semibold text-slate-800">
              Step 2 — Remove the old arrays
            </CardTitle>
            {cleanupDone && (
              <Badge variant="secondary" className="bg-emerald-50 text-emerald-700 border-emerald-200">
                Complete
              </Badge>
            )}
          </div>
          <CardDescription className="text-xs text-slate-500">
            The only step that deletes anything. Before clearing an account it checks that every
            month and every receipt in the arrays exists as a document; if any is missing it leaves
            that account alone and tells you. Run step 1 first, then look at a few accounts in
            Billing and satisfy yourself the history is intact.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Button
            variant="outline"
            className="border-amber-300 text-amber-800 hover:bg-amber-50"
            onClick={() => run("cleanup")}
            disabled={running !== null || !survey || survey.withSummary === 0}
          >
            {running === "cleanup" && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
            Remove legacy arrays
          </Button>
        </CardContent>
      </Card>

      {progress && progress.errors.length > 0 && !running && (
        <Card className="border-amber-200">
          <CardHeader>
            <CardTitle className="text-base font-semibold text-slate-800">
              Accounts that reported a problem
            </CardTitle>
            <CardDescription className="text-xs text-slate-500">
              Nothing was removed from these. Fix the cause and run again.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <ul className="space-y-1 list-disc list-inside">
              {progress.errors.map((e, i) => (
                <li key={i} className="text-xs text-amber-800">
                  {e}
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
