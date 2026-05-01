/**
 * @deprecated Re-export shim. SSE heartbeat injection now lives in
 * `@flow-state-dev/server` and is applied automatically to every live and
 * GET-attach stream. Import `injectHeartbeat` from `@flow-state-dev/server`
 * directly when you need it; this module will be removed in a future major.
 */
export { injectHeartbeat } from "@flow-state-dev/server";
