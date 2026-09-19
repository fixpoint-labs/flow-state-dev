/**
 * `@flow-state-dev/workforce/loader` — read a workforce from files.
 *
 * The Node-only half of the package. `readDeclaredRoster` is the widest entry
 * point: one call over the readers below, returning the whole declared tree —
 * workers, teams, documents, channels — plus one flattened list of what failed
 * to load, each entry tagged with the layer that reported it. It walks nothing
 * itself, and it collects rather than throws, so the caller keeps its own boot
 * policy. Under it, `readWorkforce` is the entry point an app wanting seats
 * alone still reaches for: it reads the tree and hands back records that already carry their
 * own skills, ready for `hireWorkforce`. Underneath it, `readWorkforceDirectory`
 * scans `teams/<id>/workers/<name>/` and returns one neutral `WorkerManifest`
 * per worker, and `readSeatSkills` reads the skills one seat can see across the
 * three levels it draws from; both stay exported for a caller that wants one
 * half on its own. Alongside them, `readTeamsDirectory` reads each team's own
 * optional `TEAM.md` — what a team is, and the instructions every seat on it
 * carries — `readResourcesDirectory` scans `org/resources/` and
 * `teams/<id>/resources/` and returns one `ResourceDoc` per document, and
 * `readChannelsDirectory` scans `teams/<id>/channels/<name>/` and returns one
 * `ChannelManifest` per channel. All six stop there — nothing here builds a
 * flow, an agent, a resource, a channel instance or a registry, and neither
 * does the composer over them.
 *
 * Under all of them sit the walk primitives the readers share, published for
 * the next convention to build on rather than copy: `openRoot` opens the
 * configured root, `walkTeams` enumerates `teams/`, `openStructuralDirectory`
 * and `classify` answer for one path, `refusedSymlink` and `unreadable` are the
 * one wording for each refusal, `IGNORED_ENTRIES` is the one list of names
 * that never denote anything, and `validateSegment` is the one rule for what a
 * name in this tree may be. What a reader does inside a team is its own.
 *
 * **One rule binds every reader here, and the next one added beside them.**
 * Anything the published convention tells an author they may write is either
 * consumed or refused loudly, naming it — never passed over in silence, because
 * an author who followed the docs and got no seat and no error has no way left
 * to find out. `test/published-tree-surface.test.ts` enforces it and carries the
 * reasoning, the exclusions, and whatever is still silent.
 *
 * Kept behind a subpath so importing the package root does not pull a consumer
 * onto `node:fs`.
 */

export {
  readDeclaredRoster,
  type DeclaredProblem,
  type DeclaredProblemLayer,
  type DeclaredRoster,
} from "./read-declared-roster";

export {
  readWorkforce,
  type ReadWorkforceResult,
} from "./read-workforce";

export {
  readWorkforceDirectory,
  type ReadWorkforceDirectoryResult,
  type WorkerManifestError,
  type WorkerManifestErrorKind,
} from "./read-workforce-directory";

export {
  readSeatSkills,
  type ReadSeatSkillsOptions,
  type ReadSeatSkillsResult,
  type SeatSkillError,
  type SeatSkillErrorKind,
} from "./read-seat-skills";

export {
  readTeamsDirectory,
  type ReadTeamsDirectoryResult,
  type TeamManifestError,
  type TeamManifestErrorKind,
} from "./read-teams-directory";

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

export {
  IGNORED_ENTRIES,
  classify,
  openRoot,
  openStructuralDirectory,
  refusedSymlink,
  unreadable,
  walkTeams,
  type Entry,
  type EntryKind,
  type OpenedDirectory,
  type PathReport,
  type WalkedTeam,
} from "./structural-directory";

export { validateSegment, type SegmentLabel } from "./segments";

export {
  DOCUMENT_EXTENSION,
  RESOURCES_SLOT,
  WORKERS_LEVEL,
  mintResourceRef,
} from "./resource-convention";

export type { WorkerManifest, TeamManifest, ResourceDoc, ChannelManifest } from "../manifest";
