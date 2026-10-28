/**
 * A Lab on in-memory stores holds an ask from a worker hired after it opened.
 *
 * The tree here gives no worker a tool that asks first: the Shift Coordinator can
 * hire but not fire, and the project writes are off. A worker hired with
 * `fire` in its settings still asks before it fires, so the Lab must hold that
 * ask on its in-memory stores, not fail it for want of durable execution.
 */
import { afterEach, describe, expect, it } from "vitest";
import { cpSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { FlowInstance, GeneratorModel, ModelResolver, SuspensionRecord } from "@flow-state-dev/core/types";
import { inMemoryStores, runAction } from "@flow-state-dev/engine";
import { selectHarness } from "../teams/devteam/harness.mts";
import { LAB_ORG_ID, LAB_TREE, LAB_USER_ID, openLab, type Lab } from "../teams/devteam/host.mts";

const FLOW = "coordinator";

let opened: Lab | undefined;
afterEach(async () => {
  await opened?.dispose();
  opened = undefined;
});

/** The Lab's own tree, with the Shift Coordinator's `fire` taken away. */
function treeWithoutFire(): string {
  const root = join(mkdtempSync(join(tmpdir(), "sm-hired-ask-tree-")), "workforce");
  cpSync(LAB_TREE, root, { recursive: true });
  const file = join(root, "org/workers/shift-coordinator/WORKER.md");
  const before = readFileSync(file, "utf8");
  const after = before.replace(/^tools: \[hire, fire, /m, "tools: [hire, ");
  if (after === before) throw new Error("the Shift Coordinator's tools line changed; update this test's tree");
  writeFileSync(file, after);
  return root;
}

/** A model that makes `call` once, then stops. */
function scripted(call: { toolName: string; args: Record<string, unknown> }): ModelResolver {
  let made = false;
  const model: GeneratorModel = {
    modelId: "test/step",
    async generate() {
      throw new Error("the owned tool loop calls generateStep");
    },
    async generateStep() {
      if (made) return { text: "done", finishReason: "stop" };
      made = true;
      return { toolCalls: [{ toolCallId: "t1", ...call }], finishReason: "tool-calls" };
    },
  };
  const resolve = (_id: string, blockName?: string): GeneratorModel => {
    if (blockName === "coordinator-route-ask") throw new Error("no route model in this test");
    return model;
  };
  return Object.assign(resolve, { resolveId: (id: string) => id }) as unknown as ModelResolver;
}

let model: ModelResolver | undefined;

/** One turn of `workerId`, whose model makes `call`. */
async function run(lab: Lab, workerId: string, call: { toolName: string; args: Record<string, unknown> }, message: string) {
  const runtime = await lab.state.getRuntime();
  model = scripted(call);
  const sessionId = `s-${workerId}-${globalThis.crypto.randomUUID()}`;
  const session = await lab.door("POST", `${FLOW}/sessions`, { body: { userId: LAB_USER_ID, sessionId, state: { workerId } } });
  expect(session.status).toBe(201);
  return await runAction({
    orgId: LAB_ORG_ID,
    flow: runtime.registry.get(FLOW) as FlowInstance,
    actionName: "respond",
    input: { message },
    userId: LAB_USER_ID,
    sessionId,
    stores: runtime.stores,
    runtimeConfig: runtime.runtimeConfig,
  } as never);
}

describe("a worker hired after the Lab opened", () => {
  it("asks before it fires, held on in-memory stores, though no worker held an ask-first tool at open", async () => {
    const harness = selectHarness();
    opened = await openLab({
      modelResolver: Object.assign((...args: Parameters<ModelResolver>) => model!(...args), { resolveId: (id: string) => id }),
      stores: inMemoryStores(),
      root: treeWithoutFire(),
      withoutProjectTools: true,
      harness: harness.slot,
      runTimeoutMs: harness.runTimeoutMs,
      workspace: { root: mkdtempSync(join(tmpdir(), "sm-hired-ask-")), remotes: { allow: ["file"] } },
      coderWorkerId: "eng.coder",
    });
    const lab = opened;

    const hired = await run(
      lab,
      "shift-coordinator",
      { toolName: "hire", args: { id: "helper", flow: FLOW, settings: { tools: ["fire"] } } },
      "hire a helper that can fire",
    );
    expect(hired.error).toBeUndefined();

    const fired = await run(lab, "helper", { toolName: "fire", args: { id: "helper" } }, "fire yourself");
    const runtime = await lab.state.getRuntime();
    expect((await runtime.stores.request.get(fired.requestId!))?.status).toBe("suspended");
    const pending = (await runtime.stores.suspensions.list({ status: "pending" })) as SuspensionRecord[];
    expect(pending.map((record) => record.message)).toEqual(['Fire worker "helper"?']);
  }, 120_000);
});
