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
    }
  };
}

function requireNonEmpty(value: string, name: string): void {
  if (value.trim().length === 0) {
    throw new Error(`createRecoveryClient.retry requires a non-empty ${name}`);
  }
}
