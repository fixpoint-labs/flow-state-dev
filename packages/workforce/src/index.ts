/**
 * `@flow-state-dev/workforce` — the seat factory and its persona helpers.
 *
 * The package supplies `hireWorkforce`, which turns worker records into one
 * configured, addressable flow copy each, and declares `WorkerManifest`, the
 * record those workers are made of, whether described in files or written by
 * hand. Reading that description off disk is the `./loader` subpath's job, kept
 * out of the root so importing this package does not pull a consumer onto
 * `node:fs`.
 *
 * The same split covers file-declared documents: `ResourceDoc` is the record,
 * `./loader` reads it off disk, and `resourcesFromDocs` here turns records into
 * the resource map an app spreads into its flow. A `resources/` folder takes
 * TypeScript beside the Markdown, and that half lands the same way:
 * `./codegen` finds the modules, `fsdev gen` renders them onto a
 * `resourceModules` map, and `splitResourceModules` here separates the
 * capabilities a worker kind `uses` from the resources that merge into the
 * same one map the documents fill.
 *
 * A worker is a flow kind plus its instructions; there is no Agent class here,
 * only the flow a kind resolves to. A record that names no kind is hired into
 * the built-in `agent` kind, whose flow `defineAgentWorkerFlow` builds — called
 * with no arguments it *is* the built-in, and called with arguments it is how
 * an app replaces it. Beside the
 * seat factory sit two helpers: `definePersona`, which declares the persona
 * resources a flow renders as a system prompt, and `createWorkforceCapability`,
 * which surfaces a roster through the capability system.
 *
 * The package also ships the **channel** floor: `channelFlow`, the one built-in
 * channel kind, and the two-phase binder (`channelInstances` at build time,
 * `openChannels` at runtime) that turns channel records into one registered
 * instance per kind and one named session per channel. A worker record and a
 * channel record look alike and bind differently, and the difference is worth
 * holding on to: hiring a worker MINTS a flow copy per record, while opening a
 * channel opens a SESSION per record on a shared one.
 *
 * Beside the channel floor sits the **inventory**: three org-scoped resource
 * collections holding what is actually open, which a folder of files cannot
 * answer at run time because a block does not walk folders. `inventory/
 * collections.ts` is canonical for what each one holds and how they join back
 * to the declared records.
 *
 * And beside the inventory sits the **roster**: the durable record of seats
 * hired while the app was running, which files cannot hold because a runtime
 * hire writes no file. `roster/collections.ts` owns the row,
 * `roster/reload.ts` owns reading a whole roster back at the next boot, and
 * the two are a different contract from the inventory's on purpose — a roster
 * row is deletable because firing a seat is half of what a roster is for,
 * while an inventory row means *was registered here* and is never removed.
 */

export { AGENT_KIND, defineAgentWorkerFlow, type AgentWorkerFlowOptions } from "./agent-worker-flow";
export { definePersona, type PersonaResourceConfig, type PersonaCollectionConfig } from "./define-persona";
export { createWorkforceCapability, type WorkforceCapabilityOptions } from "./workforce-capability";
export {
  createSeatHireCapability,
  hiredSeatOwnerPinFromRosterOwner,
  registerHiredSeat,
  HIRED_ROSTER_RESOURCE,
  SEAT_HIRE_CAPABILITY,
  SEAT_INVENTORY_RESOURCE,
  type HiredSeatOwnerPin,
  type SeatHireCapabilityOptions,
} from "./seat-hire-capability";
export { hireWorkforce, unattendedBoardWarnings, type HireOptions } from "./hire";
export { resourcesFromDocs } from "./resources-from-docs";
export { referencesFromDocs, referenceBody } from "./references-from-docs";
export {
  clearShadowedReferences,
  describeShadowedReferences,
  type ClearShadowedReferencesInput,
  type ClearShadowedReferencesResult,
  type ReferenceContentStore,
  type ReferenceInstallFlow,
  type ShadowedReference,
} from "./clear-shadowed-references";
export {
  SEAT_REFERENCES_KEY,
  placeOfReference,
  placeOfSeat,
  referenceReachableBySeat,
  type TreePlace,
} from "./seat-references";
export { splitResourceModules, type ResourceModuleHalves } from "./split-resource-modules";
export type {
  ResourceModuleExport,
  ResourceModules,
  WorkerResourceModuleExport,
} from "./resource-modules";
export type { SeatCapabilitySelection } from "./seat-capabilities";
// Agent discovery (FIX-817) — the workforce's two domains, and the worker-file
// key that narrows which of a scope's domains one seat reads.
export {
  workforceManifestSources,
  type DeclaredWorkforce,
  type InventoryKeys,
  type WorkforceManifestSourceOptions,
} from "./manifest-sources";
// `seatDiscoverSelection` / `narrowToSeatSelection` stay internal: the
// capability is their only caller, and an export with no consumer is a
// contract nobody asked for. `SEAT_DISCOVER_KEY` is public because the key it
// names is authored by hand in a `WORKER.md` and a second spelling of it is
// the bug this package refuses rather than resolves.
export { SEAT_DISCOVER_KEY } from "./seat-discovery";
export { workerConfigSchema, seatSkillSchema, type WorkerConfig } from "./worker-config";
export type { WorkerManifest, TeamManifest, ResourceDoc } from "./manifest";
export * from "./channel";
export * from "./inventory";
export * from "./roster";
