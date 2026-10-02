/**
 * TEAMS lists a hired seat only while the organization's roster backs it
 * (Workforce's team-list rule, applied once in the shared read).
 *
 * A fake Lab behind the clients: one session, one manifest that declares the
 * inventory and (optionally) the roster, and the rows each collection holds.
 */
import { describe, expect, it } from "vitest";
import type { LabClients } from "../src/lib/connection";
import { createLabReader, type LabSnapshot } from "../src/lib/reads";

const ORG = "acme";

type Lab = {
  seats: Array<{ id: string; kind: string }>;
  roster?: Array<{ seatId: string }> | "fails";
};

function clientsFor(lab: Lab): LabClients {
  const collections: Record<string, unknown[] | "fails"> = {
    seats: lab.seats,
    channels: [{ id: "eng.general", kind: "channel", members: [] }],
    ...(lab.roster === undefined ? {} : { roster: lab.roster }),
  };
  const manifest = {
    resources: [
      { kind: "collection", ref: "seats", pattern: "inventory/seats/*", scope: "org", client: { state: { read: true } } },
      { kind: "collection", ref: "channels", pattern: "inventory/channels/*", scope: "org", client: { state: { read: true } } },
      ...(lab.roster === undefined
        ? []
        : [{ kind: "collection", ref: "roster", pattern: "workforce/roster/*", scope: "org", client: { state: { read: true } } }]),
    ],
  };
  return {
    userId: "u1",
    sessions: {
      listSessions: async () => [{ id: "s1", flowKind: "channel", parentSessionId: null, updatedAt: 0 }],
      getSession: async () => ({ orgId: ORG }),
      getSessionState: async () => ({ items: [] }),
      listSessionRequests: async () => [],
    },
    resources: {
      getResourceManifest: async () => manifest,
      listCollectionItems: async (_sessionId: string, ref: string) => {
        const rows = collections[ref];
        if (rows === "fails") throw new Error("the roster read failed");
        return { items: (rows ?? []).map((data, i) => ({ topic: `${ref}-${i}`, clientData: data })) };
      },
    },
  } as unknown as LabClients;
}

async function teams(lab: Lab) {
  const snapshot: LabSnapshot = await createLabReader(clientsFor(lab)).read();
  if (snapshot.refused !== undefined || snapshot.unreachable !== undefined) throw new Error("not loaded");
  if (!snapshot.inventory.ok) throw new Error(snapshot.inventory.failure.message);
  return snapshot.inventory.value;
}

const declared = [
  { id: "eng.lead", kind: "agent" },
  { id: "chief-of-staff", kind: "agent" },
];

describe("TEAMS and the roster", () => {
  it("BR-22 · a hired seat's inventory row with no roster row (as an earlier fire left it) is not listed", async () => {
    const value = await teams({
      seats: [...declared, { id: "acme.support.joe", kind: "desk-clerk" }, { id: "acme.support.ada", kind: "agent" }],
      roster: [{ seatId: "support.ada" }],
    });
    expect(value.seats.map((seat) => seat.id)).toEqual(["eng.lead", "chief-of-staff", "acme.support.ada"]);
    expect(value.rosterUnread).toBeUndefined();
  });

  it("BR-23 · declared seats, a dotless org seat included, are listed as today", async () => {
    const value = await teams({ seats: declared });
    expect(value.seats.map((seat) => [seat.id, seat.team])).toEqual([
      ["eng.lead", "eng"],
      ["chief-of-staff", "Staff"],
    ]);
    expect(value.rosterUnread).toBeUndefined();
  });

  it("BR-24 · the roster read fails: hired seats aren't listed, and the section says the roster didn't load", async () => {
    const value = await teams({ seats: [...declared, { id: "acme.support.ada", kind: "agent" }], roster: "fails" });
    expect(value.seats.map((seat) => seat.id)).toEqual(["eng.lead", "chief-of-staff"]);
    expect(value.rosterUnread).toMatch(/1 hired seat isn't listed: the roster didn't load.*the roster read failed/);
  });

  it("BR-24 · no listed flow declares the roster: the same", async () => {
    const value = await teams({ seats: [...declared, { id: "acme.support.ada", kind: "agent" }] });
    expect(value.seats.map((seat) => seat.id)).toEqual(["eng.lead", "chief-of-staff"]);
    expect(value.rosterUnread).toMatch(/declares the roster/);
  });
});
