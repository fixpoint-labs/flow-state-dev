/**
 * Client-side suspension resume API.
 *
 * Provides `resumeSuspension()` for calling the server resume endpoint
 * and `createSuspensionClient()` for a reusable scoped client.
 */
import { buildFlowApiUrl, requestJson, resolveFetch } from "../internal/http";
import type { ClientFetch } from "../types";

/**
 * Response shape from the resume endpoint.
 */
export type ResumeSuspensionResponse = {
  suspensionId: string;
  status: "approved" | "rejected";
  requestId: string;
};

/**
 * Options for a single `resumeSuspension()` call.
 */
export type ResumeSuspensionOptions = {
  baseUrl?: string;
  fetcher?: ClientFetch;
  flowKind: string;
  sessionId: string;
  requestId: string;
  suspensionId: string;
  action: "approve" | "reject";
  data?: unknown;
};

/**
 * Calls the resume endpoint to settle a pending suspension.
 */
export async function resumeSuspension(
  options: ResumeSuspensionOptions
): Promise<ResumeSuspensionResponse> {
  const fetcher = resolveFetch(options.fetcher);
  const path = `/api/flows/${encodeURIComponent(options.flowKind)}/sessions/${encodeURIComponent(options.sessionId)}/requests/${encodeURIComponent(options.requestId)}/resume`;

  return requestJson<ResumeSuspensionResponse>({
    fetcher,
    url: buildFlowApiUrl({ baseUrl: options.baseUrl, path }),
    init: {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        suspensionId: options.suspensionId,
        action: options.action,
        data: options.data
      })
    }
  });
}

/**
 * Options for creating a scoped suspension client.
 */
export type CreateSuspensionClientOptions = {
  baseUrl?: string;
  fetcher?: ClientFetch;
};

/**
 * Scoped suspension client with bound transport options.
 */
export type SuspensionClient = {
  /**
   * Resume a pending suspension.
   */
  resume(options: {
    flowKind: string;
    sessionId: string;
    requestId: string;
    suspensionId: string;
    action: "approve" | "reject";
    data?: unknown;
  }): Promise<ResumeSuspensionResponse>;
};

/**
 * Creates a reusable suspension client with bound base URL and fetcher.
 */
export function createSuspensionClient(
  options: CreateSuspensionClientOptions
): SuspensionClient {
  return {
    resume(resumeOpts) {
      return resumeSuspension({
        ...resumeOpts,
        baseUrl: options.baseUrl,
        fetcher: options.fetcher
      });
    }
  };
}
