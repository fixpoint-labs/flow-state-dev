/**
 * The observe layer — the seam that abstracts how the world is read.
 *
 * ```
 * ObservationRequest ──Observer.observe()──▶ Observation ──▶ decide()
 * ```
 *
 * Conductor owns what it asks for (the entity, its artifacts, the cursor); the
 * source owns how it answers. The implementations live next to their I/O —
 * `src/github/` reads the GitHub API, `src/local/` reads a git checkout and the
 * files beside it — and neither is importable from here, so the seam stays free
 * of everything either one needs.
 */

export * from "./types";
