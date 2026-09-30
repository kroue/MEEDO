"use client";

/**
 * Settings → Water rates: what a cubic metre costs, and from which billing
 * month. Everyone can see the rates in force, what's coming and what came
 * before; only an admin can change them, and every change names its month,
 * is confirmed before it's saved, and is recorded in the audit log.
 */

import { useEffect, useMemo, useState } from "react";
import { AlertCircle, CalendarClock, Droplets, History, Loader2 } from "lucide-react";
import { useAuth } from "@/lib/auth/AuthContext";
import { calculateBill } from "@/lib/billingCalculator";
import {
  addMonths,
  describeRateCard,
  monthLabel,
  pastChanges,
  rateCardFor,
  rateCardProblem,
  scheduledEntryFor,
  toCalculatorConfig,
  upcomingChanges,
  type RateCard,
  type ScheduledRateCard,
} from "@/lib/rates";
import {
  cancelRateChange,
  currentMonthKey,
  scheduleRateChange,
  subscribeToRateSchedule,
} from "@/lib/firebase/rates";
import { subscribeToPeopleDirectory } from "@/lib/firebase/users";
import type { ConcessionaireClassification } from "@/lib/firebase/types";
import { userMessage } from "@/lib/userMessage";
import { formatPeso } from "@/lib/utils";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

const CLASSES: { key: ConcessionaireClassification; label: string }[] = [
  { key: "RESIDENTIAL", label: "Residential" },
  { key: "GOVERNMENT", label: "Government" },
  { key: "COMMERCIAL A", label: "Commercial A" },
  { key: "COMMERCIAL B", label: "Commercial B" },
];

/** A household's month, for the before-and-after example. */
const EXAMPLE_M3 = 20;

/** The form holds what was typed; it becomes numbers only when checked. */
interface Draft {
  commodityRate: string;
  minChargeThreshold: string;
  minimumCharges: Record<ConcessionaireClassification, string>;
  effectiveMonth: string;
}

function draftFrom(card: RateCard, effectiveMonth: string): Draft {
  return {
    commodityRate: card.commodityRate.toFixed(2),
    minChargeThreshold: String(card.minChargeThreshold),
    minimumCharges: Object.fromEntries(
      CLASSES.map(({ key }) => [key, String(card.minimumCharges[key])])
    ) as Record<ConcessionaireClassification, string>,
    effectiveMonth,
  };
}

function cardFrom(draft: Draft): RateCard {
  return {
    commodityRate: Number(draft.commodityRate),
    minChargeThreshold: Number(draft.minChargeThreshold),
    minimumCharges: Object.fromEntries(
      CLASSES.map(({ key }) => [key, Number(draft.minimumCharges[key])])
    ) as Record<ConcessionaireClassification, number>,
  };
}

function waterChargeFor(card: RateCard, classification: ConcessionaireClassification, m3: number): number {
  return calculateBill({
    previousReading: 0,
    currentReading: m3,
    classification,
    config: toCalculatorConfig(card),
  }).totalWaterCharge;
}

function when(iso: string): string {
  const t = Date.parse(iso);
  return isNaN(t) ? "" : new Date(t).toLocaleDateString("en-PH", { dateStyle: "medium" });
}

function RateCardSummary({ card }: { card: RateCard }) {
  return (
    <dl className="grid gap-3 sm:grid-cols-2">
      <div className="rounded-lg border border-slate-200 bg-slate-50 px-4 py-3 sm:col-span-2">
        <dt className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">
          Each cubic metre after the first {card.minChargeThreshold} m³
        </dt>
        <dd className="mt-0.5 text-lg font-semibold text-slate-900">{formatPeso(card.commodityRate)}</dd>
      </div>
      {CLASSES.map(({ key, label }) => (
        <div key={key} className="rounded-lg border border-slate-200 bg-slate-50 px-4 py-3">
          <dt className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">
            {label} minimum (first {card.minChargeThreshold} m³)
          </dt>
          <dd className="mt-0.5 text-sm font-medium text-slate-800">{formatPeso(card.minimumCharges[key])}</dd>
        </div>
      ))}
    </dl>
  );
}

export function RateSettings() {
  const { user, role } = useAuth();
  const isAdmin = role === "admin";
  const actorEmail = user?.email ?? "";

  const [schedule, setSchedule] = useState<ScheduledRateCard[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  useEffect(
    () =>
      subscribeToRateSchedule(
        (s) => {
          setSchedule(s);
          setLoadError(null);
        },
        (e) => setLoadError(userMessage(e, "Couldn't load the water rates."))
      ),
    []
  );

  // Names for who set each change. Only an admin may read other accounts, so
  // staff see the email the change was recorded under.
  const [people, setPeople] = useState<Map<string, string>>(new Map());
  useEffect(() => {
    if (!isAdmin) return;
    return subscribeToPeopleDirectory(setPeople, () => {});
  }, [isAdmin]);
  const who = (email: string) => people.get(email.trim().toLowerCase()) || email;

  const thisMonth = useMemo(() => currentMonthKey(), []);
  const inForce = schedule ? rateCardFor(schedule, thisMonth) : null;
  const inForceEntry = schedule ? scheduledEntryFor(schedule, thisMonth) : null;
  const upcoming = schedule ? upcomingChanges(schedule, thisMonth) : [];
  const history = schedule ? pastChanges(schedule, thisMonth).filter((e) => e !== inForceEntry) : [];

  const monthChoices = useMemo(
    () => Array.from({ length: 13 }, (_, i) => addMonths(thisMonth, i)),
    [thisMonth]
  );

  const [draft, setDraft] = useState<Draft | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [withdrawing, setWithdrawing] = useState<ScheduledRateCard | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const draftCard = draft ? cardFrom(draft) : null;
  const problem = draftCard ? rateCardProblem(draftCard) : null;
  // What the draft replaces is whatever would otherwise apply in its month.
  const replacing = draft && schedule ? rateCardFor(schedule, draft.effectiveMonth) : null;

  function startEditing() {
    if (!inForce) return;
    // Starting next month is the usual case: a new rate is announced ahead.
    setDraft(draftFrom(upcoming.at(-1) ?? inForce, addMonths(thisMonth, 1)));
    setSaveError(null);
    setNotice(null);
  }

  async function save() {
    if (!draft || !draftCard) return;
    setSaving(true);
    setSaveError(null);
    try {
      await scheduleRateChange(draftCard, draft.effectiveMonth, actorEmail);
      setNotice(`New rates saved. They apply to bills for ${monthLabel(draft.effectiveMonth)} onwards.`);
      setDraft(null);
      setConfirming(false);
    } catch (e) {
      setSaveError(userMessage(e, "Couldn't save the new rates."));
      setConfirming(false);
    } finally {
      setSaving(false);
    }
  }

  async function withdraw() {
    if (!withdrawing) return;
    setSaving(true);
    setSaveError(null);
    try {
      await cancelRateChange(withdrawing.effectiveMonth, actorEmail);
      setNotice(`The change due to start ${monthLabel(withdrawing.effectiveMonth)} was withdrawn.`);
      setWithdrawing(null);
    } catch (e) {
      setSaveError(userMessage(e, "Couldn't withdraw that change."));
      setWithdrawing(null);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-2">
          <Droplets className="h-4 w-4 text-slate-400" />
          <CardTitle className="text-base font-semibold text-slate-800">Water rates</CardTitle>
        </div>
        <CardDescription className="text-xs text-slate-500">
          What households pay per cubic metre, here and on the field phones. A change starts from
          the billing month it names; bills already issued keep the rates they were worked out with.
          {!isAdmin && " Only an admin can change them."}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        {loadError && (
          <Alert variant="destructive">
            <AlertCircle className="h-4 w-4" />
            <AlertDescription>{loadError}</AlertDescription>
          </Alert>
        )}
        {notice && (
          <p className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-900">
            {notice}
          </p>
        )}

        {!schedule && !loadError && (
          <div className="flex items-center gap-2 text-sm text-slate-500">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading the rates…
          </div>
        )}

        {inForce && (
          <section className="space-y-2">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h3 className="text-sm font-semibold text-slate-800">In force for {monthLabel(thisMonth)}</h3>
              <p className="text-xs text-slate-500">
                {inForceEntry
                  ? `Since ${monthLabel(inForceEntry.effectiveMonth)} · set by ${who(inForceEntry.setBy)} on ${when(inForceEntry.setAt)}`
                  : "The original rates — never changed here"}
              </p>
            </div>
            <RateCardSummary card={inForce} />
          </section>
        )}

        {upcoming.length > 0 && (
          <section className="space-y-2">
            <h3 className="flex items-center gap-2 text-sm font-semibold text-slate-800">
              <CalendarClock className="h-4 w-4 text-amber-500" /> Coming up
            </h3>
            <ul className="divide-y divide-amber-100 rounded-lg border border-amber-200 bg-amber-50/40">
              {upcoming.map((e) => (
                <li key={e.effectiveMonth} className="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <p className="text-sm font-medium text-slate-800">From {monthLabel(e.effectiveMonth)}</p>
                    <p className="text-xs text-slate-600">{describeRateCard(e)}</p>
                    <p className="text-[11px] text-slate-500">
                      Set by {who(e.setBy)} on {when(e.setAt)}
                    </p>
                  </div>
                  {isAdmin && (
                    <Button variant="outline" size="sm" className="shrink-0" onClick={() => setWithdrawing(e)}>
                      Withdraw
                    </Button>
                  )}
                </li>
              ))}
            </ul>
          </section>
        )}

        {history.length > 0 && (
          <details className="group rounded-lg border border-slate-200">
            <summary className="flex cursor-pointer items-center gap-2 px-4 py-2.5 text-sm font-medium text-slate-700">
              <History className="h-4 w-4 text-slate-400" /> Earlier rates ({history.length})
            </summary>
            <ul className="divide-y divide-slate-100 border-t border-slate-100">
              {history.map((e) => (
                <li key={e.effectiveMonth} className="px-4 py-2.5">
                  <p className="text-sm text-slate-800">From {monthLabel(e.effectiveMonth)}</p>
                  <p className="text-xs text-slate-600">{describeRateCard(e)}</p>
                  <p className="text-[11px] text-slate-500">
                    Set by {who(e.setBy)} on {when(e.setAt)}
                  </p>
                </li>
              ))}
            </ul>
          </details>
        )}

        {saveError && (
          <Alert variant="destructive">
            <AlertCircle className="h-4 w-4" />
            <AlertDescription>{saveError}</AlertDescription>
          </Alert>
        )}

        {isAdmin && inForce && !draft && (
          <Button onClick={startEditing} className="bg-sky-600 text-white hover:bg-sky-700">
            Change water rates
          </Button>
        )}

        {isAdmin && draft && draftCard && replacing && (
          <section className="space-y-4 rounded-lg border border-sky-200 bg-sky-50/40 p-4">
            <h3 className="text-sm font-semibold text-slate-800">New rates</h3>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="rate-commodity" className="text-xs font-medium text-slate-700">
                  Price per cubic metre (₱)
                </Label>
                <Input
                  id="rate-commodity"
                  type="number"
                  inputMode="decimal"
                  step="0.01"
                  min="0"
                  value={draft.commodityRate}
                  onChange={(e) => setDraft({ ...draft, commodityRate: e.target.value })}
                  className="bg-white font-mono"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="rate-threshold" className="text-xs font-medium text-slate-700">
                  Cubic metres the minimum charge covers
                </Label>
                <Input
                  id="rate-threshold"
                  type="number"
                  inputMode="numeric"
                  step="1"
                  min="0"
                  value={draft.minChargeThreshold}
                  onChange={(e) => setDraft({ ...draft, minChargeThreshold: e.target.value })}
                  className="bg-white font-mono"
                />
              </div>
              {CLASSES.map(({ key, label }) => (
                <div key={key} className="space-y-1.5">
                  <Label htmlFor={`rate-min-${key}`} className="text-xs font-medium text-slate-700">
                    {label} minimum charge (₱)
                  </Label>
                  <Input
                    id={`rate-min-${key}`}
                    type="number"
                    inputMode="numeric"
                    step="1"
                    min="0"
                    value={draft.minimumCharges[key]}
                    onChange={(e) =>
                      setDraft({ ...draft, minimumCharges: { ...draft.minimumCharges, [key]: e.target.value } })
                    }
                    className="bg-white font-mono"
                  />
                </div>
              ))}
              <div className="space-y-1.5 sm:col-span-2">
                <Label className="text-xs font-medium text-slate-700">Starts from billing month</Label>
                <Select value={draft.effectiveMonth} onValueChange={(v) => v && setDraft({ ...draft, effectiveMonth: v })}>
                  <SelectTrigger className="w-full bg-white sm:w-64">
                    <SelectValue>
                      {(v) => `${monthLabel(String(v))}${v === thisMonth ? " — this month" : ""}`}
                    </SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    {monthChoices.map((m) => (
                      <SelectItem key={m} value={m}>
                        {monthLabel(m)}
                        {m === thisMonth ? " — this month" : ""}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            {problem ? (
              <p className="text-sm text-red-600">{problem}</p>
            ) : (
              <p className="rounded-md bg-white px-3 py-2 text-sm text-slate-700">
                A residential household using {EXAMPLE_M3} m³ would pay{" "}
                <strong>{formatPeso(waterChargeFor(draftCard, "RESIDENTIAL", EXAMPLE_M3))}</strong> for its
                water, against {formatPeso(waterChargeFor(replacing, "RESIDENTIAL", EXAMPLE_M3))} at the rates
                these replace.
              </p>
            )}

            {draft.effectiveMonth === thisMonth && (
              <p className="flex items-start gap-2 text-xs text-amber-800">
                <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                Bills already issued for {monthLabel(thisMonth)} keep the old rates. Phones use the new
                ones from their next sync; a reading taken before that is billed at the old rates, and
                the bill records which.
              </p>
            )}

            <div className="flex gap-2">
              <Button
                className="bg-sky-600 text-white hover:bg-sky-700"
                disabled={problem !== null || saving}
                onClick={() => setConfirming(true)}
              >
                Save new rates
              </Button>
              <Button variant="outline" disabled={saving} onClick={() => setDraft(null)}>
                Cancel
              </Button>
            </div>
          </section>
        )}
      </CardContent>

      <ConfirmDialog
        open={confirming}
        onOpenChange={setConfirming}
        title={draft ? `Change water rates from ${monthLabel(draft.effectiveMonth)}?` : ""}
        description="Every bill for that month onwards — from this console and from the field phones — is worked out with these rates."
        confirmLabel="Set new rates"
        busy={saving}
        onConfirm={save}
      >
        {draftCard && <p className="text-sm text-slate-700">{describeRateCard(draftCard)}.</p>}
      </ConfirmDialog>

      <ConfirmDialog
        open={withdrawing !== null}
        onOpenChange={(open) => !open && setWithdrawing(null)}
        title={withdrawing ? `Withdraw the change due ${monthLabel(withdrawing.effectiveMonth)}?` : ""}
        description="Bills for that month will be worked out with the rates in force before it instead."
        confirmLabel="Withdraw change"
        destructive
        busy={saving}
        onConfirm={withdraw}
      />
    </Card>
  );
}
