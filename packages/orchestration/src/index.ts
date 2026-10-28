/**
 * `@flow-state-dev/orchestration` — the orchestration substrate.
 *
 * Three layers behind one entry point:
 *   - Task substrate (`./tasks`) — the `Task` schema + state machine, the
 *     storage-agnostic `TaskCollection`, the dispatcher catalog, workers,
 *     loop helpers, and flow policy.
 *   - Skills (`./skills`) — user-editable `SKILL.md` folders bound into a
 *     generator's context, plus the agent-callable `taskTools` surface.
 *
 * The task-board primitive is a separate subpath export
 * (`@flow-state-dev/orchestration/task-board`) so a board can be pulled in
 * without the whole surface.
 *
 * Layering: `core → orchestration → patterns`. This package depends only on
 * `@flow-state-dev/core` and never imports from `patterns` or `workforce`.
 */

export * from "./tasks";
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
