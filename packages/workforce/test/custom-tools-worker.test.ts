/**
 * A block sitting in a worker's own `blocks/` folder.
 *
 * **Registration makes a name resolvable; declaration grants use.** A block in
 * a worker's folder is registered FOR THAT WORKER — it becomes a name that worker's
 * `tools:` may resolve, and nothing more. It does not become callable until the
 * file names it, so `tools:` stays the complete and exclusive answer to *what
 * can this worker call*, and the fence does not move.
 *
 * A name resolves worker folder → team folder → the app's catalog, first match
 * wins. The first two arrive already collapsed on the worker's own map (the
 * generated `workerBlocks` export); this file pins the last hop, the fence, the
 * isolation between workers, and the two refusals that keep a registered name
 * from being a promise the framework cannot keep.
 */
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { defineCapability, handler } from "@flow-state-dev/core";
import { defineResource } from "@flow-state-dev/core/types";
import type { BlockDefinition, FlowInstance } from "@flow-state-dev/core/types";
import { createTestContext, mockGenerator } from "@flow-state-dev/testing";
import { executeBlock } from "@flow-state-dev/engine";
import { mintWorkers, type HireOptions } from "../src/hire";
import type { WorkerManifest } from "../src/manifest";
import { AGENT_FLOW, defineAgentWorkerFlow } from "../src/agent-worker-flow";

function record(over: Partial<WorkerManifest> & { id: string }): WorkerManifest {
  return { declared: {}, body: "", ...over };
}

function refusalOf(manifests: WorkerManifest[], options: HireOptions): string {
  try {
    mintWorkers(manifests, options);
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
  throw new Error("expected a refusal, got workers");
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

async function runWorker(worker: FlowInstance, toolName: string) {
  const runtime = await createTestContext({
    flow: { ...worker, cardinality: "singleton" },
    orgId: "test-org",
    org: { state: {} },
    sessionId: "test-session",
    sequencerName: worker.actions.respond!.block.name,
    declaredResources: worker.actions.respond!.block.declaredResources,
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
    block: worker.actions.respond!.block,
    input: { message: "use your tools" },
    ctx: runtime.ctx,
  });
}

describe("a worker's own blocks are registered, not granted", () => {
  it("lets a worker call a block from its own folder once its `tools:` names it", async () => {
    const check = countingBlock("check-inventory");
    const [worker] = mintWorkers(
      [record({ id: "support.clerk", declared: { tools: ["check-inventory"] }, body: "Clerk." })],
      {
        workerFlows: { [AGENT_FLOW]: defineAgentWorkerFlow() },
        workerBlocks: { "support.clerk": { "check-inventory": check } },
      },
    );

    const result = await runWorker(worker!, "check-inventory");
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
  it("does NOT let a worker call a registered block its `tools:` never named", async () => {
    const check = countingBlock("check-inventory");
    const [worker] = mintWorkers([record({ id: "support.quiet", body: "Quiet." })], {
      workerFlows: { [AGENT_FLOW]: defineAgentWorkerFlow() },
      workerBlocks: { "support.quiet": { "check-inventory": check } },
    });

    const result = await runWorker(worker!, "check-inventory");
    expect(result.error).toBeUndefined();
    expect(calls["check-inventory"]).toBe(0);
  });

  // `tools: []` written out, rather than omitted — the case an author reads as
  // "this worker reaches nothing", which must stay literally true.
  it("reaches nothing with an explicit empty `tools:` and a full folder", async () => {
    const check = countingBlock("check-inventory");
    const [worker] = mintWorkers(
      [record({ id: "support.empty", declared: { tools: [] }, body: "Empty." })],
      {
        workerFlows: { [AGENT_FLOW]: defineAgentWorkerFlow() },
        workerBlocks: { "support.empty": { "check-inventory": check } },
      },
    );

    await runWorker(worker!, "check-inventory");
    expect(calls["check-inventory"]).toBe(0);
  });

  // Two workers, one basename. Neither map is the other's, so neither worker can
  // reach the other's block even by naming it.
  it("keeps two workers' same-named blocks apart", async () => {
    const mine = countingBlock("summarize");
    const yours = handler({
      name: "summarize",
      description: "The other worker's.",
      inputSchema: z.object({}),
      outputSchema: z.object({ ran: z.string() }),
      execute: () => {
        calls["summarize-theirs"] = (calls["summarize-theirs"] ?? 0) + 1;
        return { ran: "theirs" };
      },
    }) as BlockDefinition;
    calls["summarize-theirs"] = 0;

    const [alpha] = mintWorkers(
      [
        record({ id: "support.alpha", declared: { tools: ["summarize"] }, body: "A." }),
        record({ id: "support.beta", declared: { tools: ["summarize"] }, body: "B." }),
      ],
      {
        workerFlows: { [AGENT_FLOW]: defineAgentWorkerFlow() },
        workerBlocks: {
          "support.alpha": { summarize: mine },
          "support.beta": { summarize: yours },
        },
      },
    );

    await runWorker(alpha!, "summarize");
    expect(calls["summarize"]).toBe(1);
    expect(calls["summarize-theirs"]).toBe(0);
  });

  // The precedence the owner ruled: worker → team → org, first match wins. The
  // worker's own map is nearer than the app's catalog, so it answers the name.
  it("resolves a name to the worker's own block before the app's catalog", async () => {
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

    const [worker] = mintWorkers(
      [record({ id: "support.desk", declared: { tools: ["desk-note"] }, body: "Desk." })],
      {
        workerFlows: { [AGENT_FLOW]: defineAgentWorkerFlow({ catalog: { "desk-note": app } }) },
        workerBlocks: { "support.desk": { "desk-note": own } },
      },
    );

    await runWorker(worker!, "desk-note");
    expect(calls["desk-note"]).toBe(1);
    expect(calls["desk-note-app"]).toBe(0);
  });

  // A worker with no folder must behave exactly as it does today — including
  // keeping the catalog refusal it already has.
  it("changes nothing for a worker with no folder", () => {
    const [worker] = mintWorkers([record({ id: "support.plain", body: "Plain." })], {
      workerFlows: { [AGENT_FLOW]: defineAgentWorkerFlow() },
    });
    expect(worker!.config).toMatchObject({ workerTools: [] });
    // No `tools:` line stays no line: an omitted list is never rewritten to `[]`,
    // because the two grant different things.
    expect(worker!.config).not.toHaveProperty("tools");
  });

  it("still refuses a `tools:` name that resolves nowhere, naming both doors", () => {
    const message = refusalOf(
      [record({ id: "support.lost", declared: { tools: ["nowhere"] }, body: "Lost." })],
      { workerFlows: { [AGENT_FLOW]: defineAgentWorkerFlow() }, workerBlocks: {} },
    );
    expect(message).toContain('"nowhere"');
    expect(message).toContain("defineAgentWorkerFlow");
    expect(message).toContain("blocks/");
  });
});

describe("what a worker's own map is refused for", () => {
  it("refuses a registered key that disagrees with its block's own name", () => {
    const mismatched = handler({
      name: "checkInventory",
      description: "Checks stock.",
      inputSchema: z.object({}),
      outputSchema: z.object({ ok: z.boolean() }),
      execute: () => ({ ok: true }),
    }) as BlockDefinition;

    const message = refusalOf([record({ id: "support.clerk", body: "Clerk." })], {
      workerFlows: { [AGENT_FLOW]: defineAgentWorkerFlow() },
      workerBlocks: { "support.clerk": { "check-inventory": mismatched } },
    });

    expect(message).toContain('worker "support.clerk"');
    expect(message).toContain("check-inventory");
    expect(message).toContain("checkInventory");
  });

  // Falsifiability: agreement must not refuse, or the check above could be a
  // bare throw over any non-empty map.
  it("does not refuse when the key and the block's name agree", () => {
    expect(() =>
      mintWorkers([record({ id: "support.clerk", body: "Clerk." })], {
        workerFlows: { [AGENT_FLOW]: defineAgentWorkerFlow() },
        workerBlocks: { "support.clerk": { "check-inventory": countingBlock("check-inventory") } },
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
      workerFlows: { [AGENT_FLOW]: defineAgentWorkerFlow() },
      workerBlocks: { "support.ledger": { "read-ledger": needsAStore } },
    });

    expect(message).toContain('worker "support.ledger"');
    expect(message).toContain("read-ledger");
    expect(message).toContain("ledger");
    expect(message).toContain("workforce/blocks/");
  });

  // Refused for DECLARING, not for using: a block that reads a store the worker flow
  // already installed is exactly the supported case.
  it("accepts a registered block that USES a store the worker flow installed", async () => {
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

    // The store arrives the supported way — declared on the WORKER FLOW, through a
    // capability the app passed — and the colocated block merely reads it.
    const flow = defineAgentWorkerFlow({
      uses: [defineCapability({ name: "shared-ledger", resources: { shared } })],
    });
    const [worker] = mintWorkers(
      [record({ id: "support.reader", declared: { tools: ["read-shared"] }, body: "Reader." })],
      { workerFlows: { [AGENT_FLOW]: flow }, workerBlocks: { "support.reader": { "read-shared": reads } } },
    );

    const result = await runWorker(worker!, "read-shared");
    expect(result.error).toBeUndefined();
    expect(outcome).toBe("handle worked");
  });

  it("refuses a worker file that writes `workerTools:` itself", () => {
    const message = refusalOf(
      [record({ id: "support.sneaky", declared: { workerTools: [] }, body: "Sneaky." })],
      { workerFlows: { [AGENT_FLOW]: defineAgentWorkerFlow() } },
    );
    expect(message).toContain('worker "support.sneaky"');
    expect(message).toContain("workerTools");
  });

  // BP-035's second path: the option absent entirely must behave as before.
  it("hires with no `workerBlocks` option at all", () => {
    const [worker] = mintWorkers([record({ id: "support.plain", body: "Plain." })]);
    expect(worker!.config).toMatchObject({ workerTools: [] });
  });

  // **A short roster is a supported mode**, and the map is generated from the
  // whole tree. `readWorkforce` reports a folder that produced no worker and
  // loads the rest, and the README permits hiring what loaded — so a
  // `workerBlocks` entry for a worker absent from THIS call is the ordinary shape
  // of that mode, not a mistake. The registry is validated for the manifests
  // actually being hired; entries addressed to anyone else are not this call's
  // business.
  it("hires a subset without objecting to map entries for the workers left out", () => {
    const [worker] = mintWorkers(
      [record({ id: "support.clerk", declared: { tools: ["check-inventory"] }, body: "Clerk." })],
      {
        workerFlows: { [AGENT_FLOW]: defineAgentWorkerFlow() },
        workerBlocks: {
          "support.clerk": { "check-inventory": countingBlock("check-inventory") },
          // Not on this roster — a sibling that failed to load, or a
          // deliberately short hire.
          "support.absent": { "check-inventory": countingBlock("check-inventory") },
        },
      },
    );

    expect(worker!.id).toBe("support.clerk");
    expect((worker!.config as { workerTools: BlockDefinition[] }).workerTools).toHaveLength(1);
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
      workerFlows: { [AGENT_FLOW]: defineAgentWorkerFlow() },
      workerBlocks: {
        "support.clerk": { "read-ledger": needsAStore },
        "support.absent": { "read-ledger": needsAStore },
      },
    });
    expect(message).toContain('worker "support.clerk"');
    expect(message).not.toContain("support.absent");
  });
});

describe("a colocated tool stays off the catalog list", () => {
  // `tools:` on the bag carries only the names the worker flow checks against its
  // catalog. A name that resolved to the worker's own folder leaves that list
  // and rides on `workerTools` instead.
  it("leaves only the catalog half in the bag's `tools`", () => {
    const own = countingBlock("check-inventory");
    const app = countingBlock("desk-note");
    const [worker] = mintWorkers(
      [
        record({
          id: "support.clerk",
          declared: { tools: ["desk-note", "check-inventory"] },
          body: "Clerk.",
        }),
      ],
      {
        workerFlows: { [AGENT_FLOW]: defineAgentWorkerFlow({ catalog: { "desk-note": app } }) },
        workerBlocks: { "support.clerk": { "check-inventory": own } },
      },
    );

    expect(worker!.config).toMatchObject({ tools: ["desk-note"] });
    expect((worker!.config as { workerTools: BlockDefinition[] }).workerTools).toHaveLength(1);
  });
});
