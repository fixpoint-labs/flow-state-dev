/**
 * The dispatch layer — layer 3's seam, conductor's branch policy, and the fast
 * inner loop that makes the process iterable.
 *
 * ```
 * Action ──briefFor()──▶ PhaseBrief ──Dispatcher.run()──▶ DispatchResult
 *            ▲                            ▲
 *   branchNameFor / provisionWorkspace       claudeCodeDispatcher
 * ```
 *
 * Conductor owns the left half — which branch, based on what, in which
 * workspace. The vendor harness owns the right half and is told nothing about
 * how conductor decided any of it.
 *
 * The stand-ins — `fakeDispatcher` and the `replay` harness — live behind
 * `@flow-state-dev/conductor/testing`, so importing the real dispatcher does
 * not pull test scaffolding along with it.
 */

export * from "./branch";
export * from "./brief";
export * from "./claude-code";
export * from "./types";
