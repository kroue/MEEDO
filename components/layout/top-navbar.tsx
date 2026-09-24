"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useConcessionaires } from "@/lib/firebase/useConcessionaires";
import { currentMonthStr, isConcessionaireDisconnectionEligible, isPendingSync } from "@/lib/billing";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  CloudOff,
  Settings,
  LogOut,
  User,
} from "lucide-react";
import { useAuth } from "@/lib/auth/AuthContext";
import { displayNameFor, logout } from "@/lib/firebase/auth";
import { personName, subscribeToOwnProfile } from "@/lib/firebase/users";
import { NotificationsMenu } from "@/components/layout/NotificationsMenu";

function initialsFor(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

export function TopNavbar() {
  const { user, role } = useAuth();
  const router = useRouter();
  // The same shared, live list every page reads (concessionairesStore.ts), so
  // these badges cost nothing on top of the page and are never out of date.
  // It used to be a separate full download on every load, re-run every two
  // minutes, to avoid holding a second live listener next to the page's own.
  const { concessionaires } = useConcessionaires("all");

  // The name on the person's own record, read live so an edit on the Profile
  // page shows here at once. Until it arrives — or if the record has no name —
  // the email stands in.
  const [profile, setProfile] = useState<{ uid: string; name: string } | null>(null);
  const uid = user?.uid;
  useEffect(() => {
    if (!uid) return;
    return subscribeToOwnProfile(
      uid,
      (p) => setProfile({ uid, name: p ? personName(p) : "" }),
      () => setProfile({ uid, name: "" })
    );
  }, [uid]);
  const profileName = profile && profile.uid === uid ? profile.name : "";
  const name = profileName || (user ? displayNameFor(user) : "");
  const email = user?.email ?? "";

  const monthStr = useMemo(() => currentMonthStr(), []);

  const pendingSyncCount = useMemo(
    () => concessionaires.filter((c) => isPendingSync(c, monthStr)).length,
    [concessionaires, monthStr]
  );

  const disconnectionEligible = useMemo(
    () => concessionaires.filter(isConcessionaireDisconnectionEligible),
    [concessionaires]
  );

  async function handleLogOut() {
    await logout();
    // A full page load, not router.replace: signing out shuts down the
    // database client (see clearLocalRecords), and nothing from this session
    // should stay in memory for whoever uses the PC next.
    window.location.replace("/login");
  }

  return (
    <header className="sticky top-0 z-20 flex h-16 items-center justify-between border-b border-slate-800 bg-slate-950 px-6 shadow-sm">
      {/* Left side — page context */}
      <div className="flex items-center gap-4">
        <span className="text-[11px] font-semibold text-slate-400 uppercase tracking-widest">
          Water District Management
        </span>
      </div>

      {/* Right side — status badges + user */}
      <div className="flex items-center gap-4">
        {/* Pending mobile reads — assigned to a reader this month, not yet billed */}
        <Tooltip>
          <TooltipTrigger
            onClick={() => router.push("/sync")}
            className="flex items-center gap-2 rounded-md border border-slate-800 bg-slate-900 px-2.5 py-1.5 transition-all hover:bg-slate-800 interactive-hover"
          >
            <CloudOff className="h-3.5 w-3.5 text-slate-400" />
            <span className="text-[11px] font-medium text-slate-300">
              Sync Queue
            </span>
            <Badge
              variant="secondary"
              className="bg-amber-500/20 text-amber-400 hover:bg-amber-500/30 border-transparent text-[10px] px-1.5 py-0 font-medium"
            >
              {pendingSyncCount} Pending
            </Badge>
          </TooltipTrigger>
          <TooltipContent className="bg-white border-slate-200 text-slate-900 shadow-md">
            <p>
              {pendingSyncCount} concessionaire(s) assigned for reading in {monthStr}, not yet synced back
            </p>
          </TooltipContent>
        </Tooltip>

        <NotificationsMenu disconnectionEligible={disconnectionEligible} />

        <div className="h-6 w-px bg-slate-800 mx-1" />

        {/* User Profile Dropdown */}
        <DropdownMenu>
          <DropdownMenuTrigger className="flex items-center gap-2.5 rounded-md border border-slate-800 bg-slate-900 py-1.5 pl-1.5 pr-3 transition-colors hover:bg-slate-800 interactive-hover outline-none focus-visible:ring-1 focus-visible:ring-sky-500">
            <Avatar className="h-7 w-7 border border-slate-700">
              <AvatarFallback className="bg-sky-500/20 text-[11px] font-bold text-sky-400">
                {initialsFor(name || "?")}
              </AvatarFallback>
            </Avatar>
            <div className="text-left">
              <p className="text-[12px] font-semibold text-slate-200">
                {name}
              </p>
              <p className="text-[10px] font-medium text-slate-400 uppercase">{role ?? "Admin"}</p>
            </div>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-48 bg-white border-slate-200 shadow-md rounded-xl">
            {/* Base UI requires a label to sit inside the group it names. */}
            <DropdownMenuGroup>
              <DropdownMenuLabel className="text-xs text-slate-600">
                {email || "My Account"}
              </DropdownMenuLabel>
              <DropdownMenuSeparator className="bg-slate-100" />
              <DropdownMenuItem
                onClick={() => router.push("/profile")}
                className="text-xs text-slate-900 focus:bg-slate-50 focus:text-slate-900 cursor-pointer"
              >
                <User className="mr-2 h-3.5 w-3.5" />
                Profile
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={() => router.push("/settings")}
                className="text-xs text-slate-900 focus:bg-slate-50 focus:text-slate-900 cursor-pointer"
              >
                <Settings className="mr-2 h-3.5 w-3.5" />
                Settings
              </DropdownMenuItem>
            </DropdownMenuGroup>
            <DropdownMenuSeparator className="bg-slate-100" />
            <DropdownMenuItem
              onClick={handleLogOut}
              className="text-xs text-red-600 focus:bg-red-50 focus:text-red-700 cursor-pointer"
            >
              <LogOut className="mr-2 h-3.5 w-3.5" />
              Log Out
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>

        {/* Always-visible Log Out — not just tucked in the dropdown */}
        <Tooltip>
          <TooltipTrigger
            onClick={handleLogOut}
            className="rounded-md border border-slate-800 bg-slate-900 p-2 text-slate-400 transition-colors hover:bg-red-950 hover:text-red-400 interactive-hover"
          >
            <LogOut className="h-4 w-4" />
          </TooltipTrigger>
          <TooltipContent className="bg-white border-slate-200 text-slate-900 shadow-md">
            <p>Log Out</p>
          </TooltipContent>
        </Tooltip>
      </div>
    </header>
  );
}
