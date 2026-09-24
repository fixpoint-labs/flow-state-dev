/**
 * `createSeatHireBlocks` (FIX-1500 S1) — the seat-hire sequence moved out of
 * `createSeatHireCapability` into its own, model-free export.
 *
 * These checks are regression fences on the MOVE itself, not on new
 * behaviour: `test/seat-hire-capability.test.ts` already covers what hire and
 * fire do, unedited, and stays the fence on their inputs, outputs, refusals
 * and compensation (PLAN.md V1's "unedited suite" clause). V1 proves the
 * capability's tool literally IS the block this module builds, not a second
 * copy. V2 and V3 are BR-12/13/15's duplicate-refusal and compensating-delete
 * guarantees, re-asserted directly against the export so a future edit to
 * either file trips a check that names its own cause.
 */
import { describe, expect, it, vi } from "vitest";
import { executeBlock } from "@flow-state-dev/engine";
import { createTestContext, mockGenerator } from "@flow-state-dev/testing";
import type { FlowInstance } from "@flow-state-dev/core";
import { defineHiredRosterCollection } from "../src/roster/collections";
import { defineSeatInventoryCollection } from "../src/inventory/collections";

const marks = vi.hoisted(() => ({ hireRan: false }));

vi.mock("../src/seat-hire-blocks", async () => {
  const actual = await vi.importActual<typeof import("../src/seat-hire-blocks")>(
    "../src/seat-hire-blocks",
  );
  return {
    ...actual,
    // A marked pass-through: it calls the REAL createSeatHireBlocks and hands
    // back the real fire untouched, but wraps hire's output with a mapper
    // that flips `marks.hireRan` after the real execute has already run. If
    // the capability calls anything else to build its `hire` tool, the flag
    // stays false no matter what the tool call returns.
    createSeatHireBlocks: (options: Parameters<typeof actual.createSeatHireBlocks>[0]) => {
      const real = actual.createSeatHireBlocks(options);
      return {
        hire: real.hire.connectOutput(async (output: unknown) => {
          marks.hireRan = true;
          return output;
        }),
        fire: real.fire,
      };
    },
  };
});

// Imported AFTER the mock is declared (vitest hoists vi.mock above these), so
// the capability module resolves against the mocked factory.
const { createSeatHireCapability, HIRED_ROSTER_RESOURCE, SEAT_INVENTORY_RESOURCE } = await import(
  "../src/seat-hire-capability"
);
const { defineAgentWorkerFlow } = await import("../src/agent-worker-flow");
const { hireWorkforce } = await import("../src/hire");

function liveRoster() {
  const held = new Map<string, FlowInstance>();
  return {
    register: (seat: FlowInstance) => {
      if (held.has(seat.id)) {
        throw new Error(`"${seat.id}" is already registered`);
      }
      held.set(seat.id, seat);
    },
    unregister: (id: string) => held.delete(id),
    kindAt: (id: string) => held.get(id)?.kind,
    has: (id: string) => held.has(id),
  };
}

type ToolCall = { toolCallId: string; toolName: string; args: Record<string, unknown> };

function callTool(toolName: string, args: Record<string, unknown> = {}, id = "call-1"): ToolCall {
  return { toolCallId: id, toolName, args };
}

async function runSeat(
  seat: FlowInstance,
  script: Array<{ toolCalls: ToolCall[] } | { text: string }>,
  orgId = "acme",
) {
  const runtime = await createTestContext({
    flow: { ...seat, cardinality: "singleton" },
    orgId,
    org: { state: {} },
    sessionId: "test-session",
    sequencerName: seat.actions.run!.block.name,
    declaredResources: seat.actions.run!.block.declaredResources,
    generators: {
      "agent-answer": mockGenerator({
        name: "agent-answer",
        script: script as never,
      }),
    },
  });
  const result = await executeBlock({
    block: seat.actions.run!.block,
    input: { message: "run the named tools" },
    ctx: runtime.ctx,
  });
  return { result, ctx: runtime.ctx };
}

async function listedIds(
  ctx: { resources: Record<string, { list: () => Promise<Array<{ state: Record<string, unknown> }>> }> },
  key: string,
  field: string,
): Promise<string[]> {
  const rows = await ctx.resources[key]!.list();
  return rows
    .map((row) => row.state?.[field])
    .filter((value): value is string => typeof value === "string");
}

function record(over: { id: string } & Record<string, unknown>) {
  return { declared: {}, body: "", ...over } as never;
}

describe("V1 · the capability's hire tool IS the block createSeatHireBlocks returns", () => {
  it("runs the marked pass-through block when a seat calls hire", async () => {
    marks.hireRan = false;
    const live = liveRoster();
    const kinds: NonNullable<Parameters<typeof createSeatHireCapability>[0]["kinds"]> = {};
    const seatHire = createSeatHireCapability({
      kinds,
      register: live.register,
      unregister: live.unregister,
      kindAt: live.kindAt,
    });
    kinds.agent = defineAgentWorkerFlow({ uses: [seatHire] });

    const [manager] = hireWorkforce(
      [record({ id: "eng.manager", declared: { tools: ["hire"] }, body: "Expands the roster." })],
      { kinds },
    );

    const { result } = await runSeat(manager!, [
      {
        toolCalls: [
          callTool("hire", { seatId: "eng.ada", flow: "agent", instructions: "Support." }),
        ],
      },
      { text: "done" },
    ]);

    expect(result.error).toBeUndefined();
    expect(marks.hireRan).toBe(true);
    expect(live.has("acme.eng.ada")).toBe(true);
  });
});

describe("V2 · two hires of one id, kindAt omitted, leave one roster row", () => {
  it("arriving in sequence: the second is refused by create() throwing", async () => {
    const { createSeatHireBlocks } = await import("../src/seat-hire-blocks");
    const { hire } = createSeatHireBlocks({
      register: () => {},
      unregister: () => true,
    });
    const runtime = await createTestContext({
      orgId: "acme",
      sessionId: "test-session",
      declaredResources: {
        [HIRED_ROSTER_RESOURCE]: defineHiredRosterCollection(),
        [SEAT_INVENTORY_RESOURCE]: defineSeatInventoryCollection(),
      },
    });

    const first = await executeBlock({
      block: hire,
      input: { seatId: "eng.ada", flow: "agent" },
      ctx: runtime.ctx,
    });
    expect(first.error).toBeUndefined();

    const second = await executeBlock({
      block: hire,
      input: { seatId: "eng.ada", flow: "agent" },
      ctx: runtime.ctx,
    });
    expect(second.error).toBeDefined();

    expect(await listedIds(runtime.ctx as never, HIRED_ROSTER_RESOURCE, "seatId")).toEqual([
      "eng.ada",
    ]);
  });

  it("arriving at once: exactly one succeeds, and one roster row is left", async () => {
    const { createSeatHireBlocks } = await import("../src/seat-hire-blocks");
    const { hire } = createSeatHireBlocks({
      register: () => {},
      unregister: () => true,
    });
    const runtime = await createTestContext({
      orgId: "acme",
      sessionId: "test-session",
      declaredResources: {
        [HIRED_ROSTER_RESOURCE]: defineHiredRosterCollection(),
        [SEAT_INVENTORY_RESOURCE]: defineSeatInventoryCollection(),
      },
    });

    const [a, b] = await Promise.allSettled([
      executeBlock({ block: hire, input: { seatId: "eng.ada", flow: "agent" }, ctx: runtime.ctx }),
      executeBlock({ block: hire, input: { seatId: "eng.ada", flow: "agent" }, ctx: runtime.ctx }),
    ]);

    const errors = [a, b].filter(
      (settled) => settled.status === "fulfilled" && settled.value.error !== undefined,
    );
    expect(errors).toHaveLength(1);
    expect(await listedIds(runtime.ctx as never, HIRED_ROSTER_RESOURCE, "seatId")).toEqual([
      "eng.ada",
    ]);
  });
});

describe("V3 · register throwing leaves no roster row and no inventory row", () => {
  it("cleans up the roster row it just wrote, and never reaches the inventory write", async () => {
    const { createSeatHireBlocks } = await import("../src/seat-hire-blocks");
    const { hire } = createSeatHireBlocks({
      register: () => {
        throw new Error("registration refused");
      },
      unregister: () => true,
    });
    const runtime = await createTestContext({
      orgId: "acme",
      sessionId: "test-session",
      declaredResources: {
        [HIRED_ROSTER_RESOURCE]: defineHiredRosterCollection(),
        [SEAT_INVENTORY_RESOURCE]: defineSeatInventoryCollection(),
      },
    });

    const result = await executeBlock({
      block: hire,
      input: { seatId: "eng.ada", flow: "agent" },
      ctx: runtime.ctx,
    });

    expect(result.error?.message).toMatch(/registration refused/);
    expect(await listedIds(runtime.ctx as never, HIRED_ROSTER_RESOURCE, "seatId")).toEqual([]);
    expect(await listedIds(runtime.ctx as never, SEAT_INVENTORY_RESOURCE, "id")).toEqual([]);
  });
});
