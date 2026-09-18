/**
 * POC · FIX-1416 — is a scanned block already a seat's tool?
 *
 * Throwaway. Never merges. Run it, read the verdict, then argue with the spec.
 *
 * The spec's first decision claims the primary author recipe — a custom block
 * under `workforce/blocks/`, a seat naming it in `tools:` — needs **no new
 * framework surface**: the scan's `blocks` map is already the shape
 * `defineAgentWorkerFlow({ catalog })` takes, and the fence already governs it.
 * That claim is load-bearing and nothing in the repo exercises it: the one app
 * with a `workforce/blocks/` folder (kitchen-sink) reaches its block as a flow
 * ACTION through a relative import, and passes no `catalog` at all.
 *
 * So this pins five things, each on the path a real app would take:
 *
 *   1. the generated map's type is accepted where `ToolCatalog` is expected
 *   2. a seat naming a scanned block reaches its `execute`
 *   3. a seat with `tools: []` does not — the fence holds over a scanned block
 *   4. WHICH NAME the model is advertised: the scan's registration key, or the
 *      block's own `name`, when an author lets the two differ
 *   5. whether a live `BlockDefinition` survives the HIRE path onto a seat's
 *      `ctx.flow.config` — the premise the colocated half's delivery route
 *      rests on (added for spec review round 1)
 *   6. what an author gets when a colocated block DECLARES a resource — the
 *      hole review round 1 found in D2 (added for spec review round 1)
 *
 * (4) is the one nobody had asked, (5) decides where the colocated map is
 * wired, and (6) is the defect that decides what a colocated block may declare.
 * They are the reason this POC exists.
 *
 * Run:
 *   npx vitest run --root spec-poc/FIX-1416-blocks-as-tools
 */
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { defineCapability, defineFlow, generator, handler } from "@flow-state-dev/core";
import { defineResource } from "@flow-state-dev/core/types";
import type { BlockDefinition, FlowInstance, ToolCatalog } from "@flow-state-dev/core/types";
import { createTestContext, mockGenerator } from "@flow-state-dev/testing";
import { executeBlock } from "@flow-state-dev/engine";
import { hireWorkforce } from "../../packages/workforce/src/hire";
import type { WorkerManifest } from "../../packages/workforce/src/manifest";
import { workerConfigSchema } from "../../packages/workforce/src/worker-config";
import { AGENT_KIND, defineAgentWorkerFlow } from "../../packages/workforce/src/agent-worker-flow";

/** Calls counted per block, so "did the model reach it" is observable. */
const calls = { deskNote: 0, mismatched: 0, colocated: 0 };

/**
 * Stands in for `workforce/blocks/desk-note.ts`. Copied in shape from the real
 * one in kitchen-sink, minus the `ctx.flow.config` read, which is not what is
 * in question here.
 */
const deskNote = handler({
  name: "desk-note",
  description: "Answers a note from the desk.",
  inputSchema: z.object({ note: z.string() }),
  outputSchema: z.object({ answered: z.string() }),
  execute: (input) => {
    calls.deskNote += 1;
    return { answered: input.note };
  },
});

/**
 * The case nobody wrote down: a file whose BASENAME (the registration key) and
 * whose block `name` disagree. The scan keys the map by basename; the generator
 * advertises a tool by its `.name`. Nothing forces them to agree, and the
 * kitchen-sink block's own doc comment says so out loud.
 */
const mismatched = handler({
  name: "lookupCustomer",
  description: "Looks a customer up.",
  inputSchema: z.object({ id: z.string() }),
  outputSchema: z.object({ found: z.boolean() }),
  execute: () => {
    calls.mismatched += 1;
    return { found: true };
  },
});

/**
 * Exactly what `fsdev gen` renders — `satisfies Record<string, BlockDefinition>`,
 * keyed by basename. `lookup-customer` is the file name; the block inside calls
 * itself `lookupCustomer`.
 */
const blocks = {
  "desk-note": deskNote,
  "lookup-customer": mismatched,
} satisfies Record<string, BlockDefinition>;

function record(over: Partial<WorkerManifest> & { id: string }): WorkerManifest {
  return { declared: {}, body: "", ...over };
}

async function contextFor(seat: FlowInstance, script: unknown[]) {
  return createTestContext({
    flow: { ...seat, cardinality: "singleton" },
    orgId: "test-org",
    org: { state: {} },
    sessionId: "test-session",
    sequencerName: seat.actions.run!.block.name,
    declaredResources: seat.actions.run!.block.declaredResources,
    generators: {
      "agent-answer": mockGenerator({ name: "agent-answer", script: script as never }),
    },
  });
}

/**
 * A model script that "calls" a tool by name. An unregistered name resolves to
 * a synthesized result inside the mock's own loop, so a call counter only moves
 * when the tool really did reach the model's toolset.
 */
const callTool = (toolName: string) => ({
  toolCalls: [{ toolCallId: "call-1", toolName, args: { note: "hi", id: "c1" } }],
});

async function run(seat: FlowInstance, toolName: string) {
  const runtime = await contextFor(seat, [callTool(toolName), { text: "done" }]);
  return executeBlock({
    block: seat.actions.run!.block,
    input: { message: "use your tools" },
    ctx: runtime.ctx,
  });
}

describe("FIX-1416 · a scanned block as a seat's tool", () => {
  it("1 · the generated `blocks` map is accepted where a ToolCatalog is expected", () => {
    // The whole of claim 1: no adapter, no wrapper, no conversion step.
    const catalog: ToolCatalog = blocks;
    expect(Object.keys(catalog)).toEqual(["desk-note", "lookup-customer"]);
    expect(() => defineAgentWorkerFlow({ catalog: blocks })).not.toThrow();
  });

  it("2 · a seat naming a scanned block in `tools:` reaches the block's execute", async () => {
    calls.deskNote = 0;
    const kind = defineAgentWorkerFlow({ catalog: blocks });
    const [seat] = hireWorkforce(
      [record({ id: "support.clerk", declared: { tools: ["desk-note"] }, body: "Clerk." })],
      { kinds: { [AGENT_KIND]: kind } },
    );

    const result = await run(seat!, "desk-note");
    expect(result.error).toBeUndefined();
    expect(calls.deskNote).toBe(1);
  });

  it("3 · a seat with `tools: []` does not — the fence holds over a scanned block", async () => {
    calls.deskNote = 0;
    const kind = defineAgentWorkerFlow({ catalog: blocks });
    const [seat] = hireWorkforce([record({ id: "support.ghost", body: "Quiet." })], {
      kinds: { [AGENT_KIND]: kind },
    });

    const result = await run(seat!, "desk-note");
    expect(result.error).toBeUndefined();
    expect(calls.deskNote).toBe(0);
  });

  it("4 · the model is advertised the block's OWN name, not the scan's key", async () => {
    calls.mismatched = 0;
    const kind = defineAgentWorkerFlow({ catalog: blocks });
    const [seat] = hireWorkforce(
      [record({ id: "support.desk", declared: { tools: ["lookup-customer"] }, body: "Desk." })],
      { kinds: { [AGENT_KIND]: kind } },
    );

    // The seat authorized by FILE NAME. If the model is advertised the file
    // name, this call lands; if it is advertised the block's `name`, it does
    // not, and the author has two names for one tool with nothing checking
    // that they agree.
    const byFileName = await run(seat!, "lookup-customer");
    expect(byFileName.error).toBeUndefined();
    const reachedByFileName = calls.mismatched;

    calls.mismatched = 0;
    const byBlockName = await run(seat!, "lookupCustomer");
    expect(byBlockName.error).toBeUndefined();
    const reachedByBlockName = calls.mismatched;

    // eslint-disable-next-line no-console
    console.log(
      `\n  VERDICT (4): authorized as "lookup-customer" · reached by file name: ` +
        `${reachedByFileName} · reached by block name: ${reachedByBlockName}\n`,
    );

    // Recorded, not asserted either way — the POC exists to FIND this out.
    expect(reachedByFileName + reachedByBlockName).toBeGreaterThan(0);
  });
});

/**
 * Round-1 review asked where the per-seat colocated map should be wired: a
 * second option on `defineAgentWorkerFlow` beside `catalog:`, or the hire path
 * that already carries every OTHER per-seat bag (`instructions`,
 * `teamInstructions`, `seatSkills` — `hire.ts:361` imposes the last one from
 * `manifest.skills`).
 *
 * The hire path is the better symmetry IF a live `BlockDefinition` can ride a
 * seat's settings bag. That is not obvious: the three existing contract keys
 * all carry STRINGS, and the bag goes through a zod schema and then sits on
 * `ctx.flow.config`. A function-bearing value could be rejected at the mint,
 * stripped by validation, or arrive as something the resolver cannot call.
 *
 * So: put one on the bag through `hireWorkforce` and try to call it.
 */
const colocated = handler({
  name: "check-inventory",
  description: "Checks the desk's inventory.",
  inputSchema: z.object({}),
  outputSchema: z.object({ count: z.number() }),
  execute: () => {
    calls.colocated += 1;
    return { count: 3 };
  },
});

/**
 * A kind shaped like the agent kind's colocated half and nothing else: the
 * contract schema plus one key holding live blocks, and a `tools:` resolver
 * that reads them off the seat's own config. No catalog, no `tools:` list —
 * whatever the model can call arrived through the bag.
 */
const seatBlocksKind = defineFlow({
  kind: "desk-with-own-blocks",
  cardinality: "collection",
  configSchema: workerConfigSchema().extend({
    model: z.string().default("intent/chat"),
    seatBlocks: z.record(z.custom<BlockDefinition<any, any>>()).default({}),
  }),
  actions: {
    run: {
      inputSchema: z.object({ message: z.string() }),
      block: generator({
        name: "answer",
        model: (_input, ctx) => ctx.flow.config.model,
        prompt: (_input, ctx) => ctx.flow.config.instructions ?? "",
        // The whole question, in one line: does this read return callable blocks?
        tools: (_input, ctx) => Object.values(ctx.flow.config.seatBlocks ?? {}),
        user: (input: { message: string }) => input.message,
      }),
    },
  },
});

describe("FIX-1416 · round 1 · can a colocated block ride the hire path?", () => {
  it("5 · a live BlockDefinition on a seat's settings bag survives the mint and the model can call it", async () => {
    calls.colocated = 0;

    const [seat] = hireWorkforce(
      [
        record({
          id: "support.clerk",
          declared: {
            flow: "desk-with-own-blocks",
            seatBlocks: { "check-inventory": colocated },
          } as never,
          body: "Clerk.",
        }),
      ],
      { kinds: { "desk-with-own-blocks": seatBlocksKind as never } },
    );

    expect(seat).toBeDefined();

    const runtime = await createTestContext({
      flow: { ...seat!, cardinality: "singleton" },
      orgId: "test-org",
      org: { state: {} },
      sessionId: "test-session",
      sequencerName: seat!.actions.run!.block.name,
      declaredResources: seat!.actions.run!.block.declaredResources,
      generators: {
        answer: mockGenerator({
          name: "answer",
          script: [callTool("check-inventory"), { text: "done" }] as never,
        }),
      },
    });

    const result = await executeBlock({
      block: seat!.actions.run!.block,
      input: { message: "what is in stock" },
      ctx: runtime.ctx,
    });

    // eslint-disable-next-line no-console
    console.log(
      `\n  VERDICT (5): mint ${seat ? "accepted" : "refused"} the bag · ` +
        `turn error: ${result.error ? String(result.error) : "none"} · ` +
        `colocated block reached: ${calls.colocated}\n`,
    );

    expect(result.error).toBeUndefined();
    expect(calls.colocated).toBe(1);
  });

  /**
   * The hole review round 1 found in D2, and the one test 5 was too easy to
   * catch: `check-inventory` needs nothing, so it cannot show what happens to a
   * colocated block that needs a store.
   *
   * `defineFlow` collects `declaredResources` by walking the flow's ACTION
   * blocks (`defineFlow.ts:710-721`). A block appended through a
   * function-valued `tools:` resolver is not an action block, so its
   * declarations are never seen — and a per-seat bag cannot change that,
   * because the flow was built before the seat existed.
   *
   * So the question is not *whether* the resource is installed. It is what an
   * author SEES when it isn't: a loud failure, or a tool the model calls into
   * a hole.
   */
  it("6 · a colocated block that DECLARES a resource — what does the author get?", async () => {
    const deskLedger = defineResource({
      scope: "session",
      stateSchema: z.object({ entries: z.number() }),
    });

    let sawResource: unknown = "never ran";
    const needsAStore = handler({
      name: "read-ledger",
      description: "Reads the desk ledger.",
      uses: [defineCapability({ name: "desk-ledger", resources: { deskLedger } })],
      inputSchema: z.object({}),
      outputSchema: z.object({ ok: z.boolean() }),
      execute: async (_input, ctx) => {
        // The whole question: is the handle there when the model calls it?
        sawResource = (ctx as { resources?: Record<string, unknown> }).resources?.deskLedger
          ? "present"
          : "absent";
        return { ok: true };
      },
    });

    // It really does declare the resource — the block half is fine.
    expect(needsAStore.declaredResources?.deskLedger).toBe(deskLedger);

    const [seat] = hireWorkforce(
      [
        record({
          id: "support.ledger",
          declared: {
            flow: "desk-with-own-blocks",
            seatBlocks: { "read-ledger": needsAStore },
          } as never,
          body: "Ledger clerk.",
        }),
      ],
      { kinds: { "desk-with-own-blocks": seatBlocksKind as never } },
    );

    // The seat's ACTION block never saw the declaration, which is the defect:
    // the flow is built before any seat exists, so nothing could have merged it.
    const actionDeclares =
      seat!.actions.run!.block.declaredResources?.deskLedger !== undefined;

    const runtime = await createTestContext({
      flow: { ...seat!, cardinality: "singleton" },
      orgId: "test-org",
      org: { state: {} },
      sessionId: "test-session",
      sequencerName: seat!.actions.run!.block.name,
      declaredResources: seat!.actions.run!.block.declaredResources,
      generators: {
        answer: mockGenerator({
          name: "answer",
          script: [callTool("read-ledger"), { text: "done" }] as never,
        }),
      },
    });

    const result = await executeBlock({
      block: seat!.actions.run!.block,
      input: { message: "read the ledger" },
      ctx: runtime.ctx,
    });

    // eslint-disable-next-line no-console
    console.log(
      `\n  VERDICT (6): hire ${seat ? "accepted" : "refused"} it · ` +
        `action block declares the resource: ${actionDeclares} · ` +
        `turn error: ${result.error ? String(result.error) : "none"} · ` +
        `handle inside execute: ${String(sawResource)}\n`,
    );

    // The finding, asserted so it cannot rot: hire accepts a block whose
    // resource the flow never installed. Whatever happens next — a throw, or a
    // silent hole — the author was told nothing at the door.
    expect(seat).toBeDefined();
    expect(actionDeclares).toBe(false);
  });
});
