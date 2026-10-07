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
import { defineFlow, defineResourceCollection, FlowConfigRefusalError, handler } from "@flow-state-dev/core";
import { defineAgentWorkerFlow } from "../src/agent-worker-flow";
import { workerConfigSchema } from "../src/worker-config";
import { CONTRACT_KEYS, CONTRACT_PROBE_BAG, contractKeysRefused, workerFlowProblems } from "../src/worker-flow-contract";
import { sharedResource, writtenBySchema } from "../src/shared-resource";

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

  it("refuses a flow whose block would replace the whole configuration", () => {
    const flattens = handler({
      name: "flattens-the-bag",
      inputSchema: message,
      outputSchema: message,
      flowConfigSchema: z.object({ seatId: z.string() }).transform(() => "flat"),
      execute: (input) => input
    });
    const flow = flowWith("flattened", {
      actions: { run: { ...door, block: flattens } }
    });
    // Every hire of it fails: the mint refuses the bag as a whole.
    expect(() => (flow as never as (o: object) => unknown)({ id: "x", config: { ...CONTRACT_PROBE_BAG } })).toThrow(
      /<the whole bag>/
    );
    const problems = workerFlowProblems("flattened", flow);
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain('"flattened"');
  });

  it("passes a flow whose own setting refuses only the probe, whatever its message says", () => {
    // The probe brings no `desk`, so the default fails its own rule; a real hire
    // names a desk. The message holds a `; `, which is not two issues.
    const flow = flowWith("desk-clerk", {
      configSchema: workerConfigSchema().extend({
        desk: z
          .string()
          .default("front")
          .refine((desk) => desk !== "front", "choose custom; front reserved")
      })
    });
    expect(workerFlowProblems("desk-clerk", flow)).toEqual([]);
    expect(() =>
      (flow as never as (o: object) => unknown)({ id: "x", config: { ...CONTRACT_PROBE_BAG, desk: "returns" } })
    ).not.toThrow();
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
  /** A flow declaring one org resource under `notes`. */
  const sharing = (kind: string, notes: unknown) => flowWith(kind, { resources: { notes } });
  const handRolled = (stateSchema: z.ZodTypeAny) =>
    defineResourceCollection({ pattern: "team-notes/*", scope: "org", stateSchema });

  it("passes a resource `sharedResource()` built", () => {
    const notes = sharedResource("team-notes/*", { text: z.string() });
    expect(workerFlowProblems("built-sharer", sharing("built-sharer", notes))).toEqual([]);
  });

  // Every one of these declares `writtenBy` on a resource the helper didn't
  // build, so each is refused, however its schema reads. The ones after the
  // first are the shapes no value probe could tell apart from the real field.
  const handRolledCases: Array<[string, z.ZodTypeAny]> = [
    ["the full shape, written out by hand", z.object({ text: z.string(), writtenBy: writtenBySchema })],
    ["an optional field", z.object({ text: z.string(), writtenBy: writtenBySchema.optional() })],
    ["any", z.object({ text: z.string(), writtenBy: z.any() })],
    [
      "a union with an unsigned branch",
      z.union([z.object({ text: z.string(), writtenBy: writtenBySchema }), z.object({ text: z.string() })])
    ],
    [
      "a transform of the whole entry that drops it",
      z.object({ text: z.string(), writtenBy: writtenBySchema }).transform(({ text }) => ({ text }))
    ],
    [
      "a field broader than the shared one",
      z.object({
        text: z.string(),
        writtenBy: z.object({ userId: z.union([z.string().min(1), z.boolean()]), workerId: z.string().min(1).optional() }).strict()
      })
    ],
    ["an alternative to the shared field", z.object({ text: z.string(), writtenBy: writtenBySchema.or(z.literal("system")) })],
    ["a field that drops the worker", z.object({ text: z.string(), writtenBy: writtenBySchema.transform(({ userId }) => ({ userId })) })],
    ["a refinement around a loose entry", z.object({ writtenBy: z.any(), text: z.string() }).refine(() => true)],
    ["an intersection", z.intersection(z.object({ text: z.string() }), z.object({ writtenBy: z.any() }))],
    ["a pipe", z.object({ writtenBy: z.any(), text: z.string() }).pipe(z.any())]
  ];

  for (const [label, stateSchema] of handRolledCases) {
    it(`refuses \`writtenBy\` on a hand-rolled resource: ${label}`, () => {
      const problems = workerFlowProblems("hand-sharer", sharing("hand-sharer", handRolled(stateSchema)));
      expect(problems).toHaveLength(1);
      expect(problems[0]).toContain('"hand-sharer"');
      expect(problems[0]).toContain('"notes"');
      expect(problems[0]).toContain("team-notes/*");
      expect(problems[0]).toContain("sharedResource(");
    });
  }

  it("judges a `writtenBy` at any scope, not only at org scope", () => {
    const notes = defineResourceCollection({
      pattern: "my-notes/*",
      scope: "user",
      stateSchema: z.object({ text: z.string(), writtenBy: writtenBySchema })
    });
    expect(workerFlowProblems("user-sharer", sharing("user-sharer", notes))).toHaveLength(1);
  });

  it("refuses a copy of a built resource with its schema swapped, by spread or in place", () => {
    const built = sharedResource("team-notes/*", { text: z.string() });
    const dropsAttribution = built.stateSchema.transform(({ text }) => ({ text }));
    // Spreading loses the mark: it isn't enumerable.
    const spread = { ...built, stateSchema: dropsAttribution };
    expect(workerFlowProblems("spread-sharer", sharing("spread-sharer", spread))).toHaveLength(1);
    // Swapping the schema in place keeps the mark, which no longer matches.
    const swapped = sharedResource("team-notes/*", { text: z.string() });
    (swapped as { stateSchema: unknown }).stateSchema = dropsAttribution;
    expect(workerFlowProblems("swapped-sharer", sharing("swapped-sharer", swapped))).toHaveLength(1);
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
 * The reader of a flow's refusal, alone. It reads the issues core attaches to
 * a config refusal, never the message, so each refusal here is built from
 * issues. Check 1 rests on this reading: a refusal it can't read must say so,
 * never pass.
 */
describe("reading a flow's refusal of a worker's configuration", () => {
  const refusal = (...issues: Array<[Array<string | number>, string, string?]>) =>
    new FlowConfigRefusalError(
      "Flow refused its bag.",
      issues.map(([path, code, message]) => ({ path, code, message: message ?? "Required" }))
    );
  const none = { noConfigSchema: false, undeclared: [], wrongValue: [], wholeBag: [], unread: false };

  it("reads a flow with no configSchema", () => {
    expect(contractKeysRefused(refusal([[], "no_config_schema"]))).toEqual({ ...none, noConfigSchema: true });
  });

  it("reads an undeclared top-level key as a contract key, and skips the flow's own", () => {
    const read = contractKeysRefused(refusal([["seatTools"], "unrecognized_keys"], [["notAContractKey"], "unrecognized_keys"]));
    expect(read).toEqual({ ...none, undeclared: ["seatTools"] });
  });

  it("reads a wrong value at a contract key, at the top or inside it", () => {
    expect(contractKeysRefused(refusal([["seatId"], "invalid_type"])).wrongValue).toEqual(["seatId"]);
    expect(contractKeysRefused(refusal([["seatSkills", 0, "name"], "invalid_type"])).wrongValue).toEqual(["seatSkills"]);
    expect(contractKeysRefused(refusal([["seatTools", "extra"], "unrecognized_keys"])).wrongValue).toEqual(["seatTools"]);
  });

  it("names no contract key for a path inside the flow's own settings", () => {
    const read = contractKeysRefused(
      refusal([["own", "seatId"], "invalid_type"], [["own", "seatId"], "unrecognized_keys"], [["seatIdentity"], "invalid_type"])
    );
    expect(read).toEqual(none);
  });

  it("reads every issue of a refusal that names several, whatever their messages hold", () => {
    const read = contractKeysRefused(
      refusal(
        [["instructions"], "unrecognized_keys"],
        [["seatId"], "invalid_type", "Expected number; received string"],
        [["model"], "custom", "choose custom; front reserved"]
      )
    );
    expect(read).toEqual({ ...none, undeclared: ["instructions"], wrongValue: ["seatId"] });
  });

  it("reads a block that would change the bag at a contract key", () => {
    const read = contractKeysRefused(refusal([["seatTools"], "block_contributes"], [["model"], "block_contributes"]));
    expect(read).toEqual({ ...none, wrongValue: ["seatTools"] });
  });

  it("reads an issue about the whole bag as one, never as a pass", () => {
    const read = contractKeysRefused(refusal([[], "block_contributes", "would change the bag here"]));
    expect(read).toEqual({ ...none, wholeBag: ["would change the bag here"] });
  });

  it("marks anything that isn't a config refusal unread", () => {
    expect(contractKeysRefused(new Error('"seatId" is not a declared setting')).unread).toBe(true);
    expect(contractKeysRefused(new FlowConfigRefusalError("no issues", [])).unread).toBe(true);
    expect(contractKeysRefused("thrown string").unread).toBe(true);
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
