/**
 * Default benchmark registry — the v1 roster of comparable patterns.
 *
 * Maps each pattern name to its `BenchmarkAdapter`. Adding a pattern to the
 * cross-pattern benchmark means adding one entry here; the engine resolves
 * subjects through this lookup without knowing any pattern's internals.
 *
 * Intentionally EXCLUDED from the v1 roster:
 *   - `task-board`: the substrate primitive the others compose
 *     (`parallelTasks` == task-board + planner + synthesizer). It drains a
 *     collection and returns a `TaskBoardHandle` rather than a synthesized
 *     answer, so benchmarking it alongside its consumers would double-count
 *     the same coordination work.
 *   - `event-actors`, `rlm`, `response-auditor`: not `goal → answer` shaped —
 *     they don't map cleanly onto a single generic benchmark task and would
 *     need bespoke per-task glue.
 */
import type { BenchmarkRegistry } from "@flow-state-dev/core";
import {
  supervisorBenchmarkAdapter,
  planAndExecuteBenchmarkAdapter,
  parallelTasksBenchmarkAdapter,
  roundRobinBenchmarkAdapter,
  debateBenchmarkAdapter,
  routedSpecialistsBenchmarkAdapter,
} from "./adapters";

/**
 * The shipped roster of pattern adapters, keyed by pattern name. Six entries:
 * `supervisor`, `plan-and-execute`, `parallel-tasks`, `round-robin`, `debate`,
 * `routed-specialists`.
 */
export const defaultBenchmarkRegistry: BenchmarkRegistry = {
  supervisor: supervisorBenchmarkAdapter,
  "plan-and-execute": planAndExecuteBenchmarkAdapter,
  "parallel-tasks": parallelTasksBenchmarkAdapter,
  "round-robin": roundRobinBenchmarkAdapter,
  debate: debateBenchmarkAdapter,
  "routed-specialists": routedSpecialistsBenchmarkAdapter,
};
