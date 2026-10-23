/**
 * The DevForce Lab's chief of staff and a project's repository: whichever way
 * it writes one, at create or later, it waits for a user in Inbox first.
 * Approve writes it; Deny writes nothing.
 *
 * A project's own coordinator manages the project it runs: it sets the
 * brief, and the repository through the same Inbox ask, without naming the
 * project, and never changes another project.
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
import { deriveWorkerSessionId } from "@flow-state-dev/workforce/browser";
import { selectHarness } from "../teams/devteam/harness.mts";
import { LAB_ORG_ID, LAB_USER_ID, openLab, type Lab } from "../teams/devteam/host.mts";

/** The chief of staff, and the flow it runs on, whose one copy every worker on it shares. */
const COS = "chief-of-staff";
const COS_FLOW = "coordinator";
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
  // Best fit's question goes unanswered (the evaluator, too, has no model here),
  // so the post reaches the chief of staff's own turn, which makes the call.
  const resolve = (_id: string, blockName?: string): GeneratorModel => {
    if (blockName === "coordinator-route-ask") throw new Error("no route model in this test");
    return model;
  };
  return Object.assign(resolve, { resolveId: (id: string) => id }) as unknown as ModelResolver;
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
    coderWorkerId: "eng.coder",
    inventory: true,
    projects: [
      { id: "storefront", title: "Storefront", repository: FIRST },
      { id: "billing", title: "Billing", brief: "Take payments." },
    ],
  });
  return opened;
}

/** Open a session on the coordinator flow as the Lab's owner. */
async function openSession(lab: Lab, sessionId: string, state: Record<string, unknown>): Promise<string> {
  const opened = await lab.door("POST", `${COS_FLOW}/sessions`, { body: { userId: LAB_USER_ID, sessionId, state } });
  expect(opened.status).toBe(201);
  return sessionId;
}

/** The Lab owner's coordinator for one shared project: its derived session, linked to the project. */
async function projectCoordinator(lab: Lab, id: string): Promise<string> {
  const projectId = { visibility: "shared" as const, id };
  const sessionId = await deriveWorkerSessionId({
    userId: LAB_USER_ID,
    orgId: LAB_ORG_ID,
    flow: COS_FLOW,
    criteria: { worker: "project-coordinator", projectId },
  });
  return openSession(lab, sessionId, { workerId: "project-coordinator", projectId: `shared/${id}` });
}

/** Ask a coordinator, as the Lab's owner, with a model that makes `call`: the chief of staff unless `session` names another's open session. */
async function run(lab: Lab, call: ToolCall, message: string, session?: string) {
  const runtime = await lab.state.getRuntime();
  model = scripted(call);
  // A conversation with the chief of staff, unless named: a session on its flow, naming it.
  const sessionId = session ?? (await openSession(lab, `s-cos-${globalThis.crypto.randomUUID()}`, { workerId: COS }));
  return await runAction({
    orgId: LAB_ORG_ID,
    flow: runtime.registry.get(COS_FLOW) as FlowInstance,
    actionName: "respond",
    input: { message },
    userId: LAB_USER_ID,
    sessionId,
    stores: runtime.stores,
    runtimeConfig: runtime.runtimeConfig,
  } as never);
}

/** Ask a coordinator, as the Lab's owner, and return its request and the one approval it raised. */
async function ask(
  lab: Lab,
  call: ToolCall,
  message: string,
  session?: string,
): Promise<{ requestId: string; suspension: SuspensionRecord }> {
  const runtime = await lab.state.getRuntime();
  const started = await run(lab, call, message, session);
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
async function projects(lab: Lab): Promise<Record<string, { repository?: string | null; brief?: string | null }>> {
  const rows = await lab.stored("org", "");
  return Object.fromEntries(
    Object.entries(rows)
      .filter(([key]) => /(^|\/)projects\/[^/]+$/.test(key))
      .map(([key, state]) => [key.slice(key.lastIndexOf("/") + 1), state as { repository?: string | null; brief?: string | null }]),
  );
}

describe("the chief of staff's repository writes wait for a user", () => {
  it("setRepository: nothing changes while it waits or on Deny; Approve writes it", async () => {
    const lab = await open();
    const call = { toolName: "setRepository", args: { project: { visibility: "shared", id: "storefront" }, repository: ASKED } };
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

  it("setRepository naming no project asks nothing and writes nothing: its conversation is no project's", async () => {
    const lab = await open();
    const done = await run(lab, { toolName: "setRepository", args: { repository: ASKED } }, "move it to the new repository");
    const runtime = await lab.state.getRuntime();
    expect(await runtime.stores.suspensions.list({ status: "pending" })).toHaveLength(0);
    expect(JSON.stringify(done)).toContain("no-such-project");
    expect((await projects(lab)).storefront?.repository).toBe(FIRST);
  }, 120_000);

  it("shows a user the remote without a password it carries", async () => {
    const lab = await open();
    const asked = await ask(
      lab,
      { toolName: "setRepository", args: { project: { visibility: "shared", id: "storefront" }, repository: "https://bot:s3cret-token@github.com/acme/storefront.git" } },
      "use the token remote",
    );
    expect(asked.suspension.message).not.toContain("s3cret-token");
    expect(JSON.stringify(asked.suspension.data)).not.toContain("s3cret-token");
    await answer(lab, asked, "reject");
  }, 120_000);
});

describe("a project's coordinator manages its own project", () => {
  const BRIEF = "Ship guest checkout before the holidays.";

  it("sets the brief at once, without naming the project", async () => {
    const lab = await open();
    const session = await projectCoordinator(lab, "storefront");
    const done = await run(lab, { toolName: "setBrief", args: { brief: BRIEF } }, "make the brief: ship guest checkout", session);
    expect(done.error).toBeUndefined();
    expect((await projects(lab)).storefront?.brief).toBe(BRIEF);
    const runtime = await lab.state.getRuntime();
    expect(await runtime.stores.suspensions.list({ status: "pending" })).toHaveLength(0);
  }, 120_000);

  it("sets the repository after the user approves it in Inbox; Deny changes nothing", async () => {
    const lab = await open();
    const call = { toolName: "setRepository", args: { repository: ASKED } };
    const session = await projectCoordinator(lab, "storefront");
    const asked = await ask(lab, call, "move storefront to the new repository", session);
    expect(asked.suspension.message).toBe(`Set the repository of project "storefront" to ${ASKED}?`);
    expect((await projects(lab)).storefront?.repository).toBe(FIRST);
    await answer(lab, asked, "reject");
    expect((await projects(lab)).storefront?.repository).toBe(FIRST);

    const again = await ask(lab, call, "move storefront to the new repository", session);
    await answer(lab, again, "approve");
    expect((await projects(lab)).storefront?.repository).toBe(ASKED);
  }, 120_000);

  it("never changes another project's brief", async () => {
    const lab = await open();
    const session = await projectCoordinator(lab, "storefront");
    const call = { toolName: "setBrief", args: { project: { visibility: "shared", id: "billing" }, brief: BRIEF } };
    await run(lab, call, "rewrite billing's brief", session);
    expect((await projects(lab)).billing?.brief).toBe("Take payments.");
  }, 120_000);

  it("never asks to set another project's repository: the write it would approve is refused", async () => {
    const lab = await open();
    const session = await projectCoordinator(lab, "storefront");
    const call = { toolName: "setRepository", args: { project: { visibility: "shared", id: "billing" }, repository: ASKED } };
    const done = await run(lab, call, "point billing at the new repository", session);
    const runtime = await lab.state.getRuntime();
    expect(await runtime.stores.suspensions.list({ status: "pending" })).toHaveLength(0);
    expect(JSON.stringify(done)).toContain("other-project");
    expect((await projects(lab)).billing?.repository ?? null).toBeNull();
  }, 120_000);
});

describe("the chief of staff's roster writes", () => {
  /** The user's own workers, by id, as their roster holds them. */
  async function roster(lab: Lab): Promise<string[]> {
    const rows = await lab.stored("user", "workforce/workers/");
    return Object.keys(rows).map((key) => key.slice("workforce/workers/".length)).sort();
  }

  it("hires a worker of the user's own at once; a fire waits for them, Deny keeps it, Approve removes it", async () => {
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
