/**
 * Pluggable flow execution dispatcher.
 *
 * Controls WHERE a flow action executes. The default InProcessDispatcher
 * runs actions in the current process via runAction. Alternative
 * implementations (WorkerDispatcher for BullMQ, future TriggerDevDispatcher)
 * route execution to external workers with live event bridging.
 */
import type { ExecutionResult } from "../execution/types";

/**
 * Serializable subset of InboundRequestEnvelope — everything a remote
 * worker needs to call runAction.
 */
export interface DispatchEnvelope {
  requestId: string;
  flowKind: string;
  actionName: string;
  input: unknown;
  userId: string;
  sessionId?: string;
  orgId?: string;
  tenantId?: string;
  source?: string;
  metadata?: Record<string, unknown>;
  idempotencyKey?: string;
}

/**
 * Handle returned by FlowDispatcher.dispatch(). Exposes the request id
 * and a promise that resolves when execution finishes, plus an abort hook.
 */
export interface FlowDispatchHandle {
  readonly requestId: string;
  readonly finished: Promise<ExecutionResult>;
  abort(): void;
}

/**
 * Controls where flow actions execute. Implementations:
 * - InProcessDispatcher (default) — calls runAction in the current process
 * - WorkerDispatcher (BullMQ) — enqueues to a BullMQ queue, subscribes via bridge
 * - Future: TriggerDevDispatcher, PgBossDispatcher
 */
export interface FlowDispatcher {
  dispatch(
    envelope: DispatchEnvelope,
    bridge?: StreamBridge
  ): Promise<FlowDispatchHandle>;
  close(): Promise<void>;
}

/**
 * Single event published through the bridge. Matches the shape of SSE
 * events emitted by the response emitter so the web process can forward
 * them to SSE clients without transformation.
 */
export interface StreamEvent {
  id?: string;
  event: string;
  data: string;
}

/**
 * Publisher side of the bridge — used by the worker to push events.
 */
export interface StreamPublisher {
  publishEvent(event: StreamEvent): Promise<void>;
  publishTerminal(result: ExecutionResult): Promise<void>;
  close(): Promise<void>;
}

/**
 * Subscriber side of the bridge — used by the web process to receive events.
 */
export interface StreamSubscriber {
  events(): AsyncIterable<StreamEvent>;
  completed: Promise<ExecutionResult>;
  abort(): void;
  close(): Promise<void>;
}

/**
 * Bridges events between a remote worker and a local SSE consumer.
 * The worker writes events to the bridge; the web process reads them
 * and forwards to SSE. Redis pub/sub is the BullMQ implementation;
 * future adapters implement the same interface.
 *
 * Key invariant: stores persist, bridges push. The bridge is best-effort
 * live push. Late/reconnecting clients recover from the store.
 */
export interface StreamBridge {
  createPublisher(requestId: string): StreamPublisher;
  createSubscriber(requestId: string): StreamSubscriber;
}
