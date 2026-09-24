/**
 * Hire-row pin for FIX-1529.
 *
 * The pin is `{ orgId, userId? }` from the row, never from the address. A
 * legacy row binds the cell it was read from. A row that names another org
 * is a problem and is not minted. A deep roster collection is refused once a
 * registry holds the private writer, because the private sub-prefix only
 * hides rows from the browser pattern.
 */
import { describe, expect, it } from "vitest";
import { defineFlow, defineResourceCollection, handler } from "@flow-state-dev/core";
import { createFlowRegistry } from "@flow-state-dev/engine";
import { z } from "zod";
import {
  defineHiredRosterCollection,
  defineHiredRosterPrivateCollection,
  hiredRosterStorageKey,
  hiredSeatManifest,
  hiredSeatRowFromManifest,
  registerHiredSeat,
  reloadHiredSeats,
  toHiredSeatRow,
} from "../src/roster";
import type { FlowInstance, InstanceOwnerPin } from "@flow-state-dev/core/types";
import { hireWorkforce } from "../src/hire";
import { workerConfigSchema } from "../src/worker-config";

const work = handler({
  name: "desk-work",
  inputSchema: z.object({ note: z.string() }),
  outputSchema: z.object({ note: z.string() }),
  execute: (input) => input,
});

const deskClerk = defineFlow({
  kind: "desk-clerk",
  cardinality: "collection",
  configSchema: workerConfigSchema(),
  actions: { answer: { inputSchema: z.object({ note: z.string() }), block: work } },
});
const kinds = { "desk-clerk": deskClerk };

const ACME_PROMPT = "ACME-CONFIDENTIAL: you work on acme's roadmap";

describe("hire row pin", () => {
  it("stamps owningOrgId and ownerUserId, and the mint carries that pin", () => {
    const row = toHiredSeatRow({
      seatId: "research",
      flow: "desk-clerk",
      instructions: "ALICE-PRIVATE",
      owningOrgId: "acme",
      ownerUserId: "alice",
    });
    expect(row.owningOrgId).toBe("acme");
    expect(row.ownerUserId).toBe("alice");
    expect(hiredRosterStorageKey(row)).toBe("~alice/research");
    expect(
      hiredRosterStorageKey({ seatId: "research", ownerUserId: "bob/x" })
    ).toBe("~bob%2Fx/research");

    const bound = hiredSeatManifest("acme", row);
    if (!("manifest" in bound)) throw new Error(bound.problem);
    expect(bound.manifest.id).toBe("acme.~alice.research");
    expect(bound.manifest.ownerPin).toEqual({ orgId: "acme", userId: "alice" });

    const [seat] = hireWorkforce([bound.manifest], { kinds });
    expect(seat!.ownerPin).toEqual({ orgId: "acme", userId: "alice" });

    const back = hiredSeatRowFromManifest("acme", bound.manifest);
    if (!("row" in back)) throw new Error(back.problem);
    expect(back.row.owningOrgId).toBe("acme");
    expect(back.row.ownerUserId).toBe("alice");
  });

  it("E5 a row claiming another org is a named problem and is not registered", async () => {
    const stores = {
      resourceState: {
        async getByPrefix() {
          return {
            "workforce/roster/eng.lead": {
              state: {
                seatId: "eng.lead",
                flow: "desk-clerk",
                settings: {},
                instructions: ACME_PROMPT,
                owningOrgId: "globex",
              },
            },
          };
        },
      },
    };
    const { seats, problems } = await reloadHiredSeats({
      stores,
      orgIds: ["acme"],
      kinds,
    });
    expect(seats).toEqual([]);
    expect(problems.join("\n")).toContain("globex");
    expect(problems.join("\n")).toContain("acme");
    expect(problems.join("\n")).not.toContain(ACME_PROMPT);
  });

  it("a legacy row binds the cell and stays org-visible", async () => {
    const stores = {
      resourceState: {
        async getByPrefix() {
          return {
            "workforce/roster/eng.lead": {
              state: {
                seatId: "eng.lead",
                flow: "desk-clerk",
                settings: {},
                instructions: ACME_PROMPT,
              },
            },
          };
        },
      },
    };
    const { seats, problems } = await reloadHiredSeats({
      stores,
      orgIds: ["acme"],
      kinds,
    });
    expect(problems).toEqual([]);
    expect(seats.map((seat) => seat.id)).toEqual(["acme.eng.lead"]);
    expect(seats[0]!.ownerPin).toEqual({ orgId: "acme" });
  });

  it("refuses a deep roster collection beside the private writer, and not in an app without it", () => {
    const flowWith = (kind: string, resources: Record<string, unknown>) =>
      defineFlow({
        kind,
        resources: resources as never,
        actions: {
          ping: {
            inputSchema: z.object({}),
            block: handler({
              name: `${kind}-ping`,
              inputSchema: z.object({}),
              outputSchema: z.object({ ok: z.boolean() }),
              execute: () => ({ ok: true }),
            }),
          },
        },
      })();
    expect(defineHiredRosterCollection().pattern).toBe("workforce/roster/*");
    expect(defineHiredRosterPrivateCollection().pattern).toBe("workforce/roster/[owner]/[seat]");
    expect(defineHiredRosterPrivateCollection().client?.state?.read).not.toBe(true);

    for (const pattern of [
      "workforce/roster/**",
      "workforce/**",
      "workforce/roster/[owner]/notes",
      "workforce/roster/*/*",
    ]) {
      const deep = () =>
        defineResourceCollection({ pattern, scope: "org", stateSchema: z.object({}).passthrough() });

      const withoutWriter = createFlowRegistry();
      withoutWriter.register(flowWith("deep", { deep: deep() }));
      expect(withoutWriter.get("deep")).toBeDefined();

      const armed = createFlowRegistry();
      armed.register(flowWith("hires", { roster: defineHiredRosterPrivateCollection() }));
      expect(() => armed.register(flowWith("deep", { deep: deep() }))).toThrow(
        `Collection pattern "${pattern}" can read user-owned roster rows on the server.`
      );
      expect(armed.get("deep")).toBeUndefined();
    }
  });

  it("registers the branded private writer and refuses a hand-built copy of its pattern", () => {
    const registry = createFlowRegistry();
    const ping = handler({
      name: "ping",
      inputSchema: z.object({}),
      outputSchema: z.object({ ok: z.boolean() }),
      execute: () => ({ ok: true }),
    });
    const branded = defineFlow({
      kind: "branded-writer",
      resources: { roster: defineHiredRosterPrivateCollection() },
      actions: { ping: { inputSchema: z.object({}), block: ping } },
    })();
    expect(() => registry.register(branded)).not.toThrow();

    const copy = defineFlow({
      kind: "copied-writer",
      resources: {
        roster: defineResourceCollection({
          pattern: "workforce/roster/[owner]/[seat]",
          scope: "org",
          stateSchema: z.object({}),
        }),
      },
      actions: { ping: { inputSchema: z.object({}), block: ping } },
    })();
    expect(() => registry.register(copy)).toThrow(/cannot be redeclared/);
  });

  it("gives alice and bob different addresses for the same seat id, and the pin stays the row", () => {
    const alice = toHiredSeatRow({
      seatId: "research",
      flow: "desk-clerk",
      instructions: "ALICE-PRIVATE",
      owningOrgId: "acme",
      ownerUserId: "alice",
    });
    const bob = toHiredSeatRow({
      seatId: "research",
      flow: "desk-clerk",
      instructions: "BOB-PRIVATE",
      owningOrgId: "acme",
      ownerUserId: "bob",
    });
    const aliceBound = hiredSeatManifest("acme", alice);
    const bobBound = hiredSeatManifest("acme", bob);
    if (!("manifest" in aliceBound) || !("manifest" in bobBound)) {
      throw new Error("expected both rows to mint");
    }
    expect(aliceBound.manifest.id).toBe("acme.~alice.research");
    expect(bobBound.manifest.id).toBe("acme.~bob.research");
    expect(aliceBound.manifest.ownerPin).toEqual({ orgId: "acme", userId: "alice" });
    expect(bobBound.manifest.ownerPin).toEqual({ orgId: "acme", userId: "bob" });

    const crafted = hiredSeatRowFromManifest("acme", {
      id: "acme.~bob.research",
      declared: { flow: "desk-clerk" },
      body: "from the row",
      ownerPin: { orgId: "acme", userId: "alice" },
    });
    if (!("row" in crafted)) throw new Error(crafted.problem);
    expect(crafted.row.seatId).toBe("research");
    expect(crafted.row.ownerUserId).toBe("alice");
    expect(() =>
      toHiredSeatRow({ seatId: "~alice.research", flow: "desk-clerk" })
    ).not.toThrow();
    expect(() => hiredSeatManifest("acme", toHiredSeatRow({
      seatId: "~alice.research",
      flow: "desk-clerk",
    }))).toThrow(/starts with "~"/);
  });
});

describe("registerHiredSeat", () => {
  const seat = { id: "acme.x" } as FlowInstance;

  it("refuses a hired seat with no pin, and does not call register", () => {
    const seen: InstanceOwnerPin[] = [];
    const register = (_seat: FlowInstance, pin: InstanceOwnerPin) => {
      seen.push(pin);
    };
    expect(() => registerHiredSeat(register, seat, undefined)).toThrow(/owner pin/);
    expect(() => registerHiredSeat(register, seat, { orgId: "" })).toThrow(/owner pin/);
    expect(seen).toEqual([]);
  });

  it("registers with the pin from the row, and drops a blank user", () => {
    const seen: InstanceOwnerPin[] = [];
    const register = (_seat: FlowInstance, pin: InstanceOwnerPin) => {
      seen.push(pin);
    };
    registerHiredSeat(register, seat, { orgId: "globex" });
    registerHiredSeat(register, seat, { orgId: "globex", userId: "" });
    registerHiredSeat(register, seat, { orgId: "globex", userId: "alice" });
    expect(seen).toEqual([
      { orgId: "globex" },
      { orgId: "globex" },
      { orgId: "globex", userId: "alice" },
    ]);
  });
});
