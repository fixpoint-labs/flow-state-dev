/**
 * Canonical item-log view (FIX-811).
 *
 * The physical item log of a resumed request can carry superseded copies of a
 * block's emissions. When a request continues under its own id, the suspending
 * block re-runs from the top of its body — re-emitting anything it produced
 * before it called `ctx.suspend()`. The classic shape is a human-in-the-loop
 * gate that shows an approval `message`/`component` and then suspends: on
 * re-entry the gate runs again and re-emits that prompt with a fresh id. The
 * run-1 copies stay in the physical log (merged by id next to the run-2 copies)
 * so DevTool forensics and crash recovery retain the whole record, but a
 * consumer reading the request history should see each block's emissions once.
 *
 * `collapseToCanonicalLog` is the single read-path helper that drops the
 * superseded copies, keyed by *logical block ownership* rather than item type.
 * The `GET` history, `useSession` reconstruction, and the empty-cursor SSE
 * replay seed all route through it. The append-only SSE *event* wire is NOT
 * collapsed: duplicate suppression happens here at items-record reconstruction,
 * never on the event stream (`${requestId}:${sequence_number}` stays monotonic
 * and append-only).
 *
 * Lives in `@flow-state-dev/contracts` (re-exported from `@flow-state-dev/core/items`)
 * so server-side history assembly and client-side `useSession` reconstruction
 * collapse from the same truth.
 */
import type { OutputItem } from "./types";
import { parseBlockInstanceId } from "../block-instance-id";

/**
 * The logical id a `blockInstanceId` belongs to — `${requestId}:${path}`, the
 * attempt-independent prefix. Returns `undefined` for runtime-provenance items
 * (e.g. `runtime`) and any id that doesn't parse, which are never shadowed.
 */
function logicalIdOf(blockInstanceId: string | undefined): string | undefined {
  if (blockInstanceId === undefined) return undefined;
  const parsed = parseBlockInstanceId(blockInstanceId);
  if (parsed === undefined) return undefined;
  return `${parsed.requestId}:${parsed.path}`;
}

/** The leaf logical id a `suspension` item resolves to, preferring its own
 * carried `blockInstanceId` (the suspending leaf) over runtime provenance. */
function suspensionLogicalId(item: OutputItem): string | undefined {
  const carried = (item as { blockInstanceId?: string }).blockInstanceId;
  return logicalIdOf(carried ?? item.provenance?.blockInstanceId);
}

/**
 * Collapse a request's physical item log to its canonical view.
 *
 * Three superseding rules, all keyed by the logical block path:
 *
 * 1. **Resume re-run emissions.** For every `suspension` that has a matching
 *    `suspension_resume` (a resolved cycle), the block at that suspension's
 *    logical path re-ran on continuation. Its run-1 emissions are exactly the
 *    items it owns at an `itemIndex` below the suspension's — drop them; the
 *    re-emitted run-2 copies (after the resume) survive. `suspension` and
 *    `suspension_resume` items are never dropped (they are the audit trail the
 *    history must preserve). Across N cycles the latest resolved suspension per
 *    logical path wins, so intermediate-cycle emissions collapse too.
 * 2. **Superseded traces.** Among `block_trace` items sharing a logical path,
 *    keep only the canonical one — the `completed` trace with the highest
 *    `itemIndex` (or, absent any completed, the highest-index trace) — and drop
 *    the run-1 partial(s).
 * 3. **Crash-recovery re-run emissions.** The `continue` path (FIX-811 crash
 *    recovery) re-runs the interrupted in-flight block with NO `suspension` /
 *    `suspension_resume` marker, so Rule 1 never fires for it — its run-1
 *    emissions would otherwise survive next to the re-emitted run-2 copies. A
 *    re-run is visible as more than one `block_trace` on a logical path; the
 *    canonical (latest) trace's `itemIndex` is the start of the surviving run
 *    (traces reserve their index at block start). Use it as the supersession
 *    boundary, merged with Rule 1's so the later boundary wins. A block that ran
 *    once (one trace) — including a completed block injected from the log on
 *    replay — has no boundary and is left untouched.
 * 4. **Generator tool-call de-duplication (FIX-814).** A generator that suspends
 *    inside its tool loop re-runs on resume, setting a Rule-1/3 boundary on the
 *    generator's own logical path. But a `tool_output` carries its parent
 *    generator's `blockInstanceId` as provenance, so a completed *sibling* tool
 *    call that settled on run 1 (below the boundary) would be dropped even
 *    though resume never re-runs it — it is injected from the log, not
 *    re-emitted, so no run-2 copy replaces it. Losing it would make a post-resume
 *    `GET`/`useSession` incomplete. Tool calls are memoized per `toolCall.callId`,
 *    so `tool_output`s are collapsed by (logical path + callId) instead of by the
 *    generator's re-run boundary: the canonical one per callId is the `completed`
 *    (or highest-index) record — the run-2 approved result supersedes its run-1
 *    `failed`(SUSPENSION) gate record for the same callId, while a completed
 *    sibling with no run-2 copy survives. `tool_output` is therefore exempt from
 *    the Rule-1/3 boundary. Non-generator (`.asTool()`) outputs have unique
 *    synthesized callIds, so this is a no-op for them.
 *
 * Order and identity of the surviving items are preserved. A request that never
 * suspended is returned unchanged (no resolved suspensions, no duplicate
 * traces).
 */
export function collapseToCanonicalLog<T extends OutputItem>(items: readonly T[]): T[] {
  // Rule 1: logical path -> highest itemIndex of a RESOLVED suspension on it.
  const resumedSuspensionIds = new Set<string>();
  for (const item of items) {
    if (item.type === "suspension_resume") {
      const id = (item as { suspensionId?: string }).suspensionId;
      if (id !== undefined) resumedSuspensionIds.add(id);
    }
  }
  const supersededBefore = new Map<string, number>();
  for (const item of items) {
    if (item.type !== "suspension") continue;
    const suspId = (item as { suspensionId?: string }).suspensionId;
    if (suspId === undefined || !resumedSuspensionIds.has(suspId)) continue;
    const logicalId = suspensionLogicalId(item);
    if (logicalId === undefined) continue;
    const prior = supersededBefore.get(logicalId);
    if (prior === undefined || item.itemIndex > prior) {
      supersededBefore.set(logicalId, item.itemIndex);
    }
  }

  // Rule 2: logical path -> the id of its canonical block_trace. `block_trace`
  // is an internal (RuntimeItem) type absent from the public `OutputItem`
  // union, so compare the widened string to avoid narrowing the branch away.
  // `traceCount` tracks how many traces each logical path has, so Rule 3 can
  // tell a re-run (>1) from a single run.
  const canonicalTrace = new Map<string, { id: string; itemIndex: number; completed: boolean }>();
  const traceCount = new Map<string, number>();
  for (const item of items) {
    if ((item.type as string) !== "block_trace") continue;
    const logicalId = logicalIdOf(item.provenance?.blockInstanceId);
    if (logicalId === undefined) continue;
    traceCount.set(logicalId, (traceCount.get(logicalId) ?? 0) + 1);
    const completed = item.status === "completed";
    const prior = canonicalTrace.get(logicalId);
    if (prior === undefined) {
      canonicalTrace.set(logicalId, { id: item.id, itemIndex: item.itemIndex, completed });
      continue;
    }
    // A completed trace always beats a non-completed one; among same-rank
    // traces the higher itemIndex wins.
    const better =
      (completed && !prior.completed) ||
      (completed === prior.completed && item.itemIndex > prior.itemIndex);
    if (better) canonicalTrace.set(logicalId, { id: item.id, itemIndex: item.itemIndex, completed });
  }

  // Rule 3: for every logical path that re-ran (more than one trace), use its
  // canonical trace's itemIndex — the start of the surviving run — as the
  // supersession boundary, taking the later of it and any Rule-1 boundary. This
  // is what catches crash-recovery `continue` (no suspension marker); for the
  // resume path the run-2 trace starts after `suspension_resume`, so it agrees
  // with (and never precedes) Rule 1.
  for (const [logicalId, count] of traceCount) {
    if (count < 2) continue;
    const canonical = canonicalTrace.get(logicalId);
    if (canonical === undefined) continue;
    const prior = supersededBefore.get(logicalId);
    if (prior === undefined || canonical.itemIndex > prior) {
      supersededBefore.set(logicalId, canonical.itemIndex);
    }
  }

  // Rule 4: per (logical path + callId) canonical `tool_output`. Keyed the same
  // way Rule 2 keys traces — a `completed` output always beats a non-completed
  // one; among same-rank outputs the higher itemIndex wins. This dedups a
  // gate's run-1 `failed`(SUSPENSION) record against its run-2 `completed`
  // result and keeps a completed sibling that has no run-2 copy.
  //
  // Keying assumes a tool call id is unique within a generator instance — true
  // for real providers, whose call ids are globally unique. The tool's own
  // block path additionally folds the model-step index for gate-matching, but
  // the persisted `tool_output` carries only the generator's provenance + the
  // bare call id, so this dedup can't distinguish two steps that reuse one call
  // id. A composite `.asTool()` block that itself suspends is the one narrow
  // exception: it synthesizes a fresh call id per run, so its superseded run-1
  // `failed` record has no same-key replacement and survives here (an
  // observability-only artifact in `GET`, never an execution effect).
  const canonicalToolOutput = new Map<string, { id: string; itemIndex: number; completed: boolean }>();
  for (const item of items) {
    if (item.type !== "tool_output") continue;
    const logicalId = logicalIdOf(item.provenance?.blockInstanceId);
    const callId = (item as { toolCall?: { callId?: string } }).toolCall?.callId;
    if (logicalId === undefined || callId === undefined) continue;
    const key = `${logicalId}::${callId}`;
    const completed = item.status === "completed";
    const prior = canonicalToolOutput.get(key);
    if (prior === undefined) {
      canonicalToolOutput.set(key, { id: item.id, itemIndex: item.itemIndex, completed });
      continue;
    }
    const better =
      (completed && !prior.completed) ||
      (completed === prior.completed && item.itemIndex > prior.itemIndex);
    if (better) canonicalToolOutput.set(key, { id: item.id, itemIndex: item.itemIndex, completed });
  }

  if (
    supersededBefore.size === 0 &&
    canonicalTrace.size === 0 &&
    canonicalToolOutput.size === 0
  ) {
    return [...items];
  }

  return items.filter((item) => {
    if ((item.type as string) === "block_trace") {
      const logicalId = logicalIdOf(item.provenance?.blockInstanceId);
      if (logicalId === undefined) return true;
      const canonical = canonicalTrace.get(logicalId);
      return canonical === undefined || canonical.id === item.id;
    }
    // The audit pair is always retained.
    if (item.type === "suspension" || item.type === "suspension_resume") return true;
    // Rule 4: `tool_output` is deduped per callId (above), NOT by the
    // generator's re-run boundary — a completed sibling injected from the log on
    // resume has no run-2 copy and must survive.
    if (item.type === "tool_output") {
      const logicalId = logicalIdOf(item.provenance?.blockInstanceId);
      const callId = (item as { toolCall?: { callId?: string } }).toolCall?.callId;
      if (logicalId === undefined || callId === undefined) return true;
      const canonical = canonicalToolOutput.get(`${logicalId}::${callId}`);
      return canonical === undefined || canonical.id === item.id;
    }
    // `generator_step` is a replay-only artifact keyed per generator-path +
    // step (FIX-814). The suspending generator re-runs on resume, which sets a
    // supersession boundary on its logical path — but these artifacts are the
    // substrate a LATER resume cycle reconstructs from, so they must survive
    // collapse like the audit pair. They are never client/history-visible, so
    // retaining them cannot leak into a `GET`/`useSession` view.
    if ((item.type as string) === "generator_step") return true;
    const logicalId = logicalIdOf(item.provenance?.blockInstanceId);
    if (logicalId === undefined) return true;
    const boundary = supersededBefore.get(logicalId);
    return boundary === undefined || item.itemIndex >= boundary;
  });
}
