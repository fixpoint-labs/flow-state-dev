/**
 * TEAMS lists every seat the organization's inventory registers: the
 * standard workers its files declare, each under its team.
 *
 * A fake Lab behind the clients: one session, one manifest that declares the
 * inventory, and the rows each collection holds. Then a real Lab, served.
 */
import { afterEach, describe, expect, it } from "vitest";
import { createLabClients, type LabClients } from "../src/lib/connection";
import { createLabReader, type LabSnapshot } from "../src/lib/reads";
import { ASK_LAB_USER_ID, openAskLab } from "./fixtures/ask-lab/lab.mts";
import { serveLab, type ServedLab } from "./helpers/serve-lab";

const ORG = "acme";

type Lab = {
  seats: Array<{ id: string; kind: string }>;
  /** The mailbox rows; one mailbox when omitted. */
  mailboxes?: unknown[];
};

function clientsFor(lab: Lab): LabClients {
  const collections: Record<string, unknown[]> = {
    seats: lab.seats,
    mailboxes: lab.mailboxes ?? [{ id: "eng.general", kind: "mailbox", members: [] }],
  };
  const manifest = {
    resources: [
      { kind: "collection", ref: "seats", pattern: "inventory/seats/*", scope: "org", client: { state: { read: true } } },
      { kind: "collection", ref: "mailboxes", pattern: "inventory/mailboxes/*", scope: "org", client: { state: { read: true } } },
    ],
  };
  return {
    userId: "u1",
    sessions: {
      listSessions: async () => [{ id: "s1", flowKind: "mailbox", parentSessionId: null, updatedAt: 0 }],
      getSession: async () => ({ orgId: ORG }),
      getSessionState: async () => ({ items: [] }),
      listSessionRequests: async () => [],
    },
    resources: {
      getResourceManifest: async () => manifest,
      listCollectionItems: async (_sessionId: string, ref: string) => {
        const rows = collections[ref];
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

describe("TEAMS", () => {
  it("lists every registered seat, a dotless org seat under Staff", async () => {
    const value = await teams({
      seats: [
        { id: "eng.lead", kind: "agent" },
        { id: "chief-of-staff", kind: "agent" },
        // A team named like the organization is a team like any other.
        { id: "acme.support", kind: "agent" },
      ],
    });
    expect(value.seats.map((seat) => [seat.id, seat.team, seat.name])).toEqual([
      ["eng.lead", "eng", "lead"],
      ["chief-of-staff", "Staff", "chief-of-staff"],
      ["acme.support", "acme", "support"],
    ]);
  });
});

describe("TEAMS and a real Lab", () => {
  const served: ServedLab[] = [];
  afterEach(async () => {
    await Promise.all(served.splice(0).map((lab) => lab.handle.close()));
  });

  it("lists each worker the Lab's files declare under its team, as the inventory publishes it to the browser", async () => {
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
    expect(seats.map((seat) => [seat.id, seat.team]).sort()).toEqual(
      opened.tree.workers.map((worker) => [worker.id, "ops"]).sort(),
    );
  });
});
