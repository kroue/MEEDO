"use client";

import { useEffect, useMemo, useState } from "react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import {
  Search,
  ShieldCheck,
  Lock,
  CreditCard,
  RefreshCw,
  UserCog,
  LogIn,
  Server,
  AlertCircle,
} from "lucide-react";
import {
  subscribeToAuditLogs,
  AUDIT_ACTION_TYPES,
  type AuditActionType,
  type AuditLogEntry,
} from "@/lib/firebase/auditLog";

const actionTypeConfig: Record<AuditActionType, { icon: React.ElementType; className: string }> = {
  Payment: {
    icon: CreditCard,
    className: "bg-emerald-50 text-emerald-700 border-emerald-200",
  },
  "Account Update": {
    icon: UserCog,
    className: "bg-violet-50 text-violet-700 border-violet-200",
  },
  "Data Sync": {
    icon: RefreshCw,
    className: "bg-blue-50 text-blue-700 border-blue-200",
  },
  Login: {
    icon: LogIn,
    className: "bg-slate-100 text-slate-700 border-slate-200",
  },
  System: {
    icon: Server,
    className: "bg-slate-100 text-slate-600 border-slate-200",
  },
};

function formatTimestamp(d: Date | null) {
  if (!d) return "—";
  return d.toLocaleString("en-PH", {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: true,
  });
}

export default function AuditPage() {
  const [logs, setLogs] = useState<AuditLogEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);
  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState<string>("all");

  useEffect(() => {
    const unsubscribe = subscribeToAuditLogs(
      (entries) => {
        setLogs(entries);
        setLoading(false);
      },
      (err) => {
        setError(err);
        setLoading(false);
      }
    );
    return unsubscribe;
  }, []);

  const filteredLogs = useMemo(() => {
    const q = search.trim().toLowerCase();
    return logs.filter((log) => {
      const matchesSearch =
        q === "" ||
        log.description.toLowerCase().includes(q) ||
        log.user.toLowerCase().includes(q);
      const matchesType = typeFilter === "all" || log.actionType === typeFilter;
      return matchesSearch && matchesType;
    });
  }, [logs, search, typeFilter]);

  const actionTypeCounts = useMemo(
    () =>
      logs.reduce<Record<string, number>>((acc, log) => {
        acc[log.actionType] = (acc[log.actionType] || 0) + 1;
        return acc;
      }, {}),
    [logs]
  );

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold tracking-tight text-slate-900">
            Audit Logs
          </h2>
          <p className="text-sm text-slate-500">
            Real, append-only log of admin actions — account changes, payments, sync, and logins.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1.5 rounded-full border border-slate-200 bg-slate-50 px-3 py-1.5">
            <Lock className="h-3.5 w-3.5 text-slate-500" />
            <span className="text-[10px] font-medium text-slate-500 uppercase tracking-wider">
              Read-Only
            </span>
          </div>
          <div className="flex items-center gap-1.5 rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1.5">
            <ShieldCheck className="h-3.5 w-3.5 text-emerald-600" />
            <span className="text-[10px] font-medium text-emerald-700 uppercase tracking-wider">
              Live
            </span>
          </div>
        </div>
      </div>

      {error && (
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertTitle>Error</AlertTitle>
          <AlertDescription>{error.message}</AlertDescription>
        </Alert>
      )}

      {/* Stats Cards */}
      <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-5">
        {AUDIT_ACTION_TYPES.map((type) => {
          const config = actionTypeConfig[type];
          return (
            <Card key={type} className="border-slate-200">
              <CardContent className="flex items-center gap-2 pt-4 pb-3 px-3">
                <config.icon className="h-4 w-4 text-slate-400 shrink-0" />
                <div className="min-w-0">
                  <p className="text-lg font-bold text-slate-800">{actionTypeCounts[type] || 0}</p>
                  <p className="text-[10px] text-slate-400 truncate">{type}</p>
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>

      {/* Search & Filter */}
      <Card>
        <CardContent className="pt-6">
          <div className="flex flex-col gap-3 sm:flex-row">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <Input
                placeholder="Search by description or user..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-9 text-sm"
              />
            </div>
            <Select value={typeFilter} onValueChange={(v) => setTypeFilter(v ?? "all")}>
              <SelectTrigger className="w-full sm:w-[200px] text-sm">
                <SelectValue placeholder="Filter by action type" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Action Types</SelectItem>
                {AUDIT_ACTION_TYPES.map((type) => (
                  <SelectItem key={type} value={type}>
                    {type}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      {/* Audit Log Table */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="text-base font-semibold text-slate-800">
                Event Log
              </CardTitle>
              <CardDescription className="text-xs text-slate-500">
                Newest first — every entry corresponds to a real write made from this console.
              </CardDescription>
            </div>
            <Badge
              variant="secondary"
              className="bg-slate-100 text-slate-600 border-slate-200 text-[10px]"
            >
              {filteredLogs.length} of {logs.length} events
            </Badge>
          </div>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="flex justify-center items-center h-32">
              <RefreshCw className="h-8 w-8 animate-spin text-muted-foreground" />
            </div>
          ) : filteredLogs.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-center">
              <ShieldCheck className="h-10 w-10 text-slate-300 mb-3" />
              <p className="text-sm font-medium text-slate-500">No events yet</p>
              <p className="text-xs text-slate-400 mt-1">
                Events appear here as admins create accounts, record payments, assign readers, and sign in.
              </p>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead className="text-[11px] font-semibold uppercase tracking-wider text-slate-500 w-[200px]">
                    Timestamp
                  </TableHead>
                  <TableHead className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                    User
                  </TableHead>
                  <TableHead className="text-[11px] font-semibold uppercase tracking-wider text-slate-500 w-[160px]">
                    Action Type
                  </TableHead>
                  <TableHead className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                    Description
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredLogs.map((log) => {
                  const config = actionTypeConfig[log.actionType];
                  const ActionIcon = config.icon;
                  return (
                    <TableRow key={log.id} className="group">
                      <TableCell className="text-xs font-mono text-slate-500 whitespace-nowrap">
                        {formatTimestamp(log.timestamp)}
                      </TableCell>
                      <TableCell>
                        <p className="text-sm font-medium text-slate-700">{log.user}</p>
                      </TableCell>
                      <TableCell>
                        <Badge variant="secondary" className={`${config.className} text-[10px]`}>
                          <ActionIcon className="mr-1 h-3 w-3" />
                          {log.actionType}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-xs text-slate-600 max-w-[400px]">
                        {log.description}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
