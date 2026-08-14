/**
 * Conductor's configuration for this example — all of it.
 *
 * `defineConductor()` with no arguments is the honest level 1. Nothing is
 * omitted here as a "fill it in later": the four things conductor needs to
 * start work are facts of the machine it runs on, so it reads them instead of
 * asking.
 *
 * | Not configured   | Discovered from                                            |
 * | ---------------- | ---------------------------------------------------------- |
 * | the repository   | `git remote get-url origin` in the checkout conductor is in  |
 * | GitHub auth      | `GITHUB_TOKEN` / `GH_TOKEN` — the variables `gh` already uses |
 * | the base branch  | the remote's HEAD                                            |
 * | the dispatcher   | the coding harness that is actually installed (`claude`)     |
 *
 * A discovery that cannot answer raises an error naming the field that
 * overrides it. There is no silent default anywhere — basing work on the wrong
 * branch, or dispatching to a harness that is not installed, is the kind of
 * mistake that only shows up twenty minutes later.
 *
 * Fields do exist for the cases inference genuinely cannot cover — a fork whose
 * pull requests belong upstream, a checkout with several remotes, one conductor
 * driving a repo it is not inside, and the project's own guidance documents.
 * The rule they are held to: **a field earns its place only if it encodes an
 * intent the environment cannot reveal.**
 *
 * In a repo that adopts conductor this file sits at the root. It lives in the
 * example's own directory so that adding this example does not put the
 * flow-state-dev repo itself under management — discovery still walks up to the
 * enclosing checkout, which is the repo the work lands in.
 */

import { defineConductor } from "@flow-state-dev/conductor";

export default defineConductor();
