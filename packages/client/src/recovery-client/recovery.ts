/**
 * Client for the request-recovery sweep endpoint.
 *
 * The framework only auto-runs interrupted-request detection at server
 * startup. Long-running servers and serverless deployments that disable
 * startup detection rely on a client poke to reconcile stale `in_progress`
 * records — typically the DevTool calls `checkInterrupted` on mount and on
 * every session-list refresh.
 */
import { buildFlowApiUrl, requestJson, resolveFetch } from "../internal/http";
import type { ClientFetch } from "../types";

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

export type ResumeSuspensionBody = {
  /** Id of the pending suspension to resolve. */
  suspensionId: string;
  /** Whether the operator approves or rejects the suspension. */
  action: "approve" | "reject";
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
   * Resolve a pending durable-execution suspension by approving or rejecting
   * it. POSTs to the resume endpoint, which re-dispatches the action from the
   * suspension point and returns the new request id alongside the original.
   */
  resumeSuspension: (
    flowKind: string,
    requestId: string,
    body: ResumeSuspensionBody
  ) => Promise<ResumeSuspensionResult>;
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

    resumeSuspension: async (flowKind, requestId, body) => {
      requireNonEmpty(flowKind, "flowKind");
      requireNonEmpty(requestId, "requestId");
      requireNonEmpty(body.suspensionId, "suspensionId");
      if (body.action !== "approve" && body.action !== "reject") {
        throw new Error(
          'createRecoveryClient.resumeSuspension requires action "approve" or "reject"'
        );
      }

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
    }
  };
}

function requireNonEmpty(value: string, name: string): void {
  if (value.trim().length === 0) {
    throw new Error(`createRecoveryClient requires a non-empty ${name}`);
  }
}
