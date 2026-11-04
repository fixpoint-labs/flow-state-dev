/**
 * A run as a row's owner, fired host-side (FIX-2534 D2): the sibling of
 * {@link fireWakeThrough} that starts an internal entry as the user whose
 * storage cell holds a row, and the routing call that fires one per run a
 * service flow nominates.
 *
 * Why it lives on the host: a block starts no request as anyone else
 * (`core/src/types/dispatch.ts`), and a service flow runs as the service. So
 * the service names who should hear an event, and the host starts each of
 * those requests, once it has checked the row by the schedule resolver's rule
 * (`createResourceCollectionScheduleResolver`): the nomination picks a cell
 * and grants nothing. The row must be there, in that user's cell, name the
 * same organization, and not be switched off (`enabled: false`). Never from
 * the event (BP-031).
 *
 * Not a `RequestHost` verb: nothing a running request holds can start one.
 */
import { INTERNAL_SOURCE } from "../execution/transport-sources";
import type { ExecutionResult } from "../execution/types";
import { resolveUserStorageKey } from "../stores/scope-keys";
import type { InboundTransportHost } from "../transports/types";

/** One run as a row's owner: the entry to start, and the row that makes it that user's. */
export interface OwnerRun {
  /** The flow whose internal entry runs. */
  readonly flowKind: string;
  /** The internal entry. */
  readonly entry: string;
  readonly input: unknown;
  /** Who the run would be, as nominated: checked against the row, never trusted alone. */
  readonly owner: { readonly userId: string; readonly orgId: string; readonly tenantId?: string };
  /** The row's full key in the owner's user cell (a non-isolated, user-scoped collection's). */
  readonly rowKey: string;
}

/** Why a run did not start. */
export type OwnerRunRefusal = "no_row" | "other_org" | "disabled";

/** What a fire came to. */
export type OwnerRunFired =
  | { readonly fired: true; readonly requestId: string; readonly finished: Promise<ExecutionResult> }
  | { readonly fired: false; readonly refused: OwnerRunRefusal };

/**
 * Check `run`'s row and, when it passes, dispatch the entry as its owner, in a
 * session of its own. Resolves once the host accepted the request; rejects
 * when the host refused or failed to.
 */
export async function fireOwnerRunThrough(
  host: Pick<InboundTransportHost, "dispatch" | "stores">,
  run: OwnerRun
): Promise<OwnerRunFired> {
  const { userId, orgId, tenantId } = run.owner;
  // The cell a collection that isolates nothing keeps a user's rows in, as
  // the schedule resolver derives it.
  const cell = resolveUserStorageKey(userId, orgId, { id: run.flowKind, isolateUserState: false });
  const stored = await host.stores.resourceState.get("user", cell, run.rowKey);
  if (stored === undefined) return { fired: false, refused: "no_row" };
  const state = stored.state as { orgId?: unknown; enabled?: unknown };
  // The row's stored organization, which must be the one the nomination names.
  if (state.orgId !== orgId) return { fired: false, refused: "other_org" };
  if (state.enabled === false) return { fired: false, refused: "disabled" };
  const handle = host.dispatch({
    source: INTERNAL_SOURCE,
    flowKind: run.flowKind,
    action: run.entry,
    input: run.input,
    principal: { userId, orgId },
    orgId,
    ...(tenantId !== undefined ? { tenantId } : {}),
    metadata: { ownerRun: { rowKey: run.rowKey } },
    responseEmitter: null
  });
  if (handle.accepted !== undefined) await handle.accepted;
  return { fired: true, requestId: handle.requestId, finished: handle.finished };
}

/** One owner run a routing fired or refused. */
export type RoutedOwnerRun = {
  readonly run: OwnerRun;
  readonly refused?: OwnerRunRefusal;
  readonly finished?: Promise<ExecutionResult>;
};

/** What {@link routeServiceEvent} came to: the service entry's result, and each run it named. */
export interface RoutedServiceEvent {
  readonly output: unknown;
  readonly error?: unknown;
  readonly ownerRuns: readonly RoutedOwnerRun[];
}

/**
 * Route one event through a service flow: run its internal `entry` as the
 * service principal, in a session of its own, then fire each run its output
 * names in `ownerRuns` through {@link fireOwnerRunThrough}. What an ingestion
 * (a webhook, a poll) calls once per normalized event.
 *
 * @param service.principal The service's own identity in the org (`service:github`). It reads no user's cell.
 */
export async function routeServiceEvent(
  host: Pick<InboundTransportHost, "dispatch" | "stores">,
  service: {
    readonly flowKind: string;
    readonly entry: string;
    readonly input: unknown;
    readonly principal: { readonly userId: string; readonly orgId: string; readonly tenantId?: string };
  }
): Promise<RoutedServiceEvent> {
  const { userId, orgId, tenantId } = service.principal;
  const handle = host.dispatch({
    source: INTERNAL_SOURCE,
    flowKind: service.flowKind,
    action: service.entry,
    input: service.input,
    principal: { userId, orgId },
    orgId,
    ...(tenantId !== undefined ? { tenantId } : {}),
    metadata: { serviceRoute: { entry: service.entry } },
    responseEmitter: null
  });
  const result = await handle.finished;
  if (result.error !== undefined) return { output: result.output, error: result.error, ownerRuns: [] };
  const named = (result.output as { ownerRuns?: unknown } | undefined)?.ownerRuns;
  const runs = Array.isArray(named) ? (named as OwnerRun[]) : [];
  const ownerRuns: RoutedOwnerRun[] = [];
  for (const run of runs) {
    const fired = await fireOwnerRunThrough(host, run);
    ownerRuns.push(fired.fired ? { run, finished: fired.finished } : { run, refused: fired.refused });
  }
  return { output: result.output, ownerRuns };
}
