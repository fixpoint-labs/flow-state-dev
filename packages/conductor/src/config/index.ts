/**
 * The config layer — what a project writes, and what conductor works out for
 * itself.
 *
 * ```
 * conductor.config.ts ──defineConductor()──▶ ConductorConfig
 *                                                 │
 *                        environment ──────▶ resolveConductor() ──▶ ResolvedConductor
 * ```
 *
 * Level 1 is `export default defineConductor()` and nothing else. The whole
 * point of this directory is that the second arrow does the work: the repo, the
 * token, the default branch, and the coding harness are read from the machine
 * rather than asked for, and a discovery that cannot answer raises a
 * {@link ConductorConfigError} naming the field that overrides it.
 */

export {
  defineConductor,
  resolveConductor,
  DEFAULT_GOAL_CHECK_TIMEOUT_MS,
  type BaseBranchOrigin,
  type ConductorConfig,
  type ConductorOrigins,
  type FieldOrigin,
  type GoalCheckConfig,
  type ResolvedConductor,
  type ResolvedGoalCheck,
  type ResolveOptions,
} from "./define";

export {
  ConductorConfigError,
  defaultGitRunner,
  defaultHarnessProbe,
  discoverDefaultBranch,
  discoverDispatcher,
  discoverGitHubToken,
  discoverRemoteUrl,
  discoverRepoRoot,
  KNOWN_HARNESSES,
  parseRepoRef,
  requireGitHubToken,
  type DiscoveredDefaultBranch,
  type HarnessProbe,
  type KnownHarness,
  type RepoRef,
} from "./discover";
