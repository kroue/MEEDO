import type { Metadata, Viewport } from "next";
import { Inter } from "next/font/google";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AppShell } from "@/components/layout/app-shell";
import { ServiceWorkerRegistration } from "@/components/ServiceWorkerRegistration";
import { InstallGate } from "@/components/InstallGate";
import "./globals.css";

const inter = Inter({
  variable: "--font-sans",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "MEEDO Admin Console — South Wao Water System",
  description:
    "Admin console for South Wao Water System (MEEDO): billing, collections, connections, and field operations.",
  // Named for the window title and the Start-menu entry once installed.
  applicationName: "MEEDO Admin",
  appleWebApp: { capable: true, title: "MEEDO Admin", statusBarStyle: "black-translucent" },
};

export const viewport: Viewport = {
  // Matches the console's header, so the installed window's title bar is the
  // same colour as the app rather than browser grey.
  themeColor: "#020617",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={`${inter.variable} h-full antialiased`}>
      {/* suppressHydrationWarning: browser extensions like Grammarly inject
          attributes (data-gr-ext-installed, etc.) into <body> before React
          hydrates, which would otherwise always trip a hydration mismatch
          here that has nothing to do with this app's own rendering. */}
      <body
        className="min-h-full bg-slate-50 font-sans text-slate-900 selection:bg-sky-500/20"
        suppressHydrationWarning
      >
        <TooltipProvider>
          <AppShell>{children}</AppShell>
        </TooltipProvider>
        <ServiceWorkerRegistration />
        <InstallGate />
      </body>
    </html>
  );
}
