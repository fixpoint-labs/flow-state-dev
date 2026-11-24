/**
 * `@flow-state-dev/workforce/loader` — the workforce folder, as the workforce
 * kit reads it.
 *
 * Node-only. `readWorkforceFolder` reads a workforce folder through a kit's
 * folder (`KitFolder`): its workers, teams, documents and references, every
 * path it reads claimed, and every reader problem a refusal, named. The
 * workforce kit is its caller; an app reads the records it asserts on here.
 *
 * The readers under it (one per convention: workers, skills, teams,
 * resources, references, packages) and the walk over `teams/` are internal.
 * **One rule binds every reader, and the next one added beside them.**
 * Anything the published convention tells an author they may write is either
 * consumed or refused loudly, naming it — never passed over in silence.
 */

export {
  readWorkforceFolder,
  type WorkforceFolder,
} from "./read-workforce-folder";
