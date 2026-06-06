/**
 * Cross-pattern benchmark adapter tests.
 *
 * For each shipped adapter we assert three things:
 *   1. `build({ model })` returns a subject with the right `name` and
 *      `kind: "pattern"`.
 *   2. `mapTask(task)` projects the generic task onto the pattern's input
 *      shape (`{ goal }` for most, `{ question }` for debate).
 *   3. The materialised `sequencer` runs to completion (`result.error` is
 *      null) under a scripted mock resolver that supplies canned text and,
 *      for patterns with internal planners / judges / controllers, canned
 *      structured output — proving the adapter is generically drivable from
 *      a bare benchmark task.
 *
 * The mock resolver resolves by block name first (per pattern's internal
 * generator names), so each script targets the exact generator it must
 * satisfy. We keep scripts minimal: one planned task, one approval, one
 * convergence — just enough to drain each coordination shape once.
 */
import { describe, expect, it } from "vitest";
import {
  createMockModelResolver,
  mockGenerator,
  testSequencer,
} from "@flow-state-dev/testing";
import type { ModelResolver } from "@flow-state-dev/core/types";
import type { BenchmarkTask } from "@flow-state-dev/core";
import {
  defaultBenchmarkRegistry,
  supervisorBenchmarkAdapter,
  planAndExecuteBenchmarkAdapter,
  parallelTasksBenchmarkAdapter,
  roundRobinBenchmarkAdapter,
  debateBenchmarkAdapter,
  routedSpecialistsBenchmarkAdapter,
} from "@flow-state-dev/patterns";

const MODEL = "openai/gpt-5.4-mini";

/** A representative benchmark task fed to every subject. */
const TASK: BenchmarkTask = {
  id: "t1",
  category: "reasoning",
  prompt: "Explain why the sky appears blue.",
  rubric: ["correct physical mechanism", "clear explanation"],
};

/** A single-task planner script (`utility.decomposer` output shape). */
function plannerStep() {
  return {
    structuredOutput: {
      tasks: [{ id: "task-1", goal: "Answer the question." }],
    },
  };
}

/** A canned text answer step for plain string-output generators. */
function textStep(text: string) {
  return { text };
}

describe("benchmark adapters", () => {
  it("registry exposes exactly the six v1 patterns", () => {
    expect(Object.keys(defaultBenchmarkRegistry).sort()).toEqual(
      [
        "debate",
        "parallel-tasks",
        "plan-and-execute",
        "round-robin",
        "routed-specialists",
        "supervisor",
      ].sort(),
    );
  });

  it("supervisor: builds a subject and drains under a mock resolver", async () => {
    const subject = supervisorBenchmarkAdapter.build({ model: MODEL });
    expect(subject.name).toBe("supervisor");
    expect(subject.kind).toBe("pattern");
    expect(subject.mapTask(TASK)).toEqual({ goal: TASK.prompt });

    const resolver: ModelResolver = createMockModelResolver({
      generators: {
        "bench-supervisor-planner": mockGenerator({
          name: "planner",
          script: [plannerStep()],
        }),
        "bench-supervisor-worker": mockGenerator({
          name: "worker",
          script: [{ when: () => true, then: textStep("worker answer") }],
        }),
        "bench-supervisor-reviewer": mockGenerator({
          name: "reviewer",
          script: [
            {
              when: () => true,
              then: {
                structuredOutput: { decision: "approve" },
              },
            },
          ],
        }),
        "bench-supervisor-synthesizer": mockGenerator({
          name: "synthesizer",
          script: [textStep("final supervised answer")],
        }),
      },
    });

    const result = await testSequencer(subject.sequencer, {
      input: subject.mapTask(TASK),
      modelResolver: resolver,
    });
    expect(result.error).toBeNull();
  });

  it("plan-and-execute: builds a subject and drains under a mock resolver", async () => {
    const subject = planAndExecuteBenchmarkAdapter.build({ model: MODEL });
    expect(subject.name).toBe("plan-and-execute");
    expect(subject.kind).toBe("pattern");
    expect(subject.mapTask(TASK)).toEqual({ goal: TASK.prompt });

    const resolver = createMockModelResolver({
      generators: {
        "bench-plan-and-execute-planner": mockGenerator({
          name: "planner",
          script: [plannerStep()],
        }),
        "bench-plan-and-execute-executor": mockGenerator({
          name: "executor",
          script: [
            {
              when: () => true,
              then: {
                structuredOutput: {
                  summary: "executed finding",
                  success: true,
                  reason: "",
                  sources: [],
                },
              },
            },
          ],
        }),
        "bench-plan-and-execute-synthesizer": mockGenerator({
          name: "synthesizer",
          script: [textStep("final planned answer")],
        }),
      },
    });

    const result = await testSequencer(subject.sequencer, {
      input: subject.mapTask(TASK),
      modelResolver: resolver,
    });
    expect(result.error).toBeNull();
  });

  it("parallel-tasks: builds a subject and drains under a mock resolver", async () => {
    const subject = parallelTasksBenchmarkAdapter.build({ model: MODEL });
    expect(subject.name).toBe("parallel-tasks");
    expect(subject.kind).toBe("pattern");
    expect(subject.mapTask(TASK)).toEqual({ goal: TASK.prompt });

    const resolver = createMockModelResolver({
      generators: {
        "bench-parallel-tasks-planner": mockGenerator({
          name: "planner",
          script: [plannerStep()],
        }),
        "bench-parallel-tasks-worker": mockGenerator({
          name: "worker",
          script: [{ when: () => true, then: textStep("parallel answer") }],
        }),
      },
    });

    const result = await testSequencer(subject.sequencer, {
      input: subject.mapTask(TASK),
      modelResolver: resolver,
    });
    expect(result.error).toBeNull();
  });

  it("round-robin: builds a subject and drains under a mock resolver", async () => {
    const subject = roundRobinBenchmarkAdapter.build({ model: MODEL });
    expect(subject.name).toBe("round-robin");
    expect(subject.kind).toBe("pattern");
    expect(subject.mapTask(TASK)).toEqual({ goal: TASK.prompt });

    const resolver = createMockModelResolver({
      generators: {
        "bench-round-robin-roster-alpha": mockGenerator({
          name: "alpha",
          script: [{ when: () => true, then: textStep("alpha says") }],
        }),
        "bench-round-robin-roster-beta": mockGenerator({
          name: "beta",
          script: [{ when: () => true, then: textStep("beta says") }],
        }),
        "bench-round-robin-roster-gamma": mockGenerator({
          name: "gamma",
          script: [{ when: () => true, then: textStep("gamma says") }],
        }),
        "bench-round-robin-synthesizer": mockGenerator({
          name: "synthesizer",
          script: [textStep("round-robin synthesis")],
        }),
      },
    });

    const result = await testSequencer(subject.sequencer, {
      input: subject.mapTask(TASK),
      modelResolver: resolver,
      // Round-robin's transcript lives in a session-scoped writable resource
      // under the default `contributions` accessor key; seed it empty.
      session: { resources: { contributions: { entries: [] } } },
    });
    expect(result.error).toBeNull();
  });

  it("debate: builds a subject (mapping to { question }) and drains", async () => {
    const subject = debateBenchmarkAdapter.build({ model: MODEL });
    expect(subject.name).toBe("debate");
    expect(subject.kind).toBe("pattern");
    expect(subject.mapTask(TASK)).toEqual({ question: TASK.prompt });

    const resolver = createMockModelResolver({
      generators: {
        "bench-debate-debater-pro": mockGenerator({
          name: "pro",
          script: [{ when: () => true, then: textStep("pro argument") }],
        }),
        "bench-debate-debater-con": mockGenerator({
          name: "con",
          script: [{ when: () => true, then: textStep("con argument") }],
        }),
        "bench-debate-judge": mockGenerator({
          name: "judge",
          script: [
            {
              structuredOutput: {
                verdict: "pro wins",
                winner: "pro",
                reasoning: "stronger argument",
              },
            },
          ],
        }),
        "bench-debate-synthesizer": mockGenerator({
          name: "synthesizer",
          script: [textStep("debate synthesis")],
        }),
      },
    });

    const result = await testSequencer(subject.sequencer, {
      input: subject.mapTask(TASK),
      modelResolver: resolver,
      // Debate's transcript lives in a session-scoped writable resource under
      // the `transcript` accessor key; seed it empty.
      session: { resources: { transcript: { entries: [] } } },
    });
    expect(result.error).toBeNull();
  });

  it("routed-specialists: builds a subject and drains under a mock resolver", async () => {
    const subject = routedSpecialistsBenchmarkAdapter.build({ model: MODEL });
    expect(subject.name).toBe("routed-specialists");
    expect(subject.kind).toBe("pattern");
    expect(subject.mapTask(TASK)).toEqual({ goal: TASK.prompt });

    const resolver = createMockModelResolver({
      generators: {
        // Controller picks the researcher once, then converges.
        "bench-routed-specialists-controller": mockGenerator({
          name: "controller",
          script: [
            {
              structuredOutput: {
                specialist: "researcher",
                done: false,
                reasoning: "gather facts",
              },
            },
            {
              structuredOutput: {
                specialist: null,
                done: true,
                reasoning: "solved",
              },
            },
          ],
        }),
        "bench-routed-specialists-researcher": mockGenerator({
          name: "researcher",
          script: [{ when: () => true, then: textStep("research result") }],
        }),
        "bench-routed-specialists-writer": mockGenerator({
          name: "writer",
          script: [{ when: () => true, then: textStep("written result") }],
        }),
        "bench-routed-specialists-synthesizer": mockGenerator({
          name: "synthesizer",
          script: [textStep("routed synthesis")],
        }),
      },
    });

    const result = await testSequencer(subject.sequencer, {
      input: subject.mapTask(TASK),
      modelResolver: resolver,
      // Routed-specialists' shared workspace is a session-scoped writable
      // resource under the `workspace` accessor key (schema `{ goal }`); the
      // adapter's `initialState` overwrites it from the input, but the harness
      // still needs the resource registered up front.
      session: { resources: { workspace: { goal: "" } } },
    });
    expect(result.error).toBeNull();
  });
});
