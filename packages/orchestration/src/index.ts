/**
 * `@flow-state-dev/orchestration` — the orchestration substrate.
 *
 * Three layers behind one entry point:
 *   - Task substrate (`./tasks`) — the `Task` schema + state machine, the
 *     storage-agnostic `TaskCollection`, the dispatcher catalog, workers,
 *     loop helpers, and flow policy.
 *   - Skills (`./skills`) — user-editable `SKILL.md` folders materialized into
 *     runnable pattern boards, plus the agent-callable `taskTools` surface.
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
