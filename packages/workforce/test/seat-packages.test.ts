/**
 * A package a worker holds: its instructions reach that worker's prompt, and
 * its blocks reach that worker's tools — and no other worker's.
 *
 * Graded on what the MODEL was given, read off a recording model with the
 * real generator running: the system text it saw and the tool list it was
 * offered. The settings a seat parsed to are a neighbour of that claim, and a
 * check on the map passed into the hire has passed before while the built
 * worker disagreed.
 *
 * Every "got nothing" assertion stands after an assertion that the holder, in
 * the same roster, really got the package — an empty result is evidence only
 * if the same setup can produce a full one.
 */
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { defineCapability, defineFlow, handler } from "@flow-state-dev/core";
import { defineResource } from "@flow-state-dev/core/types";
import type { BlockDefinition, GeneratorModel, ModelResolver } from "@flow-state-dev/core";
import type { FlowInstance } from "@flow-state-dev/core/types";
import { executeBlock } from "@flow-state-dev/engine";
import { createTestContext } from "@flow-state-dev/testing";
import { AGENT_KIND, defineAgentWorkerFlow } from "../src/agent-worker-flow";
import { hireWorkforce, type HireOptions } from "../src/hire";
import { resolveHeldPackages } from "../src/seat-packages";
import { SEAT_PACKAGES_KEY, type PackageManifest, type WorkerManifest } from "../src/manifest";
import { workerConfigSchema } from "../src/worker-config";

/** A named tool that does nothing; the checks read whether it was OFFERED. */
function tool(name: string) {
  return handler({
    name,
    description: `The ${name} tool.`,
    inputSchema: z.object({}),
    outputSchema: z.object({ ok: z.boolean() }),
    execute: () => ({ ok: true })
  });
}

const issueRefund = tool("issue-refund");
const voidRefund = tool("void-refund");
const pageOncall = tool("page-oncall");
const cite = tool("cite");
const ledger = tool("ledger");

const REFUNDS_TEXT = "REFUNDS-4471: refund only against an invoice you looked up.";
const ESCALATION_TEXT = "ESCALATION-9920: page on-call with the invoice id.";
const ORG_ESCALATION_TEXT = "ORG-ESCALATION-1180: email the duty manager.";
const HOUSE_TEXT = "HOUSE-3308: write plainly.";

/** A package record the loader would have produced, at a given level. */
function pkg(
  name: string,
  level: PackageManifest["level"],
  instructions: string | undefined,
  owner: { team?: string; worker?: string } = {}
): PackageManifest {
  const path =
    level === "org"
      ? `org/packages/${name}`
      : level === "team"
        ? `teams/${owner.team}/packages/${name}`
        : `teams/${owner.team}/workers/${owner.worker!.split(".")[1]}/packages/${name}`;
  return {
    name,
    path,
    level,
    ...owner,
    description: `The ${name} package.`,
    ...(instructions === undefined ? {} : { instructions })
  };
}

const refunds = pkg("refunds", "worker", REFUNDS_TEXT, { team: "support", worker: "support.clerk" });
const escalation = pkg("escalation", "team", ESCALATION_TEXT, { team: "support" });
const orgEscalation = pkg("escalation", "org", ORG_ESCALATION_TEXT);
const house = pkg("house", "org", HOUSE_TEXT);

const packageBlocks: NonNullable<HireOptions["packageBlocks"]> = {
  [refunds.path]: { "issue-refund": issueRefund, "void-refund": voidRefund },
  [escalation.path]: { "page-oncall": pageOncall },
  [house.path]: { cite }
};

function record(over: Partial<WorkerManifest> & { id: string }): WorkerManifest {
  return { declared: {}, body: "", ...over };
}

/** The clerk's reach, as `readWorkforce` would join it. */
const clerkReach = [house, orgEscalation, escalation, refunds];
/** A sibling on the same team: the libraries, never the clerk's own folder. */
const siblingReach = [house, orgEscalation, escalation];

function hire(
  manifests: WorkerManifest[],
  options: Omit<HireOptions, "packageBlocks"> & { packageBlocks?: HireOptions["packageBlocks"] } = {}
): (id: string) => FlowInstance {
  const seats = hireWorkforce(manifests, { packageBlocks, ...options });
  return (id) => {
    const seat = seats.find((candidate) => candidate.id === id);
    if (!seat) throw new Error(`no seat "${id}" in [${seats.map((s) => s.id).join(", ")}]`);
    return seat;
  };
}

function refusal(manifests: WorkerManifest[], options: HireOptions = {}): string {
  try {
    hireWorkforce(manifests, { packageBlocks, ...options });
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
  throw new Error("expected the hire to refuse, and it hired");
}

interface Turn {
  /** Tool names the model was offered, sorted. */
  tools: string[];
  /** Every system message the model was given, joined. */
  system: string;
  error?: unknown;
}

/**
 * Run one real turn against a hired seat through the real generator, with a
 * recording model, and return what the model was given.
 */
async function turn(seat: FlowInstance): Promise<Turn> {
  const tools: string[] = [];
  let system = "";
  let generateCalls = 0;
  const recording = ((): GeneratorModel => ({
    modelId: "m",
    async generate(options: { tools?: Array<{ name: string }>; messages: unknown[] }) {
      generateCalls += 1;
      tools.push(...(options.tools ?? []).map((t) => t.name));
      system = (options.messages as Array<{ role?: string; content?: unknown }>)
        .filter((message) => message.role === "system")
        .map((message) => String(message.content ?? ""))
        .join("\n");
      return { text: "done" };
    }
  })) as unknown as ModelResolver;
  recording.resolveId = (modelId: string) => modelId;

  const runtime = await createTestContext({
    flow: { ...seat, cardinality: "singleton" },
    orgId: "test-org",
    org: { state: {} },
    sessionId: `session-${seat.id}`,
    sequencerName: seat.actions.run!.block.name,
    declaredResources: seat.actions.run!.block.declaredResources,
    modelResolver: recording
  });

  const result = await executeBlock({
    block: seat.actions.run.block,
    input: { message: "go" },
    ctx: runtime.ctx
  });
  if (result.error) return { tools, system, error: result.error };
  // The control every "offered nothing" below rests on.
  expect(generateCalls).toBeGreaterThan(0);
  return { tools: tools.sort(), system };
}

describe("a package in a worker's own folder", () => {
  it("reaches that worker's prompt and tools, with no line in WORKER.md (BR-1, BR-9)", async () => {
    const seat = hire([record({ id: "support.clerk", packages: clerkReach })]);
    const got = await turn(seat("support.clerk"));

    expect(got.tools).toEqual(["issue-refund", "void-refund"]);
    expect(got.system).toContain(REFUNDS_TEXT);
    // Reach is not holding: the libraries in reach were not named, so none of
    // their text or tools arrived.
    expect(got.system).not.toContain(ESCALATION_TEXT);
    expect(got.system).not.toContain(HOUSE_TEXT);
  });

  it("reaches nobody else: a sibling of the same kind gets neither text nor tools (BR-14, BR-26)", async () => {
    const seat = hire([
      record({ id: "support.clerk", packages: clerkReach }),
      record({ id: "support.greeter", packages: siblingReach })
    ]);

    // The holder first, in the same roster, so the sibling's empty result
    // below is the package staying put and not a package that never loaded.
    const holder = await turn(seat("support.clerk"));
    expect(holder.tools).toEqual(["issue-refund", "void-refund"]);
    expect(holder.system).toContain(REFUNDS_TEXT);

    const sibling = await turn(seat("support.greeter"));
    expect(sibling.tools).toEqual([]);
    expect(sibling.system).not.toContain(REFUNDS_TEXT);
  });

  it("puts the package's text after the team's and the worker's own instructions (BR-15)", async () => {
    const seat = hire([
      record({
        id: "support.clerk",
        body: "SEAT-2201: you handle refunds.",
        teamInstructions: "TEAM-7710: answer within the hour.",
        packages: clerkReach
      })
    ]);
    const { system } = await turn(seat("support.clerk"));

    const team = system.indexOf("TEAM-7710");
    const own = system.indexOf("SEAT-2201");
    const held = system.indexOf("REFUNDS-4471");
    expect(team).toBeGreaterThanOrEqual(0);
    expect(own).toBeGreaterThan(team);
    expect(held).toBeGreaterThan(own);
  });

  it("gives a worker with `tools: []` the text and no tool (BR-2)", async () => {
    const seat = hire([
      record({ id: "support.clerk", declared: { tools: [] }, packages: clerkReach }),
      record({ id: "support.twin", packages: [...siblingReach, { ...refunds, worker: "support.twin", path: "teams/support/workers/twin/packages/refunds" }] })
    ], {
      packageBlocks: {
        ...packageBlocks,
        "teams/support/workers/twin/packages/refunds": { "issue-refund": issueRefund, "void-refund": voidRefund }
      }
    });

    // The control: the same package, held with no line, is callable.
    expect((await turn(seat("support.twin"))).tools).toEqual(["issue-refund", "void-refund"]);

    const shut = await turn(seat("support.clerk"));
    expect(shut.tools).toEqual([]);
    expect(shut.system).toContain(REFUNDS_TEXT);
  });

  it("gives a worker with a `tools:` line exactly that line: a listed package block is callable, an unlisted one is not (BR-3)", async () => {
    const seat = hire(
      [
        record({ id: "support.clerk", declared: { tools: ["issue-refund", "ledger"] }, packages: clerkReach }),
        record({
          id: "support.auditor",
          declared: { tools: ["ledger"] },
          packages: [...siblingReach, { ...refunds, worker: "support.auditor", path: "teams/support/workers/auditor/packages/refunds" }]
        })
      ],
      {
        kinds: { [AGENT_KIND]: defineAgentWorkerFlow({ catalog: { ledger } }) },
        packageBlocks: {
          ...packageBlocks,
          "teams/support/workers/auditor/packages/refunds": { "issue-refund": issueRefund, "void-refund": voidRefund }
        }
      }
    );

    const listed = await turn(seat("support.clerk"));
    expect(listed.tools).toEqual(["issue-refund", "ledger"]);
    expect(listed.system).toContain(REFUNDS_TEXT);

    const unlisted = await turn(seat("support.auditor"));
    expect(unlisted.tools).toEqual(["ledger"]);
    expect(unlisted.system).toContain(REFUNDS_TEXT);
  });

  it("keeps a package block out of the list the delegation fence reads (BR-30)", () => {
    const seat = hire([
      record({ id: "support.clerk", packages: clerkReach }),
      record({ id: "support.lister", declared: { tools: ["ledger"] }, packages: siblingReach })
    ], { kinds: { [AGENT_KIND]: defineAgentWorkerFlow({ catalog: { ledger } }) } });

    // No line: nothing listed, so the fence (which reads `tools`) sees nothing.
    expect(seat("support.clerk").config).not.toHaveProperty("tools");
    // The package's blocks reached the built worker on its own key instead.
    const held = (seat("support.clerk").config as Record<string, unknown>)[SEAT_PACKAGES_KEY] as Array<{
      tools: BlockDefinition[];
    }>;
    expect(held[0]!.tools.map((block) => block.name)).toEqual(["issue-refund", "void-refund"]);
  });

  it("keeps a listed package block off the fenced list too, like a worker's own block", () => {
    const seat = hire(
      [record({ id: "support.clerk", declared: { tools: ["issue-refund", "ledger"] }, packages: clerkReach })],
      { kinds: { [AGENT_KIND]: defineAgentWorkerFlow({ catalog: { ledger } }) } }
    );
    expect(seat("support.clerk").config).toMatchObject({ tools: ["ledger"] });
    const own = (seat("support.clerk").config as { seatTools: BlockDefinition[] }).seatTools;
    expect(own.map((block) => block.name)).toEqual(["issue-refund"]);
  });

  it("refuses a worker whose own folder has package blocks but whose record does not hold that package", () => {
    // The loader leaves a package whose PACKAGE.md it refused off the record;
    // the generated map still carries its blocks. Hiring on without it would
    // start a worker short a package its folder holds.
    const reachWithoutOwn = clerkReach.filter((candidate) => candidate !== refunds);
    const message = refusal([record({ id: "support.clerk", packages: reachWithoutOwn })]);
    expect(message).toContain('worker "support.clerk"');
    expect(message).toContain(refunds.path);
    expect(message).toContain("packageErrors");
  });

  it("does not hold a sibling's own-folder package blocks against a worker", () => {
    // Control for the refusal above: the address belongs to the clerk, so the
    // greeter, which never had it in reach, hires.
    const seat = hire([
      record({ id: "support.clerk", packages: clerkReach }),
      record({ id: "support.greeter", packages: siblingReach })
    ]);
    expect(seat("support.greeter").id).toBe("support.greeter");
  });

  it("hires an instructions-only package: the text arrives, no tool is added (BR-19)", async () => {
    const notes = pkg("notes", "worker", "NOTES-5512: keep notes short.", { team: "support", worker: "support.clerk" });
    // No generated blocks: this clerk's folder holds only `notes`, so the
    // shared map's `refunds` address would be a package it does not hold.
    const seat = hire([record({ id: "support.clerk", packages: [notes] })], { packageBlocks: {} });
    const got = await turn(seat("support.clerk"));
    expect(got.system).toContain("NOTES-5512");
    expect(got.tools).toEqual([]);
  });
});

describe("a package in a team's or the org's library", () => {
  it("reaches only a worker that names it in `packages:` (BR-10)", async () => {
    const seat = hire([
      record({ id: "support.taker", declared: { packages: ["escalation"] }, packages: siblingReach }),
      record({ id: "support.greeter", packages: siblingReach })
    ]);

    const taker = await turn(seat("support.taker"));
    expect(taker.tools).toEqual(["page-oncall"]);
    expect(taker.system).toContain(ESCALATION_TEXT);

    const greeter = await turn(seat("support.greeter"));
    expect(greeter.tools).toEqual([]);
    expect(greeter.system).not.toContain(ESCALATION_TEXT);
  });

  it("takes the team's package over the org's of the same name (BR-11)", async () => {
    const seat = hire([
      record({ id: "support.taker", declared: { packages: ["escalation"] }, packages: siblingReach })
    ]);
    const got = await turn(seat("support.taker"));
    expect(got.system).toContain(ESCALATION_TEXT);
    expect(got.system).not.toContain(ORG_ESCALATION_TEXT);
  });

  it("takes the org's package when the team offers none of that name (BR-11)", async () => {
    const seat = hire([
      record({ id: "sales.closer", declared: { packages: ["house", "escalation"] }, packages: [house, orgEscalation] })
    ]);
    const got = await turn(seat("sales.closer"));
    expect(got.system).toContain(HOUSE_TEXT);
    expect(got.system).toContain(ORG_ESCALATION_TEXT);
    // The org's `escalation` has no blocks on the map; the org's `house` does.
    expect(got.tools).toEqual(["cite"]);
  });

  it("refuses a name no library in reach offers, naming the worker, the package and the folders looked in (BR-12)", () => {
    const message = refusal([
      record({ id: "support.taker", declared: { packages: ["refundz"] }, packages: siblingReach })
    ]);
    expect(message).toContain('worker "support.taker"');
    expect(message).toContain('"refundz"');
    expect(message).toContain("teams/support/packages/refundz");
    expect(message).toContain("org/packages/refundz");
  });

  it("refuses a name that is both the worker's own package and a library's (BR-13)", () => {
    const ownEscalation = pkg("escalation", "worker", "OWN", { team: "support", worker: "support.clerk" });
    const message = refusal([
      record({
        id: "support.clerk",
        declared: { packages: ["escalation"] },
        packages: [...siblingReach, ownEscalation]
      })
    ]);
    expect(message).toContain('worker "support.clerk"');
    expect(message).toContain(ownEscalation.path);
    expect(message).toContain(escalation.path);
  });

  it("refuses a `packages:` that is not a list of names", () => {
    const message = refusal([record({ id: "support.taker", declared: { packages: "escalation" } })]);
    expect(message).toContain("`packages:`");
  });
});

describe("a record whose reach holds a package that is not this worker's to reach", () => {
  // `WorkerManifest` is public, so a hand-built or widened record can carry
  // another worker's own package or another team's library. Level alone does
  // not say whose it is; the owner on the record does, and a wrong one is
  // refused at the hire rather than dropped, so the wrong record is named.
  const pricing = pkg("pricing", "team", "PRICING-7730: quote list price.", { team: "sales" });

  it("refuses a record that carries another worker's own package, naming it", () => {
    const message = refusal([record({ id: "support.greeter", packages: [...siblingReach, refunds] })]);
    expect(message).toContain('worker "support.greeter"');
    expect(message).toContain(refunds.path);
  });

  it("refuses a record that carries another team's library package, naming it", () => {
    const message = refusal([
      record({ id: "support.taker", declared: { packages: ["pricing"] }, packages: [...siblingReach, pricing] })
    ]);
    expect(message).toContain('worker "support.taker"');
    expect(message).toContain(pricing.path);
  });

  it("still hires a record whose reach is its own, in the same roster", () => {
    // Control: the refusals above are about whose package it is, not about
    // holding a worker-level or team-level package at all.
    const seat = hire([
      record({ id: "support.clerk", declared: { packages: ["escalation"] }, packages: clerkReach })
    ]);
    const held = (seat("support.clerk").config as Record<string, Array<{ path: string }>>)[SEAT_PACKAGES_KEY]!;
    expect(held.map((entry) => entry.path)).toEqual([refunds.path, escalation.path]);
  });

  it("reads the owner off a hired seat id with the org in front", () => {
    const own = resolveHeldPackages("acme.support.clerk", ["escalation"], clerkReach, packageBlocks);
    expect(own.problems).toEqual([]);
    expect(own.held.map(({ manifest }) => manifest.path)).toEqual([refunds.path, escalation.path]);

    const other = resolveHeldPackages("acme.support.greeter", undefined, [...siblingReach, refunds], {});
    expect(other.held.map(({ manifest }) => manifest.path)).toEqual([]);
    expect(other.problems.join("\n")).toContain(refunds.path);
  });
});

describe("a package block's name is one tool's name (BR-21, BR-22, BR-23)", () => {
  it("refuses a package block that shares a name with the worker's own or team block, naming both", () => {
    const message = refusal([record({ id: "support.clerk", packages: clerkReach })], {
      seatBlocks: { "support.clerk": { "issue-refund": tool("issue-refund") } }
    });
    expect(message).toContain('worker "support.clerk"');
    expect(message).toContain('"issue-refund"');
    expect(message).toContain(refunds.path);
    expect(message).toContain("blocks/");
  });

  it("refuses two held packages carrying a block of the same name, naming both packages", () => {
    const message = refusal(
      [record({ id: "support.clerk", declared: { packages: ["escalation"] }, packages: clerkReach })],
      {
        packageBlocks: {
          ...packageBlocks,
          [escalation.path]: { "issue-refund": tool("issue-refund") }
        }
      }
    );
    expect(message).toContain('"issue-refund"');
    expect(message).toContain(refunds.path);
    expect(message).toContain(escalation.path);
  });

  it("refuses a package block whose name a picked preset's tool also uses, for a worker with no line", () => {
    const refundsCap = defineCapability({
      name: "billing",
      presets: { refunds: { tools: [tool("issue-refund")] }, default: [] }
    });
    const message = refusal(
      [record({ id: "support.clerk", declared: { capabilities: { billing: ["refunds"] } }, packages: clerkReach })],
      { kinds: { [AGENT_KIND]: defineAgentWorkerFlow({ uses: [refundsCap] }) } }
    );
    expect(message).toContain('worker "support.clerk"');
    expect(message).toContain('"issue-refund"');
    expect(message).toContain('"billing"');
    expect(message).toContain(refunds.path);
  });

  it("fails the turn with the duplicate-name error when a per-turn preset tool clashes", async () => {
    const perTurn = defineCapability({
      name: "phone",
      presets: { line: { tools: () => [tool("issue-refund")] }, default: [] }
    });
    const seat = hire(
      [record({ id: "support.clerk", declared: { capabilities: { phone: ["line"] } }, packages: clerkReach })],
      { kinds: { [AGENT_KIND]: defineAgentWorkerFlow({ uses: [perTurn] }) } }
    );
    const got = await turn(seat("support.clerk"));
    expect(String((got.error as Error | undefined)?.message)).toContain('two tools named "issue-refund"');
  });

  it("refuses a `tools:` line naming a held package's block that the kind's catalog also carries, naming both", () => {
    const agent = defineAgentWorkerFlow({ catalog: { "issue-refund": tool("issue-refund") } });
    const message = refusal(
      [record({ id: "support.clerk", declared: { tools: ["issue-refund"] }, packages: clerkReach })],
      { kinds: { [AGENT_KIND]: agent } }
    );
    expect(message).toContain('worker "support.clerk"');
    expect(message).toContain('"issue-refund"');
    expect(message).toContain(refunds.path);
    expect(message).toContain("catalog");
  });

  it("hires when the catalog's same-named tool is one the line does not name (the clash is only in what is granted)", () => {
    const agent = defineAgentWorkerFlow({ catalog: { "issue-refund": tool("issue-refund") } });
    const seat = hire(
      [record({ id: "support.clerk", declared: { tools: ["void-refund"] }, packages: clerkReach })],
      { kinds: { [AGENT_KIND]: agent } }
    );
    expect(seat("support.clerk").id).toBe("support.clerk");
  });

  it("refuses a package block registered under a name its own `name` does not match", () => {
    const message = refusal([record({ id: "support.clerk", packages: clerkReach })], {
      packageBlocks: { [refunds.path]: { "issue-refund": tool("issue-refunds") } }
    });
    expect(message).toContain('"issue-refund"');
    expect(message).toContain('"issue-refunds"');
    expect(message).toContain(refunds.path);
  });

  it("refuses a package block that declares a store", () => {
    const refundsLedger = defineResource({ scope: "session", stateSchema: z.object({ n: z.number() }) });
    const needsAStore = handler({
      name: "issue-refund",
      description: "Needs a store.",
      uses: [defineCapability({ name: "refunds-ledger", resources: { refundsLedger } })],
      inputSchema: z.object({}),
      outputSchema: z.object({ ok: z.boolean() }),
      execute: () => ({ ok: true })
    }) as BlockDefinition;
    // The premise: the block really does declare the store.
    expect(needsAStore.declaredResources?.refundsLedger).toBe(refundsLedger);
    const message = refusal([record({ id: "support.clerk", packages: clerkReach })], {
      packageBlocks: { [refunds.path]: { "issue-refund": needsAStore } }
    });
    expect(message).toContain('"refundsLedger"');
    expect(message).toContain(refunds.path);
  });

  it("does not let a worker that doesn't hold a package name its block (BR-26)", () => {
    const message = refusal([
      record({ id: "support.clerk", packages: clerkReach }),
      record({ id: "support.greeter", declared: { tools: ["issue-refund"] }, packages: siblingReach })
    ]);
    expect(message).toContain('worker "support.greeter"');
    expect(message).toContain('"issue-refund"');
    expect(message).not.toContain('worker "support.clerk"');
  });
});

describe("the settings key a package arrives on (BR-32)", () => {
  const inputSchema = z.object({ message: z.string() });
  const work = handler({
    name: "work",
    inputSchema,
    outputSchema: z.object({ ok: z.boolean() }),
    execute: () => ({ ok: true })
  });

  it("hands a custom kind composing the contract the package's text and blocks", () => {
    const custom = defineFlow({
      kind: "desk",
      cardinality: "collection",
      configSchema: workerConfigSchema(),
      actions: { run: { inputSchema, block: work } }
    });
    const seat = hire([record({ id: "support.clerk", declared: { flow: "desk" }, packages: clerkReach })], {
      kinds: { desk: custom as never }
    });
    expect((seat("support.clerk").config as Record<string, unknown>)[SEAT_PACKAGES_KEY]).toEqual([
      {
        name: "refunds",
        path: refunds.path,
        instructions: REFUNDS_TEXT,
        tools: [issueRefund, voidRefund]
      }
    ]);
  });

  it("imposes nothing on a worker that holds no package, so a hand-rolled kind without the key still hires", () => {
    const handRolled = defineFlow({
      kind: "old-desk",
      cardinality: "collection",
      configSchema: z.object({
        instructions: z.string().optional(),
        teamInstructions: z.string().optional(),
        seatSkills: z.array(z.any()).default([]),
        seatTools: z.array(z.any()).default([]),
        // Imposed on every record, so a hand-rolled kind declares it to hire at all.
        seatId: z.string().optional()
      }),
      actions: { run: { inputSchema, block: work } }
    });
    const kinds = { "old-desk": handRolled as never };

    // Holding nothing: exactly today's bag, no new key.
    const seat = hire([record({ id: "support.greeter", declared: { flow: "old-desk" }, packages: siblingReach })], {
      kinds
    });
    expect(seat("support.greeter").config).not.toHaveProperty(SEAT_PACKAGES_KEY);

    // Holding one: refused loudly, naming the key, never dropped in silence.
    const message = refusal([record({ id: "support.clerk", declared: { flow: "old-desk" }, packages: clerkReach })], {
      kinds
    });
    expect(message).toContain(`"${SEAT_PACKAGES_KEY}" is not a declared setting`);
    expect(message).toContain("workerConfigSchema()");
  });

  it("refuses a worker file that declares the key itself", () => {
    const message = refusal([record({ id: "support.clerk", declared: { [SEAT_PACKAGES_KEY]: [] } })]);
    expect(message).toContain('worker "support.clerk"');
    expect(message).toContain(`\`${SEAT_PACKAGES_KEY}:\``);
  });
});
