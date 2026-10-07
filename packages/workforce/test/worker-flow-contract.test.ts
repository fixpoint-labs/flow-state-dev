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
import { CONTRACT_KEYS, CONTRACT_PROBE_BAG, contractKeysRefused, workerFlowProblems } from "../src/worker-flow-contract";
import { isSharedWrittenBy, sharedResource, writtenBySchema } from "../src/shared-resource";

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

  // An entry's schema wrapped in a refinement, a transform, a pipe or an
  // intersection still declares the field; the check must find it there.
  const looseEntry = z.object({ writtenBy: z.any(), text: z.string() });
  const wrapped: Array<[string, z.ZodTypeAny]> = [
    ["a refinement", looseEntry.refine(() => true)],
    ["a transform", looseEntry.transform((entry) => entry)],
    ["a pipe", looseEntry.pipe(z.any())],
    ["an intersection", z.intersection(z.object({ text: z.string() }), z.object({ writtenBy: z.any() }))],
    ["a union member", z.union([z.object({ text: z.string(), writtenBy: z.any() }), z.object({ id: z.number() })])]
  ];

  for (const [label, stateSchema] of wrapped) {
    it(`finds a loose \`writtenBy\` inside ${label}`, () => {
      // What the gap let through: the resource takes an entry naming nobody.
      expect(stateSchema.safeParse({ text: "x" }).success).toBe(true);
      const flow = flowWith("wrapped-sharer", {
        resources: { notes: defineResourceCollection({ pattern: "team-notes/*", scope: "org", stateSchema }) }
      });
      const problems = workerFlowProblems("wrapped-sharer", flow);
      expect(problems).toHaveLength(1);
      expect(problems[0]).toContain('"notes"');
    });
  }

  it("passes a shared resource's field inside a refinement", () => {
    const stateSchema = z.object({ text: z.string(), writtenBy: writtenBySchema }).refine(() => true);
    const flow = flowWith("refined-sharer", {
      resources: { notes: defineResourceCollection({ pattern: "team-notes/*", scope: "org", stateSchema }) }
    });
    expect(workerFlowProblems("refined-sharer", flow)).toEqual([]);
  });

  it("refuses a `writtenBy` that accepts a worker's name and then drops it", () => {
    const dropsWorker = writtenBySchema.transform(({ userId }) => ({ userId }));
    // Every value the shared field accepts, this accepts too; what it stores loses the worker.
    expect(dropsWorker.parse({ userId: "alice", workerId: "researcher" })).toEqual({ userId: "alice" });
    const flow = flowWith("forgetful-sharer", {
      resources: {
        notes: defineResourceCollection({
          pattern: "team-notes/*",
          scope: "org",
          stateSchema: z.object({ text: z.string(), writtenBy: dropsWorker })
        })
      }
    });
    const problems = workerFlowProblems("forgetful-sharer", flow);
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain('"notes"');
  });
});

describe("the name it is registered under (BR-8)", () => {
  it("refuses a flow registered under a name that isn't its kind, naming both", () => {
    const problems = workerFlowProblems("coordinator", flowWith("triage"));
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain('"coordinator"');
    expect(problems[0]).toContain('"triage"');
  });

  it("names the flow's other problems along with the name, in one pass", () => {
    const doorless = flowWith("triage", { actions: { run: { inputSchema: note, block: work } } });
    const problems = workerFlowProblems("coordinator", doorless);
    expect(problems).toHaveLength(2);
    expect(problems[0]).toContain('its kind is "triage"');
    expect(problems[1]).toContain("has no door");
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

/**
 * The reader of a flow's refusal, alone. Each refusal is in core's wording
 * (`describeFlowConfigIssues` inside a mint's envelope). Check 1 rests on this
 * reading, so a refusal it can't read must say so, never pass.
 */
describe("reading a flow's refusal of a worker's configuration", () => {
  const bag = (issues: string) => `Flow "f" instance "f::worker-contract-probe" has an invalid config bag: ${issues}.`;

  it("reads a flow with no configSchema", () => {
    const read = contractKeysRefused(
      'Flow "f" instance "f::p" was created with a config bag, but the flow declares no configSchema. ' +
        "A copy may only carry settings the definition declared — add `configSchema: z.object({ ... })` " +
        "to defineFlow(...), or drop the bag."
    );
    expect(read).toEqual({ noConfigSchema: true, undeclared: [], wrongValue: [], unread: false });
  });

  it("reads an undeclared top-level key as a contract key, and skips the flow's own", () => {
    const read = contractKeysRefused(bag('"seatTools", "notAContractKey" is not a declared setting'));
    expect(read).toEqual({ noConfigSchema: false, undeclared: ["seatTools"], wrongValue: [], unread: false });
  });

  it("reads a wrong value at a contract key, at the top or inside it", () => {
    expect(contractKeysRefused(bag('"seatId": Expected number, received string')).wrongValue).toEqual(["seatId"]);
    expect(contractKeysRefused(bag('"seatSkills.0.name": Required')).wrongValue).toEqual(["seatSkills"]);
  });

  it("names no contract key for a path inside the flow's own settings", () => {
    const read = contractKeysRefused(
      bag('"own.seatId": Required; "seatId" is not a declared setting of "own"; "seatIdentity": Required')
    );
    expect(read).toEqual({ noConfigSchema: false, undeclared: [], wrongValue: [], unread: false });
  });

  it("reads every issue of a refusal that names several", () => {
    const read = contractKeysRefused(
      bag('"instructions" is not a declared setting; "seatId": Expected number, received string; "model": Required')
    );
    expect(read).toEqual({
      noConfigSchema: false,
      undeclared: ["instructions"],
      wrongValue: ["seatId"],
      unread: false
    });
  });

  it("reads a block's refusal of the bag, whose own text carries a `; `", () => {
    const read = contractKeysRefused(
      'Flow "f" instance "f::p" has a config bag that block "b" cannot read: "seatId": Required. ' +
        "That block declares `flowConfigSchema`; the flow's configSchema must produce a bag that " +
        "satisfies it, and this copy's does not."
    );
    expect(read).toEqual({ noConfigSchema: false, undeclared: [], wrongValue: ["seatId"], unread: false });
  });

  it("reads a block that would change the bag at a contract key", () => {
    const read = contractKeysRefused(
      'Flow "f" instance "f::p": block "b" declares a flowConfigSchema that would change the bag at ' +
        '"seatTools", "model" — a default, a transform, or a coercion. A block declares what it NEEDS.'
    );
    expect(read.wrongValue).toEqual(["seatTools"]);
    expect(read.unread).toBe(false);
  });

  it("marks a refusal in any other wording unread, never as a pass", () => {
    expect(contractKeysRefused(bag("seatId is not declared")).unread).toBe(true);
    expect(contractKeysRefused(bag('"model": Required; seatId is missing')).unread).toBe(true);
    expect(contractKeysRefused('Flow "f" rejected its configuration: "seatId" is unknown.').unread).toBe(true);
  });

  it("refuses a flow whose refusal it can't read, quoting the refusal", () => {
    const real = flowWith("reworded");
    const reworded = Object.assign(
      () => {
        throw new Error('Flow "reworded" rejected its configuration: "seatId" is unknown.');
      },
      { kind: "reworded", actions: real.actions, resources: real.resources }
    );
    const problems = workerFlowProblems("reworded", reworded as never);
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain("can't read");
    expect(problems[0]).toContain('rejected its configuration: "seatId" is unknown.');
  });
});

describe("the `writtenBy` rule check 3 applies", () => {
  it("is passed by the shared resource's own schema, so the rule and the schema can't drift", () => {
    expect(isSharedWrittenBy(writtenBySchema)).toBe(true);
  });

  it("is failed by an optional or looser field", () => {
    expect(isSharedWrittenBy(writtenBySchema.optional())).toBe(false);
    expect(isSharedWrittenBy(z.object({ userId: z.string(), workerId: z.string().optional() }))).toBe(false);
  });
});
