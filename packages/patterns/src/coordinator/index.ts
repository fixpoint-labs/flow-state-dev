/**
 * Coordinator pattern — deprecated alias for `parallelTasks`.
 *
 * All logic has moved to `parallelTasks`. This module re-exports the same
 * types under their original names and wraps `parallelTasks` with a
 * one-time deprecation warning per coordinator name.
 *
 * Slated for removal in the next major version.
 */
import { parallelTasks } from "../parallelTasks";
import type { ParallelTasksConfig } from "../parallelTasks";
import type { ZodTypeAny } from "zod";

export type { SubTaskErrorStrategy } from "../parallelTasks";
export { parallelTasksInputSchema as coordinatorInputSchema } from "../parallelTasks";
export type { CoordinatorConfig } from "../parallelTasks";

const warned = new Set<string>();

/**
 * Creates a coordinator — a deprecated alias for `parallelTasks()`.
 *
 * Emits a `console.warn` once per distinct `config.name`. Replace with
 * `parallelTasks()` — same config shape, no other changes required.
 */
export function coordinator<TOutputSchema extends ZodTypeAny = ZodTypeAny>(
  config: ParallelTasksConfig<TOutputSchema>
) {
  if (!warned.has(config.name)) {
    warned.add(config.name);
    console.warn(
      `[flow-state-dev] coordinator() is deprecated; use parallelTasks() instead. ` +
      `Slated for removal in next major. (warning shown once per name)`
    );
  }
  return parallelTasks(config);
}

/**
 * Clears the deprecation warning cache. For use in tests only.
 * Allows `coordinator()` to re-warn after a reset (useful when testing
 * the warning behavior itself).
 *
 * @internal
 */
export function __resetCoordinatorWarnings(): void {
  warned.clear();
}
