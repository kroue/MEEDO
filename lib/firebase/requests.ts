/**
 * lib/firebase/requests.ts
 *
 * The queue of things staff have asked an admin to approve.
 *
 * Money is the admin's call. A staff member at the counter takes the cash and
 * writes the receipt, but the account's balance, its connection fees and its
 * service status only move when an admin approves — so a payment recorded by
 * staff sits here until then, and a rejected one never touched the account.
 *
 * Reconnection is the one kind with three steps rather than two: the ₱200 fee
 * is collected when the request is made, the admin approves it to send a crew
 * out, and the account only goes back to CONNECTED when the admin confirms
 * the line is actually live.
 *
 * Applying a request runs the very same service function an admin's own
 * action does, so there is one implementation of each operation. Ordering is
 * deliberate: the operation runs first and the request is marked afterwards.
 * If two admins approve the same payment at once, the second attempt is
 * refused by the receipt number already being taken, rather than posting the
 * money twice.
 */

import {
  addDoc,
  collection,
  doc,
  getDocs,
  limit,
  onSnapshot,
  query,
  runTransaction,
  serverTimestamp,
  where,
  deleteField,
  type DocumentData,
  type QuerySnapshot,
  type Unsubscribe,
} from "firebase/firestore";
import { db } from "./firebase";
import { logAuditEvent } from "./auditLog";
import { addMeterPayment, updateConnectionFeeDetails } from "./concessionaires";
import { recordPayment } from "./payments";
import { requireOrNumber } from "../receipts";
import { RECONNECTION_FEE, isAwaitingFirstConnection } from "../billing";
import { formatPeso, getFullName } from "../utils";
import type {
  Concessionaire,
  ConnectionFeeDetails,
  NewServiceRequest,
  ServiceRequest,
  ServiceRequestKind,
} from "./types";

const REQUESTS_COLLECTION = "serviceRequests";
const CONCESSIONAIRES_COLLECTION = "concessionaires";

const requestsRef = () => collection(db, REQUESTS_COLLECTION);

export class RequestStateError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RequestStateError";
  }
}

/** What each kind is called on screen and in the audit log. */
export const REQUEST_KIND_LABELS: Record<ServiceRequestKind, string> = {
  WATER_PAYMENT: "Water bill payment",
  CONNECTION_PAYMENT: "Connection fee payment",
  CONNECTION_SETUP: "Connection setup",
  RECONNECTION: "Reconnection",
};

function mapSnapshot(snapshot: QuerySnapshot<DocumentData>): ServiceRequest[] {
  return snapshot.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<ServiceRequest, "id">) }));
}

/** Newest first — an admin works the top of the pile. */
function byRequestedAtDesc(a: ServiceRequest, b: ServiceRequest): number {
  return (b.requestedAt ?? "").localeCompare(a.requestedAt ?? "");
}

function ownerFields(concessionaire: Concessionaire) {
  return {
    concessionaireId: concessionaire.id,
    concessionaireName: getFullName(concessionaire),
    barangay: concessionaire.barangay ?? "",
    meterNumber: concessionaire.meterNumber ?? "",
  };
}

// ── Submitting ─────────────────────────────────────────────────────────────

/**
 * Thrown when the same request is already sitting in the queue.
 *
 * A second tap on "Send for approval" — the button not yet redrawn, the phone
 * or PC slow — used to put a second identical request in front of the admin,
 * and approving both posted the money twice. One open request of a kind per
 * account is all that can ever be waiting.
 */
export class DuplicateRequestError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DuplicateRequestError";
  }
}

async function submit(request: NewServiceRequest): Promise<string> {
  // Scoped to the person sending it, because that is what the security rules
  // let a staff account read — and a double tap is the same person twice.
  const alreadyWaiting = await getDocs(
    query(
      requestsRef(),
      where("requestedBy", "==", request.requestedBy),
      where("concessionaireId", "==", request.concessionaireId),
      where("kind", "==", request.kind),
      where("status", "==", "PENDING"),
      limit(1)
    )
  );
  if (!alreadyWaiting.empty) {
    throw new DuplicateRequestError(
      `A ${REQUEST_KIND_LABELS[request.kind].toLowerCase()} for this account is already waiting for an admin. ` +
        "Check the approvals page before sending another."
    );
  }

  const created = await addDoc(requestsRef(), request);
  logAuditEvent(
    "Account Update",
    `${REQUEST_KIND_LABELS[request.kind]} submitted for approval — ${
      request.concessionaireName || request.concessionaireId
    }` +
      (request.amount ? `, ${formatPeso(request.amount)}` : "") +
      (request.orNumber ? `, OR ${request.orNumber}` : "") +
      ".",
    request.requestedBy
  );
  return created.id;
}

export async function submitWaterPaymentRequest(
  concessionaire: Concessionaire,
  input: { amount: number; orNumber: string; note?: string },
  actorEmail: string
): Promise<string> {
  return submit({
    kind: "WATER_PAYMENT",
    status: "PENDING",
    ...ownerFields(concessionaire),
    amount: input.amount,
    orNumber: requireOrNumber(input.orNumber),
    ...(input.note?.trim() ? { note: input.note.trim() } : {}),
    requestedBy: actorEmail,
    requestedAt: new Date().toISOString(),
  });
}

export async function submitConnectionPaymentRequest(
  concessionaire: Concessionaire,
  input: { amount: number; orNumber: string; slot: string; note?: string },
  actorEmail: string
): Promise<string> {
  return submit({
    kind: "CONNECTION_PAYMENT",
    status: "PENDING",
    ...ownerFields(concessionaire),
    amount: input.amount,
    orNumber: requireOrNumber(input.orNumber),
    slot: input.slot,
    ...(input.note?.trim() ? { note: input.note.trim() } : {}),
    requestedBy: actorEmail,
    requestedAt: new Date().toISOString(),
  });
}

export async function submitConnectionSetupRequest(
  concessionaire: Concessionaire,
  input: { connectionFeeDetails: ConnectionFeeDetails; note?: string },
  actorEmail: string
): Promise<string> {
  return submit({
    kind: "CONNECTION_SETUP",
    status: "PENDING",
    ...ownerFields(concessionaire),
    amount: input.connectionFeeDetails.total,
    connectionFeeDetails: input.connectionFeeDetails,
    ...(input.note?.trim() ? { note: input.note.trim() } : {}),
    requestedBy: actorEmail,
    requestedAt: new Date().toISOString(),
  });
}

/**
 * The ₱200 is collected at the counter as the request is made — the OR is the
 * receipt already written for it. Rejecting the request means handing that
 * money back, which is why the queue shows the receipt number.
 */
export async function submitReconnectionRequest(
  concessionaire: Concessionaire,
  input: { orNumber: string; note?: string },
  actorEmail: string
): Promise<string> {
  if (concessionaire.status !== "DISCONNECTED") {
    throw new RequestStateError("This line is already connected.");
  }
  if (isAwaitingFirstConnection(concessionaire)) {
    throw new RequestStateError(
      "This account has never been connected, so there is nothing to reconnect. Set up its connection first."
    );
  }
  return submit({
    kind: "RECONNECTION",
    status: "PENDING",
    ...ownerFields(concessionaire),
    amount: RECONNECTION_FEE,
    orNumber: requireOrNumber(input.orNumber),
    ...(input.note?.trim() ? { note: input.note.trim() } : {}),
    requestedBy: actorEmail,
    requestedAt: new Date().toISOString(),
  });
}

// ── Reading ────────────────────────────────────────────────────────────────

/** Every request — the admin's queue. */
export function subscribeToServiceRequests(
  onData: (requests: ServiceRequest[]) => void,
  onError: (error: Error) => void
): Unsubscribe {
  return onSnapshot(
    requestsRef(),
    (snapshot) => onData(mapSnapshot(snapshot).sort(byRequestedAtDesc)),
    (err) => onError(err)
  );
}

/** One staff member's own submissions, whatever became of them. */
export function subscribeToMyServiceRequests(
  requestedBy: string,
  onData: (requests: ServiceRequest[]) => void,
  onError: (error: Error) => void
): Unsubscribe {
  return onSnapshot(
    query(requestsRef(), where("requestedBy", "==", requestedBy)),
    (snapshot) => onData(mapSnapshot(snapshot).sort(byRequestedAtDesc)),
    (err) => onError(err)
  );
}

/** Anything outstanding on one account, shown on that account's own pages. */
export function subscribeToAccountRequests(
  concessionaireId: string,
  onData: (requests: ServiceRequest[]) => void,
  onError: (error: Error) => void
): Unsubscribe {
  return onSnapshot(
    query(requestsRef(), where("concessionaireId", "==", concessionaireId)),
    (snapshot) => onData(mapSnapshot(snapshot).sort(byRequestedAtDesc)),
    (err) => onError(err)
  );
}

/** Still waiting on someone: pending, or approved with the crew not yet back. */
export function isOpenRequest(request: ServiceRequest): boolean {
  return request.status === "PENDING" || request.status === "APPROVED";
}

// ── Deciding ───────────────────────────────────────────────────────────────

/**
 * Reads a request and checks it is still in a state this action applies to,
 * so two admins working the queue don't both act on it.
 */
async function claim(
  requestId: string,
  expected: ServiceRequest["status"][]
): Promise<ServiceRequest> {
  return runTransaction(db, async (transaction) => {
    const ref = doc(db, REQUESTS_COLLECTION, requestId);
    const snapshot = await transaction.get(ref);
    if (!snapshot.exists()) throw new RequestStateError("That request no longer exists.");
    const request = { id: snapshot.id, ...(snapshot.data() as Omit<ServiceRequest, "id">) };
    if (!expected.includes(request.status)) {
      throw new RequestStateError("Someone else has already dealt with this request.");
    }
    return request;
  });
}

async function markRequest(
  requestId: string,
  expected: ServiceRequest["status"][],
  updates: Partial<ServiceRequest> & { status: ServiceRequest["status"] }
): Promise<void> {
  // Re-checked inside the transaction: two admins working the queue at once
  // both pass the earlier read, and the second is told rather than silently
  // overwriting the first one's decision.
  await runTransaction(db, async (transaction) => {
    const ref = doc(db, REQUESTS_COLLECTION, requestId);
    const snapshot = await transaction.get(ref);
    if (!snapshot.exists()) throw new RequestStateError("That request no longer exists.");
    const current = (snapshot.data() as ServiceRequest).status;
    if (!expected.includes(current)) {
      throw new RequestStateError("Someone else has already dealt with this request.");
    }
    transaction.update(ref, { ...updates, updatedAt: serverTimestamp() });
  });
}

/**
 * Applies a pending request.
 *
 * Payments and connection setups are carried out and the request is closed.
 * A reconnection is only approved here — the fee is already in, and this is
 * the admin saying to send someone out. The account stays disconnected until
 * [confirmReconnection].
 */
export async function approveRequest(
  requestId: string,
  actorEmail: string
): Promise<ServiceRequest["status"]> {
  const request = await claim(requestId, ["PENDING"]);
  const now = new Date().toISOString();

  if (request.kind === "RECONNECTION") {
    await markRequest(requestId, ["PENDING"], {
      status: "APPROVED",
      reviewedBy: actorEmail,
      reviewedAt: now,
    });
    logAuditEvent(
      "Account Update",
      `Approved reconnection for ${request.concessionaireName || request.concessionaireId} — crew to be sent out. ` +
        `${formatPeso(request.amount ?? RECONNECTION_FEE)} collected under OR ${request.orNumber}.`,
      actorEmail
    );
    return "APPROVED";
  }

  let outcome: string;

  if (request.kind === "WATER_PAYMENT") {
    const payment = await recordPayment(
      request.concessionaireId,
      request.amount ?? 0,
      request.orNumber ?? "",
      request.requestedBy,
      { approvedBy: actorEmail }
    );
    outcome =
      `Posted ${formatPeso(payment.amount)} against the water bill under OR ${payment.orNumber}.` +
      (payment.creditedAmount && payment.creditedAmount > 0
        ? ` ${formatPeso(payment.creditedAmount)} held as advance credit.`
        : "");
  } else if (request.kind === "CONNECTION_PAYMENT") {
    await addMeterPayment(
      request.concessionaireId,
      {
        slot: request.slot ?? "Full",
        amount: request.amount ?? 0,
        orNumber: request.orNumber ?? "",
        date: request.requestedAt,
      },
      request.requestedBy,
      { approvedBy: actorEmail }
    );
    outcome = `Posted ${formatPeso(request.amount ?? 0)} against the connection fee under OR ${request.orNumber}.`;
  } else {
    const details = request.connectionFeeDetails;
    if (!details) throw new RequestStateError("This request has no connection fee details.");
    await updateConnectionFeeDetails(request.concessionaireId, details, actorEmail);
    outcome = `Set up connection fees totalling ${formatPeso(details.total)}.`;
  }

  await markRequest(requestId, ["PENDING"], {
    status: "COMPLETED",
    reviewedBy: actorEmail,
    reviewedAt: now,
    completedBy: actorEmail,
    completedAt: now,
    outcome,
  });

  logAuditEvent(
    "Payment",
    `Approved ${REQUEST_KIND_LABELS[request.kind].toLowerCase()} requested by ${request.requestedBy} for ` +
      `${request.concessionaireName || request.concessionaireId}. ${outcome}`,
    actorEmail
  );

  return "COMPLETED";
}

/**
 * Confirms a reconnected line: the crew has been, the water is back on, and
 * the account returns to CONNECTED.
 */
export async function confirmReconnection(requestId: string, actorEmail: string): Promise<void> {
  const request = await claim(requestId, ["APPROVED"]);
  if (request.kind !== "RECONNECTION") {
    throw new RequestStateError("Only a reconnection is confirmed this way.");
  }
  const now = new Date().toISOString();

  await runTransaction(db, async (transaction) => {
    const accountRef = doc(db, CONCESSIONAIRES_COLLECTION, request.concessionaireId);
    const snapshot = await transaction.get(accountRef);
    if (!snapshot.exists()) throw new RequestStateError("That account no longer exists.");

    transaction.update(accountRef, {
      status: "CONNECTED",
      disconnectedReason: deleteField(),
      updatedBy: actorEmail,
      updatedAt: serverTimestamp(),
    });
  });

  await markRequest(requestId, ["APPROVED"], {
    status: "COMPLETED",
    completedBy: actorEmail,
    completedAt: now,
    outcome: `Line reconnected. ${formatPeso(request.amount ?? RECONNECTION_FEE)} collected under OR ${request.orNumber}.`,
  });

  logAuditEvent(
    "Account Update",
    `Confirmed reconnection for ${request.concessionaireName || request.concessionaireId}. ` +
      `Account is CONNECTED again. Fee OR ${request.orNumber}.`,
    actorEmail
  );
}

/** Refuses a request. Nothing is applied; a collected fee has to be refunded. */
export async function rejectRequest(
  requestId: string,
  reason: string,
  actorEmail: string
): Promise<void> {
  const trimmed = reason.trim();
  if (!trimmed) throw new RequestStateError("A reason is required to reject a request.");

  const request = await claim(requestId, ["PENDING", "APPROVED"]);

  await markRequest(requestId, ["PENDING", "APPROVED"], {
    status: "REJECTED",
    reviewedBy: actorEmail,
    reviewedAt: new Date().toISOString(),
    rejectionReason: trimmed,
  });

  logAuditEvent(
    "Account Update",
    `Rejected ${REQUEST_KIND_LABELS[request.kind].toLowerCase()} requested by ${request.requestedBy} for ` +
      `${request.concessionaireName || request.concessionaireId}` +
      (request.orNumber ? ` (OR ${request.orNumber})` : "") +
      `. Reason: ${trimmed}`,
    actorEmail
  );
}
