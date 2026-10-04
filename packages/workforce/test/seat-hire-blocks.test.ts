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
import { seatAddress, splitSeatAddress } from "../src/roster/address";
import { DEFAULT_ORG_ID } from "@flow-state-dev/core/types";

const captured = vi.hoisted(() => ({
  hire: undefined as unknown,
  fire: undefined as unknown,
  brokenSeats: undefined as unknown,
  rehire: undefined as unknown,
}));

vi.mock("../src/seat-hire-blocks", async () => {
  const actual = await vi.importActual<typeof import("../src/seat-hire-blocks")>(
    "../src/seat-hire-blocks",
  );
  return {
    ...actual,
    buildSeatHire: (options: Parameters<typeof actual.buildSeatHire>[0]) => {
      const real = actual.buildSeatHire(options);
      Object.assign(captured, real.blocks);
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

async function hireAgainst(
  register: SeatHireCapabilityOptions["register"] = () => {},
  orgId = "acme",
) {
  const { createSeatHireBlocks } = await import("../src/seat-hire-blocks");
  const { hire } = createSeatHireBlocks({
    register,
    unregister: () => true,
  });
  const runtime = await createTestContext({
    orgId,
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
  it("with askBefore omitted, puts that call's hire, fire and brokenSeats in the preset as they are", () => {
    const cap = createSeatHireCapability({
      register: () => {},
      unregister: () => true,
    });
    const tools = presetTools(cap) as Array<{ name: string }>;
    expect(tools.map((tool) => tool.name)).toEqual(["hire", "fire", "brokenSeats", "rehire"]);
    expect(tools[0]).toBe(captured.hire);
    expect(tools[1]).toBe(captured.fire);
    expect(tools[2]).toBe(captured.brokenSeats);
    // rehire always asks, so the tool is never the bare block.
    expect(tools[3]).not.toBe(captured.rehire);
  });

  it("wraps only the verbs askBefore names", () => {
    const cap = createSeatHireCapability({
      register: () => {},
      unregister: () => true,
      askBefore: ["fire"],
    });
    const tools = presetTools(cap);
    expect(tools[0]).toBe(captured.hire);
    expect(tools[1]).not.toBe(captured.fire);
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

describe("an org id that is not a lowercase-hyphen segment can hire", () => {
  // The framework's own default org, and the `org_…` ids auth providers hand
  // out. Put the segment check back in `seatAddress` and every hire here is
  // refused with "Organization id … must be lowercase letters".
  for (const orgId of ["org_pentest_lab", DEFAULT_ORG_ID, "Org_2NfXq"]) {
    it(`hires under "${orgId}", at an address that splits back to the seat id`, async () => {
      const registered: string[] = [];
      const { hire, ctx } = await hireAgainst((seat) => {
        registered.push(seat.id);
      }, orgId);

      const result = await executeBlock({
        block: hire,
        input: { seatId: "helper", flow: "agent" },
        ctx,
      });

      expect(result.error).toBeUndefined();
      const address = (result.output as { address: string }).address;
      expect(address).toBe(seatAddress(orgId, "helper"));
      expect(registered).toEqual([address]);
      expect(splitSeatAddress(orgId, address)).toBe("helper");
      expect(await listedIds(ctx, HIRED_ROSTER_RESOURCE, "seatId")).toEqual(["helper"]);
      expect(await listedIds(ctx, SEAT_INVENTORY_RESOURCE, "id")).toEqual([address]);
    });
  }
});
