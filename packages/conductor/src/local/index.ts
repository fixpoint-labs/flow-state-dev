/**
 * The local half of a tick: read a real checkout, turn what changed into
 * signals.
 *
 * ```
 * localObserver().observe() ──▶ { world, signals } ──▶ decide() ──▶ Action[]
 * ```
 *
 * The division of labour across this directory:
 *
 * | Module | Owns |
 * |---|---|
 * | `git` | one real git command per world fact. Nothing domain-shaped. |
 * | `store` | the local review record on disk — submissions, verdicts, comments, checks. |
 * | `read-world` | git + files → `World`, driven by the facts gates declare. |
 * | `observe` | the read path, stated as an `Observer`: fresh read + reconcile + comment cursor. |
 *
 * Everything here is I/O at the edges and plain data in the middle, and the
 * middle is shared with GitHub: `reconcile` and every gate predicate run over
 * the same `World`, so the driver cannot tell which source produced it.
 */

export {
  headSha,
  headShaAt,
  isAncestor,
  mergesCleanly,
  LocalGitError,
} from "./git";

export {
  openSubmission,
  readCheck,
  readComments,
  readReviews,
  readSubmission,
  submissionDir,
  writeCheck,
  type LocalCheckRecord,
  type LocalComment,
  type LocalSubmission,
} from "./store";

export {
  readLocalWorld,
  type LocalSourceOptions,
  type LocalWorldResult,
} from "./read-world";

export { localObserver, LOCAL_SOURCE, type LocalObserverOptions } from "./observe";
