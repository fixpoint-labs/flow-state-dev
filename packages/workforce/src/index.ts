/**
 * `@flow-state-dev/workforce` — the worker factory and its persona helpers.
 *
 * The package supplies `hireWorkforce`, which registers one copy of each
 * worker flow and the roster flow, and declares `WorkerManifest`, the
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
 * And beside the inventory sits the **roster**: each user's own workers,
 * hired while the app runs, which files cannot hold because a hire writes no
 * file. A worker of the user's own is a row of their worker collection
 * (`workers/worker-row.ts`), and the roster flow `hireWorkforce` registers
 * carries the four writes to it, `hire`, `fork`, `edit` and `fire`
 * (`workers/hire-blocks.ts`); an app calls them through the workforce client.
 * Nothing is registered by a write: each worker flow loads its turn's worker
 * from the row when the turn starts, so a hire, an edit or a fire reaches the
 * next turn on every host, with no restart. Standard workers, the ones the
 * files declare, are read-only; a user forks one to get a copy of their own.
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
