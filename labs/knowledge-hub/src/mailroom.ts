// ---------------------------------------------------------------------------
// The mailroom: the deterministic, non-LLM triage pass that runs at capture
// time (FIX-882).
//
// It stamps, sorts, and flags behind the scenes — it never interrogates the
// caller (that would be a "receptionist", which by design this is not, and
// which the industry moved away from: Letta/LangMem/Mem0 all push classification
// and near-duplicate detection to a later async pass). All the mailroom does is
// normalize for fingerprinting and hash the full capture tuple for
// transport-retry idempotency. No similarity scanning lives here — every kind of
// near-duplicate detection is the FIX-883 sweeper's job (spec Key Decision 4).
//
// Pure functions, no ctx, no I/O — the handler owns all store access, which
// keeps these trivially unit-testable.
// ---------------------------------------------------------------------------

import { createHash } from "node:crypto";

/**
 * Lowercase, collapse internal whitespace to single spaces, and trim. Used
 * ONLY inside the fingerprint — the stored fields stay verbatim.
 */
export function normalizeForFingerprint(text: string): string {
  return text.toLowerCase().replace(/\s+/g, " ").trim();
}

/**
 * sha256 hex over the full normalized capture tuple, in a fixed field order:
 * `${contextId}\n${kind}\n${norm(content)}\n${norm(context)}\n${occurredAt ?? ""}\n${source ?? ""}`.
 *
 * Covering the whole tuple makes this strictly a transport-retry identity: the
 * same sentence captured with different context (a different conversation) is a
 * different mental event and gets its own record — required context is never
 * silently discarded by dedup. Same recipe philosophy as trading-desk's
 * `computeFingerprint`: normalized load-bearing fields in a fixed order.
 *
 * `contextId` leads the tuple and is hashed verbatim (an opaque session id, not
 * free text, so it is not normalized): the identical capture under two
 * conversation contexts stays two records, never a cross-context dedup collision.
 */
export function computeFingerprint(input: {
  contextId: string;
  kind: string;
  content: string;
  context: string;
  occurredAt: string | null;
  source: string | null;
}): string {
  const tuple = [
    input.contextId,
    input.kind,
    normalizeForFingerprint(input.content),
    normalizeForFingerprint(input.context),
    input.occurredAt ?? "",
    input.source ?? "",
  ].join("\n");
  return createHash("sha256").update(tuple).digest("hex");
}
