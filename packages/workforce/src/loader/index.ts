/**
 * `@flow-state-dev/workforce/loader` — read a workforce from files.
 *
 * The Node-only half of the package. `readWorkforce` is the entry point most
 * apps want: it reads the tree and hands back records that already carry their
 * own skills, ready for `hireWorkforce`. Underneath it, `readWorkforceDirectory`
 * scans `teams/<id>/workers/<name>/` and returns one neutral `WorkerManifest`
 * per worker, and `readSeatSkills` reads the skills one seat can see across the
 * three levels it draws from; both stay exported for a caller that wants one
 * half on its own. Alongside them, `readResourcesDirectory` scans
 * `org/resources/` and `teams/<id>/resources/` and returns one `ResourceDoc` per
 * document, and `readChannelsDirectory` scans `teams/<id>/channels/<name>/` and
 * returns one `ChannelManifest` per channel. All five stop there — nothing here
 * builds a flow, an agent, a resource, a channel instance or a registry.
 *
 * Kept behind a subpath so importing the package root does not pull a consumer
 * onto `node:fs`.
 */

export {
  readWorkforce,
  type ReadWorkforceResult,
} from "./read-workforce";

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

export {
  readChannelsDirectory,
  type ChannelManifestError,
  type ChannelManifestErrorKind,
  type ReadChannelsDirectoryResult,
} from "./read-channels-directory";

export type { PathReport } from "./structural-directory";

export type { WorkerManifest, ResourceDoc, ChannelManifest } from "../manifest";
