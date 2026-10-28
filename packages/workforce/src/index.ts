/**
 * `@flow-state-dev/workforce` — the worker factory and its persona helpers.
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
 * capabilities a worker flow `uses` from the resources that merge into the
 * same one map the documents fill.
 *
 * A worker is a flow plus its instructions; there is no Agent class here,
 * only the flow it runs on. A record that names no flow is hired into
 * the built-in `agent` worker flow, which `defineAgentWorkerFlow` builds — called
 * with no arguments it *is* the built-in, and called with arguments it is how
 * an app replaces it. Beside the
 * worker factory sit two helpers: `definePersona`, which declares the persona
 * resources a flow renders as a system prompt, and `createWorkforceCapability`,
 * which surfaces a roster through the capability system.
 *
 * Beside the worker factory sits the **inventory**: an org-scoped resource
 * collection holding the workers registered in this org, which a folder of files
 * cannot answer at run time because a block does not walk folders. `inventory/
 * collections.ts` is canonical for what it holds and how it joins back to the
 * declared records.
 *
 * And beside the inventory sits the **roster**: the durable record of workers
 * hired while the app was running, which files cannot hold because a runtime
 * hire writes no file. `roster/collections.ts` owns the row,
 * `roster/reload.ts` owns reading a whole roster back at the next boot, and
 * the two are a different contract from the inventory's on purpose — a roster
 * row is deletable because firing a worker is half of what a roster is for,
 * while an inventory row means *was registered here*. A declared worker's
 * inventory row is never removed; a runtime-hired worker's is removed by its
 * fire, and only while it carries the incarnation fired.
 */

export { AGENT_FLOW, defineAgentWorkerFlow, type AgentWorkerFlowOptions } from "./agent-worker-flow";
export { definePersona, type PersonaResourceConfig, type PersonaCollectionConfig } from "./define-persona";
export { createWorkforceCapability, type WorkforceCapabilityOptions } from "./workforce-capability";
export { type HireOptions, type WorkerFlowEntry } from "./hire";
export { workerFlowProblems } from "./worker-flow-contract";
export { WORKER_ROLES, type WorkerRole } from "./worker-roles";
export { sharedResource, writeShared, type SharedWriteContext, type WrittenBy } from "./shared-resource";
export { WORKER_TASK_ENTRY } from "./worker-task-entry";
export {
  conversationLedgers,
  filingConversationBoard,
  workerTaskEntry,
  type WorkerTaskBlockInput,
  type WorkerTaskClaim,
  type WorkerTaskEntryOptions
} from "./conversation-board/task-entry";
export { sessionIdOfFiling } from "./conversation-board/filing-session";
// A routed task's recent lines (FIX-2083), for a flow of its own whose `work` turn is a generator.
export { routedTaskHistory } from "./coordinator/routed-brief";
// Steering a task a worker runs (FIX-2086): the turn a late steer is owed, on
// every flow whose `work` entry is a `workerTaskEntry`, and how a write starts it.
export {
  STEER_TURN_ENTRY,
  startOwedSteerTurn,
  steerTurnEntry,
  type SteerTurnEntryOptions
} from "./conversation-board/steer";
// A user's running turn hears the tasks that finished while it answered
// (FIX-2159): the take, the pre-built `answerAgain` source, and the cap on
// answers again in one request.
export {
  finishedTaskSchema,
  finishedTasksAnswerAgain,
  takeFinishedTasks,
  type FinishedTask,
  type FinishedTasksAnswerAgainOptions
} from "./conversation-board/take-finished";
export { MAX_ANSWERS_AGAIN } from "./conversation-board/plan";
export {
  backfillBoardWakes,
  type BoardWakeBackfillOptions,
  type BoardWakeBackfillStores
} from "./conversation-board/backfill-wakes";
export {
  createWorkerLookup,
  type WorkerLookup,
  type WorkerLookupAnswer,
  type WorkerLookupOptions
} from "./worker-lookup";
export { mergeWorkerFlows } from "./merge-worker-flows";
export { workerDoorOf, type WorkerDoor } from "./worker-door";
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
  WORKER_REFERENCES_KEY,
  parseDeclaredWorkerId,
  placeOfReference,
  placeOfWorker,
  referenceReachableByWorker,
  type DeclaredWorkerId,
  type TreePlace,
} from "./worker-references";
export { splitResourceModules, type ResourceModuleHalves } from "./split-resource-modules";
export type {
  ResourceModuleExport,
  ResourceModules,
  WorkerResourceModuleExport,
} from "./resource-modules";
export type { WorkerCapabilitySelection } from "./worker-capabilities";
// Agent discovery (FIX-817) — the workforce's two domains, and the worker-file
// key that narrows which of a scope's domains one worker reads.
export {
  workforceManifestSources,
  type DeclaredWorkforce,
  type InventoryKeys,
  type WorkforceManifestSourceOptions,
} from "./manifest-sources";
// `workerDiscoverSelection` / `narrowToWorkerSelection` stay internal: the
// capability is their only caller, and an export with no consumer is a
// contract nobody asked for. `WORKER_DISCOVER_KEY` is public because the key it
// names is authored by hand in a `WORKER.md` and a second spelling of it is
// the bug this package refuses rather than resolves.
export { WORKER_DISCOVER_KEY } from "./worker-discovery";
export {
  workerConfigSchema,
  workerSkillSchema,
  workerPackageSchema,
  type WorkerConfig
} from "./worker-config";
export type { WorkerManifest, TeamManifest, ResourceDoc, PackageManifest } from "./manifest";
export * from "./inventory";
export * from "./projects";
export * from "./workers";
export * from "./coordinator";
export * from "./delegates";
export * from "./standing-rules";
export * from "./messages";
export * from "./error-reporter";
export * from "./schedules";
export {
  defineSessionBoard,
  type SessionBoard,
  type SessionBoardOptions
} from "./conversation-board/session-board";
