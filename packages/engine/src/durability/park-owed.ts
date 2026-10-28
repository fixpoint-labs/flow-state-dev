/**
 * A park a request owes (FIX-2269): a wait that starts its own work (a
 * dispatch, a call's send) and dies before its gate is written leaves a
 * request `interrupted` behind no gate, which nothing continued. The wait owes
 * the park first, kept as a wake the engine owns (never a flow's entry), on
 * the request's session, due when the request would count as dead; the park,
 * the wait's return and the request's end clear it.
 *
 * The durability sweep fires it (step 2c): a request still `interrupted` is
 * continued as the continue route continues one, and its replay parks on what
 * it already started; one still running moves the wake on; one parked or
 * ended clears it. A request still owing its park past
 * {@link PARK_OWED_GIVE_UP_MS} from the first owe is left `interrupted`, so a
 * crash loop can't spin the sweep.
 */
import { SuspensionError } from "@flow-state-dev/core";
import type { WakeKey, WakeStore } from "../stores/types";
import { generateId } from "../utils/generate-id";
import { noteWakeOwed } from "./request-wakes";
import { RESUME_LEASE_MS } from "./resume-under-lease";
import type { DurabilityProvider } from "./types";

/** The prefix of the wake entry a request's owed park is kept under. No flow declares one. */
const PARK_OWED_PREFIX = "parkOwed:";

/** How long from the first owe a request is continued before it is left `interrupted`: 10 minutes. */
export const PARK_OWED_GIVE_UP_MS = 600_000;

/** The wake entry the park `requestId` owes is kept under. */
function parkOwedEntry(requestId: string): string {
  return `${PARK_OWED_PREFIX}${requestId}`;
}

/** The request whose owed park `entry` keeps, or `undefined` for any other wake. */
export function parkOwedRequestOf(entry: string): string | undefined {
  return entry.startsWith(PARK_OWED_PREFIX) ? entry.slice(PARK_OWED_PREFIX.length) : undefined;
}

/** The wake key of the park a request owes, from its record's fields. */
export function parkOwedKey(request: { readonly id: string; readonly sessionId?: string; readonly tenantId?: string | null }): WakeKey | undefined {
  if (request.sessionId === undefined) return undefined;
  const tenant = request.tenantId != null && request.tenantId.length > 0 ? request.tenantId : undefined;
  return { ...(tenant !== undefined ? { tenantId: tenant } : {}), sessionId: request.sessionId, entry: parkOwedEntry(request.id) };
}

/** Whether `request` owes a park: a wake keeps it. */
export async function owesPark(
  store: WakeStore | undefined,
  request: { readonly id: string; readonly sessionId?: string; readonly tenantId?: string | null }
): Promise<boolean> {
  const key = parkOwedKey(request);
  if (store === undefined || key === undefined) return false;
  return (await store.get(key)) !== null;
}

/** Clear the park `key` owes, at the version read here. A wake owed again since is kept. */
export async function clearParkOwed(store: WakeStore, key: WakeKey): Promise<void> {
  const wake = await store.get(key);
  if (wake !== null) await store.clear(key, wake.version);
}

/**
 * Let the park a stopped request owes go, under the request's lease. The sweep
 * admits a continuation under the same lease and reads the owe again there,
 * so a stop and a continuation never both land: `busy` when a continuation
 * (or a resume) holds the lease, and the request runs again.
 */
export async function letOwedParkGo(
  provider: DurabilityProvider,
  store: WakeStore,
  request: { readonly id: string; readonly sessionId?: string; readonly tenantId?: string | null }
): Promise<"let-go" | "busy"> {
  const key = parkOwedKey(request);
  // Nothing owed: only the running request writes the owe, and it is dead.
  if (key === undefined || (await store.get(key)) === null) return "let-go";
  const lease = await provider.acquireLease(request.id, { holder: generateId("park-owed-stop"), durationMs: RESUME_LEASE_MS });
  if (lease === null) return "busy";
  try {
    await clearParkOwed(store, key);
    return "let-go";
  } finally {
    await provider.releaseLease(request.id, lease.leaseId);
  }
}

/** What {@link createOwingPark} is built from: the running request, server-derived. */
export type OwingParkInputs = {
  readonly store: WakeStore;
  readonly requestId: string;
  readonly identity: { readonly userId: string; readonly tenantId: string | undefined; readonly orgId: string; readonly sessionId: string };
  /** The running flow instance's id. */
  readonly flowId: string;
  /** How long until the request would count as dead: its lease, the stale threshold. */
  readonly fenceMs: number;
  readonly now?: () => number;
};

/** Build `RequestWaits.owingPark` for one request. */
export function createOwingPark(inputs: OwingParkInputs): <T>(work: () => Promise<T>) => Promise<T> {
  const now = inputs.now ?? Date.now;
  const key = parkOwedKey({ id: inputs.requestId, sessionId: inputs.identity.sessionId, tenantId: inputs.identity.tenantId })!;
  return async <T>(work: () => Promise<T>): Promise<T> => {
    const dueAt = now() + inputs.fenceMs;
    const owed = await inputs.store.owe({
      ...key,
      flowKind: inputs.flowId,
      userId: inputs.identity.userId,
      orgId: inputs.identity.orgId,
      dueAt,
      landBy: dueAt
    });
    noteWakeOwed(inputs.store, owed.dueAt);
    let parking = false;
    try {
      return await work();
    } catch (error) {
      // The park unwinds as a throw: the engine writes the gate after it, and
      // clears the owe then. Clearing here would open the window again.
      parking = error instanceof SuspensionError;
      throw error;
    } finally {
      if (!parking) await clearParkOwed(inputs.store, key);
    }
  };
}
