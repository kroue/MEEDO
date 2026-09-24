import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Search } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { BARANGAYS, type Concessionaire } from "@/lib/firebase/types";
import { cn, getFullName } from "@/lib/utils";
import { isAccountApproved } from "@/lib/billing";

/** Rendering thousands of rows to scroll through is what the search replaces. */
const RESULTS_SHOWN = 50;

export function NewConnectionDialog({
  open,
  onOpenChange,
  allConcessionaires,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  allConcessionaires: Concessionaire[];
}) {
  const router = useRouter();
  const [barangay, setBarangay] = useState<string>("all");
  const [search, setSearch] = useState("");
  const [selectedId, setSelectedId] = useState<string>("");

  // Only accounts without a connection yet — and nothing happens on an
  // account an admin hasn't approved.
  const eligible = useMemo(
    () =>
      allConcessionaires
        .filter((c) => !c.connectionFeeDetails && isAccountApproved(c))
        .sort((a, b) => getFullName(a).localeCompare(getFullName(b))),
    [allConcessionaires]
  );

  // Every word typed has to appear somewhere — name, meter number, account
  // number or purok — so "dela cruz 3" finds the Dela Cruz in Purok 3.
  const matches = useMemo(() => {
    const words = search.toLowerCase().split(/\s+/).filter(Boolean);
    return eligible.filter((c) => {
      if (barangay !== "all" && c.barangay !== barangay) return false;
      if (words.length === 0) return true;
      const haystack = [getFullName(c), c.meterNumber, c.accountNumber, c.purok && `purok ${c.purok}`]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      return words.every((w) => haystack.includes(w));
    });
  }, [eligible, barangay, search]);

  function close(next: boolean) {
    if (!next) {
      setSearch("");
      setSelectedId("");
      setBarangay("all");
    }
    onOpenChange(next);
  }

  function goTo(id: string) {
    close(false);
    router.push(`/connections/${id}`);
  }

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>New Connection</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div className="grid gap-3 sm:grid-cols-[1fr_170px]">
            <div className="space-y-1.5">
              <Label htmlFor="new-connection-search">Search</Label>
              <div className="relative">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                <Input
                  id="new-connection-search"
                  autoFocus
                  value={search}
                  onChange={(e) => {
                    setSearch(e.target.value);
                    setSelectedId("");
                  }}
                  onKeyDown={(e) => {
                    // Enter goes straight in when the search has narrowed it to one.
                    if (e.key === "Enter" && (selectedId || matches.length === 1)) {
                      e.preventDefault();
                      goTo(selectedId || matches[0].id);
                    }
                  }}
                  placeholder="Name, meter no. or account no."
                  className="pl-9"
                  autoComplete="off"
                />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label>Barangay</Label>
              <Select
                value={barangay}
                onValueChange={(v) => {
                  if (!v) return;
                  setBarangay(v);
                  setSelectedId("");
                }}
              >
                <SelectTrigger>
                  <SelectValue>
                    {(value) => (!value || value === "all" ? "All barangays" : value === "CG" ? "Cebuano Group" : String(value))}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All barangays</SelectItem>
                  {BARANGAYS.map((b) => (
                    <SelectItem key={b} value={b}>
                      {b === "CG" ? "Cebuano Group" : b}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div
            role="listbox"
            aria-label="Concessionaires without a connection"
            className="max-h-72 overflow-y-auto rounded-lg border border-slate-200"
          >
            {matches.length === 0 ? (
              <p className="p-4 text-center text-sm text-slate-500">
                {eligible.length === 0
                  ? "Every approved concessionaire already has a connection."
                  : "No concessionaire without a connection matches that."}
              </p>
            ) : (
              matches.slice(0, RESULTS_SHOWN).map((c) => (
                <button
                  key={c.id}
                  type="button"
                  role="option"
                  aria-selected={selectedId === c.id}
                  onClick={() => setSelectedId(c.id)}
                  onDoubleClick={() => goTo(c.id)}
                  className={cn(
                    "flex w-full items-center justify-between gap-3 border-b border-slate-100 px-3 py-2 text-left last:border-b-0 hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-sky-500",
                    selectedId === c.id && "bg-sky-50 hover:bg-sky-50"
                  )}
                >
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-medium text-slate-900">{getFullName(c)}</span>
                    <span className="block text-xs text-slate-500">
                      {c.barangay === "CG" ? "Cebuano Group" : c.barangay}
                      {c.purok ? ` · Purok ${c.purok}` : ""}
                    </span>
                  </span>
                  <span className="shrink-0 font-mono text-xs text-slate-500">{c.meterNumber}</span>
                </button>
              ))
            )}
          </div>
          <p className="text-xs text-slate-500">
            {matches.length > RESULTS_SHOWN
              ? `Showing ${RESULTS_SHOWN} of ${matches.length.toLocaleString()} — keep typing to narrow it down.`
              : `${matches.length.toLocaleString()} without a connection yet.`}
          </p>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => close(false)}>
            Cancel
          </Button>
          <Button
            className="bg-sky-600 hover:bg-sky-700 text-white"
            onClick={() => selectedId && goTo(selectedId)}
            disabled={!selectedId}
          >
            Continue
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
