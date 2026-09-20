"use client";

/**
 * Your own account: what the office knows about you, and the two things you
 * can change yourself.
 *
 * Name and phone number are yours to edit. Role, email and whether the account
 * is active are the admin's — shown here so you know where you stand, but not
 * editable, and the security rules refuse the write regardless of what this
 * page offers.
 */

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  AlertCircle,
  CheckCircle2,
  KeyRound,
  Loader2,
  Mail,
  Pencil,
  Phone,
  ShieldCheck,
  User as UserIcon,
} from "lucide-react";
import { useAuth } from "@/lib/auth/AuthContext";
import { userMessage } from "@/lib/userMessage";
import { subscribeToOwnProfile, updateOwnProfile, type ConsoleUser } from "@/lib/firebase/users";
import { changeOwnPassword } from "@/lib/firebase/auth";
import { MIN_PASSWORD_LENGTH } from "@/lib/firebase/createFieldReader";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription } from "@/components/ui/alert";

function Field({ icon: Icon, label, value }: { icon: React.ElementType; label: string; value: string }) {
  return (
    <div className="flex items-start gap-3">
      <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-slate-100 text-slate-500">
        <Icon className="h-4 w-4" />
      </span>
      <div className="min-w-0">
        <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">{label}</p>
        <p className="truncate text-sm font-medium text-slate-800">{value || "—"}</p>
      </div>
    </div>
  );
}

export default function ProfilePage() {
  const { user, role } = useAuth();
  const uid = user?.uid ?? "";
  const email = user?.email ?? "";

  const [profile, setProfile] = useState<ConsoleUser | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    if (!uid) return;
    return subscribeToOwnProfile(uid, setProfile, (e) =>
      setLoadError(userMessage(e, "Couldn't load your profile."))
    );
  }, [uid]);

  // ── Details ───────────────────────────────────────────────────────────────
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState({ firstName: "", lastName: "", phoneNumber: "" });
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  function startEditing() {
    setForm({
      firstName: profile?.firstName ?? "",
      lastName: profile?.lastName ?? "",
      phoneNumber: profile?.phoneNumber ?? "",
    });
    setSaveError(null);
    setSaved(false);
    setEditing(true);
  }

  async function save() {
    setSaving(true);
    setSaveError(null);
    try {
      await updateOwnProfile(uid, form, email);
      setSaved(true);
      setEditing(false);
    } catch (e) {
      setSaveError(userMessage(e, "Couldn't save your profile."));
    } finally {
      setSaving(false);
    }
  }

  // ── Password ──────────────────────────────────────────────────────────────
  const [passwords, setPasswords] = useState({ current: "", next: "", confirm: "" });
  const [changing, setChanging] = useState(false);
  const [passwordError, setPasswordError] = useState<string | null>(null);
  const [passwordChanged, setPasswordChanged] = useState(false);

  const mismatch = passwords.confirm.length > 0 && passwords.next !== passwords.confirm;

  async function changePassword() {
    setChanging(true);
    setPasswordError(null);
    setPasswordChanged(false);
    try {
      await changeOwnPassword(passwords.current, passwords.next, MIN_PASSWORD_LENGTH);
      setPasswords({ current: "", next: "", confirm: "" });
      setPasswordChanged(true);
    } catch (e) {
      setPasswordError(userMessage(e, "Couldn't change your password."));
    } finally {
      setChanging(false);
    }
  }

  const fullName = [profile?.firstName, profile?.lastName].filter(Boolean).join(" ");

  return (
    <div className="max-w-3xl space-y-6">
      <div>
        <h2 className="text-2xl font-bold tracking-tight text-slate-900">Your profile</h2>
        <p className="text-sm text-slate-500">
          Your details and your password. Your role and email address are set by an admin.
        </p>
      </div>

      {loadError && (
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>{loadError}</AlertDescription>
        </Alert>
      )}

      <Card>
        <CardHeader className="flex-row items-start justify-between space-y-0">
          <div>
            <CardTitle className="text-base font-semibold text-slate-800">Details</CardTitle>
            <CardDescription className="text-xs text-slate-500">
              Your name is what appears on the records you create — a receipt you issue, a payment
              you send for approval.
            </CardDescription>
          </div>
          {!editing && (
            <Button variant="outline" size="sm" onClick={startEditing} disabled={!profile}>
              <Pencil className="mr-1.5 h-3.5 w-3.5" />
              Edit
            </Button>
          )}
        </CardHeader>

        <CardContent className="space-y-5">
          {saved && !editing && (
            <div className="flex items-start gap-3 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3">
              <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" />
              <p className="text-sm text-emerald-900">Your profile has been updated.</p>
            </div>
          )}

          {editing ? (
            <div className="space-y-4">
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label htmlFor="profile-first" className="text-xs font-medium text-slate-700">
                    First name *
                  </Label>
                  <Input
                    id="profile-first"
                    value={form.firstName}
                    onChange={(e) => setForm({ ...form, firstName: e.target.value })}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="profile-last" className="text-xs font-medium text-slate-700">
                    Last name *
                  </Label>
                  <Input
                    id="profile-last"
                    value={form.lastName}
                    onChange={(e) => setForm({ ...form, lastName: e.target.value })}
                  />
                </div>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="profile-phone" className="text-xs font-medium text-slate-700">
                  Phone number
                </Label>
                <Input
                  id="profile-phone"
                  value={form.phoneNumber}
                  onChange={(e) => setForm({ ...form, phoneNumber: e.target.value })}
                  placeholder="e.g. 0917 123 4567"
                />
              </div>

              {saveError && (
                <Alert variant="destructive">
                  <AlertCircle className="h-4 w-4" />
                  <AlertDescription>{saveError}</AlertDescription>
                </Alert>
              )}

              <div className="flex gap-2">
                <Button
                  onClick={save}
                  disabled={saving || !form.firstName.trim() || !form.lastName.trim()}
                  className="bg-sky-600 text-white hover:bg-sky-700"
                >
                  {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                  Save changes
                </Button>
                <Button variant="outline" onClick={() => setEditing(false)} disabled={saving}>
                  Cancel
                </Button>
              </div>
            </div>
          ) : (
            <div className="grid gap-5 sm:grid-cols-2">
              <Field icon={UserIcon} label="Name" value={fullName} />
              <Field icon={Phone} label="Phone number" value={profile?.phoneNumber ?? ""} />
              <Field icon={Mail} label="Email (sign-in)" value={email} />
              <div className="flex items-start gap-3">
                <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-slate-100 text-slate-500">
                  <ShieldCheck className="h-4 w-4" />
                </span>
                <div>
                  <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">
                    Role
                  </p>
                  <Badge
                    variant="secondary"
                    className={
                      role === "admin"
                        ? "border-sky-200 bg-sky-50 text-sky-700"
                        : "border-slate-200 bg-slate-100 text-slate-700"
                    }
                  >
                    {role === "admin" ? "Admin" : "Staff"}
                  </Badge>
                </div>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <KeyRound className="h-4 w-4 text-slate-400" />
            <CardTitle className="text-base font-semibold text-slate-800">Password</CardTitle>
          </div>
          <CardDescription className="text-xs text-slate-500">
            Your current password is asked for first — being signed in is not enough, since a
            session left open at the counter is exactly how an account gets taken.
          </CardDescription>
        </CardHeader>

        <CardContent className="space-y-4">
          {passwordChanged && (
            <div className="flex items-start gap-3 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3">
              <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" />
              <p className="text-sm text-emerald-900">
                Your password has been changed. Use it the next time you sign in.
              </p>
            </div>
          )}

          <div className="grid gap-4 sm:grid-cols-3">
            <div className="space-y-1.5">
              <Label htmlFor="pw-current" className="text-xs font-medium text-slate-700">
                Current password
              </Label>
              <Input
                id="pw-current"
                type="password"
                autoComplete="current-password"
                value={passwords.current}
                onChange={(e) => setPasswords({ ...passwords, current: e.target.value })}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="pw-next" className="text-xs font-medium text-slate-700">
                New password
              </Label>
              <Input
                id="pw-next"
                type="password"
                autoComplete="new-password"
                value={passwords.next}
                onChange={(e) => setPasswords({ ...passwords, next: e.target.value })}
              />
              <p className="text-[11px] text-slate-500">At least {MIN_PASSWORD_LENGTH} characters.</p>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="pw-confirm" className="text-xs font-medium text-slate-700">
                Confirm new password
              </Label>
              <Input
                id="pw-confirm"
                type="password"
                autoComplete="new-password"
                value={passwords.confirm}
                onChange={(e) => setPasswords({ ...passwords, confirm: e.target.value })}
              />
              {mismatch && <p className="text-[11px] text-red-600">These don&apos;t match.</p>}
            </div>
          </div>

          {passwordError && (
            <Alert variant="destructive">
              <AlertCircle className="h-4 w-4" />
              <AlertDescription>{passwordError}</AlertDescription>
            </Alert>
          )}

          <Button
            onClick={changePassword}
            disabled={
              changing ||
              !passwords.current ||
              passwords.next.length < MIN_PASSWORD_LENGTH ||
              mismatch ||
              !passwords.confirm
            }
            className="bg-slate-900 text-white hover:bg-slate-800"
          >
            {changing && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Change password
          </Button>
        </CardContent>
      </Card>

      <p className="text-xs text-slate-500">
        Need your email address or role changed? An admin does that on the{" "}
        <Link href="/team" className="font-medium text-sky-700 hover:underline">
          Team
        </Link>{" "}
        page.
      </p>
    </div>
  );
}
