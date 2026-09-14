/**
 * `@flow-state-dev/workforce/loader` — read a workforce from files.
 *
 * The Node-only half of the package. `readWorkforceDirectory` scans
 * `teams/<id>/workers/<name>/` and returns one neutral `WorkerManifest` per
 * worker; `readSeatSkills` reads the skills one seat can see, across the three
 * levels it draws from; `readResourcesDirectory` scans `org/resources/` and
 * `teams/<id>/resources/` and returns one `ResourceDoc` per document. All three
 * stop there — nothing here builds a flow, an agent, a resource or a registry.
 *
 * Kept behind a subpath so importing the package root does not pull a consumer
 * onto `node:fs`.
 */

export {
  readWorkforceDirectory,
  type ReadWorkforceDirectoryResult,
} from "./read-workforce-directory";

export {
  readSeatSkills,
  type ReadSeatSkillsOptions,
  type ReadSeatSkillsResult,
  type SeatSkillError,
  type SeatSkillErrorKind,
} from "./read-seat-skills";

export {
  readResourcesDirectory,
  type ReadResourcesDirectoryResult,
  type ResourceDocError,
  type ResourceDocErrorKind,
} from "./read-resources-directory";

export type { PathReport } from "./structural-directory";

export type { WorkerManifest, ResourceDoc } from "../manifest";
