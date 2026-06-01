/**
 * Sanctioned non-HTTP entry point for starting a flow action from plain code
 * (background jobs, cron handlers, queue consumers, custom integrations).
 *
 * `runFlow` is the flow-level complement to the FIX-503 handler firewall: with
 * block-level invocation closed off, this is the documented programmatic seam
 * for triggering a flow outside any transport. It is a thin composition over
 * `runAction` (the same orchestration the HTTP layer uses) that adds three
 * things the bare primitive does not: it hands back the generated `requestId`
 * so callers can fire-and-forget or attach an SSE stream later, layers an
 * `onItem` convenience over `ResponseEmitter.subscribeToItems`, and resolves
 * its returned handle as soon as the run is *dispatched* rather than when it
 * completes. No HTTP, no SSE live stream, no registry lookup — the caller
 * passes the flow object and the stores directly.
 */
import type { FlowInstance } from "@flow-state-dev/core/types";
import type { OutputItem } from "@flow-state-dev/core/items";
import type { StoreRegistry } from "../stores/types";
import type { RuntimeConfig } from "../runtime-config";
import { createInternalResponseEmitter } from "../streaming/response-emitter";
import { generateId } from "../utils/generate-id";
import { runAction } from "./runAction";
import type { ExecutionResult } from "./types";

/**
 * Options for {@link runFlow}. Mirrors the resolved-principal + stores shape the
 * HTTP layer passes to `runAction`, with an `onItem` streaming convenience.
 */
export type RunFlowOptions<
  TFlow extends FlowInstance = FlowInstance,
  TActionName extends keyof TFlow["actions"] & string = keyof TFlow["actions"] & string
> = {
  /** Action to invoke on the flow. Maps to `runAction`'s `actionName`. */
  action: TActionName;
  /** Action input; validated against the action/block input schema by `runAction`. */
  input: unknown;
  /**
   * Resolved principal identity. The caller is responsible for having verified
   * this `userId` belongs to the caller — the same trust contract as the HTTP
   * layer (see the auth contract). `runFlow` does not authenticate.
   */
  userId: string;
  sessionId?: string;
  orgId?: string;
  tenantId?: string;
  /**
   * Provide to correlate with a pre-generated id (idempotent retry coordination,
   * log correlation); otherwise one is generated.
   */
  requestId?: string;
  /** Transport provenance written to `RequestRecord.source`. Defaults to `"manual"`. */
  source?: string;
  metadata?: Record<string, unknown>;
  /** Explicit cancellation. Aborts the run when fired. */
  signal?: AbortSignal;
  /** Store registry the run reads/writes. Required — the caller already holds it. */
  stores: StoreRegistry;
  /**
   * Instance-level config (modelResolver, settings, logger, middleware, …).
   * Optional; defaults to `{}`. Without a `modelResolver`, generator blocks
   * fail at run time exactly as they would via `runAction`.
   */
  runtimeConfig?: RuntimeConfig;
  /**
   * Called for every non-transient item as it is added / updated / done. A thin
   * wrapper over `ResponseEmitter.subscribeToItems` — listener exceptions are
   * isolated and never break the run. Omit to fire-and-forget; items still
   * persist to `stores`.
   */
  onItem?: (item: OutputItem, kind: "added" | "updated" | "done") => void;
};

/**
 * Handle returned from {@link runFlow}. The run is already in flight; await
 * `finished` for the terminal result, or fire-and-forget.
 */
export type RunFlowHandle = {
  /** Id of the dispatched request — correlate logs or attach a stream by this. */
  readonly requestId: string;
  readonly sessionId?: string;
  /** Status at handoff. Always `"in_progress"` — the run has started, not finished. */
  readonly status: "in_progress";
  /** Resolves when the action reaches a terminal state (success, failure, abort). */
  readonly finished: Promise<ExecutionResult>;
};

/**
 * Start a flow action from non-HTTP code and return a handle synchronously.
 *
 * The returned promise resolves once the run is *dispatched*, not when it
 * completes: await `handle.finished` for the terminal {@link ExecutionResult},
 * or ignore it to fire-and-forget. A failed run reports its error on
 * `finished`'s `ExecutionResult.error`; a programmer error such as an unknown
 * action surfaces as a *rejected* `finished` (not a rejection of this call),
 * consistent with the transport host's `dispatch`.
 */
export async function runFlow<
  TFlow extends FlowInstance,
  TActionName extends keyof TFlow["actions"] & string
>(flow: TFlow, opts: RunFlowOptions<TFlow, TActionName>): Promise<RunFlowHandle> {
  const requestId = opts.requestId ?? generateId("req");
  const responseEmitter = createInternalResponseEmitter({
    requestId,
    internalSeams: undefined
  });

  if (opts.onItem !== undefined) {
    // subscribeToItems returns an unsubscribe fn; the emitter is scoped to this
    // run and discarded once it completes, so we rely on run completion rather
    // than manual teardown. Listener exceptions are isolated by the emitter.
    responseEmitter.subscribeToItems(opts.onItem);
  }

  // Call runAction WITHOUT awaiting so the run starts but this function returns
  // a handle immediately. runAction is async, so a rejection from it (e.g.
  // unknown action) lands on `finished` rather than rejecting this call.
  const finished = runAction({
    flow,
    actionName: opts.action,
    input: opts.input,
    userId: opts.userId,
    sessionId: opts.sessionId,
    orgId: opts.orgId,
    tenantId: opts.tenantId,
    requestId,
    source: opts.source ?? "manual",
    metadata: opts.metadata,
    signal: opts.signal,
    stores: opts.stores,
    responseEmitter,
    runtimeConfig: opts.runtimeConfig ?? {}
  });

  return {
    requestId,
    sessionId: opts.sessionId,
    status: "in_progress",
    finished
  };
}
