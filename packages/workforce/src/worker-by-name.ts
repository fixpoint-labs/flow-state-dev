/**
 * `findWorkerByName`: the one lookup from a worker's name to the worker that
 * holds it.
 *
 * A worker's name is the one a mailbox's `members:` lists and `discover`
 * prints: the `seatId` the hire stamps on every worker it mints. It is not the
 * worker's address. A hire's address carries its organization (and, for a
 * worker one member owns, that member), and a declared worker's address is its
 * name. The lookup reads names, so a caller never has to know which.
 *
 * Which workers are searched comes from the caller, never from the name: the
 * workers the caller's organization shares, those registered for every
 * organization (declared in the app's files), and the caller's own. Another
 * organization's workers and a teammate's own are not there to be found.
 *
 * The workers are the list the host passes, normally its registry's `list()`
 * read at the call, so a worker hired a moment ago is found and one fired is
 * not. Anything in that list without a name (a mailbox kind, an app's own
 * flow) is not a worker and is skipped.
 */
import type { FlowInstance, InstanceOwnerPin } from "@flow-state-dev/core/types";
import { SEAT_ID_KEY } from "./manifest";

/** Who is asking: their organization, and the member, when there is one. */
export interface WorkerLookupCaller {
  orgId: string;
  userId?: string;
}

/** The name a worker answers to, or `undefined` for an instance that is not a worker. */
function nameOf(instance: FlowInstance): string | undefined {
  const name = (instance.config as Record<string, unknown> | undefined)?.[SEAT_ID_KEY];
  return typeof name === "string" && name.length > 0 ? name : undefined;
}

/** Whether `caller` may reach a worker with this pin: shared, their organization's, or their own. */
function reachableBy(pin: InstanceOwnerPin | undefined, caller: WorkerLookupCaller): boolean {
  if (pin === undefined) return true;
  if (pin.orgId !== caller.orgId) return false;
  return pin.userId === undefined || pin.userId === caller.userId;
}

/**
 * The one worker holding `name` that `caller` may reach.
 *
 * @param workers Every registered instance, as the host lists them now.
 * @param name The worker's name, as `members:` and `discover` spell it.
 * @param caller The caller's organization and member, from the verified
 *   principal, never from the input that carried `name`.
 * @returns The worker, or `undefined` when no worker the caller may reach
 *   holds the name.
 * @throws When two or more workers the caller may reach hold the name,
 *   naming each by its address. Neither is picked: a name that reaches two
 *   workers is a question for whoever chose it.
 */
export function findWorkerByName(
  workers: readonly FlowInstance[],
  name: string,
  caller: WorkerLookupCaller
): FlowInstance | undefined {
  const holding = workers.filter((worker) => nameOf(worker) === name && reachableBy(worker.ownerPin, caller));
  if (holding.length > 1) {
    throw new Error(
      `"${name}" is the name of ${holding.length === 2 ? "two" : holding.length} workers here: ${holding.map((worker) => `"${worker.id}"`).join(" and ")}. ` +
        "Neither is picked; name a worker only one of them holds."
    );
  }
  return holding[0];
}
