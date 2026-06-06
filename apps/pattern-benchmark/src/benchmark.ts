/**
 * The default cross-pattern benchmark definition.
 *
 * This is the publishable artifact: a fixed task suite swept across every v1
 * coordination pattern plus the single-generator baseline, on one cheap-paid
 * model, judged by a distinct model against each task's locked rubric. The CLI
 * (`fsdev benchmark`) loads this default export, resolves the pattern names
 * against `@flow-state-dev/patterns`' `defaultBenchmarkRegistry`, and runs it.
 *
 * Adding a pattern to the registry and to the `patterns` list below is all it
 * takes to get it benchmarked — no per-pattern harness wiring.
 */
import { defineBenchmark } from "@flow-state-dev/testing";
import { tasks } from "./tasks";

export default defineBenchmark({
  name: "fsd-cross-pattern",
  // Resolved against defaultBenchmarkRegistry by the CLI. The baseline is
  // appended automatically (baseline: true) — "patterns beat the naive single
  // call" is the load-bearing claim, so the control is always present.
  patterns: [
    "supervisor",
    "plan-and-execute",
    "parallel-tasks",
    "round-robin",
    "debate",
    "routed-specialists",
  ],
  baseline: true,
  tasks,
  // Cheap-paid executor; free-tier (openrouter/...) is opt-in via `--model`.
  model: "openai/gpt-5.4-mini",
  // Distinct judge model so the grader isn't scoring its own family's output.
  judgeModel: "anthropic/claude-haiku-4-5",
  // k repetitions per (subject, task); deltas below pooled stddev are flagged
  // not-credible in the report.
  runs: 3,
});
