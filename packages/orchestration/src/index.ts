/**
 * `@flow-state-dev/orchestration` — the orchestration substrate's Node entry.
 *
 * Each name has one home. This root carries skills (user-editable `SKILL.md`
 * folders bound into a generator's context), `resolveCatalogTools`, the
 * task-turn test and the filer's settled entry. The task substrate (the
 * `Task` schema and state machine, `TaskCollection`, dispatchers, workers,
 * loop helpers, flow policy) lives on `./tasks` only, which stays
 * browser-safe; the task-board primitive on `./task-board`; the inbox on
 * `./inbox`. What only FSD's own packages read is on `./internal`, outside
 * semver.
 *
 * Layering: `core → orchestration → patterns`. This package never imports
 * from `patterns` or `workforce`.
 */

export * from "./skills";

// Cross-cutting catalog-key helper. Lives under `./shared` rather than
// `./skills` because no one layer owns it.
export { resolveCatalogTools } from "./shared/resolve-catalog-tools";

// The one task-turn test (FIX-1816 BR-5a; FIX-1817 S1 imports it): a turn the
// receiving gate serves. Node-only, since the claim it reads is an
// async-context stamp.
export { isTaskTurn } from "./task-board/task-turn";

// How a filer hears a delegated task end (FIX-2078): the `onTaskSettled`
// entry any flow that hands rows out declares.
export {
  taskSettledEntry,
  taskSettledInputSchema,
  type TaskSettledEntryOptions,
  type TaskSettledInput
} from "./tasks/notice/task-settled-entry";
