/**
 * The dispatch layer — layer 3's seam, conductor's branch policy, and the fast
 * inner loop that makes the process iterable.
 *
 * ```
 * Action ──briefFor()──▶ PhaseBrief ──Dispatcher.run()──▶ DispatchResult
 *            ▲                            ▲
 *   branchNameFor / provisionWorkspace    claudeCodeDispatcher | fakeDispatcher
 * ```
 *
 * Conductor owns the left half — which branch, based on what, in which
 * workspace. The vendor harness owns the right half and is told nothing about
 * how conductor decided any of it.
 */

export * from "./branch";
export * from "./brief";
export * from "./claude-code";
export * from "./fake";
export * from "./replay";
export * from "./types";
