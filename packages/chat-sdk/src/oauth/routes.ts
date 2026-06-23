/**
 * OAuth callback routes for Chat SDK adapters that expose them.
 *
 * The Chat SDK doesn't define `handleOAuthCallback` on its base Adapter
 * type — some adapters (Slack, Linear, GitHub) ship one anyway. We
 * duck-type per adapter and mount only those that expose a callable
 * `handleOAuthCallback`. Install initiation (the redirect *to* the
 * platform's authorize URL) is a host concern and intentionally not
 * mounted by this adapter.
 */
import type { Chat } from "chat";
import type { TransportRoute } from "@flow-state-dev/engine";

type AdapterWithOAuth = {
  handleOAuthCallback: (
    req: Request,
    options?: { redirectUri?: string }
  ) => Promise<Response>;
};

function hasOAuthCallback(adapter: unknown): adapter is AdapterWithOAuth {
  return (
    adapter !== null &&
    typeof adapter === "object" &&
    typeof (adapter as { handleOAuthCallback?: unknown }).handleOAuthCallback ===
      "function"
  );
}

export function buildOAuthRoutes(
  bot: Chat,
  prefix: string,
  config: true | { redirectUri: string }
): TransportRoute[] {
  const redirectUri = typeof config === "object" ? config.redirectUri : undefined;
  // `Chat.adapters` is marked private on the class but the field exists at
  // runtime and is the only way to enumerate adapter names for OAuth route
  // mounting. Cast through `unknown` per TS guidance for private-field reads.
  const adapters =
    ((bot as unknown) as { adapters?: Record<string, unknown> }).adapters ?? {};
  const routes: TransportRoute[] = [];
  for (const [name, adapter] of Object.entries(adapters)) {
    if (!hasOAuthCallback(adapter)) continue;
    routes.push({
      method: "GET",
      path: `${prefix}/${name}/oauth/callback`,
      handler: async (req) =>
        adapter.handleOAuthCallback(
          req,
          redirectUri !== undefined ? { redirectUri } : undefined
        ),
    });
  }
  return routes;
}
