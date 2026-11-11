/**
 * `@flow-state-dev/engine/internal`: seams only FSD's own packages read (the
 * HTTP transport adapter, read-only runs, the in-memory lease backend, owner-run
 * routing, and the resource helpers the MCP adapter projects). Published so
 * those packages can import it, but not part of the public API: no semver
 * promise, and no README entry. A name moves to `@flow-state-dev/engine/host`
 * only with a README entry.
 */
export { encodeStreamEvent } from "./streaming";
export { runRead, type RunReadOptions } from "./execution";
export { runView, type RunViewOptions, type ViewAnswer } from "./execution";
export type { RecordedRead } from "./context/view-reads";
export {
  createHttpTransportAdapter,
  type CreateHttpTransportAdapterOptions,
  createInMemoryLeaseBackend,
  HTTP_TRANSPORT_SOURCE
} from "./transports";
export {
  type MalformedOwnerRun,
  type OwnerRun,
  type OwnerRunRefusal,
  type RoutedOwnerRun,
  type RoutedServiceEvent,
  routeServiceEvent
} from "./durability/owner-runs";
export {
  type ExposedResourceEntry,
  findResourceConfig,
  getPersistedData,
  listExposedResources,
  renderContent,
  type ResolvedResourceScope,
  type ResourceFlowLike,
  type ResourceOwnerFlow,
  type ResourcePersistenceContext
} from "./resources/internal";
export {
  AttachmentUnavailableError,
  type ResolvedAttachment,
  resolveAttachment,
  sessionBlobOwner
} from "./blobs/attachments";
