/** Fixture: a minimal valid benchmark definition for CLI loader tests. */
import { defineBenchmark } from "@flow-state-dev/testing";

export default defineBenchmark({
  name: "fixture-benchmark",
  patterns: ["alpha"],
  tasks: [
    { id: "t1", category: "reasoning", prompt: "do a thing", rubric: ["did the thing"] },
  ],
  model: "openai/gpt-5.4-mini",
  judgeModel: "anthropic/claude-haiku-4-5",
});
