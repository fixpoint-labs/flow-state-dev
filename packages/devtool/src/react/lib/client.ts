/**
 * Who the DevTool reads as, and the credential its one client carries.
 *
 * The DevTool holds one `createClient` (see `context/devtool-context.tsx`).
 * When a `bearerToken` is configured (from `fsdev.config.ts` → `devtool` →
 * injected into the page, or the Settings sheet), that client's `fetcher`
 * sends it as `Authorization: Bearer` on every call and stream, so a
 * bearer-gated flow's resolver accepts the DevTool's requests.
 *
 * Every flow-addressed call takes the selected instance's EXACT id through
 * `client.flow(id)`: passing a kind where two copies exist addresses whichever
 * one the registry holds under that name, which is the defect this panel
 * exists to stop showing.
 */
import type { ClientFetch } from "@flow-state-dev/client";

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
 * A `fetch` that adds `Authorization: Bearer <token>` to every request, for a
 * client's `fetcher`. `undefined` when no token is set, so the client uses
 * the plain `fetch`. Shared with Shift Manager, which reads the Lab the same
 * way.
 */
export function withBearerToken(bearerToken: string | undefined): ClientFetch | undefined {
  if (bearerToken === undefined || bearerToken.length === 0) return undefined;
  return (input, init) => {
    const headers = new Headers(init?.headers);
    headers.set("authorization", `Bearer ${bearerToken}`);
    return fetch(input, { ...init, headers });
  };
}
