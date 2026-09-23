/**
 * About: who made the console, who owns it, the rules staff are agreeing to
 * by using it, and what it is built from.
 *
 * A server component — every fact on this page is fixed when the build is
 * made, so none of it needs to be fetched or re-rendered in the browser.
 */

import type { Metadata } from "next";
import Link from "next/link";
import Image from "next/image";
import {
  Building2,
  Code2,
  FileText,
  Mail,
  Phone,
  ScrollText,
  ShieldCheck,
  Tag,
} from "lucide-react";
import {
  APP_NAME,
  APP_VERSION,
  COMPANY_NAME,
  COPYRIGHT_HOLDER,
  COPYRIGHT_YEAR,
  DEVELOPERS,
  OPEN_SOURCE,
  SYSTEM_ADDRESS,
  SYSTEM_NAME,
  buildTimeIso,
  formatBuildTime,
} from "@/lib/appInfo";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

export const metadata: Metadata = {
  title: "About — MEEDO Admin Console",
};

function SectionTitle({
  icon: Icon,
  title,
  description,
}: {
  icon: React.ElementType;
  title: string;
  description?: string;
}) {
  return (
    <CardHeader>
      <div className="flex items-center gap-2">
        <Icon className="h-4 w-4 text-slate-400" />
        <CardTitle className="text-base font-semibold text-slate-800">{title}</CardTitle>
      </div>
      {description && (
        <CardDescription className="text-xs text-slate-500">{description}</CardDescription>
      )}
    </CardHeader>
  );
}

export default function AboutPage() {
  const buildStamp = formatBuildTime(buildTimeIso());
  const serverEnvironment = process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID || "Not configured";

  return (
    <div className="max-w-3xl space-y-6">
      <div>
        <h2 className="text-2xl font-bold tracking-tight text-slate-900">About</h2>
        <p className="text-sm text-slate-500">
          What this system is, who is responsible for it, and the terms it is used under.
        </p>
      </div>

      <Card>
        <CardContent className="flex flex-col gap-4 pt-6 sm:flex-row sm:items-center">
          <Image
            src="/logo.png"
            alt=""
            width={64}
            height={64}
            className="h-16 w-16 shrink-0 rounded-xl border border-slate-200 bg-white object-contain p-1.5"
          />
          <div className="min-w-0">
            <p className="text-lg font-bold text-slate-900">{APP_NAME}</p>
            <p className="text-sm text-slate-600">{SYSTEM_NAME}</p>
            <p className="text-xs text-slate-500">{SYSTEM_ADDRESS}</p>
            <p className="mt-2 text-xs text-slate-500">
              Billing, collections, connections and field operations for the water system —
              the counter, the office and the meter readers working from one set of records.
            </p>
          </div>
        </CardContent>
      </Card>

      <Card>
        <SectionTitle
          icon={Code2}
          title="Developer"
          description="Who built the system, and who to reach when something is wrong with it."
        />
        <CardContent className="space-y-4">
          {DEVELOPERS.map((developer) => (
            <div key={developer.email} className="space-y-1.5">
              <p className="text-sm font-medium text-slate-800">{developer.name}</p>
              <div className="grid gap-2 sm:grid-cols-2">
                <a
                  href={`mailto:${developer.email}`}
                  className="flex items-center gap-2 text-sm text-sky-700 hover:underline"
                >
                  <Mail className="h-4 w-4 shrink-0 text-slate-400" />
                  <span className="truncate">{developer.email}</span>
                </a>
                <a
                  href={`tel:${developer.phone.replace(/\s/g, "")}`}
                  className="flex items-center gap-2 text-sm text-sky-700 hover:underline"
                >
                  <Phone className="h-4 w-4 shrink-0 text-slate-400" />
                  {developer.phone}
                </a>
              </div>
            </div>
          ))}
          <p className="text-xs text-slate-500">
            For a problem with a household&apos;s records or a bill, go to an admin first — they
            can see the account and the audit trail. Reach a developer for something the console
            itself is doing wrong.
          </p>
        </CardContent>
      </Card>

      <Card>
        <SectionTitle icon={Building2} title="Ownership and copyright" />
        <CardContent className="space-y-3">
          <p className="text-sm text-slate-700">
            © {COPYRIGHT_YEAR} {COPYRIGHT_HOLDER}. All rights reserved.
          </p>
          <p className="text-sm text-slate-600">
            The software and its source code belong to {COMPANY_NAME}, which built it for{" "}
            {SYSTEM_NAME}. The records it holds — every concessionaire, bill, payment and
            reading — belong to the office alone.
          </p>
          <p className="text-xs text-slate-500">
            Third-party components listed below remain under their own licences and are not
            covered by this.
          </p>
        </CardContent>
      </Card>

      <Card>
        <SectionTitle
          icon={ScrollText}
          title="Terms of use"
          description="These apply to everyone signed in, staff and admin alike."
        />
        <CardContent>
          <ul className="space-y-2.5 text-sm text-slate-600">
            <li className="flex gap-2">
              <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-slate-400" />
              <span>
                <span className="font-medium text-slate-800">Authorised staff only.</span>{" "}
                Accounts are issued by an admin for official work. Signing in for anyone else,
                or letting anyone else use your sign-in, is not permitted.
              </span>
            </li>
            <li className="flex gap-2">
              <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-slate-400" />
              <span>
                <span className="font-medium text-slate-800">Your password is yours.</span> Do
                not write it down where others can read it or share it with a colleague. Change
                it from your{" "}
                <Link href="/profile" className="font-medium text-sky-700 hover:underline">
                  profile
                </Link>{" "}
                if you think someone else knows it.
              </span>
            </li>
            <li className="flex gap-2">
              <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-slate-400" />
              <span>
                <span className="font-medium text-slate-800">Everything is recorded.</span>{" "}
                Bills issued, payments posted, accounts changed, approvals given — each is
                written to the audit trail with the name of whoever did it and when. Assume any
                action can be traced back to you, because it can.
              </span>
            </li>
            <li className="flex gap-2">
              <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-slate-400" />
              <span>
                <span className="font-medium text-slate-800">
                  Receipt numbers come from the booklet.
                </span>{" "}
                Official receipt numbers are typed in from the issued booklet and are never
                generated by the system. What is entered here must match the paper receipt given
                to the customer.
              </span>
            </li>
            <li className="flex gap-2">
              <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-slate-400" />
              <span>
                <span className="font-medium text-slate-800">Use office equipment.</span> Install
                and sign in on machines and phones the office controls, not on personal devices.
              </span>
            </li>
          </ul>
        </CardContent>
      </Card>

      <Card>
        <SectionTitle
          icon={ShieldCheck}
          title="Data privacy"
          description="Republic Act No. 10173 — the Data Privacy Act of 2012."
        />
        <CardContent className="space-y-3">
          <p className="text-sm text-slate-600">
            This console holds personal information about residents: names, addresses, contact
            numbers, what they consumed and what they owe. Under the Data Privacy Act of 2012 the
            office is accountable for how that information is handled, and so is each person who
            handles it.
          </p>
          <ul className="space-y-2.5 text-sm text-slate-600">
            <li className="flex gap-2">
              <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-slate-400" />
              <span>
                Look up only the accounts your work actually requires. Browsing a neighbour&apos;s
                record out of curiosity is a misuse of the system, and it is logged.
              </span>
            </li>
            <li className="flex gap-2">
              <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-slate-400" />
              <span>
                Do not photograph, copy, export or message customer records outside the office.
                Exported reports are office documents and stay within the office.
              </span>
            </li>
            <li className="flex gap-2">
              <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-slate-400" />
              <span>
                Give a customer their own information when they ask for it, and only theirs.
                Anyone asking about someone else&apos;s account is referred to an admin.
              </span>
            </li>
            <li className="flex gap-2">
              <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-slate-400" />
              <span>
                Report a lost phone, a shared password or any suspected exposure of records to
                the office immediately. The Act requires the National Privacy Commission and the
                affected people to be notified within 72 hours of a breach that could cause them
                harm, and that clock starts when the office learns of it — not when it is
                convenient.
              </span>
            </li>
          </ul>
          <p className="text-xs text-slate-500">
            This is a working summary for staff, not legal advice. The office&apos;s data
            protection officer is the authority on anything here.
          </p>
        </CardContent>
      </Card>

      <Card>
        <SectionTitle
          icon={FileText}
          title="Open-source components"
          description="Built with these, each under its own licence."
        />
        <CardContent>
          <div className="overflow-hidden rounded-lg border border-slate-200">
            <table className="w-full text-sm">
              <thead className="bg-slate-50">
                <tr className="text-left text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                  <th className="px-3 py-2">Component</th>
                  <th className="px-3 py-2">Used for</th>
                  <th className="px-3 py-2">Licence</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {OPEN_SOURCE.map((item) => (
                  <tr key={item.name}>
                    <td className="px-3 py-2 font-medium text-slate-800">
                      {item.name}
                      {item.version !== "—" && (
                        <span className="ml-1.5 text-xs font-normal text-slate-400">
                          {item.version}
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-slate-600">{item.what}</td>
                    <td className="px-3 py-2 text-slate-600">{item.licence}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="mt-3 text-xs text-slate-500">
            Copyright in each of these stays with its own authors, and each is used under the
            terms of the licence named. Development tools that do not ship with the console are
            not listed.
          </p>
        </CardContent>
      </Card>

      <Card>
        <SectionTitle
          icon={Tag}
          title="This build"
          description="Worth quoting when reporting a problem."
        />
        <CardContent>
          <dl className="grid gap-4 sm:grid-cols-3">
            <div className="rounded-lg border border-slate-200 bg-slate-50 px-4 py-3">
              <dt className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                Version
              </dt>
              <dd className="mt-0.5 text-sm font-medium text-slate-800">{APP_VERSION}</dd>
            </div>
            <div className="rounded-lg border border-slate-200 bg-slate-50 px-4 py-3">
              <dt className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                Built
              </dt>
              <dd className="mt-0.5 text-sm font-medium text-slate-800">{buildStamp}</dd>
            </div>
            <div className="rounded-lg border border-slate-200 bg-slate-50 px-4 py-3">
              <dt className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                Server
              </dt>
              <dd className="mt-0.5 truncate text-sm font-medium text-slate-800">
                {serverEnvironment}
              </dd>
            </div>
          </dl>
        </CardContent>
      </Card>
    </div>
  );
}
