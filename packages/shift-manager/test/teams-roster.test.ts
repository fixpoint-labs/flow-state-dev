/**
 * TEAMS lists every worker the organization's inventory registers: the
 * standard workers its files declare, each under its team.
 *
 * A fake Lab behind the client: one session, one manifest that declares the
 * inventory, and the rows each collection holds. Then a real Lab, served.
 */
import { afterEach, describe, expect, it } from "vitest";
import type { Client } from "@flow-state-dev/client";
import { connect } from "../src/lib/connection";
import { createLabReader, type LabSnapshot } from "../src/lib/reads";
import { ASK_LAB_USER_ID, openAskLab } from "./fixtures/ask-lab/lab.mts";
import { serveLab, type ServedLab } from "./helpers/serve-lab";

const ORG = "acme";

type Lab = {
  workers: Array<{ id: string; kind: string }>;
};

function clientsFor(lab: Lab): Client {
  const collections: Record<string, unknown[]> = {
    workers: lab.workers,
  };
  const manifest = {
    resources: [
      { kind: "collection", ref: "workers", pattern: "inventory/workers/*", scope: "org", client: { state: { read: true } } },
    ],
  };
  return {
    userId: "u1",
    sessions: {
      list: async () => [{ id: "s1", flowKind: "workforce-roster", parentSessionId: null, updatedAt: 0 }],
      get: async () => ({ orgId: ORG }),
      state: async () => ({ items: [] }),
      requests: async () => [],
    },
    resources: {
      getResourceManifest: async () => manifest,
      listCollectionItems: async (_sessionId: string, ref: string) => {
        const rows = collections[ref];
        return { items: (rows ?? []).map((data, i) => ({ topic: `${ref}-${i}`, clientData: data })) };
      },
    },
  } as unknown as Client;
}

async function teams(lab: Lab) {
  const snapshot: LabSnapshot = await createLabReader(clientsFor(lab)).read();
  if (snapshot.refused !== undefined || snapshot.unreachable !== undefined) throw new Error("not loaded");
  if (!snapshot.inventory.ok) throw new Error(snapshot.inventory.failure.message);
  return snapshot.inventory.value;
}

describe("TEAMS", () => {
  it("lists every registered worker, a dotless org worker under General", async () => {
    const value = await teams({
      workers: [
        { id: "eng.lead", kind: "agent" },
        { id: "chief-of-staff", kind: "agent" },
        // A team named like the organization is a team like any other.
        { id: "acme.support", kind: "agent" },
      ],
    });
    expect(value.workers.map((worker) => [worker.id, worker.team, worker.name])).toEqual([
      ["eng.lead", "eng", "lead"],
      ["chief-of-staff", "_general", "chief-of-staff"],
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
      connect({ baseUrl: lab.baseUrl, userId: ASK_LAB_USER_ID, bearerToken: "ask-lab-secret" }),
    ).read();
    if (snapshot.refused !== undefined || snapshot.unreachable !== undefined) throw new Error("not loaded");
    expect(snapshot.orgId).toBe("ops");
    if (!snapshot.inventory.ok) throw new Error(snapshot.inventory.failure.message);
    const workers = snapshot.inventory.value.workers;
    expect(workers.map((worker) => [worker.id, worker.team]).sort()).toEqual(
      opened.tree.workers.map((worker) => [worker.id, "ops"]).sort(),
    );
  });

  it("names each worker and team by the display names its files declare, and a worker that declares none by its id", async () => {
    const opened = await openAskLab({ bearer: "ask-lab-secret", orgId: "ops" });
    const lab = await serveLab(opened.flowState);
    served.push(lab);
    const snapshot = await createLabReader(
      connect({ baseUrl: lab.baseUrl, userId: ASK_LAB_USER_ID, bearerToken: "ask-lab-secret" }),
    ).read();
    if (snapshot.refused !== undefined || snapshot.unreachable !== undefined) throw new Error("not loaded");
    if (!snapshot.inventory.ok) throw new Error(snapshot.inventory.failure.message);
    const byId = new Map(snapshot.inventory.value.workers.map((worker) => [worker.id, worker]));
    // `asker/WORKER.md` declares `name: Asker`; `ops/TEAM.md` declares `name: Operations`.
    expect(byId.get("ops.asker")).toMatchObject({ displayName: "Asker", teamName: "Operations" });
    expect(byId.get("ops.desk")).toMatchObject({ displayName: "ops.desk", teamName: "Operations" });
  });
});
