/**
 * Client for the request-recovery sweep endpoint.
 *
 * The framework only auto-runs interrupted-request detection at server
 * startup. Long-running servers and serverless deployments that disable
 * startup detection rely on a client poke to reconcile stale `in_progress`
 * records — typically the DevTool calls `checkInterrupted` on mount and on
 * every session-list refresh.
 */
import type { ResumeAction } from "@flow-state-dev/contracts";
import { buildFlowApiUrl, requestJson, resolveFetch } from "../internal/http";
import type { ClientFetch } from "../types";

/** The resolution actions the resume endpoint accepts. */
const RESUME_ACTIONS: readonly ResumeAction[] = ["approve", "reject", "submit", "skip"];

export type CreateRecoveryClientOptions = {
  baseUrl?: string;
  fetcher?: ClientFetch;
};

export type CheckInterruptedOptions = {
  /** User whose stale active-request entries should be swept. Required. */
  userId: string;
  /** Override server-side stale threshold. Default: server default (30_000ms). */
  staleThresholdMs?: number;
};

export type InterruptedRequestSummary = {
  requestId: string;
  sessionId?: string;
  flowKind: string;
  actionName: string;
  interruptedAt: number;
};

export type RetryRequestOptions = {
  flowKind: string;
  sessionId: string;
  requestId: string;
  /** Optional input override; falls back to the original request's input. */
  inputOverride?: unknown;
};

export type RetryRequestResult = {
  /** Server-issued id of the newly dispatched request. */
  newRequestId: string;
  flowKind: string;
  actionName: string;
  /** The original request id this retry derives from. */
  retryOf: string;
  sessionId?: string;
};

export type ContinueRequestOptions = {
  flowKind: string;
  sessionId: string;
  /** The interrupted request to continue under its own id. */
  requestId: string;
};

export type ContinueRequestResult = {
  /** The continued request's id — the SAME id, not a new one. */
  requestId: string;
};

export type ResumeSuspensionBody = {
  /** Id of the pending suspension to resolve. */
  suspensionId: string;
  /**
   * How the suspension resolves. `approve`/`reject` are the binary outcomes;
   * `submit` carries a `data` payload validated against the suspension's
   * `resumeSchema`; `skip` declines an optional step. The action must be in the
   * suspension's `allow` set or the route returns 409.
   */
  action: ResumeAction;
  /** Optional resume payload validated against the suspension's resumeSchema. */
  data?: unknown;
  /** Optional identifier of the operator resolving the suspension. */
  resumedBy?: string;
};

export type ResumeSuspensionResult = {
  /** Server-issued id of the newly dispatched (resumed) request. */
  requestId: string;
  /** The suspended request id this resume derives from. */
  originalRequestId: string;
};

export type RecoveryClient = {
  /**
   * Sweep stale active-request entries for the given user. Returns the
   * subset that this call actually transitioned from `in_progress` to
   * `interrupted` — already-terminal records are silently cleaned up and
   * excluded from the response.
   */
  checkInterrupted: (options: CheckInterruptedOptions) => Promise<InterruptedRequestSummary[]>;
  /**
   * Re-dispatch a previously interrupted or failed request against its
   * original session and action, returning the new request id. The caller
   * is responsible for attaching to the new request's stream.
   */
  retry: (options: RetryRequestOptions) => Promise<RetryRequestResult>;
  /**
   * Continue a crash-interrupted request under its OWN id (FIX-811). Unlike
   * {@link RecoveryClient.retry}, no new request is created: completed blocks
   * replay from the durable log and the in-flight block re-runs, transitioning
   * `interrupted → in_progress → terminal` in place. Returns the same id.
   */
  continue: (options: ContinueRequestOptions) => Promise<ContinueRequestResult>;
  /**
   * Streaming sibling of {@link RecoveryClient.continue}. POSTs to the same
   * `/continue` route with `Accept: text/event-stream` so the server returns
   * the continuation's SSE stream directly from the POST response, and
   * returns the raw {@link Response} whose body is that stream — mirroring
   * {@link RecoveryClient.resumeSuspensionStream}'s inline-streaming
   * approach so serverless deployments (no shared pub/sub) still see the
   * continued run live, without a separate GET reconnect.
   */
  continueStream: (options: ContinueRequestOptions) => Promise<Response>;
  /**
   * Resolve a pending durable-execution suspension by approving or rejecting
   * it. POSTs to the resume endpoint, which re-dispatches the action from the
   * suspension point and returns the new request id alongside the original.
   */
  resumeSuspension: (
    flowKind: string,
    requestId: string,
    body: ResumeSuspensionBody
  ) => Promise<ResumeSuspensionResult>;
  /**
   * Streaming sibling of {@link RecoveryClient.resumeSuspension}. POSTs the
   * resolution with `Accept: text/event-stream` so the server returns the
   * continuation's SSE stream directly from the POST response, and returns the
   * raw {@link Response} whose body is that stream. The continuation runs on the
   * same instance that handled the POST — so on serverless (no shared pub/sub)
   * the resuming client still sees the resumed run live, without a separate GET
   * reconnect. Falls back to a 202 JSON response when the server does not
   * support inline streaming; callers branch on the `content-type` header.
   */
  resumeSuspensionStream: (
    flowKind: string,
    requestId: string,
    body: ResumeSuspensionBody
  ) => Promise<Response>;
};

type RetryResponseBody = {
  status: string;
  request: {
    id: string;
    flowKind: string;
    actionName: string;
    status: string;
    retryOf: string;
  };
  session?: { id: string };
};

export function createRecoveryClient(options: CreateRecoveryClientOptions = {}): RecoveryClient {
  const fetcher = resolveFetch(options.fetcher);

  return {
    checkInterrupted: async ({ userId, staleThresholdMs }) => {
      const trimmed = userId.trim();
      if (trimmed.length === 0) {
        throw new Error("createRecoveryClient.checkInterrupted requires a non-empty userId");
      }

      const payload = await requestJson<{ interrupted: InterruptedRequestSummary[] }>({
        fetcher,
        url: buildFlowApiUrl({
          baseUrl: options.baseUrl,
          path: `/api/flows/users/${encodeURIComponent(trimmed)}/check-interrupted`,
          query: { staleThresholdMs }
        }),
        init: { method: "POST" }
      });

      return payload.interrupted;
    },

    retry: async ({ flowKind, sessionId, requestId, inputOverride }) => {
      requireNonEmpty(flowKind, "flowKind");
      requireNonEmpty(sessionId, "sessionId");
      requireNonEmpty(requestId, "requestId");

      const init: RequestInit = { method: "POST" };
      if (inputOverride !== undefined) {
        init.headers = { "content-type": "application/json" };
        init.body = JSON.stringify({ inputOverride });
      }

      const payload = await requestJson<RetryResponseBody>({
        fetcher,
        url: buildFlowApiUrl({
          baseUrl: options.baseUrl,
          path: `/api/flows/${encodeURIComponent(flowKind)}/sessions/${encodeURIComponent(sessionId)}/requests/${encodeURIComponent(requestId)}/retry`
        }),
        init
      });

      return {
        newRequestId: payload.request.id,
        flowKind: payload.request.flowKind,
        actionName: payload.request.actionName,
        retryOf: payload.request.retryOf,
        sessionId: payload.session?.id
      };
    },

    continue: async ({ flowKind, sessionId, requestId }) => {
      requireNonEmpty(flowKind, "flowKind");
      requireNonEmpty(sessionId, "sessionId");
      requireNonEmpty(requestId, "requestId");

      const payload = await requestJson<{ requestId: string }>({
        fetcher,
        url: buildFlowApiUrl({
          baseUrl: options.baseUrl,
          path: `/api/flows/${encodeURIComponent(flowKind)}/sessions/${encodeURIComponent(sessionId)}/requests/${encodeURIComponent(requestId)}/continue`
        }),
        init: { method: "POST" }
      });

      return { requestId: payload.requestId };
    },

    continueStream: async ({ flowKind, sessionId, requestId }) => {
      requireNonEmpty(flowKind, "flowKind");
      requireNonEmpty(sessionId, "sessionId");
      requireNonEmpty(requestId, "requestId");

      const response = await fetcher(
        buildFlowApiUrl({
          baseUrl: options.baseUrl,
          path: `/api/flows/${encodeURIComponent(flowKind)}/sessions/${encodeURIComponent(sessionId)}/requests/${encodeURIComponent(requestId)}/continue`
        }),
        {
          method: "POST",
          headers: { "accept": "text/event-stream" }
        }
      );

      if (!response.ok) {
        const text = await response.text().catch(() => "");
        throw new Error(`Continue request failed (${response.status}): ${text}`.trim());
      }

      return response;
    },

    resumeSuspension: async (flowKind, requestId, body) => {
      requireNonEmpty(flowKind, "flowKind");
      requireNonEmpty(requestId, "requestId");
      requireNonEmpty(body.suspensionId, "suspensionId");
      requireAction(body.action, "resumeSuspension");

      return requestJson<ResumeSuspensionResult>({
        fetcher,
        url: buildFlowApiUrl({
          baseUrl: options.baseUrl,
          path: `/api/flows/${encodeURIComponent(flowKind)}/requests/${encodeURIComponent(requestId)}/resume`
        }),
        init: {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body)
        }
      });
    },

    resumeSuspensionStream: async (flowKind, requestId, body) => {
      requireNonEmpty(flowKind, "flowKind");
      requireNonEmpty(requestId, "requestId");
      requireNonEmpty(body.suspensionId, "suspensionId");
      requireAction(body.action, "resumeSuspensionStream");

      const response = await fetcher(
        buildFlowApiUrl({
          baseUrl: options.baseUrl,
          path: `/api/flows/${encodeURIComponent(flowKind)}/requests/${encodeURIComponent(requestId)}/resume`
        }),
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "accept": "text/event-stream"
          },
          body: JSON.stringify(body)
        }
      );

      if (!response.ok) {
        const text = await response.text().catch(() => "");
        throw new Error(`Resume request failed (${response.status}): ${text}`.trim());
      }

      return response;
    }
  };
}

function requireNonEmpty(value: string, name: string): void {
  if (value.trim().length === 0) {
    throw new Error(`createRecoveryClient requires a non-empty ${name}`);
  }
}

function requireAction(action: ResumeAction, method: string): void {
  if (!RESUME_ACTIONS.includes(action)) {
    throw new Error(
      `createRecoveryClient.${method} requires action one of ${RESUME_ACTIONS.join(", ")}`
    );
  }
}
