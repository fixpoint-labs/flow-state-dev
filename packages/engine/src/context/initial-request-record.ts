/**
 * Shared builder for the initial `in_progress` `RequestRecord` written when a
 * request first enters the system.
 *
 * Two code paths create this record and must construct it the same way:
 * `createExecutionContext` writes it when a worker starts an action with no
 * pre-existing record, and `createInboundTransportHost` writes it at enqueue
 * time for externally-dispatched requests so a `GET …/stream` arriving before
 * the worker starts finds a live record to tail (FIX-828). The worker adopts an
 * existing record as-is and skips its own write, so this stub is the record
 * used for the entire execution — it must be complete, not a placeholder.
 *
 * Given identical inputs the two call sites produce an identical record. The
 * inputs are not always identical: the host stamps `startedAtMs` at enqueue
 * (vs worker-start) and carries `orgId` from the envelope rather than the
 * resolved org record. Both are record metadata only — execution-time org
 * resolution uses the separately-loaded org record — so a difference never
 * affects execution, only the record's provenance fields.
 */
import type { JsonObject } from "@flow-state-dev/core/types";
import type { RequestRecord } from "../stores/types";

/**
 * Inputs needed to materialize an initial request record. A structural subset
 * of both `DispatchEnvelope` and `CreateExecutionContextOptions`, so either
 * call site can pass its own envelope directly.
 */
export type InitialRequestRecordInput<TState extends JsonObject = JsonObject> = {
  requestId: string;
  flowKind: string;
  actionName: string;
  userId: string;
  /** Bare session id (FIX-682) — not the namespaced storage key. */
  sessionId?: string;
  tenantId?: string;
  orgId?: string;
  /** Inbound transport provenance; defaults to `"http"` when absent. */
  source?: string;
  metadata?: Record<string, unknown>;
  input?: unknown;
  /** Request-scoped state seed. `{}` for external HTTP dispatch. */
  requestState?: TState;
};

/**
 * Build the initial `in_progress` `RequestRecord`.
 *
 * `ts` stamps `startedAtMs`, `createdAt`, and `updatedAt` — worker-start time
 * for in-process execution, enqueue time for external dispatch (acceptable: it
 * marks when the request entered the system). `version` starts at 0; terminal
 * patches use the `"any"` CAS verb so the starting version never blocks a later
 * write, which also keeps the builder idempotent under BullMQ's at-least-once
 * delivery (a re-run adopts the existing record rather than conflicting).
 */
export function createInitialRequestRecord<TState extends JsonObject = JsonObject>(
  input: InitialRequestRecordInput<TState>,
  ts: number
): RequestRecord<TState> {
  return {
    id: input.requestId,
    flowKind: input.flowKind,
    actionName: input.actionName,
    userId: input.userId,
    sessionId: input.sessionId,
    tenantId: input.tenantId,
    orgId: input.orgId,
    source: input.source ?? "http",
    status: "in_progress",
    startedAtMs: ts,
    metadata: input.metadata,
    input: input.input,
    state: (input.requestState ?? {}) as TState,
    version: 0,
    createdAt: ts,
    updatedAt: ts
  };
}
