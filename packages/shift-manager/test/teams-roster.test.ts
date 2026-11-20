/**
 * TEAMS lists every worker the organization's inventory registers: the
 * standard workers its files declare, each under its team.
 *
 * A fake Lab behind the client: the rows the inventory holds, read by org
 * scope. Then a real Lab, served.
 */
import { afterEach, describe, expect, it } from "vitest";
import type { Client } from "@flow-state-dev/client";
import { connect } from "../src/lib/connection";
import { createWorkforceClient, workerInventoryResource } from "@flow-state-dev/workforce/browser";
import { toWorker, type Worker } from "../src/lib/workers";
import { ASK_LAB_USER_ID, openAskLab } from "./fixtures/ask-lab/lab.mts";
import { serveLab, type ServedLab } from "./helpers/serve-lab";


type Lab = {
  workers: Array<{ id: string; kind: string }>;
};

function clientsFor(lab: Lab): Client {
  return {
    userId: "u1",
    // The inventory is read by org scope (FIX-2624).
    resource: (def: { scope: string; pattern?: string }) => {
      const items = () =>
        def.scope === "org" && def.pattern === "inventory/workers/*"
          ? lab.workers.map((data, i) => ({ topic: `workers-${i}`, storageKey: `inventory/workers/${data.id}`, value: data, version: 1 }))
          : [];
      // Every page is one page here: `listAll()` is what the inventory is read whole by.
      return { list: async () => ({ items: items() }), listAll: async () => items() };
    },
  } as unknown as Client;
}

/** The organization's workers, as the directory reads them (`directory-reads.ts`): the inventory read whole, each row parsed. */
async function inventoryOf(client: Client): Promise<{ workers: Worker[] }> {
  const rows = await client.resource(workerInventoryResource).listAll();
  return { workers: rows.flatMap((row) => toWorker(row.value) ?? []) };
}

async function teams(lab: Lab) {
  return inventoryOf(clientsFor(lab));
}

describe("TEAMS", () => {
  it("lists every registered worker, a dotless org worker under General", async () => {
    const value = await teams({
      workers: [
        { id: "eng.lead", kind: "agent" },
        { id: "shift-coordinator", kind: "agent" },
        // A team named like the organization is a team like any other.
        { id: "acme.support", kind: "agent" },
      ],
    });
    expect(value.workers.map((worker) => [worker.id, worker.team, worker.name])).toEqual([
      ["eng.lead", "eng", "lead"],
      ["shift-coordinator", "_general", "shift-coordinator"],
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
    const client = connect({ baseUrl: lab.baseUrl, userId: ASK_LAB_USER_ID, bearerToken: "ask-lab-secret" });
    // The organization the gate reads, and the inventory read under it.
    expect(await createWorkforceClient(client).organization()).toBe("ops");
    const { workers } = await inventoryOf(client);
    expect(workers.map((worker) => [worker.id, worker.team]).sort()).toEqual(
      opened.tree.workers.map((worker) => [worker.id, "ops"]).sort(),
    );
  });

  it("names each worker and team by the display names its files declare, and a worker that declares none by its id", async () => {
    const opened = await openAskLab({ bearer: "ask-lab-secret", orgId: "ops" });
    const lab = await serveLab(opened.flowState);
    served.push(lab);
    const { workers } = await inventoryOf(connect({ baseUrl: lab.baseUrl, userId: ASK_LAB_USER_ID, bearerToken: "ask-lab-secret" }));
    const byId = new Map(workers.map((worker) => [worker.id, worker]));
    // `asker/WORKER.md` declares `name: Asker`; `ops/TEAM.md` declares `name: Operations`.
    expect(byId.get("ops.asker")).toMatchObject({ displayName: "Asker", teamName: "Operations" });
    expect(byId.get("ops.desk")).toMatchObject({ displayName: "ops.desk", teamName: "Operations" });
  });
});
