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
 */

export { AGENT_KIND, defineAgentWorkerFlow, type AgentWorkerFlowOptions } from "./agent-worker-flow";
export { definePersona, type PersonaResourceConfig, type PersonaCollectionConfig } from "./define-persona";
export { createWorkforceCapability, type WorkforceCapabilityOptions } from "./workforce-capability";
export { hireWorkforce, type HireOptions } from "./hire";
export { resourcesFromDocs } from "./resources-from-docs";
export { splitResourceModules, type ResourceModuleHalves } from "./split-resource-modules";
export type {
  ResourceModuleExport,
  ResourceModules,
  WorkerResourceModuleExport,
} from "./resource-modules";
export type { SeatCapabilitySelection } from "./seat-capabilities";
export { workerConfigSchema, seatSkillSchema, type WorkerConfig } from "./worker-config";
export type { WorkerManifest, ResourceDoc } from "./manifest";
export * from "./channel";
