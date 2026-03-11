import { createClient, type Client } from "@flow-state-dev/client";
import { createSessionClient, type SessionClient } from "@flow-state-dev/client";
import { createSSEClient, type CreateSSEClientOptions } from "@flow-state-dev/client";
import type { RequestStreamHandle } from "@flow-state-dev/client";

export type DevToolConfig = {
  userId: string;
};

export function createDevToolClient(config: DevToolConfig): Client {
  return createClient({
    flowKind: "__devtool__",
    userId: config.userId,
  });
}

export function createDevToolSessionClient(): SessionClient {
  return createSessionClient({});
}

export function connectRequestStream(
  flowKind: string,
  requestId: string,
  callbacks: Omit<CreateSSEClientOptions, "url" | "baseUrl">,
): RequestStreamHandle {
  return createSSEClient({
    ...callbacks,
    url: `/api/flows/${encodeURIComponent(flowKind)}/requests/${encodeURIComponent(requestId)}/stream`,
  });
}
