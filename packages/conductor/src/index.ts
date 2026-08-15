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
 * driver, and the two seams — `Dispatcher` for how work gets done, `Observer`
 * for how the world is read. Their implementations stay internal to the package
 * (`src/github`, `src/local`), and the test scaffolding built on the dispatch
 * seam — `fakeDispatcher` and the `replay` harness — lives at
 * `@flow-state-dev/conductor/testing`, so neither lands in a consumer's bundle.
 */

export * from "./config";
export * from "./dispatch";
export * from "./driver";
export * from "./model";
export * from "./observe";
