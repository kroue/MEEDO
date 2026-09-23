"use client";

import { useEffect } from "react";
import { usePathname, useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { AuthProvider, useAuth } from "@/lib/auth/AuthContext";
import { Sidebar } from "@/components/layout/sidebar";
import { TopNavbar } from "@/components/layout/top-navbar";
import { PrintHost } from "@/components/print/PrintHost";

const PUBLIC_ROUTES = ["/login"];

// Rendered on its own, outside the console: it is what a browser tab lands
// on, and it has to work whether or not anyone is signed in.
const STANDALONE_ROUTES = ["/install"];

// Routes only the "admin" role can reach — everything else (concessionaire
// lookup, connections, billing, collections) is available to "staff" too.
// See sidebar.tsx for the matching nav-item filter.
const ADMIN_ONLY_ROUTES = ["/", "/sync", "/import", "/reports", "/audit", "/team"];

function isAdminOnlyRoute(pathname: string): boolean {
  if (pathname === "/") return true;
  return ADMIN_ONLY_ROUTES.some((route) => route !== "/" && pathname.startsWith(route));
}

/** Where a role lands right after login, or gets bounced to if it strays onto an admin-only route. */
function landingPageFor(role: string | null): string {
  return role === "admin" ? "/" : "/concessionaires";
}

function AuthGate({ children }: { children: React.ReactNode }) {
  const { user, role, loading } = useAuth();
  const pathname = usePathname();
  const router = useRouter();
  const isStandaloneRoute = STANDALONE_ROUTES.includes(pathname);
  const isPublicRoute = PUBLIC_ROUTES.includes(pathname);
  const staffOnAdminRoute = role === "staff" && isAdminOnlyRoute(pathname);

  useEffect(() => {
    if (loading || isStandaloneRoute) return;
    if (!user && !isPublicRoute) {
      router.replace("/login");
    } else if (user && isPublicRoute) {
      router.replace(landingPageFor(role));
    } else if (user && staffOnAdminRoute) {
      router.replace(landingPageFor(role));
    }
  }, [user, role, loading, isPublicRoute, isStandaloneRoute, staffOnAdminRoute, router]);

  // Before anything else: this page is the same signed in or out.
  if (isStandaloneRoute) return <>{children}</>;

  // Still resolving the initial auth state — avoid flashing protected content.
  if (loading) {
    return (
      <div className="flex h-screen items-center justify-center bg-slate-950">
        <Loader2 className="h-6 w-6 animate-spin text-sky-400" />
      </div>
    );
  }

  // A redirect is about to happen (effect above) — render nothing meanwhile.
  if ((!user && !isPublicRoute) || (user && isPublicRoute) || (user && staffOnAdminRoute)) {
    return null;
  }

  if (isPublicRoute) {
    return <>{children}</>;
  }

  return (
    <div className="flex h-screen overflow-hidden print:h-auto print:overflow-visible print:block">
      <div className="print:hidden">
        <Sidebar />
      </div>
      <div className="flex flex-1 flex-col pl-64 print:pl-0 bg-[radial-gradient(ellipse_at_top_right,_var(--tw-gradient-stops))] from-sky-100/60 via-slate-50/80 to-blue-100/40 print:bg-none print:bg-white print:block">
        <div className="print:hidden">
          <TopNavbar />
        </div>
        <main className="flex-1 overflow-y-auto p-6 md:p-8 print:p-0 print:overflow-visible">
          {children}
        </main>
      </div>
      <PrintHost />
    </div>
  );
}

/** Wraps every route: provides auth state, and gates access to everything except /login. */
export function AppShell({ children }: { children: React.ReactNode }) {
  return (
    <AuthProvider>
      <AuthGate>{children}</AuthGate>
    </AuthProvider>
  );
}
