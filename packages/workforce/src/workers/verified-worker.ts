/**
 * The worker each running request's turn was verified to run as, and that
 * worker's configuration, by the session handle its blocks share. A leaf
 * module, so attribution (`writeShared`) and the flows that read a worker's
 * settings reach it without importing the worker model.
 */

/** What the worker's grants let its model do with one granted resource. */
export type GrantedAccess = "visible" | "read-only";

type Verified = {
  readonly workerId: string;
  readonly config: Readonly<Record<string, unknown>>;
  /** The documents and references the worker reaches, by accessor. */
  readonly granted: ReadonlyMap<string, GrantedAccess>;
};

const verified = new WeakMap<object, Verified>();

/**
 * Record that this request's turn runs as `workerId`, with `config`: the
 * session's worker, as `resolveWorker` loaded and checked it.
 *
 * @param session The block context's `session` handle, the same object for
 *   every block of one request.
 */
export function markVerifiedWorker(
  session: object,
  workerId: string,
  config: Readonly<Record<string, unknown>>,
  granted: ReadonlyMap<string, GrantedAccess> = new Map()
): void {
  verified.set(session, { workerId, config, granted });
}

/**
 * What the worker this request's turn was verified to run as may do with the
 * granted resource under `accessor`, or `undefined` when it isn't granted it
 * or no worker was resolved.
 *
 * @param session The block context's `session` handle.
 */
export function grantedAccessOf(session: object, accessor: string): GrantedAccess | undefined {
  return verified.get(session)?.granted.get(accessor);
}

/**
 * The worker this request's turn was verified to run as, or `undefined` when
 * no worker was resolved, which is the case on every flow that isn't a worker
 * flow. Attribution reads this, never the session's state directly: a flow
 * that isn't a worker flow can hold a `workerId` a caller wrote.
 *
 * @param session The block context's `session` handle.
 */
export function verifiedWorkerOf(session: object): string | undefined {
  return verified.get(session)?.workerId;
}

/**
 * The settings this turn runs with: the configuration of the worker the turn
 * resolved, or, on a turn that resolved none, the flow copy's own
 * `ctx.flow.config`. Synchronous: the worker was loaded at the start of the
 * turn, so a prompt, a tool list or a step condition can read it.
 *
 * @param ctx Any block's context.
 */
export function seatConfigOf(ctx: {
  readonly session: object;
  readonly flow?: { readonly config: unknown };
}): Readonly<Record<string, unknown>> {
  return (
    verified.get(ctx.session)?.config ??
    ((ctx.flow?.config ?? {}) as Readonly<Record<string, unknown>>)
  );
}

/**
 * The configuration of the worker this turn loaded with `resolveWorker`, for a
 * block of a worker flow that reads a setting after the turn's first step:
 * the same value `resolveWorker` returned as `config`. Synchronous, so a
 * prompt, a tool list or a step condition can read it.
 *
 * @param ctx Any block's context in the turn.
 * @throws When the turn loaded no worker: call `installation.resolveWorker`
 *   in the flow's `request.onStarted`.
 */
export function workerConfigOf(ctx: { readonly session: object }): Readonly<Record<string, unknown>> {
  const found = verified.get(ctx.session);
  if (found === undefined) {
    throw new Error("This turn loaded no worker: call installation.resolveWorker(ctx, flowKind) in the flow's request.onStarted.");
  }
  return found.config;
}
