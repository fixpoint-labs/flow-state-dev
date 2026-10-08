/**
 * The DevTeam's chief of staff as a coordinator (FIX-1791 S10), on the real
 * Lab: its file names `flow: coordinator`, `routing: judgment` and standard
 * workers as default delegates; its judgment is the agent's own turn, with its
 * hire and the delegate tools; and a post it hands off is answered in its
 * conversation under the delegate's name.
 *
 * The model is scripted by block: the chief of staff's judgment
 * (`coordinator-judgment`) makes the tool calls a test names, then stops; an
 * `agent` worker's turn (`agent-answer`) answers with a fixed line.
 *
 * Checks (`specs/issues/FIX-1791/BUSINESS-RULES.md`): BR-33 (the chief of
 * staff runs on the coordinator flow, routing by judgment), BR-34's
 * mechanism (hire, add, hand off), BR-10 (its delegate read is the
 * conversation's list), and BR-9's record of a default that can't take a post.
 */
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { FlowInstance, GeneratorModel, ModelResolver } from "@flow-state-dev/core/types";
import { inMemoryStores, runAction } from "@flow-state-dev/engine";
import { selectHarness } from "../teams/devteam/harness.mts";
import { LAB_ORG_ID, LAB_USER_ID, openLab, type Lab } from "../teams/devteam/host.mts";
import { createNotifyLog } from "../teams/devteam/notify.mts";

const COS = "chief-of-staff";

let opened: Lab | undefined;
afterEach(async () => {
  await opened?.dispose();
  opened = undefined;
});

type ToolCall = { toolName: string; args: Record<string, unknown> };

/** The judgment's tool calls, one per step, then a closing line; an agent worker's turn answers with a fixed line. */
function scripted(calls: ToolCall[]): ModelResolver {
  // One call per step, each after the last one's result: a later call depends on an earlier one.
  let step = 0;
  const judgment: GeneratorModel = {
    modelId: "test/judgment",
    async generate() {
      throw new Error("the owned tool loop calls generateStep");
    },
    async generateStep() {
      const call = calls[step];
      step += 1;
      if (call === undefined) return { text: "Handed on.", finishReason: "stop" };
      return { toolCalls: [{ toolCallId: `t${step}`, ...call }], finishReason: "tool-calls" };
    },
  };
  const helper: GeneratorModel = {
    modelId: "test/helper",
    async generate() {
      throw new Error("the owned tool loop calls generateStep");
    },
    async generateStep() {
      return { text: "The licenses are all MIT.", finishReason: "stop" };
    },
  };
  return Object.assign((_id: string, block?: string) => (block?.startsWith("coordinator-judgment") ? judgment : helper), {
    resolveId: (id: string) => id,
  }) as unknown as ModelResolver;
}

let model: ModelResolver | undefined;

async function open(): Promise<Lab> {
  const harness = selectHarness();
  opened = await openLab({
    modelResolver: Object.assign((...args: Parameters<ModelResolver>) => model!(...args), { resolveId: (id: string) => id }),
    stores: inMemoryStores(),
    harness: harness.slot,
    runTimeoutMs: harness.runTimeoutMs,
    workspace: { root: mkdtempSync(join(tmpdir(), "devteam-cos-coordinator-")), remotes: { allow: ["file"] } },
    coderSeatId: "eng.coder",
    mailboxes: { addresses: {}, log: createNotifyLog() },
    inventory: true,
  });
  return opened;
}

/** A conversation with the chief of staff, opened as an app does: a session on its flow, naming it. */
async function conversation(lab: Lab): Promise<string> {
  const sessionId = `s-cos-${globalThis.crypto.randomUUID()}`;
  const created = await lab.door("POST", `coordinator/sessions`, {
    body: { userId: LAB_USER_ID, sessionId, state: { workerId: COS } },
  });
  expect(created.status).toBe(201);
  return sessionId;
}

async function act(lab: Lab, sessionId: string, actionName: string, input: unknown) {
  const runtime = await lab.state.getRuntime();
  return (await runAction({
    orgId: LAB_ORG_ID,
    flow: runtime.registry.get("coordinator") as FlowInstance,
    actionName,
    input,
    userId: LAB_USER_ID,
    sessionId,
    stores: runtime.stores,
    runtimeConfig: runtime.runtimeConfig,
  } as never)) as { output?: any; error?: unknown };
}

/** The conversation's items, once nothing in the Lab is still running. */
async function settledItems(lab: Lab, sessionId: string) {
  const runtime = await lab.state.getRuntime();
  const deadline = Date.now() + 10_000;
  while ((await runtime.stores.request.list({})).some((r) => r.status === "in_progress" || r.status === "queued")) {
    if (Date.now() > deadline) throw new Error("a request never finished");
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  const requests = await runtime.stores.request.list({ sessionId, withItems: true });
  return requests.sort((a, b) => a.createdAt - b.createdAt).flatMap((r) => ((r as unknown as { items?: any[] }).items ?? []));
}

describe("the chief of staff as a coordinator (S10)", () => {
  it("runs on the coordinator flow, by judgment, its delegates starting from the standard workers its file names (BR-33, BR-10)", async () => {
    const lab = await open();
    const runtime = await lab.state.getRuntime();
    expect(runtime.registry.get("coordinator")).toBeDefined();
    const id = await conversation(lab);
    const listed = await act(lab, id, "listDelegates", {});
    expect(listed.error).toBeUndefined();
    expect(listed.output.delegates).toEqual([{ worker: "eng.em" }, { worker: "eng.coder" }]);
    // The agent flow refuses it: a session names the flow its worker runs on.
    const onAgent = await lab.door("POST", `agent/sessions`, { body: { userId: LAB_USER_ID, state: { workerId: COS } } });
    expect(onAgent.status).toBe(400);
  });

  it("hires a worker, adds it, and hands it the post, whose answer lands under its name (BR-34's mechanism, BR-20)", async () => {
    const lab = await open();
    const id = await conversation(lab);
    model = scripted([
      { toolName: "hire", args: { id: "licenses", flow: "agent", description: "Audits dependency licenses." } },
      { toolName: "addDelegate", args: { worker: "licenses" } },
      { toolName: "handOff", args: { worker: "licenses" } },
    ]);
    const turn = await act(lab, id, "run", { message: "audit our dependencies' licenses" });
    expect(turn.error).toBeUndefined();
    const items = await settledItems(lab, id);
    const answer = items.find((item) => item.type === "message" && item.agentName === "licenses");
    expect(answer).toBeDefined();
    const [record] = items.filter((item) => item.type === "component" && item.component === "coordinator-route");
    expect(record.data).toMatchObject({ by: "judgment", delegates: [{ worker: "licenses", outcome: "delivered" }] });
    expect((await act(lab, id, "listDelegates", {})).output.delegates.map((d: { worker: string }) => d.worker)).toEqual([
      "eng.em",
      "eng.coder",
      "licenses",
    ]);
  });

  it("records a default delegate whose flow can't take a post as skipped, with why (BR-9)", async () => {
    const lab = await open();
    const id = await conversation(lab);
    model = scripted([{ toolName: "handOff", args: { worker: "eng.em" } }]);
    expect((await act(lab, id, "run", { message: "plan the release" })).error).toBeUndefined();
    const items = await settledItems(lab, id);
    const [record] = items.filter((item) => item.type === "component" && item.component === "coordinator-route");
    expect(record.data.delegates).toEqual([
      { worker: "eng.em", outcome: "skipped", reason: 'Worker "eng.em" runs on flow "em", which can\'t take a delegated post.' },
    ]);
  });
});
