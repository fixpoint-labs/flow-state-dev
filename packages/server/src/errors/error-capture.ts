/**
 * Error-capture seam (FIX-724): provider-neutral types and helpers that let
 * operators route runtime block failures to an external observability service
 * (Sentry, Datadog, Bugsnag) without the framework depending on any provider
 * SDK. The framework defines the event shape; the operator writes the adapter.
 *
 * The runtime invokes the configured `ErrorCaptureHandler` once per failing
 * block, deduped to the leaf, passing an `ErrorCaptureEvent` built from the
 * normalized `FlowError` plus the request's identity. Wiring lives in
 * `createExecutionContext` (per-block `onBlockError` + `ctx._captureError`).
 * See `docs/advanced/error-capture` for the operator-facing contract.
 */
import type { BlockDefinition } from "@flow-state-dev/core/types";
import type { RuntimeLogger } from "../execution/logging";
import { DEFAULT_RUNTIME_LOGGER } from "../execution/logging";
import type { FlowError, FlowErrorScope } from "./flow-error";

/**
 * Provider-neutral context handed to an operator's error-capture callback when
 * a block fails. Carries no provider vocabulary (tags / severity / fingerprint)
 * — the adapter derives those from `error.code` / `error.retryable`.
 */
export interface ErrorCaptureEvent {
  /** Normalized framework error. The raw thrown value is on `error.cause`. */
  error: FlowError;
  /** Correlation IDs shared across all events from one request. */
  requestId: string;
  flowKind: string;
  actionName: string;
  userId: string;
  sessionId?: string;
  orgId?: string;
  /** Failing block (leaf). Absent for errors with no originating block. */
  blockName?: string;
  blockKind?: BlockDefinition["kind"];
  /** Deterministic instance id `${requestId}:${blockPath}` (excludes attempt). */
  blockInstanceId?: string;
  /** Structural path within the request's execution tree, e.g. `root/step[0]`. */
  blockPath?: string;
  /** 0-indexed retry attempt of the failing block. */
  attempt?: number;
  /** Error scope: "block" | "request" | "work" | "resource". */
  scope?: FlowErrorScope;
  /** True for high-frequency transient blocks (poll loops); lets adapters down-sample. */
  transient?: boolean;
}

/**
 * Operator-supplied error sink. Opt-in; omit for no capture. Fires once per
 * failing block (deduped to the leaf). Read-only: the return value is ignored.
 * May be async; the runtime awaits it inside a guard so a throw or rejection
 * can never affect the request. Keep it fast (enqueue-and-return).
 */
export type ErrorCaptureHandler = (event: ErrorCaptureEvent) => void | Promise<void>;

/** Request identity shared by every capture event from one request. */
export interface ErrorCaptureIdentity {
  requestId: string;
  flowKind: string;
  actionName: string;
  userId: string;
  sessionId?: string;
  orgId?: string;
}

/** Per-block overrides resolved at the failure site. */
export interface ErrorCaptureBlockInfo {
  blockName?: string;
  blockKind?: BlockDefinition["kind"];
  blockInstanceId?: string;
  blockPath?: string;
  attempt?: number;
  transient?: boolean;
  scope?: FlowErrorScope;
}

/**
 * Build an `ErrorCaptureEvent` from a normalized error, the request identity,
 * and optional per-block overrides. For fields the `FlowError` also carries
 * (`blockName`, `blockInstanceId`), the block override wins and the error's
 * value is the fallback. `blockKind` has no `FlowError` counterpart — the error
 * taxonomy carries no kind — so it is sourced solely from the block override
 * (always present for block-scope captures). `scope` prefers the error's own
 * scope and falls back to the block-info scope so a request-level fallback can
 * label itself.
 */
export function toErrorCaptureEvent(
  error: FlowError,
  identity: ErrorCaptureIdentity,
  block?: ErrorCaptureBlockInfo
): ErrorCaptureEvent {
  return {
    error,
    requestId: identity.requestId,
    flowKind: identity.flowKind,
    actionName: identity.actionName,
    userId: identity.userId,
    sessionId: identity.sessionId,
    orgId: identity.orgId,
    blockName: block?.blockName ?? error.blockName,
    blockKind: block?.blockKind,
    blockInstanceId: block?.blockInstanceId ?? error.blockInstanceId,
    blockPath: block?.blockPath,
    attempt: block?.attempt,
    scope: error.scope ?? block?.scope,
    transient: block?.transient
  };
}

/**
 * Invoke an `ErrorCaptureHandler` with full fire-and-forget safety. Awaits the
 * handler inside a try/catch so both synchronous throws and async rejections
 * are swallowed and logged at `warn`; never rethrows. A failing capture handler
 * therefore cannot affect the request outcome.
 */
export async function safeCaptureError(
  handler: ErrorCaptureHandler,
  event: ErrorCaptureEvent,
  logger?: RuntimeLogger
): Promise<void> {
  try {
    await handler(event);
  } catch (hookError) {
    (logger ?? DEFAULT_RUNTIME_LOGGER).warn?.(
      "[flow-state] errorCapture handler threw; swallowed",
      { hookError, requestId: event.requestId, blockName: event.blockName }
    );
  }
}
