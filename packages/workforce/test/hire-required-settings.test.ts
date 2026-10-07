/**
 * A model hiring a kind with required settings has to be able to get them
 * right: on the first call from the tool it is shown, and on the second from
 * the refusal it gets back. Deterministic — the model's side is the tool's
 * description and input schema, and the error text a refused call returns.
 *
 * What would make each case fail:
 *   - the `hire` description and `settings` field saying nothing about
 *     required settings (the description used to name only "the kind and a
 *     seat id", which is how a model learns to leave `settings` out);
 *   - the mint refusal passed through as `hireWorkforce`'s boot-time sentence,
 *     which says neither that nothing was written nor that the call can be
 *     made again;
 *   - a refused hire leaving a roster row behind, which turns the corrected
 *     retry into "already hired";
 *   - a mint fault that is not the kind's refusal dressed as one, which sends
 *     a model to retry a call no setting can fix.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { defineFlow, handler } from "@flow-state-dev/core";
import { executeBlock } from "@flow-state-dev/engine";
import { createTestContext } from "@flow-state-dev/testing";
import type { FlowInstance } from "@flow-state-dev/core/types";
import { createSeatHireBlocks } from "../src/seat-hire-blocks";
import { defineHiredRosterCollection } from "../src/roster/collections";
import { defineSeatInventoryCollection } from "../src/inventory/collections";
import { HIRED_ROSTER_RESOURCE, SEAT_INVENTORY_RESOURCE } from "../src/seat-hire-keys";
import { workerConfigSchema } from "../src/worker-config";
import { workerDoor } from "./worker-door";

// Lets one case make `hireWorkforce` mint nothing without throwing: a mint
// fault that is not the kind's refusal, which no real kind produces on demand.
const mintFault = vi.hoisted(() => ({ empty: false }));
vi.mock("../src/hire", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/hire")>();
  return {
    ...actual,
    hireWorkforce: ((...args: Parameters<typeof actual.hireWorkforce>) =>
      mintFault.empty ? [] : actual.hireWorkforce(...args)) as typeof actual.hireWorkforce,
  };
});
afterEach(() => {
  mintFault.empty = false;
});

const noop = handler({
  name: "noop",
  inputSchema: z.object({}),
  outputSchema: z.object({}),
  execute: () => ({}),
});

/** A coder kind whose seats must name the document they read, as the DevForce Lab's does. */
const coder = defineFlow({
  kind: "coder",
  cardinality: "collection",
  configSchema: workerConfigSchema().extend({ document: z.string().min(1) }),
  actions: { ...workerDoor, run: { inputSchema: z.object({}), block: noop } },
});

async function hireTool() {
  const registered: FlowInstance[] = [];
  const { hire } = createSeatHireBlocks({
    workerFlows: { coder } as never,
    register: (seat) => {
      registered.push(seat);
    },
    unregister: () => true,
  });
  const { ctx } = await createTestContext({
    orgId: "acme",
    sessionId: "test-session",
    declaredResources: {
      [HIRED_ROSTER_RESOURCE]: defineHiredRosterCollection(),
      [SEAT_INVENTORY_RESOURCE]: defineSeatInventoryCollection(),
    },
  });
  const rosterIds = async () =>
    (await (ctx.resources as Record<string, { list: () => Promise<Array<{ state: { seatId?: unknown } }>> }>)[
      HIRED_ROSTER_RESOURCE
    ]!.list()).map((row) => row.state.seatId);
  return { hire, ctx, registered, rosterIds };
}

describe("the hire tool, as a model sees it, says settings may be required", () => {
  it("names settings in the description and on the `settings` field", async () => {
    const { hire } = await hireTool();
    expect(hire.description).toMatch(/settings/);
    expect(hire.description).toMatch(/refuse/i);
    const settings = (hire.inputSchema as z.AnyZodObject).shape.settings as z.ZodTypeAny;
    expect(settings.description).toMatch(/require/i);
  });
});

describe("a hire missing a required setting comes back correctable", () => {
  it("names the setting, says nothing was written, and the corrected call lands", async () => {
    const { hire, ctx, registered, rosterIds } = await hireTool();

    const refused = await executeBlock({
      block: hire,
      input: { seatId: "coder-2", flow: "coder" },
      ctx,
    });
    const message = refused.error?.message ?? "";
    expect(message).toMatch(/"document": Required/);
    expect(message).toMatch(/nothing was written/i);
    expect(message).toMatch(/call hire again/i);
    expect(registered).toEqual([]);
    expect(await rosterIds()).toEqual([]);

    const retried = await executeBlock({
      block: hire,
      input: { seatId: "coder-2", flow: "coder", settings: { document: "teams/eng/feature-brief" } },
      ctx,
    });
    expect(retried.error).toBeUndefined();
    expect(retried.output).toMatchObject({ seatId: "coder-2", address: "acme.coder-2" });
    expect(registered.map((seat) => (seat.config as { document?: string }).document)).toEqual([
      "teams/eng/feature-brief",
    ]);
    expect(await rosterIds()).toEqual(["coder-2"]);
  });
});

describe("a framework refusal is not dressed as the kind's", () => {
  it("refuses a reserved `seatId` setting with the framework's message and no settings hint", async () => {
    const { hire, ctx, registered, rosterIds } = await hireTool();

    const refused = await executeBlock({
      block: hire,
      input: {
        seatId: "coder-4",
        flow: "coder",
        settings: { document: "teams/eng/feature-brief", seatId: "someone-else" },
      },
      ctx,
    });
    const message = refused.error?.message ?? "";
    // The framework's own sentence for the reserved key, unframed.
    expect(message).toMatch(/^hireWorkforce refused 1 of 1 worker/);
    expect(message).toMatch(/declares `seatId:`, which is not a setting a worker declares/);
    expect(message).not.toMatch(/call hire again|nothing was written/i);
    expect(registered).toEqual([]);
    expect(await rosterIds()).toEqual([]);
  });
});

describe("a mint fault that is not the kind's refusal keeps its own message", () => {
  it("does not dress it as a correctable settings refusal", async () => {
    const { hire, ctx, registered, rosterIds } = await hireTool();
    mintFault.empty = true;

    const refused = await executeBlock({
      block: hire,
      input: { seatId: "coder-3", flow: "coder", settings: { document: "teams/eng/feature-brief" } },
      ctx,
    });
    const message = refused.error?.message ?? "";
    expect(message).toBe(`"acme.coder-3" could not be hired, and no reason was given.`);
    expect(message).not.toMatch(/call hire again|nothing was written/i);
    expect(registered).toEqual([]);
    expect(await rosterIds()).toEqual([]);
  });
});
