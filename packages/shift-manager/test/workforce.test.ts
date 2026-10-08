/**
 * The person's workers as Shift Manager reads them, against a real Lab served
 * on a free port that runs its workers as data: one copy of `agent`, the
 * roster flow, and a standard worker.
 *
 * The Lab takes a bearer token, so a client that dropped the connection's
 * credential would be refused: the client must act as the Lab's person, with
 * the credential every other read carries.
 */
import { createBearerSecretPrincipalResolver, createFlowState, inMemoryStores, PrincipalResolutionError } from "@flow-state-dev/engine";
import type { FlowInstance } from "@flow-state-dev/core/types";
import {
  createWorkerHireBlocks,
  createWorkerInstallation,
  defineAgentWorkerFlow,
  defineWorkerRosterFlow,
} from "@flow-state-dev/workforce";
import { createWorkforceClient } from "@flow-state-dev/workforce/browser";
import { afterEach, describe, expect, it } from "vitest";
import { createLabClients } from "../src/lib/connection";
import { workforceClientFor } from "../src/lib/workforce";
import { serveLab, type ServedLab } from "./helpers/serve-lab";

const USER = "ada";
const ORG = "acme";
const SECRET = "lab-secret";

const served: ServedLab[] = [];
afterEach(async () => {
  await Promise.all(served.splice(0).map((lab) => lab.handle.close()));
});

/** A Lab running `desk.amy`, a standard worker on `agent`, as one copy of the flow. */
async function workerLab() {
  let flows: Record<string, unknown> = {};
  const installation = createWorkerInstallation({
    standardWorkers: [{ id: "desk.amy", declared: { description: "Answers the front desk." }, body: "You are Amy." }],
    workerFlows: () => flows as never,
  });
  const agent = defineAgentWorkerFlow({ installation });
  flows = { agent };
  const blocks = createWorkerHireBlocks(installation);
  const roster = defineWorkerRosterFlow(installation, {
    hire: { inputSchema: blocks.hire.inputSchema, block: blocks.hire },
    fire: { inputSchema: blocks.fire.inputSchema, block: blocks.fire },
  });
  const instances = [agent({ id: "agent" }), roster()] as unknown as FlowInstance[];
  const verify = createBearerSecretPrincipalResolver({ secret: SECRET, principal: { userId: USER, orgId: ORG } });
  const flowState = createFlowState({
    flows: Object.fromEntries(instances.map((i) => [i.id, i])),
    stores: { default: { primary: inMemoryStores() } },
    resolvePrincipal: async (context: never) => {
      const principal = await verify(context);
      if (principal === null) throw new PrincipalResolutionError("No verified principal was presented.", { status: 401 });
      return principal;
    },
  } as never);
  const lab = await serveLab(flowState);
  served.push(lab);
  return lab;
}

describe("useWorkforce's client, on a Lab that runs its workers as data", () => {
  it("lists the person's roster with each worker's flow, and opens one session per worker", async () => {
    const { baseUrl } = await workerLab();
    const workforce = workforceClientFor(createLabClients({ userId: USER, bearerToken: SECRET, baseUrl }));

    expect(await workforce.roster()).toEqual([
      { id: "desk.amy", flow: "agent", standard: true, description: "Answers the front desk." },
    ]);

    const first = await workforce.ensureWorkerSession({ worker: "desk.amy" });
    const again = await workforce.ensureWorkerSession({ worker: "desk.amy" });
    expect(first.flowKind).toBe("agent");
    expect(again.id).toBe(first.id);
    expect((await workforce.findWorkerSession({ worker: "desk.amy" }))?.id).toBe(first.id);
  });

  it("carries the connection's credential: the same client without it is refused", async () => {
    const { baseUrl } = await workerLab();
    const bare = createWorkforceClient({ userId: USER, baseUrl });
    await expect(bare.roster()).rejects.toThrow();
  });
});
