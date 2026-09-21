"use client";

/**
 * Settings for this PC, plus the office figures this console bills by.
 *
 * Only two kinds of thing are here. Choices about how this machine is used,
 * which are saved in this browser because the counter PC and the office PC
 * want different answers. And the billing figures, shown but not editable:
 * changing what a household is charged is a Board decision that belongs in a
 * reviewed change, not in a box someone can edit between customers.
 */

import { useState, useSyncExternalStore } from "react";
import Link from "next/link";
import {
  AlertCircle,
  BadgeInfo,
  CheckCircle2,
  Info,
  ListOrdered,
  MapPin,
  MonitorDown,
  Receipt,
  UserCog,
} from "lucide-react";
import { useAuth } from "@/lib/auth/AuthContext";
import { ROWS_PER_PAGE_OPTIONS, type ConsolePreferences } from "@/lib/preferences";
import { updatePreferences, usePreferences } from "@/lib/usePreferences";
import { SKIP_INSTALL_KEY, isRunningInstalled } from "@/components/InstallGate";
import { BARANGAYS } from "@/lib/firebase/types";
import {
  DISCONNECTION_ELIGIBLE_DAYS,
  EXTENSION_FEE,
  GRACE_PERIOD_DAYS,
  OVERDUE_SURCHARGE_RATE,
  RECONNECTION_FEE,
} from "@/lib/billing";
import { formatPeso } from "@/lib/utils";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

function SettingRow({
  icon: Icon,
  title,
  description,
  children,
}: {
  icon: React.ElementType;
  title: string;
  description: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-3 border-b border-slate-100 py-4 last:border-b-0 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex items-start gap-3">
        <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-slate-100 text-slate-500">
          <Icon className="h-4 w-4" />
        </span>
        <div>
          <p className="text-sm font-medium text-slate-800">{title}</p>
          <p className="text-xs text-slate-500">{description}</p>
        </div>
      </div>
      <div className="shrink-0 sm:w-56">{children}</div>
    </div>
  );
}

export default function SettingsPage() {
  const { role } = useAuth();

  const preferences = usePreferences();
  const [saved, setSaved] = useState(false);
  const [installReset, setInstallReset] = useState(false);

  // Whether this is the installed app is the browser's answer, not ours.
  const installed = useSyncExternalStore(
    (onChange) => {
      const standalone = window.matchMedia("(display-mode: standalone)");
      standalone.addEventListener("change", onChange);
      return () => standalone.removeEventListener("change", onChange);
    },
    () => isRunningInstalled(),
    () => false
  );

  function update(changes: Partial<ConsolePreferences>) {
    updatePreferences(changes);
    setSaved(true);
  }

  function showInstallPageAgain() {
    try {
      window.localStorage.removeItem(SKIP_INSTALL_KEY);
      setInstallReset(true);
    } catch {
      // Storage blocked: the install page will appear again anyway.
    }
  }

  return (
    <div className="max-w-3xl space-y-6">
      <div>
        <h2 className="text-2xl font-bold tracking-tight text-slate-900">Settings</h2>
        <p className="text-sm text-slate-500">
          How this PC uses the console, and the figures the office bills by.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base font-semibold text-slate-800">This PC</CardTitle>
          <CardDescription className="text-xs text-slate-500">
            Saved in this browser, so the counter machine and the office machine can each be set up
            the way they are used. Nothing here changes what anyone else sees.
          </CardDescription>
        </CardHeader>

        <CardContent className="py-0">
          <SettingRow
            icon={ListOrdered}
            title="Rows per page"
            description="How many rows a list shows before paging."
          >
            <Select
              value={String(preferences.rowsPerPage)}
              onValueChange={(v) => v && update({ rowsPerPage: Number(v) })}
            >
              <SelectTrigger className="w-full text-sm">
                <SelectValue>{(value) => `${value} rows`}</SelectValue>
              </SelectTrigger>
              <SelectContent>
                {ROWS_PER_PAGE_OPTIONS.map((option) => (
                  <SelectItem key={option} value={String(option)}>
                    {option} rows
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </SettingRow>

          <SettingRow
            icon={MapPin}
            title="Starting barangay"
            description="Which barangay the Concessionaires page opens on."
          >
            <Select
              value={preferences.startingBarangay || "ask"}
              onValueChange={(v) => v && update({ startingBarangay: v === "ask" ? "" : String(v) })}
            >
              <SelectTrigger className="w-full text-sm">
                <SelectValue>
                  {(value) =>
                    !value || value === "ask"
                      ? "Ask each time"
                      : value === "CG"
                        ? "Cebuano Group"
                        : String(value)
                  }
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="ask">Ask each time</SelectItem>
                {BARANGAYS.map((b) => (
                  <SelectItem key={b} value={b}>
                    {b === "CG" ? "Cebuano Group" : b}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </SettingRow>

          <SettingRow
            icon={MonitorDown}
            title="Install as an app"
            description={
              installed
                ? "This console is already installed on this PC."
                : "Offer the install page again on this PC."
            }
          >
            <Button
              variant="outline"
              className="w-full"
              onClick={showInstallPageAgain}
              disabled={installed || installReset}
            >
              {installReset ? "Will be offered again" : "Show install page"}
            </Button>
          </SettingRow>
        </CardContent>
      </Card>

      {saved && (
        <div className="flex items-start gap-3 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3">
          <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" />
          <p className="text-sm text-emerald-900">
            Saved on this PC, and applied straight away.
          </p>
        </div>
      )}

      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <Receipt className="h-4 w-4 text-slate-400" />
            <CardTitle className="text-base font-semibold text-slate-800">
              What the office bills by
            </CardTitle>
          </div>
          <CardDescription className="text-xs text-slate-500">
            Shown so nobody has to remember them. They are not editable here: changing what a
            household is charged is a Board decision, and it is made in the code so that every
            change to it is recorded and reviewed.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <dl className="grid gap-4 sm:grid-cols-2">
            {[
              { term: "Grace period", detail: `${GRACE_PERIOD_DAYS} days before a bill is late` },
              {
                term: "Late surcharge",
                detail: `${(OVERDUE_SURCHARGE_RATE * 100).toFixed(0)}% once past the grace period`,
              },
              {
                term: "Extension fee",
                detail: `${formatPeso(EXTENSION_FEE)}, once per run of unpaid bills`,
              },
              {
                term: "Disconnection",
                detail: `Eligible after ${DISCONNECTION_ELIGIBLE_DAYS} days unpaid`,
              },
              {
                term: "Reconnection fee",
                detail: `${formatPeso(RECONNECTION_FEE)}, collected before the crew goes out`,
              },
              { term: "Receipt numbers", detail: "Typed from the booklet, never generated" },
            ].map((item) => (
              <div key={item.term} className="rounded-lg border border-slate-200 bg-slate-50 px-4 py-3">
                <dt className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                  {item.term}
                </dt>
                <dd className="mt-0.5 text-sm font-medium text-slate-800">{item.detail}</dd>
              </div>
            ))}
          </dl>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <Info className="h-4 w-4 text-slate-400" />
            <CardTitle className="text-base font-semibold text-slate-800">Your account</CardTitle>
          </div>
        </CardHeader>
        <CardContent className="space-y-2">
          <Link
            href="/profile"
            className="flex items-center gap-2 text-sm font-medium text-sky-700 hover:underline"
          >
            <UserCog className="h-4 w-4" />
            Your name, phone number and password
          </Link>
          {role === "admin" && (
            <Link
              href="/team"
              className="flex items-center gap-2 text-sm font-medium text-sky-700 hover:underline"
            >
              <AlertCircle className="h-4 w-4" />
              Console accounts and roles
            </Link>
          )}
          <Link
            href="/about"
            className="flex items-center gap-2 text-sm font-medium text-sky-700 hover:underline"
          >
            <BadgeInfo className="h-4 w-4" />
            About this console — developer, terms and data privacy
          </Link>
        </CardContent>
      </Card>
    </div>
  );
}
