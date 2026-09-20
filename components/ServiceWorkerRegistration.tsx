"use client";

import { useEffect } from "react";

/**
 * Registers the service worker, which is what lets Windows install the console
 * as a desktop app with its own icon.
 *
 * Only in a built app: in development the worker would sit between the browser
 * and the dev server's hot reloading for no benefit.
 */
export function ServiceWorkerRegistration() {
  useEffect(() => {
    if (process.env.NODE_ENV !== "production") return;
    if (!("serviceWorker" in navigator)) return;

    navigator.serviceWorker.register("/sw.js").catch((error) => {
      // Not being installable is a missing convenience, never a broken page.
      console.warn("Couldn't register the service worker", error);
    });
  }, []);

  return null;
}
