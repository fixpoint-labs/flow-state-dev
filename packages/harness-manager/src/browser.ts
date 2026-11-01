/**
 * `@flow-state-dev/harness-manager/browser` — the names a browser component
 * needs from this package, and nothing that runs a harness.
 *
 * The package root is not safe to bundle for a browser: the manager provisions
 * checkouts and runs git through `@flow-state-dev/workspace`, which imports
 * Node built-ins. Import from here in a client component instead.
 *
 * `test/browser-subpath-safe.spec.ts` walks this entry's import graph, through
 * the workspace packages it reaches, and fails on any Node built-in.
 */
export {
  readRecordedWork,
  type FileTouch,
  type OpenedPullRequest,
  type PlanStep,
  type RecordedRun,
  type RecordedWork,
  type RecordedWorkClient,
} from "./recorded-work";
