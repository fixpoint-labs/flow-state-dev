/**
 * `@flow-state-dev/workspace` — the file projection.
 *
 * One piece of machinery moving file content between resource collections and
 * wherever an agent works, so the shell path and the coding path share a
 * behaviour instead of drifting apart with a copy each.
 *
 * See `projection.ts` for why the baseline exists and what it costs to get
 * wrong; it is the whole of the fix.
 */
export { createProjection, hashContent } from "./projection";
export type { Projection, ProjectionOptions } from "./projection";
export { createMemoryPlace } from "./memory-place";
export type { MemoryPlace } from "./memory-place";
export { createHostPlace } from "./host-place";
export type { HostPlace } from "./host-place";
export { normalizePath, routePath, isMetadataKey } from "./routing";
export type { Routed } from "./routing";
export type {
  FlushOutcome,
  FlushReport,
  Mount,
  Place,
  ProjectedEntryState,
} from "./types";
export { createClaimRegistry, sharedClaimRegistry } from "./claims";
export type { ClaimHolder, ClaimRegistry } from "./claims";
