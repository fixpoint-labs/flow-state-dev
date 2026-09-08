/**
 * Thin wrappers around the `@flow-state-dev/client` factories used by the
 * DevTool panel. The DevTool is not itself a flow instance (it inspects
 * arbitrary ones), so the shared client is initialised with a synthetic
 * `__devtool__` address for listing and capabilities only, and every addressed
 * call below takes the selected instance's EXACT id.
 *
 * `flowKind` is the historical spelling of the client's address slot and of the
 * `/api/flows/:flowKind/` URL segment. It carries an instance id — that is what
 * the server resolves — so the parameters here are named `flowId` to say what
 * the value actually is. Passing a kind where two copies exist addresses
 * whichever one the registry happens to hold under that name, which is the
 * defect this panel exists to stop showing.
 *
 * When a `bearerToken` is configured (from `fsdev.config.ts` → `devtool` →
 * injected into the page, or the Settings sheet), every client sends it as
 * `Authorization: Bearer` so a bearer-gated flow's resolver accepts DevTool's
 * requests. The token rides on a wrapping `fetcher`, which is the one hook all
 * client factories (JSON, action, and the fetch-based SSE stream) share.
 */
import {
  createClient,
  createSessionClient,
  createRecoveryClient,
  createSSEClient,
  type Client,
  type ClientFetch,
  type ExecuteActionResponse,
  type SessionClient,
  type RecoveryClient,
  type CreateSSEClientOptions,
  type RequestStreamHandle,
} from "@flow-state-dev/client";

export type DevToolConfig = {
  userId: string;
  /**
   * Bearer token sent as `Authorization: Bearer` on every flow request. Set
   * from the app's `fsdev.config.ts` `devtool.bearerToken` (injected by
   * `fsdev dev`) or the Settings sheet. Undefined means no auth header.
   */
  bearerToken?: string;
};

/**
 * A `fetcher` that adds `Authorization: Bearer <token>` to every request.
 * Returns `undefined` when no token is set, so the client uses its default.
 */
export function bearerFetcher(bearerToken: string | undefined): ClientFetch | undefined {
  if (bearerToken === undefined || bearerToken.length === 0) return undefined;
  return (input, init) => {
    const headers = new Headers(init?.headers);
    headers.set("authorization", `Bearer ${bearerToken}`);
    return fetch(input, { ...init, headers });
  };
}

export function createDevToolClient(config: DevToolConfig, baseUrl?: string): Client {
  return createClient({
    flowKind: "__devtool__",
    userId: config.userId,
    baseUrl,
    fetcher: bearerFetcher(config.bearerToken),
  });
}

export function createDevToolSessionClient(baseUrl?: string, bearerToken?: string): SessionClient {
  return createSessionClient({ baseUrl, fetcher: bearerFetcher(bearerToken) });
}

export function createDevToolRecoveryClient(baseUrl?: string, bearerToken?: string): RecoveryClient {
  return createRecoveryClient({ baseUrl, fetcher: bearerFetcher(bearerToken) });
}

/** Open a request's SSE stream on the instance that owns it. */
export function connectRequestStream(
  flowId: string,
  requestId: string,
  callbacks: Omit<CreateSSEClientOptions, "url" | "baseUrl">,
  baseUrl?: string,
  bearerToken?: string,
): RequestStreamHandle {
  return createSSEClient({
    ...callbacks,
    baseUrl,
    fetcher: bearerFetcher(bearerToken),
    // Encoded once, here. Instance ids are opaque, so they may carry
    // punctuation this side does not get to prescribe.
    url: `/api/flows/${encodeURIComponent(flowId)}/requests/${encodeURIComponent(requestId)}/stream?include=trace`,
  });
}

/**
 * Dispatch an action against a specific flow INSTANCE. The DevTool's shared
 * `Client` is bound to the synthetic `__devtool__` address for
 * listing/capabilities, so dispatches build a per-instance client to hit the
 * right endpoint while still threading `baseUrl` for cross-origin embedded
 * mounts.
 */
export function dispatchDevToolAction(
  flowId: string,
  sessionId: string,
  action: string,
  input: unknown,
  options: { userId: string; baseUrl?: string; bearerToken?: string },
): Promise<ExecuteActionResponse> {
  const client = createClient({
    flowKind: flowId,
    userId: options.userId,
    baseUrl: options.baseUrl,
    fetcher: bearerFetcher(options.bearerToken),
  });
  return client.sendAction(action, input, { sessionId });
}
