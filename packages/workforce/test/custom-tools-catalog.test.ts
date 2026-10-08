/**
 * The app's catalog as a seat's tool source — the primary recipe FIX-1416
 * wires: a block under `workforce/blocks/`, handed to the kind as `catalog:`,
 * named by a seat's `tools:`.
 *
 * Two rules are pinned here and both were found by a POC rather than by
 * reading:
 *
 * - **One tool has one name.** The map key and the block's own `name` must
 *   agree, refused when the KIND is built — before any seat exists — because
 *   the catalog is a kind-construction argument. A seat authorizes by key and
 *   the model is advertised the block's `name`, so two spellings means a seat
 *   authorizing one tool and a model calling another.
 * - **A catalog tool's declared stores are installed on the kind.** A seat
 *   reaches its tools through a resolver that runs per turn, so a block
 *   arriving that way is outside `defineFlow`'s static walk over action blocks.
 *   Left alone, the tool is hired, advertised, called — and its handle is not
 *   there, while the turn reports success.
 */
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { defineCapability, handler } from "@flow-state-dev/core";
import { defineResource } from "@flow-state-dev/core/types";
import type { FlowInstance } from "@flow-state-dev/core/types";
import { createTestContext, mockGenerator } from "@flow-state-dev/testing";
import { executeBlock } from "@flow-state-dev/engine";
import type { GeneratorModel, GeneratorModelCallOptions, ModelResolver } from "@flow-state-dev/core/types";
import { mintSeats, type HireOptions } from "../src/hire";
import { createWorkerHireBlocks } from "../src/workers/hire-blocks";
import { createWorkerInstallation } from "../src/workers/installation";
import type { WorkerManifest } from "../src/manifest";
import { AGENT_KIND, defineAgentWorkerFlow } from "../src/agent-worker-flow";

function record(over: Partial<WorkerManifest> & { id: string }): WorkerManifest {
  return { declared: {}, body: "", ...over };
}

function hire(manifests: WorkerManifest[], kinds: HireOptions["workerFlows"]): FlowInstance[] {
  return mintSeats(manifests, { workerFlows: kinds });
}

/** A model script that "calls" a tool by name. */
const callTool = (toolName: string) => ({
  toolCalls: [{ toolCallId: "call-1", toolName, args: {} }],
});

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
        script: [callTool(toolName), { text: "done" }] as never,
      }),
    },
  });
  return executeBlock({
    block: seat.actions.run!.block,
    input: { message: "use your tools" },
    ctx: runtime.ctx,
  });
}

describe("one tool, one name — the app's catalog", () => {
  const mismatched = handler({
    name: "lookupCustomer",
    description: "Looks a customer up.",
    inputSchema: z.object({}),
    outputSchema: z.object({ found: z.boolean() }),
    execute: () => ({ found: true }),
  });

  it("refuses a catalog key that disagrees with its block's own name, when the kind is built", () => {
    expect(() => defineAgentWorkerFlow({ catalog: { "lookup-customer": mismatched } })).toThrow(
      /lookup-customer/,
    );
  });

  // The refusal has to say which of the two the model would have been
  // advertised, because that is the half an author cannot see.
  it("names both spellings, and says which one the model would have seen", () => {
    let message = "";
    try {
      defineAgentWorkerFlow({ catalog: { "lookup-customer": mismatched } });
    } catch (error) {
      message = error instanceof Error ? error.message : String(error);
    }
    expect(message).toContain("lookupCustomer");
    expect(message).toContain("lookup-customer");
  });

  // The other half of the rule, and the one that makes the check falsifiable:
  // agreement must NOT refuse. Without this the guard could be a bare `throw`.
  it("does not refuse when the key and the block's name agree", () => {
    const agreeing = handler({
      name: "desk-note",
      description: "Answers a note.",
      inputSchema: z.object({}),
      outputSchema: z.object({ ok: z.boolean() }),
      execute: () => ({ ok: true }),
    });
    expect(() => defineAgentWorkerFlow({ catalog: { "desk-note": agreeing } })).not.toThrow();
  });

  // A kind built with no catalog at all must not acquire a refusal.
  it("builds with no catalog", () => {
    expect(() => defineAgentWorkerFlow()).not.toThrow();
  });
});

describe("a catalog tool's declared stores are installed on the kind", () => {
  const auditLog = defineResource({
    scope: "session",
    stateSchema: z.object({ lines: z.number() }),
  });

  /** Declares its store through a capability, which is the shape an app writes. */
  function writeAudit(seen: { outcome: string }) {
    return handler({
      name: "write-audit",
      description: "Appends to the audit log.",
      uses: [defineCapability({ name: "audit", resources: { auditLog } })],
      inputSchema: z.object({}),
      outputSchema: z.object({ ok: z.boolean() }),
      execute: async (_input, ctx) => {
        try {
          // A real tool does not optional-chain its own declared resource, and
          // it WRITES: a read of an empty store is indistinguishable from a
          // store that is not wired to anything.
          const res = (
            ctx as { resources: Record<string, { patchState: (u: object) => Promise<void> }> }
          ).resources.auditLog;
          await res.patchState({ lines: 1 });
          seen.outcome = "handle worked";
        } catch (error) {
          seen.outcome = `threw: ${error instanceof Error ? error.message : String(error)}`;
        }
        return { ok: true };
      },
    });
  }

  it("declares the store on the flow, so the handle is there when the model calls the tool", async () => {
    const seen = { outcome: "never ran" };
    const kind = defineAgentWorkerFlow({ catalog: { "write-audit": writeAudit(seen) } });
    const [seat] = hire([record({ id: "support.auditor", declared: { tools: ["write-audit"] } })], {
      [AGENT_KIND]: kind,
    });

    // The static half: the action block the flow walks now carries the
    // declaration. Before the registration this was `undefined` — the tool was
    // advertised to the model with nothing behind it.
    expect(seat!.actions.run!.block.declaredResources?.auditLog).toBe(auditLog);

    // The runtime half, which is the one that matters: the tool ran and its
    // store answered. The turn reporting success proves nothing on its own —
    // it reported success in the broken state too, with the block throwing
    // inside itself — so the outcome the block recorded is what is asserted.
    const result = await runSeat(seat!, "write-audit");
    expect(result.error).toBeUndefined();
    expect(seen.outcome).toBe("handle worked");
  });

  // A worker with no `tools:` line can call the tools of a preset it picked,
  // including one the kind leaves off. That tool reaches the generator through
  // the per-turn resolver too, so its store has to be declared by the kind for
  // the same reason a catalog tool's is.
  it("installs the store of a tool a worker reaches by picking an off-by-default preset", async () => {
    const seen = { outcome: "never ran" };
    const ledgerWork = defineCapability({
      name: "ledger-work",
      presets: { audit: { tools: [writeAudit(seen)] }, default: [] }
    });
    const kind = defineAgentWorkerFlow({ uses: [ledgerWork] });
    const [seat] = hire(
      [record({ id: "support.picker", declared: { capabilities: { "ledger-work": ["audit"] } } })],
      { [AGENT_KIND]: kind }
    );

    expect(seat!.actions.run!.block.declaredResources?.auditLog).toBe(auditLog);
    const result = await runSeat(seat!, "write-audit");
    expect(result.error).toBeUndefined();
    expect(seen.outcome).toBe("handle worked");
  });

  // Kind-wide, not per seat: the catalog belongs to the kind, so its stores
  // belong to every seat of it — the same bill `uses` already presents.
  it("installs the store for a seat whose `tools:` never names the block", () => {
    const seen = { outcome: "never ran" };
    const kind = defineAgentWorkerFlow({ catalog: { "write-audit": writeAudit(seen) } });
    const [seat] = hire([record({ id: "support.ghost" })], { [AGENT_KIND]: kind });

    expect(Object.keys((seat as unknown as { resources?: object }).resources ?? {})).toContain(
      "auditLog",
    );
  });

  // The store reaches the flow's own resource map, which is what an engine
  // installs from — not only the block's declaration.
  it("merges the declaration into the flow's resources", () => {
    const seen = { outcome: "never ran" };
    const kind = defineAgentWorkerFlow({
      catalog: { "write-audit": writeAudit(seen) },
    }) as unknown as { resources?: Record<string, unknown> };

    expect(Object.keys(kind.resources ?? {})).toContain("auditLog");
  });

  // A kind whose catalog declares nothing must not gain a resource map it did
  // not have — the registration has to be the union, not a rewrite.
  it("leaves a resource-free catalog's kind exactly as it was", () => {
    const plain = handler({
      name: "desk-note",
      description: "Answers a note.",
      inputSchema: z.object({}),
      outputSchema: z.object({ ok: z.boolean() }),
      execute: () => ({ ok: true }),
    });
    const withCatalog = defineAgentWorkerFlow({ catalog: { "desk-note": plain } }) as unknown as {
      resources?: Record<string, unknown>;
    };
    const without = defineAgentWorkerFlow() as unknown as { resources?: Record<string, unknown> };

    expect(Object.keys(withCatalog.resources ?? {}).sort()).toEqual(
      Object.keys(without.resources ?? {}).sort(),
    );
  });
});

/**
 * A framework block whose own name isn't the key a worker's `tools:` spells
 * goes in the catalog renamed with `.as({ name })`. The one-name check reads
 * the copy's name, so it passes under the new name with no Workforce change,
 * and a key that still disagrees is refused as before.
 */
describe("a block renamed with .as() to its catalog key", () => {
  const description = "Hire a worker of your own onto your roster.";
  const hireBlock = () => createWorkerHireBlocks(createWorkerInstallation()).hire;

  it("accepts Workforce's own hire block renamed to the key", () => {
    expect(hireBlock().name).toBe("workforce-hire");
    expect(() =>
      defineAgentWorkerFlow({ catalog: { hire: hireBlock().as({ name: "hire", description }) } }),
    ).not.toThrow();
  });

  // The control: the same entry without `.as()` is today's refusal, so the
  // acceptance above is the rename's doing, not a loosened check.
  it("refuses the same block passed as it is", () => {
    expect(() => defineAgentWorkerFlow({ catalog: { hire: hireBlock() } })).toThrow(/workforce-hire/);
  });

  it("refuses a key that differs from the .as() name, naming both spellings", () => {
    let message = "";
    try {
      defineAgentWorkerFlow({ catalog: { hire: hireBlock().as({ name: "hireWorker" }) } });
    } catch (error) {
      message = error instanceof Error ? error.message : String(error);
    }
    expect(message).toContain('"hire"');
    expect(message).toContain("hireWorker");
  });

  it("refuses two different copies under one key from a capability and the catalog; one shared copy is fine", () => {
    const blocks = createWorkerHireBlocks(createWorkerInstallation());
    const grant = (tool: unknown) =>
      defineCapability({ name: "roster-tools", presets: { roster: { tools: [tool as never] }, default: ["roster"] } });

    const fromCapability = blocks.hire.as({ name: "hire" });
    const fromCatalog = blocks.hire.as({ name: "hire" });
    expect(() =>
      defineAgentWorkerFlow({ uses: [grant(fromCapability)], catalog: { hire: fromCatalog } }),
    ).toThrow(/catalog key "hire"/);

    const shared = blocks.hire.as({ name: "hire" });
    expect(() => defineAgentWorkerFlow({ uses: [grant(shared)], catalog: { hire: shared } })).not.toThrow();
  });

  it("offers the renamed block to a worker naming it, with the new description, and runs it", async () => {
    let flows: Record<string, unknown> = {};
    const installation = createWorkerInstallation({ workerFlows: () => flows as never });
    const renamed = createWorkerHireBlocks(installation).hire.as({ name: "hire", description });
    const kind = defineAgentWorkerFlow({ installation, catalog: { hire: renamed } });
    flows = { [AGENT_KIND]: kind };
    const [seat] = hire([record({ id: "desk.hr", declared: { tools: ["hire"] } })], { [AGENT_KIND]: kind });

    // A step model that calls `hire` once, recording what it was offered and
    // what the call returned.
    const seen: GeneratorModelCallOptions[] = [];
    const model: GeneratorModel = {
      modelId: "step-model",
      async generate() {
        throw new Error("legacy generate must not be called");
      },
      async generateStep(options) {
        seen.push(options);
        return seen.length === 1
          ? { toolCalls: [{ toolCallId: "c1", toolName: "hire", args: { id: "night-desk" } }], finishReason: "tool-calls" }
          : { text: "hired", finishReason: "stop" };
      },
    };
    const resolver = Object.assign(() => model, { resolveId: (id: string) => id }) as unknown as ModelResolver;
    const runtime = await createTestContext({
      flow: { ...seat!, cardinality: "singleton" },
      orgId: "test-org",
      org: { state: {} },
      sessionId: "test-session",
      sequencerName: seat!.actions.run!.block.name,
      declaredResources: seat!.actions.run!.block.declaredResources,
      modelResolver: resolver,
    });
    const result = await executeBlock({
      block: seat!.actions.run!.block,
      input: { message: "hire night-desk" },
      ctx: runtime.ctx,
    });

    expect(result.error).toBeUndefined();
    const offered = (seen[0]?.tools ?? []).find((tool) => tool.name === "hire");
    expect(offered?.description).toBe(description);
    const toolResult = JSON.stringify(seen[1]?.messages ?? []);
    expect(toolResult).toContain("night-desk");
  });
});
