/**
 * lib/firebase/auditLog.ts
 *
 * A real, append-only event log for admin actions, backing the Audit Logs
 * page. Every write path that matters (account changes, payments, mobile
 * sync assignment, XLSX imports, admin logins) calls `logAuditEvent` right
 * alongside its actual Firestore write — so what shows up here is only ever
 * something that really happened, not simulated data.
 *
 * Logging failures are swallowed (fire-and-forget): a dropped audit entry
 * should never block or fail the real action it's describing.
 */

import {
  collection,
  addDoc,
  query,
  orderBy,
  limit,
  onSnapshot,
  serverTimestamp,
  Timestamp,
  type Unsubscribe,
} from "firebase/firestore";
import { db } from "./firebase";

export const AUDIT_ACTION_TYPES = [
  "Payment",
  "Account Update",
  "Data Sync",
  "Login",
  "System",
] as const;

export type AuditActionType = (typeof AUDIT_ACTION_TYPES)[number];

export interface AuditLogEntry {
  id: string;
  timestamp: Date | null;
  user: string;
  actionType: AuditActionType;
  description: string;
}

const AUDIT_LOGS_COLLECTION = "auditLogs";

/** Fire-and-forget: records an event without ever throwing back into the caller's write flow. */
export function logAuditEvent(
  actionType: AuditActionType,
  description: string,
  user: string
): void {
  addDoc(collection(db, AUDIT_LOGS_COLLECTION), {
    actionType,
    description,
    user,
    timestamp: serverTimestamp(),
  }).catch((err) => {
    console.error("Failed to write audit log entry", err);
  });
}

/** Realtime feed of the most recent audit log entries, newest first. */
export function subscribeToAuditLogs(
  onData: (entries: AuditLogEntry[]) => void,
  onError: (error: Error) => void,
  maxEntries: number = 300
): Unsubscribe {
  const q = query(
    collection(db, AUDIT_LOGS_COLLECTION),
    orderBy("timestamp", "desc"),
    limit(maxEntries)
  );
  return onSnapshot(
    q,
    (snapshot) => {
      onData(
        snapshot.docs.map((d) => {
          const data = d.data();
          const ts = data.timestamp as Timestamp | undefined;
          return {
            id: d.id,
            timestamp: ts ? ts.toDate() : null,
            user: (data.user as string) ?? "unknown",
            actionType: (data.actionType as AuditActionType) ?? "System",
            description: (data.description as string) ?? "",
          };
        })
      );
    },
    onError
  );
}
