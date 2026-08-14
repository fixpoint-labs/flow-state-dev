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
 * This entrypoint currently exports M0: the entity model and the pure driver.
 * The tick, the connectors, and the dispatcher seam land with M1.
 */

export * from "./driver";
export * from "./model";
