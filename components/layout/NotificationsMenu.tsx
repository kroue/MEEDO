"use client";

import { useEffect, useMemo, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { doc, onSnapshot } from "firebase/firestore";
import {
  AlertCircle,
  Banknote,
  Bell,
  CheckCheck,
  CheckCircle2,
  Truck,
  UserPlus,
  WifiOff,
  XCircle,
  type LucideIcon,
} from "lucide-react";
import { db } from "@/lib/firebase/firebase";
import {
  subscribeToApprovalQueue,
  subscribeToMyApprovalRequests,
} from "@/lib/firebase/concessionaires";
import {
  REQUEST_KIND_LABELS,
  subscribeToMyServiceRequests,
  subscribeToServiceRequests,
} from "@/lib/firebase/requests";
import type { Concessionaire, ServiceRequest } from "@/lib/firebase/types";
import { formatPeso } from "@/lib/utils";
import { useAuth } from "@/lib/auth/AuthContext";
import { cn, getFullName } from "@/lib/utils";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

type Tone = "info" | "warning" | "danger" | "success";

interface Notice {
  /**
   * Identity plus version. It changes when what the notice is about changes —
   * a new request joins the queue, say — so that shows as unread again.
   */
  id: string;
  tone: Tone;
  icon: LucideIcon;
  title: string;
  detail?: string;
  href?: string;
  /** A condition that holds right now (being offline), not an event to dismiss. */
  live?: boolean;
}

const TONE_STYLES: Record<Tone, string> = {
  info: "bg-sky-50 text-sky-600",
  warning: "bg-amber-50 text-amber-600",
  danger: "bg-red-50 text-red-600",
  success: "bg-emerald-50 text-emerald-600",
};

/** How long a staff member keeps hearing about a decision on their request. */
const RECENT_DECISION_MS = 14 * 24 * 60 * 60 * 1000;

/** Long enough to ride out a page load, short enough to be told promptly. */
const OFFLINE_GRACE_MS = 4000;

/** Read notices remembered per person; the oldest are dropped past this. */
const MAX_REMEMBERED = 200;

/**
 * Whether the console has lost its connection to the server.
 *
 * A listener opened with includeMetadataChanges shows it indirectly:
 * `fromCache` is true while snapshots come from the local copy because the
 * server can't be reached, and false again once a real response arrives. The
 * grace period keeps a slow first load from flashing an "offline" notice.
 */
function useIsOffline(): boolean {
  const [offline, setOffline] = useState(false);

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    const report = (isOffline: boolean) => {
      if (timer) clearTimeout(timer);
      timer = null;
      if (isOffline) timer = setTimeout(() => setOffline(true), OFFLINE_GRACE_MS);
      else setOffline(false);
    };

    const unsubscribe = onSnapshot(
      doc(db, "settings", "orCounter"),
      { includeMetadataChanges: true },
      (snapshot) => report(snapshot.metadata.fromCache),
      // Only an unreachable server means offline. A refused read is not a
      // connection problem, and saying so would send people chasing their wifi.
      (error) => report(error.code === "unavailable")
    );

    return () => {
      if (timer) clearTimeout(timer);
      unsubscribe();
    };
  }, []);

  return offline;
}

/** Order-independent short fingerprint of a set of ids. */
function fingerprint(ids: string[]): string {
  let hash = 5381;
  for (const id of [...ids].sort()) {
    for (let i = 0; i < id.length; i++) hash = ((hash * 33) ^ id.charCodeAt(i)) >>> 0;
    hash = ((hash * 33) ^ 44) >>> 0;
  }
  return `${ids.length}.${hash.toString(36)}`;
}

function accountName(c: Concessionaire): string {
  return getFullName(c) || c.meterNumber || "Unnamed account";
}

function summarizeNames(accounts: Concessionaire[]): string {
  const names = accounts.map(accountName);
  if (names.length <= 2) return names.join(" and ");
  return `${names.slice(0, 2).join(", ")} and ${names.length - 2} more`;
}

function loadReadIds(key: string): string[] {
  try {
    const parsed: unknown = JSON.parse(window.localStorage.getItem(key) ?? "[]");
    return Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === "string") : [];
  } catch {
    return [];
  }
}

function saveReadIds(key: string, ids: string[]) {
  try {
    window.localStorage.setItem(key, JSON.stringify(ids));
  } catch {
    // Storage blocked or full: notices just show as unread again next visit.
  }
}

export function NotificationsMenu({
  disconnectionEligible,
}: {
  /** Accounts unpaid long enough to disconnect — already loaded by the navbar. */
  disconnectionEligible: Concessionaire[];
}) {
  const { user, role } = useAuth();
  const router = useRouter();
  const pathname = usePathname();
  const email = user?.email ?? "";
  const isAdmin = role === "admin";
  const offline = useIsOffline();

  // Admins hear about requests waiting on them; staff about what became of
  // their own. Both come from the same approval fields. Results are tagged with
  // the subscription they came from, so one person's list never shows for another.
  const approvalSource = isAdmin ? "queue" : role === "staff" && email ? `mine:${email}` : null;
  const [approvalResult, setApprovalResult] = useState<{ source: string; accounts: Concessionaire[] }>({
    source: "",
    accounts: [],
  });
  useEffect(() => {
    if (!approvalSource) return;
    const onData = (accounts: Concessionaire[]) => setApprovalResult({ source: approvalSource, accounts });
    const onError = (error: Error) => {
      console.warn("Couldn't load approval notifications", error);
      onData([]);
    };
    return approvalSource === "queue"
      ? subscribeToApprovalQueue(onData, onError)
      : subscribeToMyApprovalRequests(email, onData, onError);
  }, [approvalSource, email]);
  const approvalAccounts = useMemo(
    () => (approvalResult.source === approvalSource ? approvalResult.accounts : []),
    [approvalResult, approvalSource]
  );

  // The same split for payments, connection setups and reconnections: an
  // admin sees the queue, a staff member sees what became of their own.
  const [requestResult, setRequestResult] = useState<{ source: string; requests: ServiceRequest[] }>({
    source: "",
    requests: [],
  });
  useEffect(() => {
    if (!approvalSource) return;
    const onData = (requests: ServiceRequest[]) =>
      setRequestResult({ source: approvalSource, requests });
    const onError = (error: Error) => {
      console.warn("Couldn't load request notifications", error);
      onData([]);
    };
    return approvalSource === "queue"
      ? subscribeToServiceRequests(onData, onError)
      : subscribeToMyServiceRequests(email, onData, onError);
  }, [approvalSource, email]);
  const serviceRequests = useMemo(
    () => (requestResult.source === approvalSource ? requestResult.requests : []),
    [requestResult, approvalSource]
  );

  const [loadedAt] = useState(() => Date.now());

  const notices = useMemo<Notice[]>(() => {
    const list: Notice[] = [];

    if (offline) {
      list.push({
        id: "offline",
        live: true,
        tone: "warning",
        icon: WifiOff,
        title: "You're offline",
        detail:
          "Showing the last data loaded. Payments, bills and other changes won't save until the connection is back.",
      });
    }

    if (isAdmin) {
      const pending = approvalAccounts
        .filter((a) => a.approvalStatus === "PENDING")
        .sort((a, b) => (b.approvalRequestedAt ?? "").localeCompare(a.approvalRequestedAt ?? ""));
      if (pending.length > 0) {
        list.push({
          id: `approvals:${fingerprint(pending.map((a) => a.id))}`,
          tone: "info",
          icon: UserPlus,
          title:
            pending.length === 1
              ? "1 new account is waiting for your approval"
              : `${pending.length} new accounts are waiting for your approval`,
          detail: summarizeNames(pending),
          href: "/approvals",
        });
      }

      const waiting = serviceRequests.filter((r) => r.status === "PENDING");
      if (waiting.length > 0) {
        const byKind = new Map<string, number>();
        waiting.forEach((r) =>
          byKind.set(REQUEST_KIND_LABELS[r.kind], (byKind.get(REQUEST_KIND_LABELS[r.kind]) ?? 0) + 1)
        );
        const money = waiting.reduce((sum, r) => sum + (r.amount ?? 0), 0);
        list.push({
          id: `requests:${fingerprint(waiting.map((r) => r.id))}`,
          tone: "warning",
          icon: Banknote,
          title:
            waiting.length === 1
              ? "1 request is waiting for your approval"
              : `${waiting.length} requests are waiting for your approval`,
          detail:
            [...byKind.entries()].map(([label, count]) => `${count} × ${label.toLowerCase()}`).join(", ") +
            (money > 0 ? ` · ${formatPeso(money)} not yet posted` : ""),
          href: "/approvals",
        });
      }

      const crewsOut = serviceRequests.filter(
        (r) => r.status === "APPROVED" && r.kind === "RECONNECTION"
      );
      if (crewsOut.length > 0) {
        list.push({
          id: `reconnections:${fingerprint(crewsOut.map((r) => r.id))}`,
          tone: "info",
          icon: Truck,
          title:
            crewsOut.length === 1
              ? "1 reconnection is waiting to be confirmed"
              : `${crewsOut.length} reconnections are waiting to be confirmed`,
          detail: "Mark the account connected once the water is back on.",
          href: "/approvals",
        });
      }

      if (disconnectionEligible.length > 0) {
        const n = disconnectionEligible.length;
        list.push({
          id: `disconnection:${fingerprint(disconnectionEligible.map((c) => c.id))}`,
          tone: "danger",
          icon: AlertCircle,
          title: n === 1 ? "1 account is eligible for disconnection" : `${n} accounts are eligible for disconnection`,
          detail: "Unpaid for more than 20 days. Open the delinquency report to review them.",
          href: "/reports#delinquency",
        });
      }
    } else {
      const cutoff = loadedAt - RECENT_DECISION_MS;
      approvalAccounts
        .filter(
          (a) =>
            (a.approvalStatus === "APPROVED" || a.approvalStatus === "REJECTED") &&
            !!a.approvalReviewedAt &&
            Date.parse(a.approvalReviewedAt) >= cutoff
        )
        .sort((a, b) => (b.approvalReviewedAt ?? "").localeCompare(a.approvalReviewedAt ?? ""))
        .slice(0, 10)
        .forEach((a) => {
          if (a.approvalStatus === "APPROVED") {
            list.push({
              id: `approved:${a.id}:${a.approvalReviewedAt}`,
              tone: "success",
              icon: CheckCircle2,
              title: `${accountName(a)} was approved`,
              detail: "The account is now active and can be billed.",
              href: `/concessionaires/${a.id}`,
            });
          } else {
            list.push({
              id: `rejected:${a.id}:${a.approvalReviewedAt}`,
              tone: "danger",
              icon: XCircle,
              title: `${accountName(a)} wasn't approved`,
              detail: a.approvalRejectionReason ? `Reason: ${a.approvalRejectionReason}` : undefined,
              href: "/approvals",
            });
          }
        });

      serviceRequests
        .filter((r) => {
          const decidedAt = r.completedAt ?? r.reviewedAt;
          return (
            (r.status === "COMPLETED" || r.status === "REJECTED") &&
            !!decidedAt &&
            Date.parse(decidedAt) >= cutoff
          );
        })
        .sort((a, b) =>
          (b.completedAt ?? b.reviewedAt ?? "").localeCompare(a.completedAt ?? a.reviewedAt ?? "")
        )
        .slice(0, 10)
        .forEach((r) => {
          const what = `${REQUEST_KIND_LABELS[r.kind]}${r.amount ? ` — ${formatPeso(r.amount)}` : ""}`;
          const decidedAt = r.completedAt ?? r.reviewedAt;
          if (r.status === "COMPLETED") {
            list.push({
              id: `request-done:${r.id}:${decidedAt}`,
              tone: "success",
              icon: CheckCircle2,
              title: `${what} was approved`,
              detail: r.outcome ?? `${r.concessionaireName} · posted to the account.`,
              href: "/approvals",
            });
          } else {
            list.push({
              id: `request-rejected:${r.id}:${decidedAt}`,
              tone: "danger",
              icon: XCircle,
              title: `${what} wasn't approved`,
              detail: r.rejectionReason
                ? `${r.concessionaireName} · ${r.rejectionReason}`
                : r.concessionaireName,
              href: "/approvals",
            });
          }
        });
    }

    return list;
  }, [offline, isAdmin, approvalAccounts, serviceRequests, disconnectionEligible, loadedAt]);

  // ── Read state ──────────────────────────────────────────────────────────
  const storageKey = user ? `meedo:notifications-read:${user.uid}` : null;
  // What this person has already seen: read from storage until they open the
  // menu, then held in state (and saved) from that point on.
  const [savedRead, setSavedRead] = useState<{ key: string; ids: string[] } | null>(null);
  const readIds =
    savedRead && savedRead.key === storageKey ? savedRead.ids : storageKey ? loadReadIds(storageKey) : [];

  const unread = notices.filter((n) => n.live || !readIds.includes(n.id));

  // What was new when the menu was opened stays marked while it's open, even
  // though opening it is what marks everything read.
  const [newWhenOpened, setNewWhenOpened] = useState<string[]>([]);

  function handleOpenChange(open: boolean) {
    if (!open) return;
    setNewWhenOpened(unread.map((n) => n.id));
    const seen = notices.filter((n) => !n.live).map((n) => n.id);
    const next = [...readIds.filter((id) => !seen.includes(id)), ...seen].slice(-MAX_REMEMBERED);
    if (!storageKey) return;
    setSavedRead({ key: storageKey, ids: next });
    saveReadIds(storageKey, next);
  }

  function openNotice(href: string) {
    const [path, hash] = href.split("#");
    // A same-page hash link through the router fires no hashchange, so the
    // page already open would never notice; setting the hash directly does.
    if (hash && path === pathname) window.location.hash = hash;
    else router.push(href);
  }

  const badge = unread.length;

  return (
    <DropdownMenu onOpenChange={handleOpenChange}>
      <DropdownMenuTrigger
        aria-label={badge > 0 ? `Notifications, ${badge} new` : "Notifications"}
        className="relative rounded-md border border-slate-800 bg-slate-900 p-2 text-slate-400 transition-colors hover:bg-slate-800 hover:text-slate-200 interactive-hover outline-none focus-visible:ring-1 focus-visible:ring-sky-500 data-popup-open:bg-slate-800 data-popup-open:text-slate-200"
      >
        <Bell className="h-4 w-4" />
        {badge > 0 && (
          <span className="absolute -right-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full border border-slate-900 bg-red-500 px-1 text-[9px] font-bold text-white">
            {badge > 9 ? "9+" : badge}
          </span>
        )}
      </DropdownMenuTrigger>

      <DropdownMenuContent
        align="end"
        sideOffset={8}
        className="w-80 overflow-hidden rounded-xl border border-slate-200 bg-white p-0 shadow-lg"
      >
        <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3">
          <p className="text-sm font-semibold text-slate-900">Notifications</p>
          {notices.length > 0 && (
            <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-slate-600">
              {notices.length}
            </span>
          )}
        </div>

        {notices.length === 0 ? (
          <div className="flex flex-col items-center gap-1.5 px-6 py-10 text-center">
            <CheckCheck className="mb-1 h-6 w-6 text-emerald-500" />
            <p className="text-sm font-medium text-slate-700">You&apos;re all caught up</p>
            <p className="text-xs text-slate-500">Nothing needs your attention right now.</p>
          </div>
        ) : (
          <div className="max-h-[26rem] overflow-y-auto p-1.5">
            {notices.map((notice) => {
              const body = <NoticeBody notice={notice} isNew={newWhenOpened.includes(notice.id)} />;
              const href = notice.href;
              return href ? (
                <DropdownMenuItem
                  key={notice.id}
                  onClick={() => openNotice(href)}
                  className="cursor-pointer items-start gap-3 rounded-lg px-2.5 py-2.5 focus:bg-slate-50"
                >
                  {body}
                </DropdownMenuItem>
              ) : (
                <div key={notice.id} className="flex items-start gap-3 rounded-lg px-2.5 py-2.5">
                  {body}
                </div>
              );
            })}
          </div>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function NoticeBody({ notice, isNew }: { notice: Notice; isNew: boolean }) {
  const Icon = notice.icon;
  return (
    <>
      <span
        className={cn(
          "mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full",
          TONE_STYLES[notice.tone]
        )}
      >
        <Icon className="size-3.5" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-[13px] font-medium leading-snug text-slate-900">{notice.title}</span>
        {notice.detail && (
          <span className="mt-0.5 block text-xs leading-snug text-slate-500">{notice.detail}</span>
        )}
      </span>
      {isNew && <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-sky-500" aria-label="New" />}
    </>
  );
}
