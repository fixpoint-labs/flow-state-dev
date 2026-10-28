/**
 * Cancel a suspension that waits for a user, and continue its request
 * (FIX-2129): the engine half of `RequestHost.resumeWait({ suspension,
 * outcome: { cancelled: true } })`.
 *
 * A board pays it when a task waiting on a user is cancelled (the cancel's
 * debt), and to end one stop of a task that goes on. The suspension resolves
 * through its single pending state, under its request's lease, the fence every
 * answer takes: whichever comes first wins and the other is told
 * `already-resolved`. The block then reads `{ cancelled: true }` and runs to
 * its end.
 *
 * The caller names the suspension by its request and id, read off a row the
 * board wrote, and it must be this principal's: the request the suspension
 * parks carries the same user, tenant and organization as the running one. Any
 * other answers `gate-not-found`, as a wait gate in another session does, so
 * the verb is not an oracle. The request may be in another session: a task
 * runs in a session of its own, and the board that cancels it is the filer's.
 *
 * `first` runs under the lease, once the suspension is found pending and
 * before it resolves: the board's write that cancels the task. An answer that
 * arrives meanwhile finds the lease held, and then the suspension resolved.
 *
 * `taskCancelled` says the task the run works is cancelled with this stop. It
 * is recorded on the suspension's resume data, so the continued run, and a
 * re-drive of it, asks nobody again: a later wait for a user resolves
 * `cancelled` at once. Without it only this stop ends, and the run's next
 * wait for a user suspends as usual.
 *
 * A suspension already recorded `cancelled` whose request is still parked is a
 * cancel whose continuation never started (a crash after the write): it is
 * continued, as the sweep's re-drive continues it.
 */
import { isUserSuspension, isWaitGate } from "@flow-state-dev/core/types";
import type { ResumeWaitResult, SuspensionAddress, SuspensionRecord } from "@flow-state-dev/core/types";
import type { WaitResumeDeps } from "./resume-wait-gate";
import { continueUnderLease, latestGateIdOf, resumeUnderLease } from "./resume-under-lease";
import { loggedUserStop, PARKED } from "./stop-suspended";

/** Who is asking: the running request's principal, server-derived. */
export type CancelOwner = {
  readonly userId: string;
  readonly tenantId: string | undefined;
  readonly orgId: string;
};

type Refusal = Extract<ResumeWaitResult, { ok: false }>;

/** The resume data a cancel of the run's task records (see the module header). */
const TASK_CANCELLED = { taskCancelled: true } as const;

/** Whether a cancelled suspension's resume data says its task was cancelled with it. */
export function cancelledWithTask(data: unknown): boolean {
  return typeof data === "object" && data !== null && (data as { taskCancelled?: unknown }).taskCancelled === true;
}

const notFound = (address: SuspensionAddress): Refusal => ({
  ok: false,
  refused: "gate-not-found",
  detail: `no suspension "${address.suspensionId}" waits for a user in request "${address.requestId}"`
});

const resolved = (address: SuspensionAddress, why: string): Refusal => ({
  ok: false,
  refused: "already-resolved",
  detail: `suspension "${address.suspensionId}" ${why}`
});

const busy = (address: SuspensionAddress, why: string): Refusal => ({
  ok: false,
  refused: "busy",
  detail: `suspension "${address.suspensionId}": ${why}; try again shortly`
});

/** Cancel the user's suspension at `address` (see the module header). */
export async function cancelUserSuspension(
  deps: WaitResumeDeps,
  address: SuspensionAddress,
  owner: CancelOwner,
  first?: () => Promise<void>,
  options?: { readonly taskCancelled?: boolean }
): Promise<ResumeWaitResult> {
  const request = await deps.stores.request.get(address.requestId);
  if (
    request === undefined ||
    request.userId !== owner.userId ||
    (request.tenantId ?? undefined) !== owner.tenantId ||
    (request.orgId ?? undefined) !== owner.orgId
  ) {
    return notFound(address);
  }
  const gate = await deps.provider.loadSuspension(address.requestId, address.suspensionId);
  // A request that finished has had its stops cleaned up; its log still names one it asked, resolved.
  if (gate === null && loggedUserStop(request, address.suspensionId)) return resolved(address, `was resolved, and its request is "${request.status}"`);
  if (gate === null || isWaitGate(gate) || !isUserSuspension(gate)) return notFound(address);
  if (gate.status === "cancelled") return continueCancelled(deps, gate);

  const result = await resumeUnderLease<Refusal>(deps, {
    requestId: address.requestId,
    holder: "cancel",
    // Re-read under the lease: an answer that won the race has resolved it.
    admit: async () => {
      const current = await deps.provider.loadSuspension(address.requestId, address.suspensionId);
      if (current === null) return { refusal: notFound(address) };
      if (current.status !== "pending") return { refusal: resolved(address, `was already resolved (${current.status})`) };
      const parked = await parkedOn(deps, current);
      if (parked !== true) return { refusal: parked };
      await first?.();
      return { suspension: current };
    },
    action: "reject",
    ...(options?.taskCancelled === true ? { data: TASK_CANCELLED } : {}),
    resumedBy: "cancel",
    status: "cancelled"
  });
  if (result.ok) return { ok: true };
  if ("refusal" in result) return result.refusal;
  return busy(address, "another resume of its request holds it");
}

/**
 * Whether the request is parked on this suspension, so a continuation can
 * replay its resolution onto it: `suspended`, or `interrupted` with the
 * suspension on its log. One still parking (`in_progress`: the suspension is
 * written, the request not yet recorded `suspended`) is `busy`.
 */
async function parkedOn(deps: WaitResumeDeps, gate: SuspensionRecord): Promise<true | Refusal> {
  const address = { requestId: gate.requestId, suspensionId: gate.suspensionId };
  const request = await deps.stores.request.get(gate.requestId);
  if (request?.status === "in_progress") return busy(address, "its request has not finished parking");
  if (request?.status === "interrupted" && latestGateIdOf(request) !== gate.suspensionId) {
    return busy(address, "its request was interrupted before it parked");
  }
  if (request === undefined || !PARKED.includes(request.status)) {
    return resolved(address, `belongs to a request that is "${request?.status ?? "gone"}", not parked`);
  }
  return true;
}

/** Continue a request whose suspension is already recorded `cancelled`, if it is still parked on it. */
async function continueCancelled(deps: WaitResumeDeps, gate: SuspensionRecord): Promise<ResumeWaitResult> {
  const address = { requestId: gate.requestId, suspensionId: gate.suspensionId };
  const result = await continueUnderLease<Refusal>(deps, {
    requestId: address.requestId,
    holder: "cancel",
    admit: async () => {
      const request = await deps.stores.request.get(address.requestId);
      const latest = request === undefined ? undefined : latestGateIdOf(request);
      // No log to read (a store that keeps none here): trust the suspension.
      if (request === undefined || !PARKED.includes(request.status) || (latest !== undefined && latest !== address.suspensionId)) {
        return { refusal: resolved(address, "was cancelled, and its request has moved on") };
      }
      return {
        resumeContext: { suspensionId: address.suspensionId, action: "reject", data: gate.resumeData, resumedBy: "cancel" }
      };
    }
  });
  if (result.ok) return { ok: true };
  if ("refusal" in result) return result.refusal;
  return busy(address, "another resume of its request holds it");
}
