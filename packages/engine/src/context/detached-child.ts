/**
 * Deriving and adopting the child session a detached start targets (FIX-999).
 *
 * The seam's safety rule: a caller supplies the *target* of an operation and
 * never the *authority* for it. It hands over a routing seed and the seam builds
 * the child session id from that seed together with the running request's
 * server-derived identity — principal, tenant, **and parent session**.
 *
 * The parent session is in the key material because every other verb on this
 * seam authorises by **descent**: settle resolves the board in the session that
 * dispatched this request, and interrupt and liveness answer only for a session
 * whose parent chain reaches the current one. A child is therefore unreachable
 * except *through* the parent that owns it, which makes the parent part of what
 * the child **is**. A key that omits it names a child two owners can both claim,
 * and the loser's work settles onto the wrong board while its own interrupt and
 * liveness calls refuse — unsettleable, uninterruptible, invisible.
 */
import { createHash } from "node:crypto";
import type { DetachedRoutingSeed } from "@flow-state-dev/core/types";

/** The server-derived facts a child key is built from. Never caller-supplied. */
export type DerivationIdentity = {
  /** The running request's principal. */
  userId: string;
  /** The tenant the running request belongs to, if multi-tenant. */
  tenantId: string | undefined;
  /** The session that is spawning the child — the child's parent. */
  parentSessionId: string;
};

/** Prefix so a derived child id is recognisable in a store dump. */
const CHILD_ID_PREFIX = "dsx_";

/**
 * Length-prefix a field so field boundaries cannot be confused.
 *
 * Without this, `("u_ab", "c")` and `("u_a", "bc")` hash identically, and since
 * the parent session id is one of the fields that is a cross-lineage collision
 * reachable by choosing ids — exactly what the derivation exists to prevent.
 */
function framed(value: string | undefined): string {
  const v = value ?? "";
  return `${v.length}:${v}`;
}

/**
 * Derive the child session id for a detached start.
 *
 * Deterministic by design — the same identity and seed must land on the same
 * child, because that is what makes "adopt if it already exists" the ordinary
 * second-task-same-topic path rather than a conflict.
 */
export function deriveChildSessionId(
  identity: DerivationIdentity,
  seed: DetachedRoutingSeed
): string {
  const material = [
    framed(identity.tenantId),
    framed(identity.userId),
    framed(identity.parentSessionId),
    framed(seed.topic),
    framed(seed.key)
  ].join("|");

  const digest = createHash("sha256").update(material, "utf8").digest("hex");
  return `${CHILD_ID_PREFIX}${digest.slice(0, 32)}`;
}

/** The identity a genuine child of this request must carry. */
export type ExpectedChildIdentity = {
  flowKind: string;
  userId: string;
  tenantId: string | undefined;
  orgId: string | undefined;
  parentSessionId: string;
};

/** The subset of a stored session record adoption inspects. */
export type AdoptionCandidate = {
  flowKind: string;
  userId: string;
  tenantId?: string;
  orgId?: string;
  parentSessionId?: string;
};

/** Which field disagreed. Reported for diagnostics; the caller refuses by name. */
export type AdoptionMismatch =
  | "flowKind"
  | "userId"
  | "tenantId"
  | "orgId"
  | "parentSessionId";

export type AdoptionVerdict =
  | { adoptable: true }
  | { adoptable: false; mismatch: AdoptionMismatch };

/** `null` and `undefined` both mean "absent" on a persisted record (BP-030). */
function sameOptional(a: string | undefined | null, b: string | undefined | null): boolean {
  const left = a == null ? undefined : a;
  const right = b == null ? undefined : b;
  return left === right;
}

/**
 * Decide whether a record found at the derived child key may be adopted.
 *
 * **Why this validates more than the key implies.** The derivation already binds
 * principal, tenant and parent session, so a record the *seam* created at this
 * key necessarily matches. But the seam is not the only writer: the public
 * session-create route lets a caller choose both the session id and its
 * metadata, so a same-principal caller can pre-create a record sitting at the
 * deterministic child id. `createExecutionContext` validates user, tenant and org
 * bindings — but **not `flowKind` and not `parentSessionId`** — so a pre-created
 * top-level record, or one belonging to another flow, would sail through that
 * check and be adopted.
 *
 * Both outcomes are bad in the same way: the flow runs against a session bound to
 * the wrong flow kind, and because every other verb here authorises by descent,
 * the adopted record's parent chain does not reach the real parent, so interrupt
 * and liveness refuse for work that is genuinely the caller's.
 *
 * A mismatch is a **named refusal**, never a silent fall-through to create — the
 * record belongs to someone, and overwriting it is not this verb's call.
 */
export function evaluateAdoption(
  record: AdoptionCandidate,
  expected: ExpectedChildIdentity
): AdoptionVerdict {
  if (record.flowKind !== expected.flowKind) {
    return { adoptable: false, mismatch: "flowKind" };
  }
  if (record.userId !== expected.userId) {
    return { adoptable: false, mismatch: "userId" };
  }
  if (!sameOptional(record.tenantId, expected.tenantId)) {
    return { adoptable: false, mismatch: "tenantId" };
  }
  if (!sameOptional(record.orgId, expected.orgId)) {
    return { adoptable: false, mismatch: "orgId" };
  }
  if (!sameOptional(record.parentSessionId, expected.parentSessionId)) {
    return { adoptable: false, mismatch: "parentSessionId" };
  }
  return { adoptable: true };
}
