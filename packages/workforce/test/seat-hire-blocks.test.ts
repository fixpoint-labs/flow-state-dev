/**
 * Fences the unedited capability suite cannot see: the capability's tools are
 * the handlers this factory returned, `create()` refuses a second hire when
 * `kindAt` is omitted, and a thrown `register` deletes the roster row before
 * inventory is written.
 */
import { describe, expect, it, vi } from "vitest";
import { resolveActivePresets } from "@flow-state-dev/core/capability";
import { executeBlock } from "@flow-state-dev/engine";
import { createTestContext } from "@flow-state-dev/testing";
import type { SeatHireCapabilityOptions } from "../src/seat-hire-blocks";
import { defineHiredRosterCollection } from "../src/roster/collections";
import { defineSeatInventoryCollection } from "../src/inventory/collections";

const captured = vi.hoisted(() => ({
  hire: undefined as unknown,
  fire: undefined as unknown,
}));

vi.mock("../src/seat-hire-blocks", async () => {
  const actual = await vi.importActual<typeof import("../src/seat-hire-blocks")>(
    "../src/seat-hire-blocks",
  );
  return {
    ...actual,
    createSeatHireBlocks: (options: Parameters<typeof actual.createSeatHireBlocks>[0]) => {
      const real = actual.createSeatHireBlocks(options);
      captured.hire = real.hire;
      captured.fire = real.fire;
      return real;
    },
  };
});

const { createSeatHireCapability, HIRED_ROSTER_RESOURCE, SEAT_INVENTORY_RESOURCE } = await import(
  "../src/seat-hire-capability"
);

function presetTools(cap: Parameters<typeof resolveActivePresets>[0]): unknown[] {
  return resolveActivePresets(cap).flatMap(({ preset }) =>
    Array.isArray(preset.tools) ? preset.tools : [],
  );
}

async function hireAgainst(register: SeatHireCapabilityOptions["register"] = () => {}) {
  const { createSeatHireBlocks } = await import("../src/seat-hire-blocks");
  const { hire } = createSeatHireBlocks({
    register,
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
  return { hire, ctx: runtime.ctx };
}

async function listedIds(ctx: { resources: object }, key: string, field: string): Promise<string[]> {
  const resources = ctx.resources as Record<
    string,
    { list: () => Promise<Array<{ state: Record<string, unknown> }>> }
  >;
  const rows = await resources[key]!.list();
  return rows
    .map((row) => row.state?.[field])
    .filter((value): value is string => typeof value === "string");
}

describe("the capability mounts the factory's blocks", () => {
  it("puts that call's hire and fire into the tools preset", () => {
    const cap = createSeatHireCapability({
      register: () => {},
      unregister: () => true,
    });
    const tools = presetTools(cap);
    expect(tools).toHaveLength(2);
    expect(tools[0]).toBe(captured.hire);
    expect(tools[1]).toBe(captured.fire);
  });
});

describe("two hires of one id, kindAt omitted, leave one roster row", () => {
  it("arriving in sequence: the second is refused by create() throwing", async () => {
    const { hire, ctx } = await hireAgainst();

    const first = await executeBlock({
      block: hire,
      input: { seatId: "eng.ada", flow: "agent" },
      ctx,
    });
    expect(first.error).toBeUndefined();

    const second = await executeBlock({
      block: hire,
      input: { seatId: "eng.ada", flow: "agent" },
      ctx,
    });
    expect(second.error).toBeDefined();

    expect(await listedIds(ctx, HIRED_ROSTER_RESOURCE, "seatId")).toEqual(["eng.ada"]);
  });

  it("arriving at once: exactly one succeeds, and one roster row is left", async () => {
    const { hire, ctx } = await hireAgainst();

    const [a, b] = await Promise.allSettled([
      executeBlock({ block: hire, input: { seatId: "eng.ada", flow: "agent" }, ctx }),
      executeBlock({ block: hire, input: { seatId: "eng.ada", flow: "agent" }, ctx }),
    ]);

    const errors = [a, b].filter(
      (settled) => settled.status === "fulfilled" && settled.value.error !== undefined,
    );
    expect(errors).toHaveLength(1);
    expect(await listedIds(ctx, HIRED_ROSTER_RESOURCE, "seatId")).toEqual(["eng.ada"]);
  });
});

describe("register throwing leaves no roster row and no inventory row", () => {
  it("cleans up the roster row it just wrote, and never reaches the inventory write", async () => {
    const { hire, ctx } = await hireAgainst(() => {
      throw new Error("registration refused");
    });

    const result = await executeBlock({
      block: hire,
      input: { seatId: "eng.ada", flow: "agent" },
      ctx,
    });

    expect(result.error?.message).toMatch(/registration refused/);
    expect(await listedIds(ctx, HIRED_ROSTER_RESOURCE, "seatId")).toEqual([]);
    expect(await listedIds(ctx, SEAT_INVENTORY_RESOURCE, "id")).toEqual([]);
  });
});
