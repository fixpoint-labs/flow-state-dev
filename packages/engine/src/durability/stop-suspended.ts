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
 *   continues with the stop recorded on it (`abortRequested`): the run reads
 *   it at its first abort poll, before anything runs, and ends `aborted`
 *   through its own lifecycle (the gate's `suspension_resume` item, the
 *   finished hook, the terminal event, finalization). No block runs on.
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
import { resolveRequestIncarnation } from "../stores/scope-keys";
import { resumeAskGate } from "./resume-ask-gate";
import { continueUnderLease, latestGateIdOf, resumeUnderLease, type ResumeDeps } from "./resume-under-lease";

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
export async function pendingGatesOf(
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
 * Stop a suspended request. The caller has already checked the caller may
 * reach it.
 */
export async function stopSuspendedRequest(
  deps: SuspendedStopDeps,
  record: RequestRecord
): Promise<SuspendedStopResult> {
  const [gate] = await pendingGatesOf(deps, record);
  if (gate === undefined) {
    // Parked behind a gate that expired: nothing will ever continue the turn
    // on its own, so the stop does, and it ends through its own lifecycle.
    const expired = await expiredLatestGate(deps, record);
    if (expired !== undefined) {
      const resumeContext: ResumeContext = { suspensionId: expired.suspensionId, action: "reject", resumedBy: "stop" };
      return (await continueWithStop(deps, record, resumeContext)) ? "stopped" : "already-resolved";
    }
    // No pending gate: an answer resolved it first, and the turn runs again.
    return "already-resolved";
  }

  // A turn interrupted before its log held the gate can't be replayed onto it:
  // it is continued as crash recovery continues it, with the stop recorded, so
  // it parks on the gate again and the stop is then carried as for any parked
  // turn (`runAction`'s carry, or the sweep's).
  const replayable = record.status === "suspended" || latestGateIdOf(record) === gate.suspensionId;
  if (!replayable) return (await continueWithStop(deps, record, undefined)) ? "stopped" : "already-resolved";

  // An ask continues, so its call ends what it asked for.
  if (isAskGate(gate)) {
    const result = await resumeAskGate(deps, gate, { answered: false, stopped: true }, "stop");
    // A refusal is the race lost: an answer (or a timeout) resolved the gate
    // first, or holds the turn's lease to do so right now.
    return result.ok ? "stopped" : "already-resolved";
  }

  const ended = await stopAtNonAskGate(deps, record, gate);
  return ended ? "stopped" : "already-resolved";
}

/** The turn's last logged gate, when it expired: the turn waits on nothing now. */
async function expiredLatestGate(
  deps: SuspendedStopDeps,
  record: RequestRecord
): Promise<SuspensionRecord | undefined> {
  const suspensionId = latestGateIdOf(record);
  if (suspensionId === undefined) return undefined;
  const gate = await deps.provider.loadSuspension(record.id, suspensionId);
  return gate?.status === "expired" ? gate : undefined;
}

/**
 * Record the stop on the parked turn itself (`abortRequested`), fenced on it
 * still being parked under the incarnation that was checked. `false` when
 * another request took the id, or the turn moved on.
 */
async function recordStop(
  deps: SuspendedStopDeps,
  record: Pick<RequestRecord, "id" | "createdAt" | "incarnation">
): Promise<boolean> {
  const result = await deps.stores.request.setFieldsIfStatus(
    record.id,
    { abortRequested: true },
    PARKED,
    Date.now(),
    resolveRequestIncarnation(record)
  );
  return result.applied;
}

/**
 * Resolve a non-ask gate `stopped`, through the gate's single pending state,
 * and continue the turn with the stop recorded on it: it ends `aborted`
 * through its own lifecycle without running on. Under the request's lease.
 */
async function stopAtNonAskGate(
  deps: SuspendedStopDeps,
  record: RequestRecord,
  gate: SuspensionRecord
): Promise<boolean> {
  const result = await resumeUnderLease<"refused">(deps, {
    requestId: record.id,
    holder: "stop",
    admit: async () => {
      const current = await deps.provider.loadSuspension(record.id, gate.suspensionId);
      if (current === null || current.status !== "pending") return { refusal: "refused" };
      // Fenced on the incarnation checked: if another request took the id in
      // between, nothing is stopped, and the caller hears `already-resolved`.
      if (!(await recordStop(deps, record))) return { refusal: "refused" };
      return { suspension: current };
    },
    // Read as a rejection only if a block reaches the gate before the stop
    // does; the stop recorded on the turn ends it first.
    action: "reject",
    resumedBy: "stop",
    status: "stopped"
  });
  return result.ok;
}

/**
 * Continue a parked turn with the stop recorded on it, under its lease:
 * `resumeContext` replays a resolved gate; without one the turn is continued
 * as crash recovery continues it.
 */
async function continueWithStop(
  deps: SuspendedStopDeps,
  record: RequestRecord,
  resumeContext: ResumeContext | undefined
): Promise<boolean> {
  const result = await continueUnderLease<"refused">(deps, {
    requestId: record.id,
    holder: "stop",
    admit: async () => ((await recordStop(deps, record)) ? { resumeContext } : { refusal: "refused" })
  });
  return result.ok;
}

/** Why a re-drive left a request alone. */
export type RedriveRefusal = "not-parked" | "superseded";

/**
 * Drive on a request left parked behind a gate that is already resolved: the
 * re-drive (BR-11a, BR-16c). Any ask outcome continues the turn with the
 * recorded outcome, never a new one; a non-ask gate resolved `stopped`
 * continues it with the stop recorded on it, so it ends `aborted` through its
 * own lifecycle. Under the request's lease, so a live resume is never raced.
 *
 * `gate` must be the request's latest gate; a request that has since parked
 * on a newer one is left alone (`superseded`).
 */
export async function redriveResolvedGate(
  deps: SuspendedStopDeps,
  gate: SuspensionRecord
): Promise<"redriven" | "busy" | RedriveRefusal> {
  if (!isAskGate(gate) && gate.status !== "stopped") return "not-parked";

  const result = await continueUnderLease<RedriveRefusal>(deps, {
    requestId: gate.requestId,
    holder: "redrive",
    admit: async () => {
      const record = await deps.stores.request.get(gate.requestId);
      if (record === undefined || !PARKED.includes(record.status)) return { refusal: "not-parked" };
      if (!isLatestGate(record, gate.suspensionId)) return { refusal: "superseded" };
      const current = await deps.provider.loadSuspension(gate.requestId, gate.suspensionId);
      if (current === null || current.status === "pending") return { refusal: "superseded" };
      if (!isAskGate(current)) {
        // A stopped approval: the stop recorded on the turn ends it.
        if (!(await recordStop(deps, record))) return { refusal: "not-parked" };
        return {
          resumeContext: { suspensionId: current.suspensionId, action: "reject", resumedBy: current.resolvedBy }
        };
      }
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
