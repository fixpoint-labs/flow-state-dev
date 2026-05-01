/**
 * Thin wrappers around the `@flow-state-dev/client` factories used by the
 * DevTool panel. The DevTool itself doesn't have a flowKind (it inspects
 * arbitrary flows), so the action client is initialised with a synthetic
 * `__devtool__` flowKind and the panel always passes the real flowKind
 * explicitly when dispatching actions.
 */
import {
  createClient,
  createSessionClient,
  createRecoveryClient,
  createSSEClient,
  type Client,
  type SessionClient,
  type RecoveryClient,
  type CreateSSEClientOptions,
  type RequestStreamHandle,
} from "@flow-state-dev/client";

export type DevToolConfig = {
  userId: string;
};

export function createDevToolClient(config: DevToolConfig, baseUrl?: string): Client {
  return createClient({
    flowKind: "__devtool__",
    userId: config.userId,
    baseUrl,
  });
}

export function createDevToolSessionClient(baseUrl?: string): SessionClient {
  return createSessionClient({ baseUrl });
}

export function createDevToolRecoveryClient(baseUrl?: string): RecoveryClient {
  return createRecoveryClient({ baseUrl });
}

export function connectRequestStream(
  flowKind: string,
  requestId: string,
  callbacks: Omit<CreateSSEClientOptions, "url" | "baseUrl">,
  baseUrl?: string,
): RequestStreamHandle {
  return createSSEClient({
    ...callbacks,
    baseUrl,
    url: `/api/flows/${encodeURIComponent(flowKind)}/requests/${encodeURIComponent(requestId)}/stream?unfiltered=true`,
  });
}
