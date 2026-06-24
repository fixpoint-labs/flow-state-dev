/**
 * @deprecated Re-export shim. SSE heartbeat injection now lives in
 * `@flow-state-dev/engine` and is applied automatically to every live and
 * GET-attach stream. Import `injectHeartbeat` from `@flow-state-dev/engine`
 * directly when you need it; this module will be removed in a future major.
 */
export { injectHeartbeat } from "@flow-state-dev/engine";
