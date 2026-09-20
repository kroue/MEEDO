"use client";

import { userMessage } from "@/lib/userMessage";
import { useEffect, useState, type FormEvent } from "react";
import {
  subscribeToConsoleUsers,
  updateConsoleUserDetails,
  type ConsoleUser,
} from "@/lib/firebase/users";
import { createConsoleUserAccount, MIN_PASSWORD_LENGTH } from "@/lib/firebase/createConsoleUser";
import {
  setAccountDisabled,
  resetAccountPassword,
  sendPasswordResetLink,
} from "@/lib/firebase/createFieldReader";
import { ACCOUNT_CAPABILITIES } from "@/lib/firebase/accountBackend";
import { useAuth } from "@/lib/auth/AuthContext";
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
  UserPlus,
  Loader2,
  Pencil,
  ShieldCheck,
  User,
  KeyRound,
} from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Pagination, usePagination } from "@/components/ui/pagination";

const ROLE_BADGE_STYLES: Record<"admin" | "staff", string> = {
  admin: "bg-sky-50 text-sky-700 border-sky-200",
  staff: "bg-slate-100 text-slate-600 border-slate-200",
};

export default function TeamPage() {
  const { user, role: myRole } = useAuth();
  const actorEmail = user?.email ?? "unknown";

  const [users, setUsers] = useState<ConsoleUser[]>([]);
  const pagedUsers = usePagination(users);
  const [loaded, setLoaded] = useState(false);

  const [createOpen, setCreateOpen] = useState(false);
  const [newEmail, setNewEmail] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [newPasswordConfirm, setNewPasswordConfirm] = useState("");
  const [newFirstName, setNewFirstName] = useState("");
  const [newLastName, setNewLastName] = useState("");
  const [newRole, setNewRole] = useState<"admin" | "staff">("staff");
  const [createError, setCreateError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  const [editingUser, setEditingUser] = useState<ConsoleUser | null>(null);
  const [editFirstName, setEditFirstName] = useState("");
  const [editLastName, setEditLastName] = useState("");
  const [editRole, setEditRole] = useState<"admin" | "staff">("staff");
  const [editError, setEditError] = useState<string | null>(null);
  const [editSaving, setEditSaving] = useState(false);

  const myUid = user?.uid ?? "";
  const [busyUid, setBusyUid] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  // Password reset in place. Console accounts do have real email addresses,
  // but an admin resetting a colleague's password directly is faster than a
  // reset email round trip, and it revokes existing sessions at the same time.
  const [resetTarget, setResetTarget] = useState<ConsoleUser | null>(null);
  const [resetPassword, setResetPassword] = useState("");
  const [resetConfirm, setResetConfirm] = useState("");
  const [resetError, setResetError] = useState<string | null>(null);
  const [resetting, setResetting] = useState(false);

  useEffect(() => {
    const unsubscribe = subscribeToConsoleUsers(
      (list) => {
        setUsers(list);
        setLoaded(true);
      },
      (err) => console.error("Failed to subscribe to console users", err)
    );
    return unsubscribe;
  }, []);

  const resetCreateForm = () => {
    setNewEmail("");
    setNewPassword("");
    setNewPasswordConfirm("");
    setNewFirstName("");
    setNewLastName("");
    setNewRole("staff");
    setCreateError(null);
  };

  async function handleCreate(e: FormEvent) {
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
      await createConsoleUserAccount(newEmail, newPassword, newFirstName, newLastName, newRole, actorEmail);
      resetCreateForm();
      setCreateOpen(false);
    } catch (err) {
      setCreateError(userMessage(err, "Failed to create account."));
    } finally {
      setCreating(false);
    }
  }

  async function handleToggleDisabled(u: ConsoleUser) {
    setBusyUid(u.uid);
    setActionError(null);
    try {
      await setAccountDisabled(u.uid, !u.disabled);
    } catch (err) {
      setActionError(userMessage(err, "Failed to update the account."));
    } finally {
      setBusyUid(null);
    }
  }

  // Console accounts have real email addresses, so when the backend can't set
  // a password directly there is still a usable path: Firebase's own reset
  // email. Field readers have no such fallback — see the Mobile Sync page.
  const canSetDirectly = ACCOUNT_CAPABILITIES.canSetPasswordDirectly;

  async function handleResetPassword(e: FormEvent) {
    e.preventDefault();
    if (!resetTarget) return;
    setResetError(null);

    if (canSetDirectly) {
      if (resetPassword.length < MIN_PASSWORD_LENGTH) {
        setResetError(`Password must be at least ${MIN_PASSWORD_LENGTH} characters.`);
        return;
      }
      if (resetPassword !== resetConfirm) {
        setResetError("Passwords don't match.");
        return;
      }
    }

    setResetting(true);
    try {
      if (canSetDirectly) {
        await resetAccountPassword(resetTarget.uid, resetPassword);
      } else {
        await sendPasswordResetLink(resetTarget.email);
      }
      setResetTarget(null);
      setResetPassword("");
      setResetConfirm("");
    } catch (err) {
      setResetError(userMessage(err, "Failed to reset the password."));
    } finally {
      setResetting(false);
    }
  }

  function openEditDialog(u: ConsoleUser) {
    setEditingUser(u);
    setEditFirstName(u.firstName);
    setEditLastName(u.lastName);
    setEditRole(u.role);
    setEditError(null);
  }

  async function handleSaveEdit(e: FormEvent) {
    e.preventDefault();
    if (!editingUser) return;
    setEditError(null);

    if (!editFirstName.trim() || !editLastName.trim()) {
      setEditError("First and last name are required.");
      return;
    }
    if (editingUser.uid === user?.uid && editRole !== "admin") {
      setEditError("You can't demote your own account.");
      return;
    }

    setEditSaving(true);
    try {
      await updateConsoleUserDetails(
        editingUser.uid,
        { firstName: editFirstName.trim(), lastName: editLastName.trim(), role: editRole },
        actorEmail
      );
      setEditingUser(null);
    } catch (err) {
      setEditError(userMessage(err, "Failed to update account."));
    } finally {
      setEditSaving(false);
    }
  }

  return (
    <div className="container mx-auto p-4 space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Team</h1>
          <p className="text-muted-foreground">
            Admin console accounts. <strong>Admin</strong> has full access; <strong>Staff</strong> can look
            up concessionaires, print SOAs/receipts, and accept connection and water bill payments.
          </p>
        </div>
        <Button onClick={() => setCreateOpen(true)} className="shrink-0">
          <UserPlus className="h-4 w-4 mr-2" />
          Create Account
        </Button>
      </div>

      <Dialog
        open={createOpen}
        onOpenChange={(v) => {
          setCreateOpen(v);
          if (!v) resetCreateForm();
        }}
      >
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Create Console Account</DialogTitle>
            <DialogDescription>Signs into this admin console with an email and password.</DialogDescription>
          </DialogHeader>
          <form onSubmit={handleCreate} className="space-y-4">
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
              <Label htmlFor="new-role">Role</Label>
              <Select value={newRole} onValueChange={(v) => v && setNewRole(v as "admin" | "staff")}>
                <SelectTrigger id="new-role" className="w-full text-sm">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="staff">Staff</SelectItem>
                  <SelectItem value="admin">Admin</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="new-email">Email</Label>
              <Input
                id="new-email"
                type="email"
                autoComplete="off"
                required
                value={newEmail}
                onChange={(e) => setNewEmail(e.target.value)}
                placeholder="you@waterdistrict.gov.ph"
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

      <Dialog open={editingUser !== null} onOpenChange={(v) => !v && setEditingUser(null)}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Edit Account</DialogTitle>
            <DialogDescription>
              Updates this account&apos;s name and role. Email and password aren&apos;t changed here.
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={handleSaveEdit} className="space-y-4">
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
              <Label htmlFor="edit-role">Role</Label>
              <Select value={editRole} onValueChange={(v) => v && setEditRole(v as "admin" | "staff")}>
                <SelectTrigger id="edit-role" className="w-full text-sm">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="staff">Staff</SelectItem>
                  <SelectItem value="admin">Admin</SelectItem>
                </SelectContent>
              </Select>
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

      {loaded && users.length === 0 && (
        <Alert>
          <ShieldCheck className="h-4 w-4" />
          <AlertTitle>No accounts yet</AlertTitle>
          <AlertDescription>This shouldn&apos;t normally happen — you&apos;re signed in as one.</AlertDescription>
        </Alert>
      )}

      {actionError && (
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertTitle>Action failed</AlertTitle>
          <AlertDescription>{actionError}</AlertDescription>
        </Alert>
      )}

      <Dialog open={resetTarget !== null} onOpenChange={(v) => !v && setResetTarget(null)}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>{canSetDirectly ? "Reset password" : "Send a reset link"}</DialogTitle>
            <DialogDescription>
              {canSetDirectly ? (
                <>
                  Sets a new password for{" "}
                  {resetTarget ? `${resetTarget.firstName} ${resetTarget.lastName}` : ""}. They will
                  be signed out everywhere and will need the new password to get back in.
                </>
              ) : (
                <>
                  Emails a password-reset link to {resetTarget?.email}. They choose the new password
                  themselves, so nobody else ever sees it.
                </>
              )}
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={handleResetPassword} className="space-y-4">
            {resetError && (
              <Alert variant="destructive">
                <AlertCircle className="h-4 w-4" />
                <AlertDescription>{resetError}</AlertDescription>
              </Alert>
            )}
            {canSetDirectly && (
              <>
                <div className="space-y-1.5">
                  <Label htmlFor="team-reset-password">New Password</Label>
                  <Input
                    id="team-reset-password"
                    type="password"
                    autoComplete="new-password"
                    required
                    value={resetPassword}
                    onChange={(e) => setResetPassword(e.target.value)}
                    placeholder={`At least ${MIN_PASSWORD_LENGTH} characters`}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="team-reset-confirm">Confirm New Password</Label>
                  <Input
                    id="team-reset-confirm"
                    type="password"
                    autoComplete="new-password"
                    required
                    value={resetConfirm}
                    onChange={(e) => setResetConfirm(e.target.value)}
                  />
                </div>
              </>
            )}
            <DialogFooter>
              <Button type="submit" disabled={resetting} className="w-full">
                {resetting ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    {canSetDirectly ? "Saving..." : "Sending..."}
                  </>
                ) : canSetDirectly ? (
                  "Set New Password"
                ) : (
                  "Send Reset Email"
                )}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        {!loaded ? (
          <div className="col-span-full flex justify-center items-center h-32">
            <RefreshCw className="h-8 w-8 animate-spin text-muted-foreground" />
          </div>
        ) : (
          pagedUsers.rows.map((u) => (
            <Card key={u.uid}>
              <CardHeader className="pb-2">
                <div className="flex items-start justify-between gap-2">
                  <div className="flex items-center gap-3 min-w-0">
                    <User className="h-5 w-5 text-muted-foreground shrink-0" />
                    <div className="min-w-0">
                      <CardTitle className="text-base truncate">
                        {u.firstName} {u.lastName}
                      </CardTitle>
                      <CardDescription className="truncate">{u.email}</CardDescription>
                    </div>
                  </div>
                  <div className="flex items-center gap-0.5 shrink-0">
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7"
                      onClick={() => {
                        setResetTarget(u);
                        setResetPassword("");
                        setResetConfirm("");
                        setResetError(null);
                      }}
                      aria-label={`Reset password for ${u.firstName} ${u.lastName}`}
                      title={canSetDirectly ? "Reset password" : "Send a password-reset email"}
                      disabled={myRole !== "admin"}
                    >
                      <KeyRound className="h-3.5 w-3.5" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7"
                      onClick={() => openEditDialog(u)}
                      aria-label={`Edit ${u.firstName} ${u.lastName}`}
                      title="Edit details"
                      disabled={myRole !== "admin"}
                    >
                      <Pencil className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="flex items-center gap-2">
                  <Badge variant="secondary" className={ROLE_BADGE_STYLES[u.role]}>
                    {u.role === "admin" ? "Admin" : "Staff"}
                  </Badge>
                  {u.disabled && (
                    <Badge
                      variant="secondary"
                      className="bg-red-50 text-red-700 border-red-200 text-[10px]"
                    >
                      DISABLED
                    </Badge>
                  )}
                </div>
                {/* Disabling revokes existing refresh tokens too, so a session
                    already open on another machine stops working. Not offered
                    for your own account — locking yourself out mid-session
                    helps nobody. */}
                {u.uid !== myUid && (
                  <Button
                    variant={u.disabled ? "outline" : "ghost"}
                    size="sm"
                    disabled={myRole !== "admin" || busyUid === u.uid}
                    onClick={() => handleToggleDisabled(u)}
                    className={
                      u.disabled
                        ? "h-7 w-full text-xs font-semibold"
                        : "h-7 w-full text-xs font-semibold text-red-600 hover:text-red-700 hover:bg-red-50"
                    }
                  >
                    {u.disabled ? "Re-enable account" : "Revoke access"}
                  </Button>
                )}
              </CardContent>
            </Card>
          ))
        )}
      </div>

      <Pagination paged={pagedUsers} noun="accounts" />
    </div>
  );
}
