"use client";

/**
 * components/InstallGate.tsx
 *
 * Sends someone opening the console in a browser tab to the install page once,
 * so office PCs end up with the app in the Start menu rather than a bookmark
 * nobody can find.
 *
 * It stays out of the way where it would only be a nuisance:
 *
 *  - in development, and on localhost generally, so the console opens straight
 *    up while it is being worked on;
 *  - once the app is running installed, which is the whole point of it;
 *  - after someone has chosen to carry on in the browser, since not every
 *    machine can install and nobody should be stuck in a loop over it.
 */

import { useEffect } from "react";
import { usePathname, useRouter } from "next/navigation";

export const INSTALL_ROUTE = "/install";
/** Set when someone chooses the browser; remembered on that machine. */
export const SKIP_INSTALL_KEY = "meedo:skip-install";

/** Already running as an installed app rather than in a browser tab. */
export function isRunningInstalled(): boolean {
  if (typeof window === "undefined") return false;
  return (
    window.matchMedia("(display-mode: standalone)").matches ||
    window.matchMedia("(display-mode: window-controls-overlay)").matches ||
    // iOS Safari predates display-mode and reports it here instead.
    (window.navigator as Navigator & { standalone?: boolean }).standalone === true
  );
}

function isLocal(hostname: string): boolean {
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "[::1]";
}

export function InstallGate() {
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    if (process.env.NODE_ENV !== "production") return;
    if (pathname === INSTALL_ROUTE) return;
    if (isLocal(window.location.hostname)) return;
    if (isRunningInstalled()) return;

    try {
      if (window.localStorage.getItem(SKIP_INSTALL_KEY) === "1") return;
    } catch {
      // Storage blocked: better to show the page again than to trap anyone.
    }

    router.replace(INSTALL_ROUTE);
  }, [pathname, router]);

  return null;
}
