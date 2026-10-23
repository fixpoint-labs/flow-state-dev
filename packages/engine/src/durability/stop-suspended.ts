/**
 * Stopping a parked turn (FIX-1816, BR-16 to BR-16c).
 *
 * A running turn is stopped by recording the intent and firing its signal
 * (`execution/record-request-stop.ts`). A suspended turn has no signal to
 * fire: nothing is running. So its stop resolves the gate it is parked on,
 * through the gate's single pending state (the fence every resume shares), and
 * then:
 *
 * - **A wait gate** is resolved with a stop outcome and the turn continues, so
 *   the parked call, which holds the waited-on row, can cancel it. The engine
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
 * the running turn as any stop does. A non-wait gate a person already resolved,
 * still owed a re-drive, is the exception (FIX-2108): re-recorded `stopped`,
 * fenced on that resolution and on it still being the last logged gate. The
 * person's answer is replaced, not kept: the turn never logged it.
 *
 * The gate's resolved record, `stopped`, is the obligation. If the process dies
 * before the turn leaves `suspended`, the durability sweep's re-drive finishes
 * it ({@link redriveResolvedGate}).
 *
 * The same re-drive carries an approval that expired (FIX-1846): the turn
 * continues with the gate read as a rejection marked expired, so the gated
 * call does not run and the model is told the approval is no longer valid.
 * A stop of a turn parked behind one still ends it `aborted`: the stop is
 * recorded on the turn, which its first abort poll reads before anything runs.
 *
 * And it carries a gate a person resolved (approved, rejected, submitted or
 * skipped) whose turn never continued (FIX-1850): the turn continues with the
 * person's recorded resolution, as their resume would have.
 */
import { isWaitGate, isExpiredApproval, RESUME_ACTION_STATUS } from "@flow-state-dev/core/types";
import type { ResumeAction, ResumeContext, SuspensionRecord } from "@flow-state-dev/core/types";
import type { RequestRecord, StoreRegistry } from "../stores/types";
import type { DurabilityProvider } from "./types";
import { resolveRequestIncarnation } from "../stores/scope-keys";
import { resumeWaitGate } from "./resume-wait-gate";
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
 * Stop a suspended request. The caller has already checked the caller may
 * reach it.
 */
export async function stopSuspendedRequest(
  deps: SuspendedStopDeps,
  record: RequestRecord
): Promise<SuspendedStopResult> {
  const [gate] = await pendingGatesOf(deps, record);
  if (gate === undefined) return stopBehindResolvedGate(deps, record);

  // A turn interrupted before its log held the gate can't be replayed onto it:
  // it is continued as crash recovery continues it, with the stop recorded, so
  // it parks on the gate again and the stop is then carried as for any parked
  // turn (`runAction`'s carry, or the sweep's).
  const replayable = record.status === "suspended" || latestGateIdOf(record) === gate.suspensionId;
  if (!replayable) return (await continueWithStop(deps, record, undefined)) ? "stopped" : "already-resolved";

  // A wait continues, so its call ends the task it waits on.
  if (isWaitGate(gate)) {
    const result = await resumeWaitGate(deps, gate, { answered: false, stopped: true }, "stop");
    // A refusal is the race lost: an answer (or a timeout) resolved the gate
    // first, or holds the turn's lease to do so right now.
    return result.ok ? "stopped" : "already-resolved";
  }

  const ended = await stopAtNonWaitGate(deps, record, gate);
  return ended ? "stopped" : "already-resolved";
}

/** No pending gate. An expiry is continued; a non-wait resolution still owed a re-drive is stopped. */
async function stopBehindResolvedGate(
  deps: SuspendedStopDeps,
  record: RequestRecord
): Promise<SuspendedStopResult> {
  const suspensionId = latestGateIdOf(record);
  const gate = suspensionId === undefined ? null : await deps.provider.loadSuspension(record.id, suspensionId);
  // Nothing continues an expired gate, so the stop does. Any `expired` status,
  // including a form that allows no reject (`isExpiredApproval` is narrower).
  if (gate?.status === "expired") {
    return (await continueWithStop(deps, record, {
      suspensionId: gate.suspensionId,
      action: "reject",
      resumedBy: "stop",
      resolution: "expired"
    })) ? "stopped" : "already-resolved";
  }
  // A person's resolution, or a stop. A resolved wait stays `already-resolved`.
  if (gate !== null && !isWaitGate(gate) && owesRedrive(gate)) {
    return (await stopAtNonWaitGate(deps, record, gate)) ? "stopped" : "already-resolved";
  }
  return "already-resolved";
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
 * Resolve a non-wait gate `stopped` and continue the turn with the stop
 * recorded on it: it ends `aborted` through its own lifecycle without running
 * on. Under the request's lease, fenced on the status that was read.
 */
async function stopAtNonWaitGate(
  deps: SuspendedStopDeps,
  record: RequestRecord,
  gate: SuspensionRecord
): Promise<boolean> {
  const result = await resumeUnderLease<"refused">(deps, {
    requestId: record.id,
    holder: "stop",
    admit: async () => {
      const current = await deps.provider.loadSuspension(record.id, gate.suspensionId);
      if (current === null || current.status !== gate.status) return { refusal: "refused" };
      // A resolved status stays as it is after a run goes past the gate, so it
      // alone can't tell an owed gate from one a re-drive already ran past to
      // a newer gate. It is owed only while it is still the turn's last gate.
      if (current.status !== "pending") {
        const fresh = await deps.stores.request.get(record.id);
        if (fresh === undefined || latestGateIdOf(fresh) !== gate.suspensionId) return { refusal: "refused" };
      }
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
  if (result.ok) return true;
  // Busy: someone holds the turn's lease. If it is a stop, the gate says so.
  return "busy" in result && (await deps.provider.loadSuspension(record.id, gate.suspensionId))?.status === "stopped";
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

/** Inverse of {@link RESUME_ACTION_STATUS}; a wait stays on the wait path. */
function personResolutionOf(gate: Pick<SuspensionRecord, "reason" | "status">): ResumeAction | undefined {
  if (isWaitGate(gate)) return undefined;
  const actions = Object.keys(RESUME_ACTION_STATUS) as ResumeAction[];
  return actions.find((action) => RESUME_ACTION_STATUS[action] === gate.status);
}

/**
 * Whether an `interrupted` request will run again: the last gate on its log is
 * still pending (a resume drives it), or resolved and owed a re-drive, which
 * the durability sweep gives it (step 2b). An interrupted request with no such
 * gate died while it ran, and nothing drives it again: its work is over.
 *
 * A wait's `ended` (`wait-chain.ts`) reads it alone, so it does not see an
 * unlogged pending gate; {@link parkedInterruptedIds} builds the parked rule on it. `record.items` must hold the request's log.
 */
export async function drivenAgain(
  provider: Pick<DurabilityProvider, "loadSuspension">,
  record: Pick<RequestRecord, "id" | "items">
): Promise<boolean> {
  const gateId = latestGateIdOf(record);
  if (gateId === undefined) return false;
  const gate = await provider.loadSuspension(record.id, gateId);
  if (gate === null) return false;
  return gate.status === "pending" || owesRedrive(gate);
}

/**
 * The ids of the `interrupted` records in `records` that are parked, not dead:
 * {@link drivenAgain} (the last logged gate is pending, or resolved and owed a
 * re-drive), or the store holds a pending gate of the request that its log
 * does not name yet (a crash between `provider.suspend` and the log append, or
 * a re-suspension). The one rule of a parked interrupted request: a stop
 * (`execution/record-request-stop.ts`), history and session retention
 * (`execution/past-turns.ts`) read it.
 *
 * Each record must carry its item log. One pending-gate read per session, and
 * a gate read per interrupted record the pending gates do not already cover.
 * Without a durability provider nothing can suspend, so none are parked. A
 * failed read rejects: the caller decides what an unknown answer means.
 */
export async function parkedInterruptedIds(
  provider: Pick<DurabilityProvider, "listSuspended" | "loadSuspension"> | undefined,
  records: readonly Pick<RequestRecord, "id" | "status" | "items" | "userId" | "sessionId">[]
): Promise<Set<string>> {
  const parked = new Set<string>();
  const interrupted = records.filter((r) => r.status === "interrupted");
  if (provider === undefined || interrupted.length === 0) return parked;
  const ids = new Set(interrupted.map((r) => r.id));
  const sessions = new Map<string, { userId: string; sessionId: string | undefined }>();
  for (const r of interrupted) sessions.set(`${r.userId}\u0000${r.sessionId ?? ""}`, { userId: r.userId, sessionId: r.sessionId });
  for (const { userId, sessionId } of sessions.values()) {
    const pending = await provider.listSuspended({ userId, ...(sessionId !== undefined ? { sessionId } : {}), status: "pending" });
    for (const gate of pending) if (ids.has(gate.requestId)) parked.add(gate.requestId);
  }
  for (const record of interrupted) {
    if (!parked.has(record.id) && (await drivenAgain(provider, record))) parked.add(record.id);
  }
  return parked;
}

/** Whether this gate owes a re-drive. The sweep and {@link redriveResolvedGate} both use it. */
export function owesRedrive(gate: Pick<SuspensionRecord, "reason" | "status" | "allow">): boolean {
  return (
    gate.status === "stopped" ||
    (gate.status === "submitted" && isWaitGate(gate)) ||
    isExpiredApproval(gate) ||
    personResolutionOf(gate) !== undefined
  );
}

/** A person's resolution and a wait's outcome. A stop and an expiry do not carry the recorded data. */
function recordedResume(current: SuspensionRecord, action: ResumeAction) {
  return {
    resumeContext: {
      suspensionId: current.suspensionId,
      action,
      data: current.resumeData,
      resumedBy: current.resolvedBy
    }
  };
}

/** Why a re-drive left a request alone. */
export type RedriveRefusal = "not-parked" | "superseded";

/**
 * Drive on a request left parked behind a gate that is already resolved: the
 * re-drive (BR-11a, BR-16c). Any wait outcome continues the turn with the
 * recorded outcome, never a new one; a non-wait gate resolved `stopped`
 * continues it with the stop recorded on it, so it ends `aborted` through its
 * own lifecycle; an approval that expired continues it with a rejection that
 * `runAction` marks expired from the gate (FIX-1846); a person's resolution of
 * any other gate continues it with that resolution and its data (FIX-1850).
 * Under the request's lease, so a live resume is never raced.
 *
 * `gate` must be the request's latest gate; a request that has since parked
 * on a newer one is left alone (`superseded`).
 */
export async function redriveResolvedGate(
  deps: SuspendedStopDeps,
  gate: SuspensionRecord
): Promise<"redriven" | "busy" | RedriveRefusal> {
  if (!isWaitGate(gate) && !owesRedrive(gate)) return "not-parked";

  const result = await continueUnderLease<RedriveRefusal>(deps, {
    requestId: gate.requestId,
    holder: "redrive",
    admit: async () => {
      const record = await deps.stores.request.get(gate.requestId);
      if (record === undefined || !PARKED.includes(record.status)) return { refusal: "not-parked" };
      if (!isLatestGate(record, gate.suspensionId)) return { refusal: "superseded" };
      const current = await deps.provider.loadSuspension(gate.requestId, gate.suspensionId);
      if (current === null || current.status === "pending") return { refusal: "superseded" };
      if (isExpiredApproval(current)) {
        // No longer valid: the gated call reads a rejection marked expired,
        // and the turn carries on.
        return {
          resumeContext: {
            suspensionId: current.suspensionId,
            action: "reject",
            resumedBy: current.resolvedBy,
            resolution: "expired"
          }
        };
      }
      const personAction = personResolutionOf(current);
      if (personAction !== undefined) return recordedResume(current, personAction);
      if (!isWaitGate(current)) {
        // Only a `stopped` non-wait gate is owed here: the stop recorded on the turn ends it.
        if (current.status !== "stopped" || !(await recordStop(deps, record))) return { refusal: "not-parked" };
        return {
          resumeContext: { suspensionId: current.suspensionId, action: "reject", resumedBy: current.resolvedBy }
        };
      }
      return recordedResume(current, "submit");
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
