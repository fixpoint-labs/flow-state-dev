/**
 * Public barrel for `@flow-state-dev/contracts` — the zero-dependency shared
 * layer at the bottom of the framework spine. It carries the item taxonomy,
 * the deterministic block-instance-id helpers, and the pure leaf types those
 * depend on. Browser packages (`react`, `client`), the block-authoring
 * ecosystem, and `core` itself value-import from here; nothing in this package
 * imports any workspace package or external runtime dependency.
 *
 * `core` re-exports every symbol below from its original path, so this move is
 * non-breaking for existing `@flow-state-dev/core` consumers.
 */

// Item taxonomy: types, content, events, and the pure resolution helpers.
export * from "./items";

// Pure leaf types not surfaced through the items barrel.
export type { ResumeAction, SuspensionReason, SuspensionStatus } from "./types/suspension";

// Agent discovery: the shared manifest-entry record and the per-domain source
// type that projects into it (FIX-817).
export { MANIFEST_DOMAINS, isManifestDomain } from "./types/manifest";
export type { ManifestDomain, ManifestEntry, ManifestSource } from "./types/manifest";

// Deterministic blockInstanceId construction/parsing (pure string logic).
export * from "./block-instance-id";
