/**
 * Seat-hire capability — hire and fire as catalog tools on the existing mint.
 *
 * Graded on what a seat can actually call and what Discover then lists, not
 * on the factory's return type. Empty `tools:` staying empty is the fence
 * (BR-1). Naming `hire` after the kind installed the capability is the grant
 * (BR-2). A hire nobody can find is theater (BR-10).
 */
import { describe, expect, it } from "vitest";
import {
  createSeatHireCapability,
  HIRED_ROSTER_RESOURCE,
  SEAT_INVENTORY_RESOURCE,
  registerHiredSeat,
  type HiredSeatOwnerPin,
} from "../src/seat-hire-capability";
import { createWorkforceCapability } from "../src/workforce-capability";
import { workforceManifestSources } from "../src/manifest-sources";
import { defineAgentWorkerFlow } from "../src/agent-worker-flow";
import { hireWorkforce, type HireOptions } from "../src/hire";
import { hiredSeatManifest, parseHiredSeatRow } from "../src/roster/rows";
import type { WorkerManifest } from "../src/manifest";
import type { FlowInstance } from "@flow-state-dev/core";
import { executeBlock } from "@flow-state-dev/engine";
import { createTestContext, mockGenerator } from "@flow-state-dev/testing";

function record(over: Partial<WorkerManifest> & { id: string }): WorkerManifest {
  return { declared: {}, body: "", ...over };
}

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

function callTool(toolName: string, args: Record<string, unknown> = {}, id = "call-1"): ToolCall {
  return { toolCallId: id, toolName, args };
}

function collectionOf(ctx: { resources: Record<string, { list: () => Promise<Array<{ state: unknown }>> }> }, key: string) {
  return ctx.resources[key];
}

async function listedIds(
  ctx: { resources: Record<string, { list: () => Promise<Array<{ state: Record<string, unknown> }>> }> },
  key: string,
  field: string,
): Promise<string[]> {
  const rows = await collectionOf(ctx, key).list();
  return rows
    .map((row) => row.state?.[field])
    .filter((value): value is string => typeof value === "string");
}

function hireReturn(items: unknown[]): { seatId?: string; address?: string; warning?: string } | undefined {
  const visit = (value: unknown): { seatId?: string; address?: string; warning?: string } | undefined => {
    if (value === null || typeof value !== "object") return undefined;
    const record = value as Record<string, unknown>;
    if (typeof record.seatId === "string" && typeof record.address === "string") {
      return record as { seatId?: string; address?: string; warning?: string };
    }
    for (const nested of Object.values(record)) {
      const found = visit(nested);
      if (found !== undefined) return found;
    }
    return undefined;
  };
  for (const item of items) {
    const found = visit(item);
    if (found !== undefined) return found;
  }
  return undefined;
}

async function discoverSeatIds(ctx: never, hiredRoster = HIRED_ROSTER_RESOURCE): Promise<string[]> {
  const [source] = workforceManifestSources({
    roster: { workers: [], channels: [] },
    inventory: { seats: SEAT_INVENTORY_RESOURCE },
    hiredRoster,
  });
  const entries = await source!.entries(ctx);
  return entries.map((entry) => entry.id);
}

function kindWithHire(
  live: ReturnType<typeof liveRoster>,
  over: Partial<Parameters<typeof createSeatHireCapability>[0]> = {},
) {
  const kinds: NonNullable<HireOptions["kinds"]> = {};
  const seatHire = createSeatHireCapability({
    kinds,
    register: live.register,
    unregister: live.unregister,
    kindAt: live.kindAt,
    ...over,
  });
  kinds.agent = defineAgentWorkerFlow({ uses: [seatHire] });
  return { kinds, seatHire };
}

describe("the tools fence on seat-hire", () => {
  it("BR-1 · a seat whose tools: is empty cannot call hire even when its kind installed the capability", async () => {
    let hireCalls = 0;
    const live = liveRoster();
    const { kinds } = kindWithHire(live, {
      register: (seat) => {
        hireCalls += 1;
        live.register(seat);
      },
    });

    const [manager] = hireWorkforce(
      [record({ id: "eng.manager", body: "Expands the roster." })],
      { kinds },
    );

    const { result } = await runSeat(manager!, [
      { toolCalls: [callTool("hire", { seatId: "eng.ada", flow: "agent", instructions: "You take support tickets." })] },
      { text: "done" },
    ]);

    expect(result.error).toBeUndefined();
    expect(hireCalls).toBe(0);
    expect(live.has("acme.eng.ada")).toBe(false);
  });

  it("BR-2 · a seat that names hire in tools: mints, writes the roster, and returns { seatId, address }", async () => {
    const live = liveRoster();
    const { kinds } = kindWithHire(live);

    const [manager] = hireWorkforce(
      [record({ id: "eng.manager", declared: { tools: ["hire"] }, body: "Expands the roster." })],
      { kinds },
    );

    const { result, ctx } = await runSeat(manager!, [
      {
        toolCalls: [
          callTool("hire", {
            seatId: "eng.ada",
            flow: "agent",
            instructions: "You take support tickets.",
          }),
        ],
      },
      { text: "done" },
    ]);

    expect(result.error).toBeUndefined();
    expect(live.has("acme.eng.ada")).toBe(true);
    expect(live.kindAt("acme.eng.ada")).toBe("agent");
    expect(await listedIds(ctx, HIRED_ROSTER_RESOURCE, "seatId")).toEqual(["eng.ada"]);
    expect(await listedIds(ctx, SEAT_INVENTORY_RESOURCE, "id")).toEqual(["acme.eng.ada"]);

    expect(hireReturn(result.items)).toMatchObject({ seatId: "eng.ada", address: "acme.eng.ada" });
  });

  it("stamps the row with the principal's org, so a copy read under another org is refused", async () => {
    // An unstamped row binds whatever cell it is read from. The stamp is what
    // lets a reload of a copied row refuse instead of re-owning it.
    const live = liveRoster();
    const { kinds } = kindWithHire(live);

    const [manager] = hireWorkforce(
      [record({ id: "eng.manager", declared: { tools: ["hire"] }, body: "Expands the roster." })],
      { kinds },
    );

    const { result, ctx } = await runSeat(manager!, [
      {
        toolCalls: [
          callTool("hire", { seatId: "eng.ada", flow: "agent", orgId: "globex" }),
        ],
      },
      { text: "done" },
    ]);

    expect(result.error).toBeUndefined();
    const [stored] = await collectionOf(ctx as never, HIRED_ROSTER_RESOURCE).list();
    const parsed = parseHiredSeatRow(stored?.state);
    if ("problem" in parsed) throw new Error(parsed.problem);
    expect(parsed.row.owningOrgId).toBe("acme");
    expect(parsed.row.ownerUserId).toBeNull();

    expect(hiredSeatManifest("acme", parsed.row)).toHaveProperty("manifest.id", "acme.eng.ada");
    expect(hiredSeatManifest("globex", parsed.row)).toEqual({
      problem: expect.stringContaining('owned by organization "acme"'),
    });
  });

  it("refuses a kind this app never registered, and writes nothing", async () => {
    const live = liveRoster();
    const { kinds } = kindWithHire(live);

    const [manager] = hireWorkforce(
      [record({ id: "eng.manager", declared: { tools: ["hire"] }, body: "Expands the roster." })],
      { kinds },
    );

    const { result, ctx } = await runSeat(manager!, [
      { toolCalls: [callTool("hire", { seatId: "eng.ada", flow: "invented-kind" })] },
      { text: "done" },
    ]);

    expect(result.error?.message).toMatch(/invented-kind/);
    expect(live.has("acme.eng.ada")).toBe(false);
    expect(await listedIds(ctx, HIRED_ROSTER_RESOURCE, "seatId")).toEqual([]);
    expect(await listedIds(ctx, SEAT_INVENTORY_RESOURCE, "id")).toEqual([]);
  });

  it("refuses the same seat id twice", async () => {
    const live = liveRoster();
    const { kinds } = kindWithHire(live);

    const [manager] = hireWorkforce(
      [record({ id: "eng.manager", declared: { tools: ["hire"] }, body: "Expands the roster." })],
      { kinds },
    );

    const { result, ctx } = await runSeat(manager!, [
      { toolCalls: [callTool("hire", { seatId: "eng.ada", flow: "agent" }, "call-1")] },
      { toolCalls: [callTool("hire", { seatId: "eng.ada", flow: "agent" }, "call-2")] },
      { text: "done" },
    ]);

    expect(result.error?.message).toMatch(/already served/);
    expect(live.has("acme.eng.ada")).toBe(true);
    expect(await listedIds(ctx, HIRED_ROSTER_RESOURCE, "seatId")).toEqual(["eng.ada"]);
  });

  it("does not let a seat name hire when its kind never installed the capability", () => {
    expect(() =>
      hireWorkforce(
        [record({ id: "eng.manager", declared: { tools: ["hire"] }, body: "No grant." })],
        { kinds: { agent: defineAgentWorkerFlow() } },
      ),
    ).toThrow(/hire/);
  });

  it("ignores a caller-supplied orgId and writes the principal's roster", async () => {
    const live = liveRoster();
    const { kinds } = kindWithHire(live);

    const [manager] = hireWorkforce(
      [record({ id: "eng.manager", declared: { tools: ["hire"] }, body: "Expands the roster." })],
      { kinds },
    );

    const { ctx } = await runSeat(manager!, [
      {
        toolCalls: [
          callTool("hire", { seatId: "eng.ada", flow: "agent", orgId: "other-org" }),
        ],
      },
      { text: "done" },
    ]);

    expect(live.has("acme.eng.ada")).toBe(true);
    expect(live.has("other-org.eng.ada")).toBe(false);
    expect(await listedIds(ctx, HIRED_ROSTER_RESOURCE, "seatId")).toEqual(["eng.ada"]);
    expect(await listedIds(ctx, SEAT_INVENTORY_RESOURCE, "id")).toEqual(["acme.eng.ada"]);
  });
});

describe("fire", () => {
  it("removes the roster row and releases the address; the inventory row stays", async () => {
    const live = liveRoster();
    const { kinds } = kindWithHire(live);

    const [manager] = hireWorkforce(
      [record({ id: "eng.manager", declared: { tools: ["hire", "fire"] }, body: "Expands the roster." })],
      { kinds },
    );

    const { ctx } = await runSeat(manager!, [
      { toolCalls: [callTool("hire", { seatId: "eng.ada", flow: "agent" }, "h1")] },
      { toolCalls: [callTool("fire", { seatId: "eng.ada" }, "f1")] },
      { text: "done" },
    ]);

    expect(live.has("acme.eng.ada")).toBe(false);
    expect(await listedIds(ctx, HIRED_ROSTER_RESOURCE, "seatId")).toEqual([]);
    expect(await listedIds(ctx, SEAT_INVENTORY_RESOURCE, "id")).toEqual(["acme.eng.ada"]);
  });

  it("refuses to fire a seat that was declared in a worker file, not hired through this tool", async () => {
    const live = liveRoster();
    const { kinds } = kindWithHire(live);

    const seats = hireWorkforce(
      [
        record({ id: "eng.manager", declared: { tools: ["fire"] }, body: "Expands the roster." }),
        record({ id: "acme.eng.file", body: "Declared on disk." }),
      ],
      { kinds },
    );
    const manager = seats.find((seat) => seat.id === "eng.manager");
    const fileSeat = seats.find((seat) => seat.id === "acme.eng.file");
    live.register(fileSeat!);

    const { result } = await runSeat(manager!, [
      { toolCalls: [callTool("fire", { seatId: "eng.file" })] },
      { text: "done" },
    ]);

    expect(live.has("acme.eng.file")).toBe(true);
    expect(result.error?.message).toMatch(/worker file|folder/);
  });
});

describe("Discover sees a runtime hire", () => {
  function kindThatCanHireAndDiscover(live: ReturnType<typeof liveRoster>) {
    const kinds: NonNullable<HireOptions["kinds"]> = {};
    const seatHire = createSeatHireCapability({
      kinds,
      register: live.register,
      unregister: live.unregister,
      kindAt: live.kindAt,
    });
    const workforce = createWorkforceCapability({
      roster: { workers: [], channels: [] },
      inventory: { seats: SEAT_INVENTORY_RESOURCE },
      hiredRoster: HIRED_ROSTER_RESOURCE,
    });
    kinds.agent = defineAgentWorkerFlow({ uses: [seatHire, workforce] });
    return kinds;
  }

  it("BR-10 · hire then discover lists the new seat", async () => {
    const live = liveRoster();
    const kinds = kindThatCanHireAndDiscover(live);
    const [manager] = hireWorkforce(
      [record({ id: "eng.manager", declared: { tools: ["hire"] }, body: "Expands the roster." })],
      { kinds },
    );

    const { result, ctx } = await runSeat(manager!, [
      {
        toolCalls: [
          callTool("hire", {
            seatId: "eng.ada",
            flow: "agent",
            instructions: "You take support tickets.",
          }),
        ],
      },
      { text: "done" },
    ]);

    expect(result.error).toBeUndefined();
    expect(await discoverSeatIds(ctx as never)).toEqual(["acme.eng.ada"]);
  });

  it("fire removes the seat from Discover even though the inventory row stays", async () => {
    const live = liveRoster();
    const kinds = kindThatCanHireAndDiscover(live);
    const [manager] = hireWorkforce(
      [record({ id: "eng.manager", declared: { tools: ["hire", "fire"] }, body: "Expands the roster." })],
      { kinds },
    );

    const { ctx } = await runSeat(manager!, [
      { toolCalls: [callTool("hire", { seatId: "eng.ada", flow: "agent" }, "h1")] },
      { toolCalls: [callTool("fire", { seatId: "eng.ada" }, "f1")] },
      { text: "done" },
    ]);

    expect(await listedIds(ctx, HIRED_ROSTER_RESOURCE, "seatId")).toEqual([]);
    expect(await listedIds(ctx, SEAT_INVENTORY_RESOURCE, "id")).toEqual(["acme.eng.ada"]);
    expect(await discoverSeatIds(ctx as never)).toEqual([]);
  });
});

describe("FIX-1529 owner pin", () => {
  it("refuses registering a hired seat without an owner pin from the hire row", async () => {
    const calls: Array<{ id: string; pin: HiredSeatOwnerPin }> = [];
    const seat = { id: "acme.eng.ada", kind: "agent" } as FlowInstance;

    expect(() =>
      registerHiredSeat((registered, pin) => {
        calls.push({ id: registered.id, pin });
      }, seat, undefined),
    ).toThrow(/owner pin/);
    expect(calls).toEqual([]);

    const pins: HiredSeatOwnerPin[] = [];
    const live = liveRoster();
    const { kinds } = kindWithHire(live, {
      register: (hired, pin) => {
        pins.push(pin);
        live.register(hired);
      },
    });
    const [manager] = hireWorkforce(
      [record({ id: "eng.manager", declared: { tools: ["hire"] }, body: "Expands the roster." })],
      { kinds },
    );
    const { result } = await runSeat(manager!, [
      { toolCalls: [callTool("hire", { seatId: "eng.ada", flow: "agent" })] },
      { text: "done" },
    ]);

    expect(result.error).toBeUndefined();
    expect(pins).toEqual([{ orgId: "acme" }]);
    expect(pins[0]?.orgId).not.toBe("eng");
  });
});

describe("unattended boards stay a warning", () => {
  it("hires without attaching a board and names the unattended ledger", async () => {
    const live = liveRoster();
    const { kinds } = kindWithHire(live, { channelBoards: ["eng.standup.triage"] });

    const [manager] = hireWorkforce(
      [record({ id: "eng.manager", declared: { tools: ["hire"] }, body: "Expands the roster." })],
      { kinds },
    );

    const { result } = await runSeat(manager!, [
      { toolCalls: [callTool("hire", { seatId: "eng.ada", flow: "agent" })] },
      { text: "done" },
    ]);

    const payload = hireReturn(result.items);
    expect(payload?.address).toBe("acme.eng.ada");
    expect(payload?.warning).toMatch(/eng\.standup/);
    expect(payload?.warning).toMatch(/triage/);
  });
});
