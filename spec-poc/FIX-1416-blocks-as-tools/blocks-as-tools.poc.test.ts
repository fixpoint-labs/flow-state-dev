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
 * So this pins four things, each on the path a real app would take:
 *
 *   1. the generated map's type is accepted where `ToolCatalog` is expected
 *   2. a seat naming a scanned block reaches its `execute`
 *   3. a seat with `tools: []` does not — the fence holds over a scanned block
 *   4. WHICH NAME the model is advertised: the scan's registration key, or the
 *      block's own `name`, when an author lets the two differ
 *
 * (4) is the one nobody has asked. It is the reason this POC exists.
 *
 * Run:
 *   npx vitest run --root spec-poc/FIX-1416-blocks-as-tools
 */
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { handler } from "@flow-state-dev/core";
import type { BlockDefinition, FlowInstance, ToolCatalog } from "@flow-state-dev/core/types";
import { createTestContext, mockGenerator } from "@flow-state-dev/testing";
import { executeBlock } from "@flow-state-dev/engine";
import { hireWorkforce } from "../../packages/workforce/src/hire";
import type { WorkerManifest } from "../../packages/workforce/src/manifest";
import { AGENT_KIND, defineAgentWorkerFlow } from "../../packages/workforce/src/agent-worker-flow";

/** Calls counted per block, so "did the model reach it" is observable. */
const calls = { deskNote: 0, mismatched: 0 };

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
