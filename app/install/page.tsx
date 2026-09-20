"use client";

/**
 * Where a browser tab lands: install the console as an app on this PC.
 *
 * Edge and Chrome offer the install themselves through `beforeinstallprompt`,
 * which is captured here so the button does it in one click. Browsers that
 * don't — Firefox, and locked-down machines — get the manual route and, either
 * way, the door out: nobody is kept from the console because their PC can't
 * install it.
 */

import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { CheckCircle2, Download, ExternalLink, Info, MonitorDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { INSTALL_ROUTE, SKIP_INSTALL_KEY, isRunningInstalled } from "@/components/InstallGate";

/** The event Edge and Chrome fire when a site qualifies for installation. */
interface InstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

const REASONS = [
  "Opens in its own window, with the MEEDO icon on the desktop and in the Start menu.",
  "No address bar to mistype, and no hunting for a bookmark.",
  "Updates by itself — there is no installer to re-run when the console changes.",
];

export default function InstallPage() {
  const router = useRouter();
  const [promptEvent, setPromptEvent] = useState<InstallPromptEvent | null>(null);
  const [busy, setBusy] = useState(false);
  // The tab that did the installing stays a tab, so "installed" has to be
  // remembered as well as read from the browser.
  const [justInstalled, setJustInstalled] = useState(false);

  const subscribeToDisplayMode = useCallback((onChange: () => void) => {
    const standalone = window.matchMedia("(display-mode: standalone)");
    standalone.addEventListener("change", onChange);
    return () => standalone.removeEventListener("change", onChange);
  }, []);
  const runningInstalled = useSyncExternalStore(
    subscribeToDisplayMode,
    () => isRunningInstalled(),
    () => false
  );
  const installed = runningInstalled || justInstalled;

  useEffect(() => {
    const onBeforeInstall = (event: Event) => {
      // Keep the browser's own bar from appearing; the button below does it.
      event.preventDefault();
      setPromptEvent(event as InstallPromptEvent);
    };
    const onInstalled = () => setJustInstalled(true);

    window.addEventListener("beforeinstallprompt", onBeforeInstall);
    window.addEventListener("appinstalled", onInstalled);
    return () => {
      window.removeEventListener("beforeinstallprompt", onBeforeInstall);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, []);

  async function install() {
    if (!promptEvent) return;
    setBusy(true);
    try {
      await promptEvent.prompt();
      const { outcome } = await promptEvent.userChoice;
      if (outcome === "accepted") setJustInstalled(true);
      // A browser only offers each captured prompt once.
      setPromptEvent(null);
    } finally {
      setBusy(false);
    }
  }

  function continueInBrowser() {
    try {
      window.localStorage.setItem(SKIP_INSTALL_KEY, "1");
    } catch {
      // Without storage this page shows again next time, which is survivable.
    }
    router.replace("/");
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-950 p-6">
      <div className="w-full max-w-lg rounded-2xl border border-slate-800 bg-slate-900 p-8 shadow-xl">
        <div className="flex items-center gap-4">
          <Image src="/logo.png" alt="" width={56} height={56} className="rounded-full" priority />
          <div>
            <h1 className="text-lg font-bold text-white">MEEDO Admin Console</h1>
            <p className="text-xs font-medium uppercase tracking-widest text-sky-400">
              South Wao Water System
            </p>
          </div>
        </div>

        {installed ? (
          <div className="mt-8 space-y-6">
            <div className="flex items-start gap-3 rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-4">
              <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-emerald-400" />
              <div>
                <p className="text-sm font-semibold text-emerald-300">Installed on this PC</p>
                <p className="mt-0.5 text-xs text-emerald-200/80">
                  Open it from the desktop icon or the Start menu next time.
                </p>
              </div>
            </div>
            <Button
              onClick={() => router.replace("/")}
              className="h-11 w-full bg-sky-600 text-white hover:bg-sky-700"
            >
              Open the console
            </Button>
          </div>
        ) : (
          <div className="mt-8 space-y-6">
            <div>
              <h2 className="text-sm font-semibold text-slate-200">Install it on this PC</h2>
              <ul className="mt-3 space-y-2">
                {REASONS.map((reason) => (
                  <li key={reason} className="flex items-start gap-2.5 text-xs text-slate-400">
                    <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-sky-400" />
                    {reason}
                  </li>
                ))}
              </ul>
            </div>

            {promptEvent ? (
              <Button
                onClick={install}
                disabled={busy}
                className="h-11 w-full bg-sky-600 text-white hover:bg-sky-700"
              >
                <Download className="mr-2 h-4 w-4" />
                {busy ? "Installing…" : "Install MEEDO Admin"}
              </Button>
            ) : (
              <div className="rounded-xl border border-slate-800 bg-slate-950/60 p-4">
                <div className="flex items-center gap-2 text-xs font-semibold text-slate-300">
                  <MonitorDown className="h-4 w-4 text-sky-400" />
                  Install it from the browser menu
                </div>
                <ol className="mt-3 space-y-2 text-xs text-slate-400">
                  <li className="flex gap-2">
                    <span className="font-mono text-slate-500">1.</span>
                    <span>
                      In <strong className="text-slate-300">Microsoft Edge</strong>, open the{" "}
                      <strong className="text-slate-300">⋯</strong> menu at the top right.
                    </span>
                  </li>
                  <li className="flex gap-2">
                    <span className="font-mono text-slate-500">2.</span>
                    <span>
                      Choose <strong className="text-slate-300">Apps</strong> →{" "}
                      <strong className="text-slate-300">Install this site as an app</strong>. In
                      Chrome it is <strong className="text-slate-300">Cast, save and share</strong> →{" "}
                      <strong className="text-slate-300">Install page as app</strong>.
                    </span>
                  </li>
                  <li className="flex gap-2">
                    <span className="font-mono text-slate-500">3.</span>
                    <span>
                      Name it <strong className="text-slate-300">MEEDO Admin</strong> and tick{" "}
                      <strong className="text-slate-300">Pin to taskbar</strong> if offered.
                    </span>
                  </li>
                </ol>
                <p className="mt-3 flex items-start gap-2 text-[11px] text-slate-500">
                  <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                  Firefox cannot install web apps. Use Edge or Chrome on office PCs, or carry on in
                  the browser below.
                </p>
              </div>
            )}

            <div className="border-t border-slate-800 pt-4">
              <button
                type="button"
                onClick={continueInBrowser}
                className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-400 transition-colors hover:text-slate-200"
              >
                <ExternalLink className="h-3.5 w-3.5" />
                Continue in the browser instead
              </button>
              <p className="mt-1 text-[11px] text-slate-600">
                This PC won&apos;t be asked again. The console works the same either way.
              </p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
