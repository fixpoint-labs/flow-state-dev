/**
 * In-memory registry tracking pending suspensions across active requests.
 *
 * Each suspension is a promise that blocks execution inside a handler/sequencer
 * until the client calls the resume endpoint. The registry stores the
 * resolve/reject callbacks so the resume route can settle the promise.
 *
 * This is the lightweight (non-durable) implementation — suspensions do not
 * survive server restarts. FIX-141 adds a DurabilityProvider on top.
 */
import type { SuspensionStatus } from "@flow-state-dev/core/items";
import type { ResumePayload } from "@flow-state-dev/core/types";

export type PendingSuspension = {
  suspensionId: string;
  requestId: string;
  reason: string;
  data?: Record<string, unknown>;
  render?: { component: string; props?: Record<string, unknown> };
  createdAt: number;
  resolve: (payload: ResumePayload) => void;
  reject: (error: Error) => void;
  timeoutTimer?: ReturnType<typeof setTimeout>;
  status: SuspensionStatus;
};

/**
 * Global in-memory registry of pending suspensions keyed by suspensionId.
 * A secondary index maps requestId → Set<suspensionId> for bulk cleanup.
 */
const suspensionById = new Map<string, PendingSuspension>();
const suspensionsByRequest = new Map<string, Set<string>>();

/**
 * Registers a new pending suspension. Called by ctx.suspend().
 */
export function registerSuspension(suspension: PendingSuspension): void {
  suspensionById.set(suspension.suspensionId, suspension);

  let requestSet = suspensionsByRequest.get(suspension.requestId);
  if (requestSet === undefined) {
    requestSet = new Set();
    suspensionsByRequest.set(suspension.requestId, requestSet);
  }
  requestSet.add(suspension.suspensionId);
}

/**
 * Looks up a pending suspension by ID. Returns undefined if not found
 * or already resolved.
 */
export function getSuspension(suspensionId: string): PendingSuspension | undefined {
  return suspensionById.get(suspensionId);
}

/**
 * Removes a suspension from the registry. Called after resolve/reject/timeout.
 */
export function removeSuspension(suspensionId: string): void {
  const suspension = suspensionById.get(suspensionId);
  if (suspension === undefined) return;

  if (suspension.timeoutTimer !== undefined) {
    clearTimeout(suspension.timeoutTimer);
  }

  suspensionById.delete(suspensionId);

  const requestSet = suspensionsByRequest.get(suspension.requestId);
  if (requestSet !== undefined) {
    requestSet.delete(suspensionId);
    if (requestSet.size === 0) {
      suspensionsByRequest.delete(suspension.requestId);
    }
  }
}

/**
 * Cleans up all pending suspensions for a request. Called when a request
 * completes, fails, or is interrupted. Rejects any still-pending promises
 * with a cancellation error.
 */
export function cleanupRequestSuspensions(requestId: string): void {
  const requestSet = suspensionsByRequest.get(requestId);
  if (requestSet === undefined) return;

  for (const suspensionId of requestSet) {
    const suspension = suspensionById.get(suspensionId);
    if (suspension !== undefined && suspension.status === "pending") {
      if (suspension.timeoutTimer !== undefined) {
        clearTimeout(suspension.timeoutTimer);
      }
      suspension.status = "rejected";
      suspension.reject(new Error("Request completed while suspension was pending"));
    }
    suspensionById.delete(suspensionId);
  }

  suspensionsByRequest.delete(requestId);
}

/**
 * Returns all pending suspension IDs for a request.
 */
export function getRequestSuspensions(requestId: string): string[] {
  const requestSet = suspensionsByRequest.get(requestId);
  if (requestSet === undefined) return [];
  return Array.from(requestSet);
}

/**
 * Resets the registry (for testing only).
 * @internal
 */
export function resetSuspensionRegistry(): void {
  for (const suspension of suspensionById.values()) {
    if (suspension.timeoutTimer !== undefined) {
      clearTimeout(suspension.timeoutTimer);
    }
  }
  suspensionById.clear();
  suspensionsByRequest.clear();
}
