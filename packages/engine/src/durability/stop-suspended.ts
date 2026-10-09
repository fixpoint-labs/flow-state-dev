/**
 * Stopping a parked turn (FIX-1816, BR-16 to BR-16c).
 *
 * A running turn is stopped by recording the intent and firing its signal
 * (`execution/record-request-stop.ts`). A suspended turn has no signal to
 * fire: nothing is running. So its stop resolves the gate it is parked on,
 * through the gate's single pending state (the fence every resume shares), and
 * then:
 *
 * - **An ask gate** is resolved with a stop outcome and the turn continues, so
 *   the parked call, which holds the asked row, can cancel it. The engine
 *   cannot reach the board, so it never cancels the row itself. The call then
 *   ends its own turn `aborted` with no further model call.
 * - **Any other gate** (a person's approval) is resolved `stopped` and the turn
 *   ends `aborted` where it stands. Nothing continues.
 *
 * A stop that finds no pending gate lost the race to an answer: the turn is
 * running again, and the stop reports `already-resolved`. A second stop reaches
 * the running turn as any stop does.
 *
 * The gate's resolved record, `stopped`, is the obligation. If the process dies
 * before the turn leaves `suspended`, the durability sweep's re-drive finishes
 * it ({@link redriveResolvedGate}).
 */
import { isAskGate } from "@flow-state-dev/core/types";
import type { ResumeContext, SuspensionRecord } from "@flow-state-dev/core/types";
import type { RequestRecord, StoreRegistry } from "../stores/types";
import type { RequestStreamEvent, SuspensionResumeItem } from "@flow-state-dev/core/items";
import { resolveRequestIncarnation } from "../stores/scope-keys";
import { settledRecordFields } from "../execution/request-action-result";
import { resumeAskGate } from "./resume-ask-gate";
import { continueUnderLease, latestGateIdOf, RESUME_LEASE_MS, type ResumeDeps } from "./resume-under-lease";
import { generateId } from "../utils/generate-id";

/** What a stop of a parked turn needs from the host. */
export type SuspendedStopDeps = ResumeDeps & {
  stores: Pick<StoreRegistry, "request">;
};

/**
 * The one way a host builds what stopping a parked turn needs: its durability
 * provider, its stores, and how it continues a request. Every site that wires
 * the stop (the abort route, `ctx.session.stopRequest` through the request
 * host) builds it here.
 */
export function createParkedStopDeps(deps: {
  provider: SuspendedStopDeps["provider"];
  stores: SuspendedStopDeps["stores"];
  continueRequest: SuspendedStopDeps["continueRequest"];
}): SuspendedStopDeps {
  return { provider: deps.provider, stores: deps.stores, continueRequest: deps.continueRequest };
}

/** What stopping a parked turn came to. */
export type SuspendedStopResult = "stopped" | "already-resolved";

/** The request statuses a parked turn can be read in: parked, or a re-drive's crash. */
export const PARKED: readonly RequestRecord["status"][] = ["suspended", "interrupted"];

/** The pending gate(s) `record` is parked on, newest first. */
async function pendingGatesOf(
  deps: SuspendedStopDeps,
  record: Pick<RequestRecord, "id" | "sessionId" | "userId">
): Promise<SuspensionRecord[]> {
  // Bounded by one session's pending gates: a conversation has few. (A
  // request-id filter on the store is the follow-up if stopping grows hot.)
  const pending = await deps.provider.listSuspended({
    userId: record.userId,
    ...(record.sessionId !== undefined ? { sessionId: record.sessionId } : {}),
    status: "pending"
  });
  // Newest first, sorted here rather than trusted to the store's order.
  return pending
    .filter((s) => s.requestId === record.id)
    .sort((a, b) => b.createdAt - a.createdAt);
}

/**
 * End a parked turn `aborted` where it stands, without running anything:
 * fenced on the turn still being parked, on the incarnation that was checked.
 * Then, as a run that resumes and ends writes them: the gate's
 * `suspension_resume` item recording the stop, persisted and streamed, so the
 * gate no longer reads as open, and the terminal `request.aborted` event, so a
 * stream following the turn through its park ends.
 */
async function abortParked(
  deps: SuspendedStopDeps,
  record: Pick<RequestRecord, "id" | "createdAt" | "incarnation" | "items">,
  gate: Pick<SuspensionRecord, "suspensionId" | "resolvedAt" | "resolvedBy">
): Promise<boolean> {
  const now = Date.now();
  const result = await deps.stores.request.setFieldsIfStatus(
    record.id,
    {
      ...settledRecordFields({ status: "aborted" }),
      abortRequested: true,
      abortedAt: now,
      completedAtMs: now,
      // Nothing runs on, so nothing is left to write under this id.
      finalizedAtMs: now
    },
    PARKED,
    now,
    resolveRequestIncarnation(record)
  );
  if (!result.applied) return false;
  try {
    const resumeItem: SuspensionResumeItem = {
      id: `item_suspension_resume_${now}_${Math.random().toString(16).slice(2)}`,
      type: "suspension_resume",
      status: "completed",
      suspensionId: gate.suspensionId,
      resolution: "stopped",
      resolvedBy: gate.resolvedBy,
      resolvedAt: gate.resolvedAt ?? now,
      requestId: record.id,
      itemIndex: (record.items ?? []).reduce((max, item) => Math.max(max, (item.itemIndex ?? -1) + 1), 0),
      provenance: { blockName: "runtime", blockInstanceId: "runtime", phase: "main" },
      ts: now
    };
    deps.stores.request.persistItems(record.id, [resumeItem]);
    await deps.stores.request.flushItems(record.id);
    const prior = await deps.stores.request.getEvents(record.id);
    const last = prior.reduce((max, e) => Math.max(max, e.sequence_number), 0);
    const event = (sequence: number, body: Record<string, unknown>) =>
      ({ stream: "request", requestId: record.id, sequence_number: sequence, ts: now, ...body }) as RequestStreamEvent;
    deps.stores.request.persistEvents(record.id, [
      event(last + 1, { type: "item.added", item: resumeItem }),
      event(last + 2, { type: "item.done", item: resumeItem }),
      event(last + 3, { type: "request.aborted", status: "aborted" })
    ]);
    await deps.stores.request.flushEvents(record.id);
  } catch {
    // The turn is aborted: the record says so, and a reader falls back to it.
  }
  return true;
}

/**
 * Stop a suspended request. The caller has already checked the caller may
 * reach it.
 */
export async function stopSuspendedRequest(
  deps: SuspendedStopDeps,
  record: RequestRecord
): Promise<SuspendedStopResult> {
  const [gate] = await pendingGatesOf(deps, record);
  // No pending gate: an answer resolved it first, and the turn runs again.
  if (gate === undefined) return "already-resolved";

  // An ask continues, so its call ends what it asked for. One whose turn was
  // interrupted before its log held the gate can't be replayed onto it, so it
  // is ended where it stands, as any other gate is.
  const replayable = record.status === "suspended" || latestGateIdOf(record) === gate.suspensionId;
  if (isAskGate(gate) && replayable) {
    const result = await resumeAskGate(deps, gate, { answered: false, stopped: true }, "stop");
    // A refusal is the race lost: an answer (or a timeout) resolved the gate
    // first, or holds the turn's lease to do so right now.
    return result.ok ? "stopped" : "already-resolved";
  }

  const ended = await stopAtNonAskGate(deps, record, gate);
  return ended ? "stopped" : "already-resolved";
}

/**
 * Resolve a non-ask gate `stopped` and end the turn `aborted`, under the
 * request's lease, through the gate's single pending state.
 */
async function stopAtNonAskGate(
  deps: SuspendedStopDeps,
  record: RequestRecord,
  gate: SuspensionRecord
): Promise<boolean> {
  const lease = await deps.provider.acquireLease(record.id, {
    holder: generateId("stop"),
    durationMs: RESUME_LEASE_MS
  });
  if (lease === null) return false;
  try {
    const current = await deps.provider.loadSuspension(record.id, gate.suspensionId);
    if (current === null || current.status !== "pending") return false;
    const now = Date.now();
    // The gate first: its resolved record is what a re-drive finishes from if
    // the process dies before the turn is written `aborted`.
    await deps.provider.suspend({ ...current, status: "stopped", resolvedAt: now, resolvedBy: "stop" });
    // Fenced on the incarnation checked: if another request took the id in
    // between, nothing was stopped, and the caller hears `already-resolved`.
    return abortParked(deps, record, { suspensionId: current.suspensionId, resolvedAt: now, resolvedBy: "stop" });
  } finally {
    await deps.provider.releaseLease(record.id, lease.leaseId).catch(() => {});
  }
}

/** Why a re-drive left a request alone. */
export type RedriveRefusal = "not-parked" | "superseded";

/**
 * Drive on a request left parked behind a gate that is already resolved: the
 * re-drive (BR-11a, BR-16c). Any ask outcome continues the turn with the
 * recorded outcome, never a new one; a non-ask gate resolved `stopped` ends the
 * turn `aborted`. Under the request's lease, so a live resume is never raced.
 *
 * `gate` must be the request's latest gate; a request that has since parked
 * on a newer one is left alone (`superseded`).
 */
export async function redriveResolvedGate(
  deps: SuspendedStopDeps,
  gate: SuspensionRecord
): Promise<"redriven" | "busy" | RedriveRefusal> {
  if (!isAskGate(gate)) {
    if (gate.status !== "stopped") return "not-parked";
    // Under the request's lease, as the live stop that wrote the gate holds
    // it until the turn is written aborted: the two never interleave.
    const lease = await deps.provider.acquireLease(gate.requestId, {
      holder: generateId("redrive"),
      durationMs: RESUME_LEASE_MS
    });
    if (lease === null) return "busy";
    try {
      const record = await deps.stores.request.get(gate.requestId);
      if (record === undefined || !PARKED.includes(record.status)) return "not-parked";
      if (!isLatestGate(record, gate.suspensionId)) return "superseded";
      return (await abortParked(deps, record, gate)) ? "redriven" : "not-parked";
    } finally {
      await deps.provider.releaseLease(gate.requestId, lease.leaseId).catch(() => {});
    }
  }

  const result = await continueUnderLease<RedriveRefusal>(deps, {
    requestId: gate.requestId,
    holder: "redrive",
    admit: async () => {
      const record = await deps.stores.request.get(gate.requestId);
      if (record === undefined || !PARKED.includes(record.status)) return { refusal: "not-parked" };
      if (!isLatestGate(record, gate.suspensionId)) return { refusal: "superseded" };
      const current = await deps.provider.loadSuspension(gate.requestId, gate.suspensionId);
      if (current === null || current.status === "pending") return { refusal: "superseded" };
      const resumeContext: ResumeContext = {
        suspensionId: current.suspensionId,
        action: "submit",
        data: current.resumeData,
        resumedBy: current.resolvedBy
      };
      return { resumeContext };
    }
  });
  if (result.ok) return "redriven";
  return "refusal" in result ? result.refusal : "busy";
}

/** Whether `suspensionId` is the last gate the request's item log parked on. */
function isLatestGate(record: RequestRecord, suspensionId: string): boolean {
  const latest = latestGateIdOf(record);
  // No log to read (a store that keeps none here): trust the gate.
  return latest === undefined || latest === suspensionId;
}
