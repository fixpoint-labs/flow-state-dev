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
  createSSEClientFromResponse,
  type Client,
  type ExecuteActionResponse,
  type SessionClient,
  type RecoveryClient,
  type CreateSSEClientOptions,
  type RequestSSECallbacks,
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
    url: `/api/flows/${encodeURIComponent(flowKind)}/requests/${encodeURIComponent(requestId)}/stream?include=trace`,
  });
}

/**
 * Consume a pre-fetched SSE response body as a request stream (inline
 * streaming). Used after a streaming resume: the resume POST returns the
 * continuation's SSE stream directly, so the DevTool consumes that body instead
 * of opening a separate GET — essential on serverless, where the GET would hit a
 * different instance and never see the in-flight continuation.
 */
export function consumeRequestStreamResponse(
  response: Response,
  callbacks: RequestSSECallbacks,
): RequestStreamHandle {
  return createSSEClientFromResponse({ ...callbacks, response });
}

/**
 * Dispatch an action against a specific flow. The DevTool's shared `Client`
 * is bound to a synthetic `__devtool__` flowKind for listing/capabilities,
 * so action dispatches build a per-flow client to hit the right endpoint
 * while still threading `baseUrl` for cross-origin embedded mounts.
 */
export function dispatchDevToolAction(
  flowKind: string,
  sessionId: string,
  action: string,
  input: unknown,
  options: { userId: string; baseUrl?: string },
): Promise<ExecuteActionResponse> {
  const client = createClient({
    flowKind,
    userId: options.userId,
    baseUrl: options.baseUrl,
  });
  return client.sendAction(action, input, { sessionId });
}
