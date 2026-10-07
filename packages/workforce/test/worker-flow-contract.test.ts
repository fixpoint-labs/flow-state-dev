/**
 * The worker contract's three checks, read off a flow definition (FIX-1789
 * V1: BR-2 to BR-5, BR-8).
 *
 * Every broken flow here is one an author could write. Each check is graded on
 * what the flow itself does with what a real hire hands it — its schema's
 * refusal of a full bag, its public actions, what its `writtenBy` field accepts
 * and refuses — never on the names it happens to declare.
 */
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { defineFlow, defineResourceCollection, handler } from "@flow-state-dev/core";
import { defineAgentWorkerFlow } from "../src/agent-worker-flow";
import { workerConfigSchema } from "../src/worker-config";
import { CONTRACT_KEYS, CONTRACT_PROBE_BAG, workerFlowProblems } from "../src/worker-flow-contract";
import { sharedResource } from "../src/shared-resource";

const message = z.object({ message: z.string() });
const reply = handler({
  name: "contract-reply",
  inputSchema: message,
  outputSchema: message,
  execute: (input) => input
});
const note = z.object({ note: z.string() });
const work = handler({ name: "contract-work", inputSchema: note, outputSchema: note, execute: (i) => i });

/** One door: a public action declaring `userMessage` that takes `{ message }`. */
const door = { inputSchema: message, block: reply, userMessage: (i: { message: string }) => i.message };

function flowWith(kind: string, over: Record<string, unknown> = {}) {
  return defineFlow({
    kind,
    cardinality: "collection",
    configSchema: workerConfigSchema(),
    actions: { run: door },
    ...over
  } as never);
}

describe("a flow that meets the contract", () => {
  it("has no problems when it composes the configuration and has one door", () => {
    expect(workerFlowProblems("triage", flowWith("triage"))).toEqual([]);
  });

  it("has no problems when it declares the configuration's keys by hand, each taking a hire's value (H1)", () => {
    const handBuilt = flowWith("hand-built", {
      configSchema: z.object({
        instructions: z.string().optional(),
        teamInstructions: z.string().optional(),
        seatSkills: z.array(z.any()).default([]),
        seatTools: z.array(z.any()).default([]),
        seatPackages: z.array(z.any()).optional(),
        seatId: z.string().optional(),
        desk: z.string().default("front")
      })
    });
    expect(workerFlowProblems("hand-built", handBuilt)).toEqual([]);
  });

  it("has no problems when only its own required setting is missing from the probe", () => {
    // `desk` is the flow's own call: every worker supplies it, and a probe of
    // the contract's keys cannot. That says nothing about the contract.
    const ownRequired = flowWith("desk-bound", {
      configSchema: workerConfigSchema().extend({ desk: z.string() })
    });
    expect(workerFlowProblems("desk-bound", ownRequired)).toEqual([]);
  });

  it("is true of the built-in agent, with and without task lists", () => {
    expect(workerFlowProblems("agent", defineAgentWorkerFlow() as never)).toEqual([]);
    expect(
      workerFlowProblems("agent", defineAgentWorkerFlow({ taskLists: ["front-desk.queue"] }) as never)
    ).toEqual([]);
  });

  it("is true of a flow writing a shared resource", () => {
    const sharing = flowWith("sharer", {
      resources: { notes: sharedResource("team-notes/*", { text: z.string() }) }
    });
    expect(workerFlowProblems("sharer", sharing)).toEqual([]);
  });

  it("is true of a flow keeping org data of its own, declared or not (Q2)", () => {
    const orgData = flowWith("org-keeper", {
      resources: {
        board: defineResourceCollection({
          pattern: "board/*",
          scope: "org",
          stateSchema: z.object({ text: z.string() })
        })
      }
    });
    expect(workerFlowProblems("org-keeper", orgData)).toEqual([]);
  });
});

describe("configuration (BR-2)", () => {
  it("probes every key the configuration declares, so a new key is checked the day it lands", () => {
    expect(Object.keys(CONTRACT_PROBE_BAG).sort()).toEqual([...CONTRACT_KEYS].sort());
    const parsed = workerConfigSchema().strict().safeParse(CONTRACT_PROBE_BAG);
    expect(parsed.success).toBe(true);
  });

  it("refuses a flow that declares no configuration, naming it", () => {
    const bare = defineFlow({ kind: "bare", cardinality: "collection", actions: { run: door } });
    const problems = workerFlowProblems("bare", bare as never);
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain('"bare"');
    expect(problems[0]).toContain("workerConfigSchema()");
  });

  it("refuses a flow that leaves out a key of the configuration, naming the key", () => {
    const short = flowWith("short", {
      configSchema: z.object({
        instructions: z.string().optional(),
        teamInstructions: z.string().optional(),
        seatSkills: z.array(z.any()).default([]),
        seatPackages: z.array(z.any()).optional(),
        seatId: z.string().optional()
      })
    });
    const problems = workerFlowProblems("short", short);
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain('"short"');
    expect(problems[0]).toContain("`seatTools`");
    expect(problems[0]).not.toContain("`seatId`");
  });

  it("refuses a flow that takes a configuration key with a type no hire supplies (K1)", () => {
    const numbered = flowWith("numbered", {
      configSchema: z.object({
        instructions: z.string().optional(),
        teamInstructions: z.string().optional(),
        seatSkills: z.array(z.any()).default([]),
        seatTools: z.array(z.any()).default([]),
        seatPackages: z.array(z.any()).optional(),
        seatId: z.number().optional()
      })
    });
    const problems = workerFlowProblems("numbered", numbered);
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain('"numbered"');
    expect(problems[0]).toContain("`seatId`");
  });

  it("refuses a flow whose list accepts only an empty one", () => {
    const empty = flowWith("empty-skills", {
      configSchema: workerConfigSchema().extend({ seatSkills: z.array(z.never()).default([]) })
    });
    const problems = workerFlowProblems("empty-skills", empty);
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain("`seatSkills`");
  });
});

describe("the door (BR-3, BR-4)", () => {
  it("refuses a flow with no door, naming it", () => {
    const doorless = flowWith("doorless", {
      actions: {
        run: { inputSchema: note, block: work },
        // Takes `{ message }` but writes no user item: not a door.
        log: { inputSchema: message, block: reply }
      }
    });
    const problems = workerFlowProblems("doorless", doorless);
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain('"doorless"');
    expect(problems[0]).toContain("door");
  });

  it("refuses a flow with two doors, naming both", () => {
    const twoDoors = flowWith("two-doors", { actions: { ask: door, say: door } });
    const problems = workerFlowProblems("two-doors", twoDoors);
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain('"two-doors"');
    expect(problems[0]).toContain('"ask"');
    expect(problems[0]).toContain('"say"');
  });
});

describe("attribution (BR-5)", () => {
  const loose: Array<[string, z.ZodTypeAny]> = [
    ["optional", z.object({ userId: z.string().min(1), workerId: z.string().min(1).optional() }).optional()],
    ["any", z.any()],
    ["without a required user", z.object({ userId: z.string().optional(), workerId: z.string().optional() })],
    ["a bare string", z.string()],
    ["a numeric user", z.object({ userId: z.union([z.string().min(1), z.number()]), workerId: z.string().min(1).optional() })],
    ["any worker", z.object({ userId: z.string().min(1), workerId: z.any() })],
    ["an empty worker", z.object({ userId: z.string().min(1), workerId: z.string().optional() })]
  ];

  for (const [label, field] of loose) {
    it(`refuses a \`writtenBy\` declared as ${label}, naming the accessor and its pattern`, () => {
      const flow = flowWith("loose-sharer", {
        resources: {
          notes: defineResourceCollection({
            pattern: "team-notes/*",
            scope: "org",
            stateSchema: z.object({ text: z.string(), writtenBy: field })
          })
        }
      });
      const problems = workerFlowProblems("loose-sharer", flow);
      expect(problems).toHaveLength(1);
      expect(problems[0]).toContain('"loose-sharer"');
      expect(problems[0]).toContain('"notes"');
      expect(problems[0]).toContain("team-notes/*");
    });
  }

  it("judges a `writtenBy` at any scope, not only at org scope", () => {
    const flow = flowWith("user-sharer", {
      resources: {
        notes: defineResourceCollection({
          pattern: "my-notes/*",
          scope: "user",
          stateSchema: z.object({ text: z.string(), writtenBy: z.any() })
        })
      }
    });
    expect(workerFlowProblems("user-sharer", flow)).toHaveLength(1);
  });
});

describe("the name it is registered under (BR-8)", () => {
  it("refuses a flow registered under a name that isn't its kind, naming both", () => {
    const problems = workerFlowProblems("coordinator", flowWith("triage"));
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain('"coordinator"');
    expect(problems[0]).toContain('"triage"');
  });
});

describe("every problem at once (BR-7)", () => {
  it("names each requirement a flow misses, not only the first", () => {
    const broken = defineFlow({
      kind: "broken",
      cardinality: "collection",
      resources: {
        notes: defineResourceCollection({
          pattern: "team-notes/*",
          scope: "org",
          stateSchema: z.object({ text: z.string(), writtenBy: z.any() })
        })
      },
      actions: { run: { inputSchema: note, block: work } }
    });
    expect(workerFlowProblems("broken", broken as never)).toHaveLength(3);
  });
});
