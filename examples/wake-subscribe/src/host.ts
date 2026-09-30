/**
 * Shared host sketch — GitHub is registered once.
 *
 * TODAY the adapter still addresses a flow:
 *   POST /api/flows/:flowKind/webhooks/github
 *
 * SKETCH (style 1 only, not implemented):
 *   POST /api/webhooks/github  → consult a subscribe table → session
 *
 * Style 2 keeps today's URL and points it at the desk kind.
 *
 * Not a running server. `fsdev.config.ts` skips these adapters so inspect /
 * review / record run locally with no secrets.
 */
export { createPerSessionHost } from "./1-per-session/host";
export { createFanInHost } from "./2-fan-in-route/host";
export { registerGitHubTransport, githubProviderDefinition } from "./shared/github-provider";
