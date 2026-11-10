// FIX-2534 D2; BP-031.
/**
 * A run as a row's owner, fired host-side: the sibling of
 * {@link fireWakeThrough} that starts an internal entry as the user whose
 * storage cell holds a row, and the routing call that fires one per run a
 * service flow nominates.
 *
 * Why it lives on the host: a block starts no request as anyone else
 * (`core/src/types/dispatch.ts`), and a service flow runs as the service. So
 * the service names who should hear an event, and the host starts each of
 * those requests, once it has checked the row in the cell the schedule
 * resolver reads ({@link resolveSharedUserCellKey}): the nomination picks a
 * cell and grants nothing. The row must be there, in that user's cell, name
 * the same organization and tenant, and not be switched off
 * (`enabled: false`). Never from the event.
 *
 * Each row's runs share one session, and each service's routings another, so
 * a busy thread doesn't store a new session per event.
 *
 * Not a `RequestHost` verb: nothing a running request holds can start one.
 */
import type { ExecutionResult } from "../execution/types";
import { resolveSharedUserCellKey, tenantMatches } from "../stores/scope-keys";
import type { InboundTransportHost } from "../transports/types";
import { dispatchInternalAs, type InternalPrincipal } from "./dispatch-internal";

/** One run as a row's owner: the entry to start, and the row that makes it that user's. */
export interface OwnerRun {
  /** The flow whose internal entry runs. */
  readonly flowKind: string;
  /** The internal entry. */
  readonly entry: string;
  readonly input: unknown;
  /** Who the run would be, as nominated: checked against the row, never trusted alone. */
  readonly owner: InternalPrincipal;
  /** The row's full key in the owner's user cell (a user-scoped collection shared across flows). */
  readonly rowKey: string;
}

/** Why a run did not start. */
export type OwnerRunRefusal = "no_resource" | "other_org" | "other_tenant" | "disabled";

/** What a fire came to. */
export type OwnerRunFired =
  | { readonly fired: true; readonly requestId: string; readonly finished: Promise<ExecutionResult> }
  | { readonly fired: false; readonly refused: OwnerRunRefusal };

/** The session every run of one row starts in: one per owner, flow and row. */
function ownerRunSessionId(run: OwnerRun): string {
  return `owner-run:${[run.owner.orgId, run.owner.userId, run.flowKind, run.rowKey].map(encodeURIComponent).join(":")}`;
}

/**
 * Check `run`'s row and, when it passes, dispatch the entry as its owner, in
 * the row's own session. Resolves once the host accepted the request; rejects
 * when the host refused or failed to.
 */
export async function fireOwnerRunThrough(
  host: Pick<InboundTransportHost, "dispatch" | "stores">,
  run: OwnerRun
): Promise<OwnerRunFired> {
  const { userId, orgId, tenantId } = run.owner;
  const stored = await host.stores.resourceState.get("user", resolveSharedUserCellKey(userId, orgId, run.flowKind), run.rowKey);
  if (stored === undefined) return { fired: false, refused: "no_resource" };
  const state = stored.state as { orgId?: unknown; tenantId?: unknown; enabled?: unknown };
  // The row's stored organization and tenant, which must be the ones the nomination names.
  if (state.orgId !== orgId) return { fired: false, refused: "other_org" };
  if (!tenantMatches(typeof state.tenantId === "string" ? state.tenantId : undefined, tenantId)) return { fired: false, refused: "other_tenant" };
  if (state.enabled === false) return { fired: false, refused: "disabled" };
  const handle = dispatchInternalAs(host, {
    flowKind: run.flowKind,
    entry: run.entry,
    input: run.input,
    as: run.owner,
    sessionId: ownerRunSessionId(run),
    metadata: { ownerRun: { rowKey: run.rowKey } }
  });
  if (handle.accepted !== undefined) await handle.accepted;
  return { fired: true, requestId: handle.requestId, finished: handle.finished };
}

/** One owner run a routing named: fired, refused by its row check, or failed to fire. */
export type RoutedOwnerRun = {
  readonly run: OwnerRun;
  readonly refused?: OwnerRunRefusal;
  /** The host threw or refused while starting it; the other runs still fire. */
  readonly failed?: string;
  readonly finished?: Promise<ExecutionResult>;
};

/** One entry of a service's `ownerRuns` it named but the host won't fire, and why. */
export type MalformedOwnerRun = { readonly value: unknown; readonly reason: string };

/** What {@link routeServiceEvent} came to: the service entry's result, and each run it named. */
export interface RoutedServiceEvent {
  readonly output: unknown;
  readonly error?: unknown;
  /**
   * The routing request ended with no error and no `ownerRuns` in its output:
   * stopped before it finished (a shutdown cancelled it). Not "routed to no
   * one": an ingestion answers it as retryable.
   */
  readonly incomplete?: true;
  readonly ownerRuns: readonly RoutedOwnerRun[];
  /** Entries of the output's `ownerRuns` that weren't a run of this service's own flow, in its org. */
  readonly malformed: readonly MalformedOwnerRun[];
}

/** The most owner runs one routing starts at once, by default. */
const DEFAULT_OWNER_RUN_CONCURRENCY = 8;

const isString = (value: unknown): value is string => typeof value === "string" && value.length > 0;

/** `value` as an owner run of `flowKind` in `orgId`, or why it isn't one. The fence: a flow's output is read, never cast. */
function parseOwnerRun(value: unknown, flowKind: string, orgId: string): OwnerRun | string {
  if (typeof value !== "object" || value === null) return "not an object";
  const run = value as Record<string, unknown>;
  const owner = run.owner as Record<string, unknown> | undefined;
  if (run.flowKind !== flowKind) return `names flow "${String(run.flowKind)}", not the service's own "${flowKind}"`;
  if (!isString(run.entry) || !isString(run.rowKey)) return "names no entry or task";
  if (typeof owner !== "object" || owner === null || !isString(owner.userId)) return "names no owner";
  if (owner.orgId !== orgId) return "names an owner in another org";
  if (owner.tenantId !== undefined && !isString(owner.tenantId)) return "names a malformed tenant";
  return {
    flowKind,
    entry: run.entry,
    input: run.input,
    owner: { userId: owner.userId, orgId, ...(owner.tenantId !== undefined ? { tenantId: owner.tenantId as string } : {}) },
    rowKey: run.rowKey
  };
}

/** Fire one run, catching what the host throws so one bad run can't stop the rest. */
async function fireOne(host: Pick<InboundTransportHost, "dispatch" | "stores">, run: OwnerRun): Promise<RoutedOwnerRun> {
  try {
    const fired = await fireOwnerRunThrough(host, run);
    return fired.fired ? { run, finished: fired.finished } : { run, refused: fired.refused };
  } catch (error) {
    return { run, failed: error instanceof Error ? error.message : String(error) };
  }
}

/**
 * Route one event through a service flow: run its internal `entry` as the
 * service principal, then fire each run its output names in `ownerRuns`
 * through {@link fireOwnerRunThrough}, at most `concurrency` at once. Each
 * run's failure to fire is recorded on it, and the rest still fire. What an
 * ingestion (a webhook, a poll) calls once per normalized event.
 *
 * @param service.principal The service's own identity in the org (`service:github`). It reads no user's cell.
 * @param options.concurrency The most runs started at once: 8 by default.
 */
export async function routeServiceEvent(
  host: Pick<InboundTransportHost, "dispatch" | "stores">,
  service: {
    readonly flowKind: string;
    readonly entry: string;
    readonly input: unknown;
    readonly principal: InternalPrincipal;
  },
  options: { readonly concurrency?: number } = {}
): Promise<RoutedServiceEvent> {
  const { userId, orgId } = service.principal;
  const handle = dispatchInternalAs(host, {
    flowKind: service.flowKind,
    entry: service.entry,
    input: service.input,
    as: service.principal,
    sessionId: `service-route:${[orgId, userId, service.flowKind].map(encodeURIComponent).join(":")}`,
    metadata: { serviceRoute: { entry: service.entry } }
  });
  const result = await handle.finished;
  if (result.error !== undefined) return { output: result.output, error: result.error, ownerRuns: [], malformed: [] };
  const named = (result.output as { ownerRuns?: unknown } | undefined)?.ownerRuns;
  if (!Array.isArray(named)) return { output: result.output, incomplete: true, ownerRuns: [], malformed: [] };
  const runs: OwnerRun[] = [];
  const malformed: MalformedOwnerRun[] = [];
  for (const value of named) {
    const parsed = parseOwnerRun(value, service.flowKind, orgId);
    if (typeof parsed === "string") malformed.push({ value, reason: parsed });
    else runs.push(parsed);
  }
  const ownerRuns: RoutedOwnerRun[] = new Array(runs.length);
  let next = 0;
  const worker = async () => {
    for (let i = next++; i < runs.length; i = next++) ownerRuns[i] = await fireOne(host, runs[i]!);
  };
  const width = Math.max(1, Math.min(options.concurrency ?? DEFAULT_OWNER_RUN_CONCURRENCY, runs.length));
  await Promise.all(Array.from({ length: width }, worker));
  return { output: result.output, ownerRuns, malformed };
}
