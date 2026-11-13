/**
 * The readers under `readWorkforceFolder`, and the names the codegen walks
 * share with them: internal to the package. `./loader` publishes
 * `readWorkforceFolder` alone.
 */

export {
  readWorkforce,
} from "./read-workforce";

export {
  readWorkforceDirectory,
  type ReadWorkforceDirectoryResult,
  type WorkerManifestError,
} from "./read-workforce-directory";

export {
  readWorkerSkills,
  type WorkerSkillError,
} from "./read-worker-skills";

export {
  readReferencesDirectory,
  readResourcesDirectory,
  type ReadResourcesDirectoryResult,
} from "./read-resources-directory";

export {
  PACKAGES_SLOT,
  readPackagesDirectory,
  type ReadPackagesDirectoryResult,
} from "./read-packages-directory";

// The walk primitives under `walkTeams` (`classify`, `openRoot`,
// `IGNORED_ENTRIES`, ...) are the engine's: `@flow-state-dev/engine/folder`.
export {
  walkTeams,
  type WalkedTeam,
} from "./structural-directory";

export {
  validateSegment,
  type SegmentLabel,
} from "./segments";

export {
  DOCUMENT_EXTENSION,
  REFERENCES_SLOT,
  RESOURCES_SLOT,
  WORKERS_LEVEL,
  type DocumentSlot,
  siblingSlotPath,
} from "./resource-convention";

export type {
  WorkerManifest,
  TeamManifest,
  ResourceDoc,
  PackageManifest,
} from "../manifest";
