import { useState } from "react";
import { useRouter } from "next/navigation";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { BARANGAYS, type Concessionaire } from "@/lib/firebase/types";
import { getFullName } from "@/lib/utils";

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
  const [selectedId, setSelectedId] = useState<string>("");

  // Filter out those who already have connectionFeeDetails
  let available = allConcessionaires.filter(c => !c.connectionFeeDetails);
  
  if (barangay !== "all") {
    available = available.filter(c => c.barangay === barangay);
  }

  // Sort alphabetically
  available.sort((a, b) => getFullName(a).localeCompare(getFullName(b)));

  function handleContinue() {
    if (!selectedId) return;
    onOpenChange(false);
    router.push(`/connections/${selectedId}`);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>New Connection</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-4">
          <div className="space-y-2">
            <Label>Filter by Barangay</Label>
            <Select value={barangay} onValueChange={(v) => v && setBarangay(v)}>
              <SelectTrigger>
                <SelectValue placeholder="All Barangays" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Barangays</SelectItem>
                {BARANGAYS.map((b) => (
                  <SelectItem key={b} value={b}>
                    {b === "CG" ? "Cebuano Group" : b}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label>Select Concessionaire</Label>
            <Select value={selectedId} onValueChange={(v) => v && setSelectedId(v)}>
              <SelectTrigger>
                <SelectValue placeholder="Select a concessionaire..." />
              </SelectTrigger>
              <SelectContent>
                {available.length === 0 ? (
                  <div className="p-2 text-sm text-slate-500 text-center">No eligible concessionaires found.</div>
                ) : (
                  available.map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      {getFullName(c)} (Purok {c.purok})
                    </SelectItem>
                  ))
                )}
              </SelectContent>
            </Select>
            <p className="text-xs text-slate-500">Only showing concessionaires without an active connection.</p>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button 
            className="bg-sky-600 hover:bg-sky-700 text-white" 
            onClick={handleContinue}
            disabled={!selectedId}
          >
            Continue
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
