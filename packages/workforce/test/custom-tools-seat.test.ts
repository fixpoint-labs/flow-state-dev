/**
 * A block sitting in a worker's own `blocks/` folder.
 *
 * **Registration makes a name resolvable; declaration grants use.** A block in
 * a seat's folder is registered FOR THAT SEAT — it becomes a name that seat's
 * `tools:` may resolve, and nothing more. It does not become callable until the
 * file names it, so `tools:` stays the complete and exclusive answer to *what
 * can this seat call*, and the fence does not move.
 *
 * A name resolves worker folder → team folder → the app's catalog, first match
 * wins. The first two arrive already collapsed on the seat's own map (the
 * generated `seatBlocks` export); this file pins the last hop, the fence, the
 * isolation between seats, and the two refusals that keep a registered name
 * from being a promise the framework cannot keep.
 */
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { defineCapability, handler } from "@flow-state-dev/core";
import { defineResource } from "@flow-state-dev/core/types";
import type { BlockDefinition, FlowInstance } from "@flow-state-dev/core/types";
import { createTestContext, mockGenerator } from "@flow-state-dev/testing";
import { executeBlock } from "@flow-state-dev/engine";
import { hireWorkforce, type HireOptions } from "../src/hire";
import type { WorkerManifest } from "../src/manifest";
import { AGENT_KIND, defineAgentWorkerFlow } from "../src/agent-worker-flow";

function record(over: Partial<WorkerManifest> & { id: string }): WorkerManifest {
  return { declared: {}, body: "", ...over };
}

function refusalOf(manifests: WorkerManifest[], options: HireOptions): string {
  try {
    hireWorkforce(manifests, options);
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
  throw new Error("expected a refusal, got seats");
}

/** Counts per block, so "did the model reach it" is observable rather than assumed. */
const calls: Record<string, number> = {};

function countingBlock(name: string): BlockDefinition {
  calls[name] = 0;
  return handler({
    name,
    description: `Runs ${name}.`,
    inputSchema: z.object({}),
    outputSchema: z.object({ ran: z.string() }),
    execute: () => {
      calls[name] = (calls[name] ?? 0) + 1;
      return { ran: name };
    },
  }) as BlockDefinition;
}

async function runSeat(seat: FlowInstance, toolName: string) {
  const runtime = await createTestContext({
    flow: { ...seat, cardinality: "singleton" },
    orgId: "test-org",
    org: { state: {} },
    sessionId: "test-session",
    sequencerName: seat.actions.run!.block.name,
    declaredResources: seat.actions.run!.block.declaredResources,
    generators: {
      "agent-answer": mockGenerator({
        name: "agent-answer",
        script: [
          { toolCalls: [{ toolCallId: "call-1", toolName, args: {} }] },
          { text: "done" },
        ] as never,
      }),
    },
  });
  return executeBlock({
    block: seat.actions.run!.block,
    input: { message: "use your tools" },
    ctx: runtime.ctx,
  });
}

describe("a seat's own blocks are registered, not granted", () => {
  it("lets a seat call a block from its own folder once its `tools:` names it", async () => {
    const check = countingBlock("check-inventory");
    const [seat] = hireWorkforce(
      [record({ id: "support.clerk", declared: { tools: ["check-inventory"] }, body: "Clerk." })],
      {
        kinds: { [AGENT_KIND]: defineAgentWorkerFlow() },
        seatBlocks: { "support.clerk": { "check-inventory": check } },
      },
    );

    const result = await runSeat(seat!, "check-inventory");
    expect(result.error).toBeUndefined();
    expect(calls["check-inventory"]).toBe(1);
  });

  // The whole of the owner's ruling, as a check that can fail: a registered
  // name the file never named is NOT callable. Without this, "registered" and
  // "granted" are indistinguishable.
  //
  // The counter is what makes the absence observable: the same block, reached
  // by the same script, moved the counter in the test above — so a counter that
  // stays at zero here is the fence holding, not a broken harness.
  it("does NOT let a seat call a registered block its `tools:` never named", async () => {
    const check = countingBlock("check-inventory");
    const [seat] = hireWorkforce([record({ id: "support.quiet", body: "Quiet." })], {
      kinds: { [AGENT_KIND]: defineAgentWorkerFlow() },
      seatBlocks: { "support.quiet": { "check-inventory": check } },
    });

    const result = await runSeat(seat!, "check-inventory");
    expect(result.error).toBeUndefined();
    expect(calls["check-inventory"]).toBe(0);
  });

  // `tools: []` written out, rather than omitted — the case an author reads as
  // "this seat reaches nothing", which must stay literally true.
  it("reaches nothing with an explicit empty `tools:` and a full folder", async () => {
    const check = countingBlock("check-inventory");
    const [seat] = hireWorkforce(
      [record({ id: "support.empty", declared: { tools: [] }, body: "Empty." })],
      {
        kinds: { [AGENT_KIND]: defineAgentWorkerFlow() },
        seatBlocks: { "support.empty": { "check-inventory": check } },
      },
    );

    await runSeat(seat!, "check-inventory");
    expect(calls["check-inventory"]).toBe(0);
  });

  // Two seats, one basename. Neither map is the other's, so neither seat can
  // reach the other's block even by naming it.
  it("keeps two seats' same-named blocks apart", async () => {
    const mine = countingBlock("summarize");
    const yours = handler({
      name: "summarize",
      description: "The other seat's.",
      inputSchema: z.object({}),
      outputSchema: z.object({ ran: z.string() }),
      execute: () => {
        calls["summarize-theirs"] = (calls["summarize-theirs"] ?? 0) + 1;
        return { ran: "theirs" };
      },
    }) as BlockDefinition;
    calls["summarize-theirs"] = 0;

    const [alpha] = hireWorkforce(
      [
        record({ id: "support.alpha", declared: { tools: ["summarize"] }, body: "A." }),
        record({ id: "support.beta", declared: { tools: ["summarize"] }, body: "B." }),
      ],
      {
        kinds: { [AGENT_KIND]: defineAgentWorkerFlow() },
        seatBlocks: {
          "support.alpha": { summarize: mine },
          "support.beta": { summarize: yours },
        },
      },
    );

    await runSeat(alpha!, "summarize");
    expect(calls["summarize"]).toBe(1);
    expect(calls["summarize-theirs"]).toBe(0);
  });

  // The precedence the owner ruled: worker → team → org, first match wins. The
  // seat's own map is nearer than the app's catalog, so it answers the name.
  it("resolves a name to the seat's own block before the app's catalog", async () => {
    const own = countingBlock("desk-note");
    const app = handler({
      name: "desk-note",
      description: "The app's.",
      inputSchema: z.object({}),
      outputSchema: z.object({ ran: z.string() }),
      execute: () => {
        calls["desk-note-app"] = (calls["desk-note-app"] ?? 0) + 1;
        return { ran: "app" };
      },
    }) as BlockDefinition;
    calls["desk-note-app"] = 0;

    const [seat] = hireWorkforce(
      [record({ id: "support.desk", declared: { tools: ["desk-note"] }, body: "Desk." })],
      {
        kinds: { [AGENT_KIND]: defineAgentWorkerFlow({ catalog: { "desk-note": app } }) },
        seatBlocks: { "support.desk": { "desk-note": own } },
      },
    );

    await runSeat(seat!, "desk-note");
    expect(calls["desk-note"]).toBe(1);
    expect(calls["desk-note-app"]).toBe(0);
  });

  // A seat with no folder must behave exactly as it does today — including
  // keeping the catalog refusal it already has.
  it("changes nothing for a seat with no folder", () => {
    const [seat] = hireWorkforce([record({ id: "support.plain", body: "Plain." })], {
      kinds: { [AGENT_KIND]: defineAgentWorkerFlow() },
    });
    expect(seat!.config).toMatchObject({ tools: [], seatTools: [] });
  });

  it("still refuses a `tools:` name that resolves nowhere, naming both doors", () => {
    const message = refusalOf(
      [record({ id: "support.lost", declared: { tools: ["nowhere"] }, body: "Lost." })],
      { kinds: { [AGENT_KIND]: defineAgentWorkerFlow() }, seatBlocks: {} },
    );
    expect(message).toContain('"nowhere"');
    expect(message).toContain("defineAgentWorkerFlow");
    expect(message).toContain("blocks/");
  });
});

describe("what a seat's own map is refused for", () => {
  it("refuses a registered key that disagrees with its block's own name", () => {
    const mismatched = handler({
      name: "checkInventory",
      description: "Checks stock.",
      inputSchema: z.object({}),
      outputSchema: z.object({ ok: z.boolean() }),
      execute: () => ({ ok: true }),
    }) as BlockDefinition;

    const message = refusalOf([record({ id: "support.clerk", body: "Clerk." })], {
      kinds: { [AGENT_KIND]: defineAgentWorkerFlow() },
      seatBlocks: { "support.clerk": { "check-inventory": mismatched } },
    });

    expect(message).toContain('worker "support.clerk"');
    expect(message).toContain("check-inventory");
    expect(message).toContain("checkInventory");
  });

  // Falsifiability: agreement must not refuse, or the check above could be a
  // bare throw over any non-empty map.
  it("does not refuse when the key and the block's name agree", () => {
    expect(() =>
      hireWorkforce([record({ id: "support.clerk", body: "Clerk." })], {
        kinds: { [AGENT_KIND]: defineAgentWorkerFlow() },
        seatBlocks: { "support.clerk": { "check-inventory": countingBlock("check-inventory") } },
      }),
    ).not.toThrow();
  });

  it("refuses a registered block that declares its own resources, naming both fixes", () => {
    const ledger = defineResource({
      scope: "session",
      stateSchema: z.object({ entries: z.number() }),
    });
    const needsAStore = handler({
      name: "read-ledger",
      description: "Reads the ledger.",
      uses: [defineCapability({ name: "desk-ledger", resources: { ledger } })],
      inputSchema: z.object({}),
      outputSchema: z.object({ ok: z.boolean() }),
      execute: () => ({ ok: true }),
    }) as BlockDefinition;

    // The premise the refusal rests on, asserted so the check cannot pass for
    // the wrong reason: the block really does declare the resource.
    expect(needsAStore.declaredResources?.ledger).toBe(ledger);

    const message = refusalOf([record({ id: "support.ledger", body: "Ledger." })], {
      kinds: { [AGENT_KIND]: defineAgentWorkerFlow() },
      seatBlocks: { "support.ledger": { "read-ledger": needsAStore } },
    });

    expect(message).toContain('worker "support.ledger"');
    expect(message).toContain("read-ledger");
    expect(message).toContain("ledger");
    expect(message).toContain("workforce/blocks/");
  });

  // Refused for DECLARING, not for using: a block that reads a store the kind
  // already installed is exactly the supported case.
  it("accepts a registered block that USES a store the kind installed", async () => {
    const shared = defineResource({
      scope: "session",
      stateSchema: z.object({ entries: z.number() }),
    });
    let outcome = "never ran";
    const reads = handler({
      name: "read-shared",
      description: "Reads the shared ledger.",
      inputSchema: z.object({}),
      outputSchema: z.object({ ok: z.boolean() }),
      execute: async (_input, ctx) => {
        try {
          const res = (
            ctx as { resources: Record<string, { patchState: (u: object) => Promise<void> }> }
          ).resources.shared;
          await res.patchState({ entries: 1 });
          outcome = "handle worked";
        } catch (error) {
          outcome = `threw: ${error instanceof Error ? error.message : String(error)}`;
        }
        return { ok: true };
      },
    }) as BlockDefinition;

    // The store arrives the supported way — declared on the KIND, through a
    // capability the app passed — and the colocated block merely reads it.
    const kind = defineAgentWorkerFlow({
      uses: [defineCapability({ name: "shared-ledger", resources: { shared } })],
    });
    const [seat] = hireWorkforce(
      [record({ id: "support.reader", declared: { tools: ["read-shared"] }, body: "Reader." })],
      { kinds: { [AGENT_KIND]: kind }, seatBlocks: { "support.reader": { "read-shared": reads } } },
    );

    const result = await runSeat(seat!, "read-shared");
    expect(result.error).toBeUndefined();
    expect(outcome).toBe("handle worked");
  });

  it("refuses a worker file that writes `seatTools:` itself", () => {
    const message = refusalOf(
      [record({ id: "support.sneaky", declared: { seatTools: [] }, body: "Sneaky." })],
      { kinds: { [AGENT_KIND]: defineAgentWorkerFlow() } },
    );
    expect(message).toContain('worker "support.sneaky"');
    expect(message).toContain("seatTools");
  });

  // BP-035's second path: the option absent entirely must behave as before.
  it("hires with no `seatBlocks` option at all", () => {
    const [seat] = hireWorkforce([record({ id: "support.plain", body: "Plain." })]);
    expect(seat!.config).toMatchObject({ seatTools: [] });
  });

  // **A short roster is a supported mode**, and the map is generated from the
  // whole tree. `readWorkforce` reports a folder that produced no worker and
  // loads the rest, and the README permits hiring what loaded — so a
  // `seatBlocks` entry for a worker absent from THIS call is the ordinary shape
  // of that mode, not a mistake. The registry is validated for the manifests
  // actually being hired; entries addressed to anyone else are not this call's
  // business.
  it("hires a subset without objecting to map entries for the workers left out", () => {
    const [seat] = hireWorkforce(
      [record({ id: "support.clerk", declared: { tools: ["check-inventory"] }, body: "Clerk." })],
      {
        kinds: { [AGENT_KIND]: defineAgentWorkerFlow() },
        seatBlocks: {
          "support.clerk": { "check-inventory": countingBlock("check-inventory") },
          // Not on this roster — a sibling that failed to load, or a
          // deliberately short hire.
          "support.absent": { "check-inventory": countingBlock("check-inventory") },
        },
      },
    );

    expect(seat!.id).toBe("support.clerk");
    expect((seat!.config as { seatTools: BlockDefinition[] }).seatTools).toHaveLength(1);
  });

  // The other half: a bad registry is still refused for a worker that IS being
  // hired, so ignoring the rest does not turn into ignoring everything.
  it("still refuses a bad registry for a worker on this roster", () => {
    const ledger = defineResource({
      scope: "session",
      stateSchema: z.object({ entries: z.number() }),
    });
    const needsAStore = handler({
      name: "read-ledger",
      description: "Reads the ledger.",
      uses: [defineCapability({ name: "ledger-cap", resources: { ledger } })],
      inputSchema: z.object({}),
      outputSchema: z.object({ ok: z.boolean() }),
      execute: () => ({ ok: true }),
    }) as BlockDefinition;

    const message = refusalOf([record({ id: "support.clerk", body: "Clerk." })], {
      kinds: { [AGENT_KIND]: defineAgentWorkerFlow() },
      seatBlocks: {
        "support.clerk": { "read-ledger": needsAStore },
        "support.absent": { "read-ledger": needsAStore },
      },
    });
    expect(message).toContain('worker "support.clerk"');
    expect(message).not.toContain("support.absent");
  });
});

describe("a colocated tool does not travel through delegation", () => {
  // The delegation fence narrows a board worker to the delegating seat's own
  // `tools:` list. A name that resolved to the seat's own folder leaves that
  // list, so the fence keeps its exact current meaning and a colocated tool
  // cannot be handed to somebody else's seat.
  it("leaves only the catalog half in the bag's `tools`", () => {
    const own = countingBlock("check-inventory");
    const app = countingBlock("desk-note");
    const [seat] = hireWorkforce(
      [
        record({
          id: "support.clerk",
          declared: { tools: ["desk-note", "check-inventory"] },
          body: "Clerk.",
        }),
      ],
      {
        kinds: { [AGENT_KIND]: defineAgentWorkerFlow({ catalog: { "desk-note": app } }) },
        seatBlocks: { "support.clerk": { "check-inventory": own } },
      },
    );

    expect(seat!.config).toMatchObject({ tools: ["desk-note"] });
    expect((seat!.config as { seatTools: BlockDefinition[] }).seatTools).toHaveLength(1);
  });
});
