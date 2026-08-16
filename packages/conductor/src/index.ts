/**
 * `@flow-state-dev/conductor` — development orchestration for flow-state-dev.
 *
 * Conductor runs a software development process: it drives a work item from
 * problem through spec, review, implementation, and PR feedback, dispatching
 * the actual coding to a vendor harness and pausing only where a human decision
 * is genuinely required.
 *
 * The process it encodes is not new — it is the one already written down in
 * `docs/contributing/orchestration.md`. Conductor does not invent it. Conductor
 * **executes it in code instead of interpreting it in a prompt.**
 *
 * This entrypoint exports the config surface, the entity model, the pure
 * driver, the two seams — `Dispatcher` for how work gets done, `Observer` for
 * how the world is read — and `openConductor`, the runtime that assembles them
 * into a tick over durable state.
 *
 * **A seam implementation is reachable exactly when a caller has to name it.**
 * GitHub is what `openConductor` builds when no observer is passed, so nothing
 * imports it and `src/github` stays internal. The local source is the opposite:
 * reading a checkout instead of a repository is the caller's decision to state,
 * so `localObserver` lives at `@flow-state-dev/conductor/local` — a subpath, for
 * the same reason `fakeDispatcher` and the `replay` harness live at
 * `@flow-state-dev/conductor/testing`, so neither lands in a consumer's bundle
 * unasked.
 */

export * from "./config";
export * from "./dispatch";
export * from "./driver";
export * from "./model";
export * from "./observe";
export * from "./runtime";
