/**
 * TEAMS lists a hired seat only while the organization's roster backs it
 * (Workforce's team-list rule, applied once in the shared read).
 *
 * A fake Lab behind the clients: one session, one manifest that declares the
 * inventory and (optionally) the roster, and the rows each collection holds.
 */
import { afterEach, describe, expect, it } from "vitest";
import { createLabClients, type LabClients } from "../src/lib/connection";
import { createLabReader, type LabSnapshot } from "../src/lib/reads";
import { ASK_LAB_USER_ID, openAskLab } from "./fixtures/ask-lab/lab.mts";
import { serveLab, type ServedLab } from "./helpers/serve-lab";

const ORG = "acme";

type Lab = {
  seats: Array<{ id: string; kind: string; hired?: boolean; incarnation?: string }>;
  roster?: Array<{ seatId: string; incarnation?: string | null }> | "fails";
  /** The channel rows; one channel when omitted. */
  channels?: unknown[];
  /**
   * The roster is declared only by an `agent` flow whose one session is a
   * dispatch child of the channel session, as when the viewer's only agent
   * session was spawned by a dispatch.
   */
  rosterOnChildSession?: boolean;
};

function clientsFor(lab: Lab): LabClients {
  const collections: Record<string, unknown[] | "fails"> = {
    seats: lab.seats,
    channels: lab.channels ?? [{ id: "eng.general", kind: "channel", members: [] }],
    ...(lab.roster === undefined ? {} : { roster: lab.roster }),
  };
  const rosterEntry = { kind: "collection", ref: "roster", pattern: "workforce/roster/*", scope: "org", client: { state: { read: true } } };
  const manifest = {
    resources: [
      { kind: "collection", ref: "seats", pattern: "inventory/seats/*", scope: "org", client: { state: { read: true } } },
      { kind: "collection", ref: "channels", pattern: "inventory/channels/*", scope: "org", client: { state: { read: true } } },
      ...(lab.roster === undefined || lab.rosterOnChildSession ? [] : [rosterEntry]),
    ],
  };
  const childManifest = { resources: [rosterEntry] };
  return {
    userId: "u1",
    sessions: {
      listSessions: async () => [
        { id: "s1", flowKind: "channel", parentSessionId: null, updatedAt: 0 },
        ...(lab.rosterOnChildSession ? [{ id: "s2", flowKind: "agent", parentSessionId: "s1", updatedAt: 0 }] : []),
      ],
      getSession: async () => ({ orgId: ORG }),
      getSessionState: async () => ({ items: [] }),
      listSessionRequests: async () => [],
    },
    resources: {
      getResourceManifest: async (sessionId: string) => (sessionId === "s2" ? childManifest : manifest),
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

  it("a hired seat's row is listed only while the roster row at its address carries the same incarnation", async () => {
    // `support.ada` was fired and hired again; the old hire's inventory row
    // (as a fire that stopped part-way leaves it) is not the new seat's.
    const stale = await teams({
      seats: [...declared, { id: "acme.support.ada", kind: "agent", hired: true, incarnation: "i-old" }],
      roster: [{ seatId: "support.ada", incarnation: "i-new" }],
    });
    expect(stale.seats.map((seat) => seat.id)).toEqual(["eng.lead", "chief-of-staff"]);
    const current = await teams({
      seats: [...declared, { id: "acme.support.ada", kind: "agent", hired: true, incarnation: "i-new" }],
      roster: [{ seatId: "support.ada", incarnation: "i-new" }],
    });
    expect(current.seats.map((seat) => seat.id)).toEqual(["eng.lead", "chief-of-staff", "acme.support.ada"]);
  });

  it("BR-23 · declared seats, a dotless org seat included, are listed as today", async () => {
    const value = await teams({ seats: declared });
    expect(value.seats.map((seat) => [seat.id, seat.team])).toEqual([
      ["eng.lead", "eng"],
      ["chief-of-staff", "Staff"],
    ]);
    expect(value.rosterUnread).toBeUndefined();
  });

  it("BR-23 · a declared team that shares the organization's name stays listed under its team, with no roster row", async () => {
    // Org `acme`, declared team `acme`: the id splits as an address in `acme`,
    // and only the row's `hired: false` tells it from a hire.
    const value = await teams({ seats: [...declared, { id: "acme.support", kind: "agent", hired: false }] });
    expect(value.seats.map((seat) => [seat.id, seat.team, seat.name, seat.seatId])).toEqual([
      ["eng.lead", "eng", "lead", "eng.lead"],
      ["chief-of-staff", "Staff", "chief-of-staff", "chief-of-staff"],
      ["acme.support", "acme", "support", "acme.support"],
    ]);
    expect(value.rosterUnread).toBeUndefined();
  });

  it("a user-owned hire isn't listed: its roster row is owner-private, and the incarnation on its inventory row proves no roster row is still there", async () => {
    // The state a fire leaves when it stops after deleting the owner's roster
    // row: the inventory row, incarnation and all, unchanged. Shift Manager
    // reads only what a browser can, so it can't tell that from a live hire.
    const value = await teams({
      seats: [...declared, { id: "acme.~u1.research", kind: "agent", hired: true, incarnation: "i-1" }],
      roster: [],
    });
    expect(value.seats.map((seat) => seat.id)).toEqual(["eng.lead", "chief-of-staff"]);
  });

  it("the only session on a flow that declares the roster is a dispatch child: the roster is still read, and the hired seat listed", async () => {
    const value = await teams({
      seats: [...declared, { id: "acme.support.ada", kind: "agent", hired: true, incarnation: "i-1" }],
      roster: [{ seatId: "support.ada", incarnation: "i-1" }],
      rosterOnChildSession: true,
    });
    expect(value.seats.map((seat) => seat.id)).toEqual(["eng.lead", "chief-of-staff", "acme.support.ada"]);
    expect(value.rosterUnread).toBeUndefined();
  });

  it("BR-24 · the roster read fails: hired seats aren't listed, and the section says the roster didn't load", async () => {
    const value = await teams({ seats: [...declared, { id: "acme.support.ada", kind: "agent" }], roster: "fails" });
    expect(value.seats.map((seat) => seat.id)).toEqual(["eng.lead", "chief-of-staff"]);
    expect(value.rosterUnread).toMatch(/1 hired seat isn't listed: the roster didn't load.*the roster read failed/);
  });

  it("BR-24 · a Lab whose only seats are hired, with the roster unread, says why they aren't listed rather than that it registers nothing", async () => {
    const value = await teams({ seats: [{ id: "acme.support.ada", kind: "agent", hired: true }], roster: "fails", channels: [] });
    expect(value.seats).toEqual([]);
    expect(value.rosterUnread).toMatch(/1 hired seat isn't listed: the roster didn't load.*the roster read failed/);
  });

  it("BR-24 · no listed flow declares the roster: the same", async () => {
    const value = await teams({ seats: [...declared, { id: "acme.support.ada", kind: "agent" }] });
    expect(value.seats.map((seat) => seat.id)).toEqual(["eng.lead", "chief-of-staff"]);
    expect(value.rosterUnread).toMatch(/declares the roster/);
  });
});

describe("TEAMS and a real Lab", () => {
  const served: ServedLab[] = [];
  afterEach(async () => {
    await Promise.all(served.splice(0).map((lab) => lab.handle.close()));
  });

  it("BR-23 · a declared team named like the organization is listed, by the origin its row publishes to the browser", async () => {
    // Organization `ops`, declared team `ops`: every `ops.*` seat id is also
    // an address in `ops`. The Lab declares no roster, so a row read as hired
    // would be hidden with "the roster didn't load". Only `hired: false`,
    // written by the boot and published through the collection's client
    // projection, keeps them listed.
    const opened = await openAskLab({ bearer: "ask-lab-secret", orgId: "ops" });
    const lab = await serveLab(opened.flowState);
    served.push(lab);
    const snapshot = await createLabReader(
      createLabClients({ baseUrl: lab.baseUrl, userId: ASK_LAB_USER_ID, bearerToken: "ask-lab-secret" }),
    ).read();
    if (snapshot.refused !== undefined || snapshot.unreachable !== undefined) throw new Error("not loaded");
    expect(snapshot.orgId).toBe("ops");
    if (!snapshot.inventory.ok) throw new Error(snapshot.inventory.failure.message);
    const seats = snapshot.inventory.value.seats;
    expect(seats.map((seat) => [seat.id, seat.hired, seat.team]).sort()).toEqual(
      opened.tree.workers.map((worker) => [worker.id, false, "ops"]).sort(),
    );
    expect(snapshot.inventory.value.rosterUnread).toBeUndefined();
  });
});
