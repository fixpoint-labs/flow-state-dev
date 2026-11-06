/**
 * `@flow-state-dev/orchestration` — the orchestration substrate's Node entry.
 *
 * Each name has one home. This root carries skills (user-editable `SKILL.md`
 * folders bound into a generator's context), the frontmatter helpers,
 * `resolveCatalogTools`, and the Node-only seams below. The task substrate
 * (the `Task` schema and state machine, `TaskCollection`, dispatchers,
 * workers, loop helpers, flow policy) lives on `./tasks` only, which stays
 * browser-safe; the task-board primitive on `./task-board`; the inbox on
 * `./inbox`.
 *
 * Layering: `core → orchestration → patterns`. This package never imports
 * from `patterns` or `workforce`.
 */

export * from "./skills";

// Cross-cutting catalog-key helper. Lives under `./shared` rather than
// `./skills` because no one layer owns it.
export { resolveCatalogTools } from "./shared/resolve-catalog-tools";

// The frontmatter dialect the hand-written convention files share.
// `SKILL.md` and `WORKER.md` must accept the same frontmatter, and neither
// owns it, so it sits beside the other cross-cutting helper rather than
// under `./skills`.
export { splitFrontmatter, parseFrontmatterYaml } from "./shared/frontmatter";

// The one task-turn test (FIX-1816 BR-5a; FIX-1817 S1 imports it): a turn the
// receiving gate serves. Node-only like the seam below, since the claim it
// reads is an async-context stamp.
export { isTaskTurn, TASK_SESSION_TASK_KEY } from "./task-board/task-turn";

// How a filer hears a delegated task end (FIX-2078): the `onTaskSettled`
// entry any flow that hands rows out declares, a running request's own take
// of a notice through the same take record (FIX-2159), and the repairs a
// board's pass runs in the filer's session (resumes, cascades, notices past due).
export {
  takeOwedNotice,
  taskSettledEntry,
  taskSettledInputSchema,
  type TaskSettledEntryOptions,
  type TaskSettledInput
} from "./tasks/notice/task-settled-entry";
export { payBoardDebts, settlePassWake, type BoardDebts, type PayBoardDebtsOptions } from "./tasks/notice/pass";

// The lease-renewal async-context seam. Deliberately NOT on the `./tasks`
// subpath: it needs `node:async_hooks`, and that subpath is published
// browser-safe (`docs/architecture/items.md`). This entry already reaches
// `node:fs` through skills, so it is the right home for a Node-only seam.
export {
  openLeaseRenewalScope,
  withLeaseRenewalScope,
  stampLeaseRenewal,
  currentLeaseRenewal,
} from "./tasks/lease-renewal-scope";
