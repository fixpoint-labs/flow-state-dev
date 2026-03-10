import { createClient, type Client } from "@flow-state-dev/client";
import { createSessionClient, type SessionClient } from "@flow-state-dev/client";
import { createSSEClient, type CreateSSEClientOptions } from "@flow-state-dev/client";
import type { RequestStreamHandle } from "@flow-state-dev/client";

export type DevToolConfig = {
  baseUrl: string;
  userId: string;
};

export function createDevToolClient(config: DevToolConfig): Client {
  return createClient({
    baseUrl: config.baseUrl,
    flowKind: "__devtool__",
    userId: config.userId,
  });
}

export function createDevToolSessionClient(config: DevToolConfig): SessionClient {
  return createSessionClient({
    baseUrl: config.baseUrl,
  });
}

export function connectRequestStream(
  config: DevToolConfig,
  flowKind: string,
  requestId: string,
  callbacks: Omit<CreateSSEClientOptions, "url" | "baseUrl">,
): RequestStreamHandle {
  return createSSEClient({
    ...callbacks,
    baseUrl: config.baseUrl,
    url: `/api/flows/${encodeURIComponent(flowKind)}/requests/${encodeURIComponent(requestId)}/stream`,
  });
}
