/**
 * The DevForce Lab's chief of staff and a project's repository: whichever way
 * it writes one, at create or later, it waits for a person in Inbox first.
 * Approve writes it; Deny writes nothing.
 *
 * The Lab is opened the way DevTeam's config opens it, with its default
 * projects. The chief of staff's model is scripted to make one tool call, so
 * no key is needed; the answer goes through the engine's own resume route,
 * as Inbox sends it.
 */
import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { FlowInstance, GeneratorModel, ModelResolver, SuspensionRecord } from "@flow-state-dev/core/types";
import { inMemoryStores, runAction } from "@flow-state-dev/engine";
import { selectHarness } from "../teams/devteam/harness.mts";
import { LAB_ORG_ID, LAB_USER_ID, openLab, type Lab } from "../teams/devteam/host.mts";
import { createNotifyLog } from "../teams/devteam/notify.mts";

/** The chief of staff, and the flow it runs on, whose one copy every worker on it shares. */
const COS = "chief-of-staff";
const COS_FLOW = "agent";
const FIRST = "https://github.com/acme/storefront.git";
const ASKED = "git@github.com:acme/storefront-next.git";

let opened: Lab | undefined;
afterEach(async () => {
  await opened?.dispose();
  opened = undefined;
});

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
  return Object.assign(() => model, { resolveId: (id: string) => id }) as unknown as ModelResolver;
}

type ToolCall = { toolName: string; args: Record<string, unknown> };

/**
 * The model the next request resolves, set by {@link run}. Handed to the Lab
 * once, so the resume route answers with it too.
 */
let model: ModelResolver | undefined;

async function open(): Promise<Lab> {
  const harness = selectHarness();
  opened = await openLab({
    modelResolver: Object.assign((...args: Parameters<ModelResolver>) => model!(...args), { resolveId: (id: string) => id }),
    stores: inMemoryStores(),
    harness: harness.slot,
    runTimeoutMs: harness.runTimeoutMs,
    workspace: { root: mkdtempSync(join(tmpdir(), "devteam-repository-ask-")), remotes: { allow: ["file"] } },
    coderSeatId: "eng.coder",
    mailboxes: { addresses: {}, log: createNotifyLog() },
    inventory: true,
    projects: [{ id: "storefront", title: "Storefront", workstreams: ["eng.feature"], repository: FIRST }],
  });
  return opened;
}

/** Ask the chief of staff, as the Lab's owner, with a model that makes `call`. */
async function run(lab: Lab, call: ToolCall, message: string) {
  const runtime = await lab.state.getRuntime();
  model = scripted(call);
  // A conversation with the chief of staff: a session on its flow, naming it.
  const sessionId = `s-cos-${globalThis.crypto.randomUUID()}`;
  const opened = await lab.door("POST", `${COS_FLOW}/sessions`, {
    body: { userId: LAB_USER_ID, sessionId, state: { workerId: COS } },
  });
  expect(opened.status).toBe(201);
  return await runAction({
    orgId: LAB_ORG_ID,
    flow: runtime.registry.get(COS_FLOW) as FlowInstance,
    actionName: "run",
    input: { message },
    userId: LAB_USER_ID,
    sessionId,
    stores: runtime.stores,
    runtimeConfig: runtime.runtimeConfig,
  } as never);
}

/** Ask the chief of staff, as the Lab's owner, and return its request and the one approval it raised. */
async function ask(lab: Lab, call: ToolCall, message: string): Promise<{ requestId: string; suspension: SuspensionRecord }> {
  const runtime = await lab.state.getRuntime();
  const started = await run(lab, call, message);
  expect((await runtime.stores.request.get(started.requestId!))?.status).toBe("suspended");
  const pending = (await runtime.stores.suspensions.list({ status: "pending" })) as SuspensionRecord[];
  expect(pending).toHaveLength(1);
  expect(pending[0]!.reason).toBe("human_approval");
  return { requestId: started.requestId!, suspension: pending[0]! };
}

/** Answer through the resume route, as Inbox does, and wait for the request to finish. */
async function answer(lab: Lab, asked: { requestId: string; suspension: SuspensionRecord }, action: "approve" | "reject") {
  const sent = await lab.door("POST", `${COS_FLOW}/requests/${asked.requestId}/resume`, {
    body: { suspensionId: asked.suspension.suspensionId, action },
  });
  expect(sent.status).toBe(202);
  const runtime = await lab.state.getRuntime();
  for (let i = 0; i < 400; i += 1) {
    const status = String((await runtime.stores.request.get(asked.requestId))?.status);
    if (status !== "suspended" && status !== "in_progress") return status;
    await new Promise((r) => setTimeout(r, 25));
  }
  throw new Error("the answered request never finished");
}

/** The stored project rows, by id. */
async function projects(lab: Lab): Promise<Record<string, { repository?: string | null }>> {
  const rows = await lab.stored("org", "");
  return Object.fromEntries(
    Object.entries(rows)
      .filter(([key]) => /(^|\/)projects\/[^/]+$/.test(key))
      .map(([key, state]) => [key.slice(key.lastIndexOf("/") + 1), state as { repository?: string | null }]),
  );
}

describe("the chief of staff's repository writes wait for a person", () => {
  it("setRepository: nothing changes while it waits or on Deny; Approve writes it", async () => {
    const lab = await open();
    const call = { toolName: "setRepository", args: { projectId: "storefront", repository: ASKED } };
    const asked = await ask(lab, call, "move storefront to the new repository");
    expect(asked.suspension.message).toContain(ASKED);
    expect((await projects(lab)).storefront?.repository).toBe(FIRST);

    await answer(lab, asked, "reject");
    expect((await projects(lab)).storefront?.repository).toBe(FIRST);

    const again = await ask(lab, call, "move storefront to the new repository");
    await answer(lab, again, "approve");
    expect((await projects(lab)).storefront?.repository).toBe(ASKED);
  }, 120_000);

  it("createProject with a repository: Deny creates nothing; without one it does not ask", async () => {
    const lab = await open();
    const asked = await ask(
      lab,
      { toolName: "createProject", args: { id: "checkout", title: "Checkout", repository: ASKED } },
      "start a checkout project on that repository",
    );
    expect(asked.suspension.message).toContain('"checkout"');
    expect((await projects(lab)).checkout).toBeUndefined();
    await answer(lab, asked, "reject");
    expect((await projects(lab)).checkout).toBeUndefined();

    await run(lab, { toolName: "createProject", args: { id: "notes", title: "Notes" } }, "start a notes project");
    const runtime = await lab.state.getRuntime();
    expect(await runtime.stores.suspensions.list({ status: "pending" })).toHaveLength(0);
    expect((await projects(lab)).notes).toMatchObject({ repository: null });
  }, 120_000);

  it("shows a person the remote without a password it carries", async () => {
    const lab = await open();
    const asked = await ask(
      lab,
      { toolName: "setRepository", args: { projectId: "storefront", repository: "https://bot:s3cret-token@github.com/acme/storefront.git" } },
      "use the token remote",
    );
    expect(asked.suspension.message).not.toContain("s3cret-token");
    expect(JSON.stringify(asked.suspension.data)).not.toContain("s3cret-token");
    await answer(lab, asked, "reject");
  }, 120_000);
});

describe("the chief of staff's roster writes", () => {
  /** The person's own workers, by id, as their roster holds them. */
  async function roster(lab: Lab): Promise<string[]> {
    const rows = await lab.stored("user", "workforce/workers/");
    return Object.keys(rows).map((key) => key.slice("workforce/workers/".length)).sort();
  }

  it("hires a worker of the person's own at once; a fire waits for them, Deny keeps it, Approve removes it", async () => {
    const lab = await open();
    const hired = await run(lab, { toolName: "hire", args: { id: "helper", flow: "agent" } }, "hire me a helper");
    expect(hired.error).toBeUndefined();
    expect(await roster(lab)).toEqual(["helper"]);

    const call = { toolName: "fire", args: { id: "helper" } };
    const asked = await ask(lab, call, "fire the helper");
    expect(asked.suspension.message).toContain('"helper"');
    expect(await roster(lab)).toEqual(["helper"]);
    await answer(lab, asked, "reject");
    expect(await roster(lab)).toEqual(["helper"]);

    const again = await ask(lab, call, "fire the helper");
    await answer(lab, again, "approve");
    expect(await roster(lab)).toEqual([]);
  }, 120_000);
});
