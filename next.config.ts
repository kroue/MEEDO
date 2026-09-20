import type { NextConfig } from "next";

// Firebase Auth/Firestore + optional Firebase/Google Analytics endpoints this
// app actually talks to from the browser. next/font/google self-hosts fonts
// at build time, so no external font host needs to be allowlisted.
//
// 'unsafe-eval' is only added in development: Next's Fast Refresh/HMR
// runtime uses eval() to inject hot-reloaded modules, which a strict CSP
// otherwise blocks with "Uncaught EvalError". The production bundle never
// calls eval(), so the deployed app stays without 'unsafe-eval'.
const isDev = process.env.NODE_ENV === "development";

const CSP = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline'${isDev ? " 'unsafe-eval'" : ""} https://www.googletagmanager.com https://www.google-analytics.com`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: https://www.google-analytics.com",
  "font-src 'self' data:",
  "connect-src 'self' https://*.googleapis.com https://*.firebaseio.com wss://*.firebaseio.com https://www.google-analytics.com https://*.google-analytics.com",
  "frame-src 'self' https://*.firebaseapp.com",
  // The service worker that makes the console installable, and the manifest
  // that describes it. Both fall back to default-src, but browsers differ in
  // how they resolve that fallback for workers, so they are stated outright.
  "worker-src 'self'",
  "manifest-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'self'",
].join("; ");

const nextConfig: NextConfig = {
  async headers() {
    return [
      {
        // Applies to every route in the app.
        source: "/:path*",
        headers: [
          { key: "Content-Security-Policy", value: CSP },
          { key: "X-Frame-Options", value: "SAMEORIGIN" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          {
            key: "Permissions-Policy",
            value: "camera=(), microphone=(), geolocation=()",
          },
        ],
      },
    ];
  },
};

export default nextConfig;
