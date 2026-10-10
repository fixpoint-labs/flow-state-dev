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

// The board touch that resumes a turn waiting on an asked task (FIX-1816),
// for a layer that runs its own board. The rest of the ask mechanism is on
// the `./task-board` subpath.
export { resumeOwedAsks, type ResumeOwedReport } from "./tasks/helpers/wait-for-response";

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
