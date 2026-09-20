"use client";

import { userMessage } from "@/lib/userMessage";
import { useEffect, useMemo, useState, type FormEvent } from "react";
import { useConcessionaires } from "@/lib/firebase/useConcessionaires";
import { batchAssignConcessionairesForReading } from "@/lib/firebase/concessionaires";
import {
  subscribeToFieldReaderUsers,
  setAssignedBarangays,
  updateFieldReaderDetails,
  type FieldReaderUser,
} from "@/lib/firebase/users";
import {
  createFieldReaderAccount,
  setAccountDisabled,
  resetAccountPassword,
  MIN_PASSWORD_LENGTH,
} from "@/lib/firebase/createFieldReader";
import { ACCOUNT_CAPABILITIES } from "@/lib/firebase/accountBackend";
import { currentMonthStr as billingMonthStr, isAccountApproved } from "@/lib/billing";
import { useAuth } from "@/lib/auth/AuthContext";
import { BARANGAYS } from "@/lib/firebase/types";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertCircle,
  RefreshCw,
  CheckCircle2,
  Smartphone,
  X,
  Plus,
  Users,
  UserPlus,
  Loader2,
  Pencil,
  Phone,
  KeyRound,
} from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";

export default function SyncPage() {
  const { user } = useAuth();
  const actorEmail = user?.email ?? "unknown";
  const { concessionaires, loading, error } = useConcessionaires("all");
  const [readers, setReaders] = useState<FieldReaderUser[]>([]);
  const [readersLoaded, setReadersLoaded] = useState(false);
  const [busyReaderUid, setBusyReaderUid] = useState<string | null>(null);

  const [createOpen, setCreateOpen] = useState(false);
  const [newUsername, setNewUsername] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [newPasswordConfirm, setNewPasswordConfirm] = useState("");
  const [newFirstName, setNewFirstName] = useState("");
  const [newLastName, setNewLastName] = useState("");
  const [newPhoneNumber, setNewPhoneNumber] = useState("");
  const [createError, setCreateError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  const [editingReader, setEditingReader] = useState<FieldReaderUser | null>(null);
  const [editFirstName, setEditFirstName] = useState("");
  const [editLastName, setEditLastName] = useState("");
  const [editPhoneNumber, setEditPhoneNumber] = useState("");
  const [editError, setEditError] = useState<string | null>(null);
  const [editSaving, setEditSaving] = useState(false);

  // Assign/recall failures used to surface as a browser alert() pointing the
  // user at the developer console; every other page here uses a real Alert.
  const [actionError, setActionError] = useState<string | null>(null);

  // Password reset — field readers sign in with synthetic @meedo.local
  // addresses, which can't receive Firebase's reset email, so a forgotten
  // password previously meant abandoning the account and making a new one.
  const [resetTarget, setResetTarget] = useState<FieldReaderUser | null>(null);
  const [resetPassword, setResetPassword] = useState("");
  const [resetConfirm, setResetConfirm] = useState("");
  const [resetError, setResetError] = useState<string | null>(null);
  const [resetting, setResetting] = useState(false);

  useEffect(() => {
    const unsubscribe = subscribeToFieldReaderUsers(
      (users) => {
        setReaders(users);
        setReadersLoaded(true);
      },
      (err) => console.error("Failed to subscribe to field reader users", err)
    );
    return unsubscribe;
  }, []);

  const resetCreateForm = () => {
    setNewUsername("");
    setNewPassword("");
    setNewPasswordConfirm("");
    setNewFirstName("");
    setNewLastName("");
    setNewPhoneNumber("");
    setCreateError(null);
  };

  const handleCreateReader = async (e: FormEvent) => {
    e.preventDefault();
    setCreateError(null);

    if (!newFirstName.trim() || !newLastName.trim()) {
      setCreateError("First and last name are required.");
      return;
    }
    if (newPassword.length < MIN_PASSWORD_LENGTH) {
      setCreateError(`Password must be at least ${MIN_PASSWORD_LENGTH} characters.`);
      return;
    }
    if (newPassword !== newPasswordConfirm) {
      setCreateError("Passwords don't match.");
      return;
    }

    setCreating(true);
    try {
      await createFieldReaderAccount(
        newUsername,
        newPassword,
        newFirstName,
        newLastName,
        newPhoneNumber,
        actorEmail
      );
      resetCreateForm();
      setCreateOpen(false);
    } catch (err) {
      setCreateError(userMessage(err, "Failed to create account."));
    } finally {
      setCreating(false);
    }
  };

  const openEditDialog = (reader: FieldReaderUser) => {
    setEditingReader(reader);
    setEditFirstName(reader.firstName);
    setEditLastName(reader.lastName);
    setEditPhoneNumber(reader.phoneNumber);
    setEditError(null);
  };

  const handleSaveReaderDetails = async (e: FormEvent) => {
    e.preventDefault();
    if (!editingReader) return;
    setEditError(null);

    if (!editFirstName.trim() || !editLastName.trim()) {
      setEditError("First and last name are required.");
      return;
    }

    setEditSaving(true);
    try {
      await updateFieldReaderDetails(
        editingReader.uid,
        {
          firstName: editFirstName.trim(),
          lastName: editLastName.trim(),
          phoneNumber: editPhoneNumber.trim(),
        },
        actorEmail
      );
      setEditingReader(null);
    } catch (err) {
      setEditError(userMessage(err, "Failed to update details."));
    } finally {
      setEditSaving(false);
    }
  };

  const displayNameFor = (reader: FieldReaderUser) => {
    const full = `${reader.firstName} ${reader.lastName}`.trim();
    return full || reader.username;
  };

  // e.g. "AUG 2026". Built from a fixed month table via lib/billing, NOT from
  // toLocaleString("default", ...) — that follows the browser's locale, and
  // several locales abbreviate September as "Sept". The phone always queries
  // Locale.US ("SEP 2026"), so a en-GB browser would assign "SEPT 2026" and
  // the reader would download an empty route, with no error on either side.
  const currentMonthStr = useMemo(() => billingMonthStr(), []);

  const statsByBarangay = useMemo(() => {
    const stats = BARANGAYS.map((b) => ({
      barangay: b,
      totalConnected: 0,
      missingReading: 0,
      assigned: 0,
      unassignedIds: [] as string[],
    }));

    if (concessionaires) {
      concessionaires.forEach((c) => {
        // An account awaiting approval must never reach a reader's route.
        if (c.status === "CONNECTED" && isAccountApproved(c)) {
          const stat = stats.find((s) => s.barangay === c.barangay);
          if (stat) {
            stat.totalConnected++;
            const hasReading =
              c.billingSummary?.latestBill?.month === currentMonthStr ||
              (c.billingHistory ?? []).some((h) => h.month === currentMonthStr);
            if (!hasReading) {
              stat.missingReading++;
              if (c.assignedForReading === currentMonthStr) {
                stat.assigned++;
              } else {
                stat.unassignedIds.push(c.id);
              }
            }
          }
        }
      });
    }

    return stats;
  }, [concessionaires, currentMonthStr]);

  // Which field reader(s) currently have each Barangay assigned to them.
  const readersByBarangay = useMemo(() => {
    const map = new Map<string, FieldReaderUser[]>();
    readers.forEach((reader) => {
      reader.assignedBarangays.forEach((b) => {
        map.set(b, [...(map.get(b) ?? []), reader]);
      });
    });
    return map;
  }, [readers]);

  const handleToggleDisabled = async (reader: FieldReaderUser) => {
    setBusyReaderUid(reader.uid);
    setActionError(null);
    try {
      await setAccountDisabled(reader.uid, !reader.disabled);
    } catch (e) {
      setActionError(userMessage(e, "Failed to update the account."));
    } finally {
      setBusyReaderUid(null);
    }
  };

  const handleResetPassword = async (e: FormEvent) => {
    e.preventDefault();
    if (!resetTarget) return;
    setResetError(null);

    if (resetPassword.length < MIN_PASSWORD_LENGTH) {
      setResetError(`Password must be at least ${MIN_PASSWORD_LENGTH} characters.`);
      return;
    }
    if (resetPassword !== resetConfirm) {
      setResetError("Passwords don't match.");
      return;
    }

    setResetting(true);
    try {
      await resetAccountPassword(resetTarget.uid, resetPassword);
      setResetTarget(null);
      setResetPassword("");
      setResetConfirm("");
    } catch (err) {
      setResetError(userMessage(err, "Failed to reset the password."));
    } finally {
      setResetting(false);
    }
  };

  const handleAddBarangay = async (reader: FieldReaderUser, barangay: string) => {
    setBusyReaderUid(reader.uid);
    setActionError(null);
    try {
      const stat = statsByBarangay.find((s) => s.barangay === barangay);
      if (stat && stat.unassignedIds.length > 0) {
        await batchAssignConcessionairesForReading(stat.unassignedIds, currentMonthStr, actorEmail);
      }
      const nextBarangays = [...reader.assignedBarangays, barangay];
      await setAssignedBarangays(reader.uid, nextBarangays, currentMonthStr, actorEmail);
    } catch (e) {
      console.error(e);
      setActionError(
        `Failed to assign Barangay: ${userMessage(e)}`
      );
    } finally {
      setBusyReaderUid(null);
    }
  };

  const handleRemoveBarangay = async (reader: FieldReaderUser, barangay: string) => {
    setBusyReaderUid(reader.uid);
    try {
      const nextBarangays = reader.assignedBarangays.filter((b) => b !== barangay);
      await setAssignedBarangays(reader.uid, nextBarangays, currentMonthStr, actorEmail);
    } catch (e) {
      console.error(e);
      setActionError(
        `Failed to recall Barangay: ${userMessage(e)}`
      );
    } finally {
      setBusyReaderUid(null);
    }
  };

  return (
    <div className="container mx-auto p-4 space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Mobile Sync</h1>
          <p className="text-muted-foreground">
            Assign Barangays to field readers for the current billing month:{" "}
            <strong>{currentMonthStr}</strong>. Each reader can be handed
            multiple Barangays and chooses which one to work on first from
            their device.
          </p>
        </div>
        <Button onClick={() => setCreateOpen(true)} className="shrink-0">
          <UserPlus className="h-4 w-4 mr-2" />
          Create Field Reader
        </Button>
        <Dialog
          open={createOpen}
          onOpenChange={(v) => {
            setCreateOpen(v);
            if (!v) resetCreateForm();
          }}
        >
          <DialogContent className="sm:max-w-sm">
            <DialogHeader>
              <DialogTitle>Create Field Reader Account</DialogTitle>
              <DialogDescription>
                The reader signs into the mobile app with this username and
                password — no email needed.
              </DialogDescription>
            </DialogHeader>
            <form onSubmit={handleCreateReader} className="space-y-4">
              {createError && (
                <Alert variant="destructive">
                  <AlertCircle className="h-4 w-4" />
                  <AlertDescription>{createError}</AlertDescription>
                </Alert>
              )}
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label htmlFor="new-first-name">First Name</Label>
                  <Input
                    id="new-first-name"
                    autoComplete="off"
                    required
                    value={newFirstName}
                    onChange={(e) => setNewFirstName(e.target.value)}
                    placeholder="Juan"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="new-last-name">Last Name</Label>
                  <Input
                    id="new-last-name"
                    autoComplete="off"
                    required
                    value={newLastName}
                    onChange={(e) => setNewLastName(e.target.value)}
                    placeholder="Dela Cruz"
                  />
                </div>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="new-phone">Phone Number</Label>
                <Input
                  id="new-phone"
                  type="tel"
                  autoComplete="off"
                  value={newPhoneNumber}
                  onChange={(e) => setNewPhoneNumber(e.target.value)}
                  placeholder="09XX XXX XXXX"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="new-username">Username</Label>
                <Input
                  id="new-username"
                  autoComplete="off"
                  required
                  value={newUsername}
                  onChange={(e) => setNewUsername(e.target.value)}
                  placeholder="jdelacruz"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="new-password">Password</Label>
                <Input
                  id="new-password"
                  type="password"
                  autoComplete="new-password"
                  required
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  placeholder={`At least ${MIN_PASSWORD_LENGTH} characters`}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="new-password-confirm">Confirm Password</Label>
                <Input
                  id="new-password-confirm"
                  type="password"
                  autoComplete="new-password"
                  required
                  value={newPasswordConfirm}
                  onChange={(e) => setNewPasswordConfirm(e.target.value)}
                />
              </div>
              <DialogFooter>
                <Button type="submit" disabled={creating} className="w-full">
                  {creating ? (
                    <>
                      <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                      Creating...
                    </>
                  ) : (
                    "Create Account"
                  )}
                </Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>
      </div>

      <Dialog
        open={editingReader !== null}
        onOpenChange={(v) => !v && setEditingReader(null)}
      >
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Edit Field Reader</DialogTitle>
            <DialogDescription>
              Updates this reader&apos;s name and phone number. Username and password aren&apos;t changed here.
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={handleSaveReaderDetails} className="space-y-4">
            {editError && (
              <Alert variant="destructive">
                <AlertCircle className="h-4 w-4" />
                <AlertDescription>{editError}</AlertDescription>
              </Alert>
            )}
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="edit-first-name">First Name</Label>
                <Input
                  id="edit-first-name"
                  autoComplete="off"
                  required
                  value={editFirstName}
                  onChange={(e) => setEditFirstName(e.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="edit-last-name">Last Name</Label>
                <Input
                  id="edit-last-name"
                  autoComplete="off"
                  required
                  value={editLastName}
                  onChange={(e) => setEditLastName(e.target.value)}
                />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="edit-phone">Phone Number</Label>
              <Input
                id="edit-phone"
                type="tel"
                autoComplete="off"
                value={editPhoneNumber}
                onChange={(e) => setEditPhoneNumber(e.target.value)}
                placeholder="09XX XXX XXXX"
              />
            </div>
            <DialogFooter>
              <Button type="submit" disabled={editSaving} className="w-full">
                {editSaving ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    Saving...
                  </>
                ) : (
                  "Save Changes"
                )}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog
        open={resetTarget !== null}
        onOpenChange={(v) => !v && setResetTarget(null)}
      >
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Reset password</DialogTitle>
            <DialogDescription>
              Sets a new password for {resetTarget ? displayNameFor(resetTarget) : ""}. Field
              readers sign in with a username, not an email, so they can&apos;t use a
              self-service reset link — an admin has to set it here. Signing them out of any
              device they&apos;re currently on is part of the reset.
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={handleResetPassword} className="space-y-4">
            {resetError && (
              <Alert variant="destructive">
                <AlertCircle className="h-4 w-4" />
                <AlertDescription>{resetError}</AlertDescription>
              </Alert>
            )}
            <div className="space-y-1.5">
              <Label htmlFor="reset-password">New Password</Label>
              <Input
                id="reset-password"
                type="password"
                autoComplete="new-password"
                required
                value={resetPassword}
                onChange={(e) => setResetPassword(e.target.value)}
                placeholder={`At least ${MIN_PASSWORD_LENGTH} characters`}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="reset-password-confirm">Confirm New Password</Label>
              <Input
                id="reset-password-confirm"
                type="password"
                autoComplete="new-password"
                required
                value={resetConfirm}
                onChange={(e) => setResetConfirm(e.target.value)}
              />
            </div>
            <DialogFooter>
              <Button type="submit" disabled={resetting} className="w-full">
                {resetting ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    Saving...
                  </>
                ) : (
                  "Set New Password"
                )}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {error && (
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertTitle>Error</AlertTitle>
          <AlertDescription>{userMessage(error)}</AlertDescription>
        </Alert>
      )}

      {actionError && (
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertTitle>Action failed</AlertTitle>
          <AlertDescription>{actionError}</AlertDescription>
        </Alert>
      )}

      <div>
        <h2 className="mb-3 flex items-center gap-2 text-lg font-semibold">
          <Users className="h-5 w-5 text-muted-foreground" />
          Field Readers
        </h2>

        {readersLoaded && readers.length === 0 && (
          <Alert>
            <Smartphone className="h-4 w-4" />
            <AlertTitle>No field reader accounts yet</AlertTitle>
            <AlertDescription>
              Use &quot;Create Field Reader&quot; above to set one up before
              you can assign Barangays here.
            </AlertDescription>
          </Alert>
        )}

        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {readers.map((reader) => {
            const availableBarangays = BARANGAYS.filter(
              (b) => !reader.assignedBarangays.includes(b)
            );
            const isBusy = busyReaderUid === reader.uid;

            return (
              <Card key={reader.uid}>
                <CardHeader className="pb-2">
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex items-center gap-3 min-w-0">
                      <Smartphone className="h-5 w-5 text-muted-foreground shrink-0" />
                      <div className="min-w-0">
                        <CardTitle className="text-base truncate">{displayNameFor(reader)}</CardTitle>
                        <p className="text-xs text-muted-foreground truncate">@{reader.username}</p>
                      </div>
                    </div>
                    <div className="flex items-center gap-0.5 shrink-0">
                      {/* A reader signs in with a username, so there is no
                          address a reset link could go to — setting the
                          password directly needs the Admin SDK, i.e. the
                          account-management Cloud Functions. Without them the
                          honest answer is to create the account again, so the
                          control is hidden rather than offered and then
                          failing. */}
                      {ACCOUNT_CAPABILITIES.canSetPasswordDirectly && (
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7"
                          onClick={() => {
                            setResetTarget(reader);
                            setResetPassword("");
                            setResetConfirm("");
                            setResetError(null);
                          }}
                          aria-label={`Reset password for ${displayNameFor(reader)}`}
                          title="Reset password"
                        >
                          <KeyRound className="h-3.5 w-3.5" />
                        </Button>
                      )}
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7"
                        onClick={() => openEditDialog(reader)}
                        aria-label={`Edit ${displayNameFor(reader)}`}
                        title="Edit details"
                      >
                        <Pencil className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </div>
                  {reader.disabled && (
                    <Badge
                      variant="secondary"
                      className="w-fit bg-red-50 text-red-700 border-red-200 text-[10px]"
                    >
                      ACCOUNT DISABLED
                    </Badge>
                  )}
                  {reader.phoneNumber && (
                    <p className="flex items-center gap-1 text-xs text-muted-foreground">
                      <Phone className="h-3 w-3" />
                      {reader.phoneNumber}
                    </p>
                  )}
                  <CardDescription>
                    {reader.assignedBarangays.length > 0
                      ? `${reader.assignedBarangays.length} Barangay(s) assigned`
                      : "No Barangays assigned yet"}
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-3">
                  {/* Revocation. Recalling a Barangay only empties the route —
                      it does not take away the account's credentials or its
                      access to concessionaire records. Disabling does, and it
                      revokes existing refresh tokens so an already-signed-in
                      phone stops working rather than running on its session. */}
                  <Button
                    variant={reader.disabled ? "outline" : "ghost"}
                    size="sm"
                    disabled={isBusy}
                    onClick={() => handleToggleDisabled(reader)}
                    className={
                      reader.disabled
                        ? "h-7 w-full text-xs font-semibold"
                        : "h-7 w-full text-xs font-semibold text-red-600 hover:text-red-700 hover:bg-red-50"
                    }
                  >
                    {reader.disabled ? "Re-enable account" : "Revoke access (lost phone)"}
                  </Button>

                  <div className="flex flex-wrap gap-2">
                    {reader.assignedBarangays.length === 0 && (
                      <span className="text-sm text-muted-foreground">—</span>
                    )}
                    {reader.assignedBarangays.map((b) => (
                      <Badge
                        key={b}
                        className="flex items-center gap-1 bg-blue-600 pr-1"
                      >
                        {b}
                        <button
                          type="button"
                          onClick={() => handleRemoveBarangay(reader, b)}
                          disabled={isBusy}
                          className="ml-1 rounded-full p-0.5 hover:bg-black/20"
                          aria-label={`Recall ${b} from ${reader.username}`}
                        >
                          <X className="h-3 w-3" />
                        </button>
                      </Badge>
                    ))}
                  </div>

                  {availableBarangays.length > 0 && (
                    <Select
                      value={null}
                      onValueChange={(v) => v && handleAddBarangay(reader, v)}
                      disabled={isBusy}
                    >
                      <SelectTrigger className="w-full text-sm">
                        {isBusy ? (
                          <RefreshCw className="h-4 w-4 animate-spin" />
                        ) : (
                          <>
                            <Plus className="h-4 w-4" />
                            <SelectValue placeholder="Assign a Barangay" />
                          </>
                        )}
                      </SelectTrigger>
                      <SelectContent>
                        {availableBarangays.map((b) => (
                          <SelectItem key={b} value={b}>
                            {b}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  )}
                </CardContent>
              </Card>
            );
          })}
        </div>
      </div>

      <div>
        <h2 className="mb-3 text-lg font-semibold">Reading Progress</h2>
        {loading ? (
          <div className="flex justify-center items-center h-32">
            <RefreshCw className="h-8 w-8 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {statsByBarangay.map((stat) => {
              const isAllRead =
                stat.totalConnected > 0 && stat.missingReading === 0;
              const assignedReaders = readersByBarangay.get(stat.barangay) ?? [];

              return (
                <Card key={stat.barangay} className="flex flex-col">
                  <CardHeader className="pb-2">
                    <div className="flex justify-between items-start">
                      <CardTitle>{stat.barangay}</CardTitle>
                      {isAllRead ? (
                        <Badge className="bg-green-600">All Read</Badge>
                      ) : (
                        <Badge variant="outline">
                          {stat.totalConnected} Connected
                        </Badge>
                      )}
                    </div>
                    <CardDescription>
                      {assignedReaders.length > 0 ? (
                        <span className="flex items-center gap-1 text-blue-500">
                          <CheckCircle2 className="h-3.5 w-3.5" />
                          {assignedReaders.map(displayNameFor).join(", ")}
                        </span>
                      ) : (
                        "Not assigned to any reader"
                      )}
                    </CardDescription>
                  </CardHeader>
                  <CardContent>
                    <div className="space-y-3">
                      <div className="flex justify-between items-center text-sm">
                        <span className="text-muted-foreground">
                          No reading yet ({currentMonthStr})
                        </span>
                        <span className="font-semibold text-lg text-orange-500">
                          {stat.missingReading}
                        </span>
                      </div>

                      <div className="flex justify-between items-center text-sm">
                        <span className="text-muted-foreground">
                          Assigned for Reading
                        </span>
                        <span className="font-semibold text-lg text-blue-500">
                          {stat.assigned}
                        </span>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
