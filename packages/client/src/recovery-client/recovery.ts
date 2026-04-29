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

export type RecoveryClient = {
  /**
   * Sweep stale active-request entries for the given user. Returns the
   * subset that this call actually transitioned from `in_progress` to
   * `interrupted` — already-terminal records are silently cleaned up and
   * excluded from the response.
   */
  checkInterrupted: (options: CheckInterruptedOptions) => Promise<InterruptedRequestSummary[]>;
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
    }
  };
}
