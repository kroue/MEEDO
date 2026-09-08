"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import { useAuth } from "@/lib/auth/AuthContext";
import {
  LayoutDashboard,
  CreditCard,
  BarChart3,
  ShieldCheck,
  Database,
  FileUp,
  Plug,
  Smartphone,
  Receipt,
  Users,
} from "lucide-react";

const navItems = [
  { href: "/", label: "Dashboard", icon: LayoutDashboard, adminOnly: true },
  { href: "/concessionaires", label: "Concessionaires", icon: Database, adminOnly: false },
  { href: "/connections", label: "Connections", icon: Plug, adminOnly: false },
  { href: "/sync", label: "Mobile Sync", icon: Smartphone, adminOnly: true },
  { href: "/billing", label: "Billing", icon: Receipt, adminOnly: false },
  { href: "/import", label: "Import XLSX", icon: FileUp, adminOnly: true },
  { href: "/collections", label: "Collection Module", icon: CreditCard, adminOnly: false },
  { href: "/reports", label: "Reports & Analytics", icon: BarChart3, adminOnly: true },
  { href: "/audit", label: "Audit Logs", icon: ShieldCheck, adminOnly: true },
  { href: "/team", label: "Team", icon: Users, adminOnly: true },
  { href: "/migrate", label: "Storage Migration", icon: Database, adminOnly: true },
];

export function Sidebar() {
  const pathname = usePathname();
  const { role } = useAuth();
  const visibleNavItems = navItems.filter((item) => !item.adminOnly || role === "admin");

  return (
    <aside className="fixed inset-y-0 left-0 z-30 flex w-64 flex-col border-r border-slate-800 bg-slate-950">
      {/* Brand */}
      <div className="flex h-16 items-center gap-3 border-b border-slate-800 px-6 bg-slate-950/50">
        <Image
          src="/logo.png"
          alt="South Wao Water System"
          width={36}
          height={36}
          className="shrink-0 rounded-full"
        />
        <div>
          <h1 className="text-[13px] font-bold tracking-tight text-white uppercase">
            MEEDO
          </h1>
          <p className="text-[10px] font-medium tracking-widest text-sky-400 uppercase">
            Admin Console
          </p>
        </div>
      </div>

      {/* Navigation */}
      <nav className="flex-1 space-y-1.5 overflow-y-auto px-4 py-6">
        {visibleNavItems.map((item) => {
          const isActive =
            item.href === "/"
              ? pathname === "/"
              : pathname.startsWith(item.href);

          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                "group flex items-center gap-3 rounded-md px-3 py-2.5 text-[13px] font-medium transition-all duration-200 ease-snappy outline-none focus-visible:ring-1 focus-visible:ring-sky-500 interactive-hover",
                isActive
                  ? "bg-sky-500/15 text-sky-400 border border-sky-500/20 shadow-sm"
                  : "border border-transparent text-slate-400 hover:bg-slate-800/80 hover:text-slate-200 hover:border-slate-700/50"
              )}
            >
              <item.icon
                className={cn(
                  "h-[16px] w-[16px] shrink-0 transition-colors duration-200",
                  isActive
                    ? "text-sky-400"
                    : "text-slate-500 group-hover:text-slate-300"
                )}
              />
              {item.label}
            </Link>
          );
        })}
      </nav>

      {/* Footer */}
      <div className="border-t border-slate-800 px-5 py-4 bg-slate-950/50">
        <div className="flex items-center justify-between">
          <p className="text-[10px] font-medium text-slate-500">
            © 2026 MEEDO
          </p>
          <p className="text-[9px] font-medium text-sky-400 border border-sky-500/30 px-1.5 py-0.5 rounded bg-sky-500/10">v2.4.1</p>
        </div>
      </div>
    </aside>
  );
}
