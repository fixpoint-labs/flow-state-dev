/**
 * What a tick reaches the outside world through.
 *
 * Four seams and a clock, gathered in one place so the tick itself takes no
 * dependency it cannot be handed a different implementation of. Two of them —
 * `Observer` and `Dispatcher` — are the package's declared seams; the other two
 * are the config it was opened with and the git runner provisioning goes
 * through.
 *
 * The type is separate from `./session`, which builds it, so `./tick` can be
 * read without reading the wiring that assembles it.
 */

import type { ResolvedConductor } from "../config/define";
import type { GitRunner } from "../dispatch/branch";
import type { Dispatcher } from "../dispatch/types";
import type { Observer } from "../observe/types";

/** The seams one conductor session runs against. */
export interface RuntimeDeps {
  /** Repo, base branch, guidance, policy — everything resolved at open. */
  readonly config: ResolvedConductor;
  /** How the world is read. GitHub unless the caller supplied another. */
  readonly observer: Observer;
  /** How work gets done. Comes from the config's dispatcher discovery. */
  readonly dispatcher: Dispatcher;
  /** How git is run for workspace provisioning. */
  readonly git: GitRunner;
  /** This session's clock. Injected so a test's timestamps are its own. */
  readonly now: () => Date;
}
