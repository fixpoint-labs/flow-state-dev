/**
 * Whether the host a router is served on keeps its disk.
 *
 * A host adapter whose disk does not last between requests (a serverless
 * function) says so once, with {@link declareEphemeralDisk}, on the router it
 * serves. The upload route then refuses a file whose blob store keeps bytes
 * on this host, by name, instead of storing it where the next request can't
 * read it. The engine names no host: the adapter makes the declaration.
 */
import type { FlowApiRouter } from "../routes/createFlowApiRouter";

/** Where a router keeps its host-disk state, read across engine copies. */
const HOST_DISK = Symbol.for("@flow-state-dev/engine/hostDisk");

/** A router's host-disk state: the disk lasts until a host adapter says it doesn't. */
export type HostDiskState = { persists: boolean };

/** Create a router's host-disk state. */
export function createHostDiskState(): HostDiskState {
  return { persists: true };
}

/** Attach `state` to `router`, for {@link declareEphemeralDisk} to find. */
export function attachHostDiskState(router: FlowApiRouter, state: HostDiskState): void {
  Object.defineProperty(router, HOST_DISK, { value: state, enumerable: false, configurable: true });
}

/**
 * Declare that the host serving `router` does not keep its disk between
 * requests. Called by a host adapter, never by an app: uploads to a blob store
 * that keeps bytes on this host are then refused with `attachments_unavailable`.
 *
 * Returns `false`, and changes nothing, for a router `createFlowApiRouter`
 * did not build: such a router serves no upload route, so there is nothing
 * to refuse. A host adapter can call it on whatever router it is handed.
 */
export function declareEphemeralDisk(router: FlowApiRouter): boolean {
  const state = (router as Record<symbol, unknown>)[HOST_DISK] as HostDiskState | undefined;
  if (state === undefined) return false;
  state.persists = false;
  return true;
}
