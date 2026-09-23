/**
 * Hire-row pin for FIX-1529.
 *
 * The pin is `{ orgId, userId? }` from the row, never from the address. A
 * legacy row binds the cell it was read from. A row that names another org
 * is a problem and is not minted. A deep roster collection is refused at
 * definition, because the private sub-prefix only hides rows from the
 * browser pattern.
 */
import { describe, expect, it } from "vitest";
import { defineResourceCollection } from "@flow-state-dev/core";
import { z } from "zod";
import {
  defineHiredRosterCollection,
  defineHiredRosterPrivateCollection,
  hiredRosterStorageKey,
  hiredSeatManifest,
  hiredSeatRowFromManifest,
  reloadHiredSeats,
  toHiredSeatRow,
} from "../src/roster";
import { hireWorkforce } from "../src/hire";
import { workerConfigSchema } from "../src/worker-config";
import { defineFlow, handler } from "@flow-state-dev/core";

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

    const bound = hiredSeatManifest("acme", row);
    if (!("manifest" in bound)) throw new Error(bound.problem);
    expect(bound.manifest.id).toBe("acme.research");
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

  it("refuses a workforce/roster/** collection, and still allows the two roster patterns", () => {
    expect(() =>
      defineResourceCollection({
        pattern: "workforce/roster/**",
        scope: "org",
        stateSchema: z.object({}),
      })
    ).toThrow(/user-owned roster rows/);
    expect(() =>
      defineResourceCollection({
        pattern: "workforce/**",
        scope: "org",
        stateSchema: z.object({}),
      })
    ).toThrow(/user-owned roster rows/);
    expect(defineHiredRosterCollection().pattern).toBe("workforce/roster/*");
    expect(defineHiredRosterPrivateCollection().pattern).toBe("workforce/roster/[owner]/[seat]");
    expect(defineHiredRosterPrivateCollection().client?.state?.read).not.toBe(true);
  });
});
