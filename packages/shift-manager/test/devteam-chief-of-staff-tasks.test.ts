/**
 * The DevTeam's chief of staff files tasks (FIX-1794 S11), on the real Lab:
 * its turn carries Orchestration's task tools once each, and a task it files
 * for one of its delegates runs in a task session of the person's and is
 * heard back in the conversation once.
 *
 * The model is scripted by block: the chief of staff's judgment
 * (`coordinator-judgment`) makes the tool calls a test names, then answers;
 * an `agent` worker's turn (`agent-answer`) answers with a fixed line.
 *
 * The chief of staff keeps its memory to its own flow (`isolateUserState`),
 * and the task session runs on `agent`, which doesn't: the conversation's
 * board has to sit where both read it, or every task it files fails at the
 * task session's gate.
 */
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { GeneratorTool } from "@flow-state-dev/core";
import type { FlowInstance, GeneratorModel, ModelResolver } from "@flow-state-dev/core/types";
import { inMemoryStores, runAction } from "@flow-state-dev/engine";
import { createTaskToolsCapability } from "@flow-state-dev/orchestration";
import { LIST_TASKS_ACTION } from "../src/lib/conversation-tasks";
import { selectHarness } from "../teams/devteam/harness.mts";
import { LAB_ORG_ID, LAB_USER_ID, openLab, type Lab } from "../teams/devteam/host.mts";
import { createNotifyLog } from "../teams/devteam/notify.mts";

const COS = "chief-of-staff";
const DELEGATE_ANSWER = "The licenses are all MIT.";

let opened: Lab | undefined;
afterEach(async () => {
  await opened?.dispose();
  opened = undefined;
});

type ToolCall = { toolName: string; args: Record<string, unknown> };

/**
 * The judgment's tool calls, one per step, then a closing line; it records
 * the tool names each step was handed. An `agent` worker's turn answers with
 * a fixed line.
 */
function scripted(calls: ToolCall[], seen: string[][] = []): ModelResolver {
  let step = 0;
  const judgment: GeneratorModel = {
    modelId: "test/judgment",
    async generate() {
      throw new Error("the owned tool loop calls generateStep");
    },
    async generateStep(options: { tools?: Array<{ name: string }> }) {
      seen.push((options.tools ?? []).map((tool) => tool.name));
      const call = calls[step];
      step += 1;
      if (call === undefined) return { text: "Noted.", finishReason: "stop" };
      return { toolCalls: [{ toolCallId: `t${step}`, ...call }], finishReason: "tool-calls" };
    },
  };
  const helper: GeneratorModel = {
    modelId: "test/helper",
    async generate() {
      throw new Error("the owned tool loop calls generateStep");
    },
    async generateStep() {
      return { text: DELEGATE_ANSWER, finishReason: "stop" };
    },
  };
  return Object.assign((_id: string, block?: string) => (block?.startsWith("coordinator-judgment") ? judgment : helper), {
    resolveId: (id: string) => id,
  }) as unknown as ModelResolver;
}

async function open(model: ModelResolver): Promise<Lab> {
  const harness = selectHarness();
  opened = await openLab({
    modelResolver: model,
    stores: inMemoryStores(),
    harness: harness.slot,
    runTimeoutMs: harness.runTimeoutMs,
    workspace: { root: mkdtempSync(join(tmpdir(), "devteam-cos-tasks-")), remotes: { allow: ["file"] } },
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

async function act(lab: Lab, sessionId: string, actionName: string, input: unknown, flow = "coordinator") {
  const runtime = await lab.state.getRuntime();
  return (await runAction({
    orgId: LAB_ORG_ID,
    flow: runtime.registry.get(flow) as FlowInstance,
    actionName,
    input,
    userId: LAB_USER_ID,
    sessionId,
    stores: runtime.stores,
    runtimeConfig: runtime.runtimeConfig,
  } as never)) as { output?: any; error?: unknown };
}

/** Poll `read` until `done` holds of it, or fail naming `what`. */
async function until<T>(read: () => Promise<T>, done: (value: T) => boolean, what: string): Promise<T> {
  let last: T = await read();
  for (const deadline = Date.now() + 10_000; !done(last); last = await read()) {
    if (Date.now() > deadline) throw new Error(`${what}: still ${JSON.stringify(last)}`);
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  return last;
}

/** Wait until nothing in the Lab is running or waiting to run. */
async function quiet(lab: Lab): Promise<void> {
  const runtime = await lab.state.getRuntime();
  await until(
    async () => (await runtime.stores.request.list({})).filter((r) => ["pending", "queued", "in_progress"].includes(r.status)).length,
    (running) => running === 0,
    "requests still running",
  );
}

/** The conversation's message items, oldest first. */
async function messages(lab: Lab, sessionId: string) {
  const runtime = await lab.state.getRuntime();
  const requests = await runtime.stores.request.list({ sessionId, withItems: true });
  return requests
    .sort((a, b) => a.createdAt - b.createdAt)
    .flatMap((r) => ((r as unknown as { items?: any[] }).items ?? []))
    .filter((item) => item.type === "message")
    .map((item) => ({ agentName: item.agentName as string | undefined, text: textOf(item) }));
}

/** The task-board capability's own tool names, from a fresh instance: never a count. */
function taskToolNames(): string[] {
  const capability = createTaskToolsCapability() as unknown as {
    __presetDefs?: { tools?: { controlTools?: GeneratorTool[] } };
  };
  const names = (capability.__presetDefs?.tools?.controlTools ?? []).map((tool) => tool.config?.name ?? tool.name);
  expect(names.length).toBeGreaterThan(0);
  return names;
}

describe("the chief of staff files tasks (FIX-1794 S11)", () => {
  it("carries each of the task tools exactly once on its turn", async () => {
    const seen: string[][] = [];
    const lab = await open(scripted([], seen));
    const id = await conversation(lab);
    expect((await act(lab, id, "run", { message: "what's on my board?" })).error).toBeUndefined();
    expect(seen).toHaveLength(1);
    const [names] = seen as [string[]];
    for (const tool of taskToolNames()) {
      expect(names.filter((name) => name === tool), `${tool} on the turn`).toHaveLength(1);
    }
    expect(new Set(names).size).toBe(names.length);
  });

  it("files a task for an agent delegate, which runs it in a task session of the person's, and hears it complete once", async () => {
    const goal = `audit the licenses of ${globalThis.crypto.randomUUID().slice(0, 8)}`;
    const lab = await open(
      scripted([
        { toolName: "hire", args: { id: "licenses", flow: "agent", description: "Audits dependency licenses." } },
        { toolName: "addDelegate", args: { worker: "licenses" } },
        { toolName: "addTask", args: { goal, assignee: "licenses" } },
      ]),
    );
    const id = await conversation(lab);
    expect((await act(lab, id, "run", { message: "have our dependencies' licenses audited" })).error).toBeUndefined();

    // The conversation's own read, the one Shift Manager's TASKS panel makes: the task, completed by its delegate.
    const listed = await until(
      async () => (await act(lab, id, LIST_TASKS_ACTION, {})).output as { tasks: Array<Record<string, unknown>> },
      (out) => out.tasks?.[0]?.status === "completed" || out.tasks?.[0]?.status === "errored",
      "the filed task",
    );
    expect(listed.tasks).toEqual([expect.objectContaining({ goal, assignee: "licenses", status: "completed", attempts: 1 })]);
    const taskId = listed.tasks[0]!.id as string;
    await quiet(lab);

    // It ran in a session of its own: the person's, a child of the conversation, on `agent`, born naming its worker and task.
    const runtime = await lab.state.getRuntime();
    const runs = (await runtime.stores.request.list({})).filter((r) => r.actionName === "work");
    const taskSessions = [...new Set(runs.map((r) => r.sessionId!))];
    expect(taskSessions).toHaveLength(1);
    expect(await runtime.stores.session.get(taskSessions[0]!)).toMatchObject({
      userId: LAB_USER_ID,
      flowKind: "agent",
      parentSessionId: id,
      state: expect.objectContaining({ workerId: "licenses", taskId }),
    });

    // The conversation heard it once, under the delegate's name, with what came back.
    const heard = (await messages(lab, id)).filter((m) => m.text.includes(`(${taskId}) completed by licenses`));
    expect(heard).toEqual([{ agentName: "licenses", text: expect.stringContaining(DELEGATE_ANSWER) }]);
  });
});

/** A stored message's text. */
function textOf(item: { content?: unknown; text?: unknown }): string {
  if (typeof item.text === "string") return item.text;
  if (typeof item.content === "string") return item.content;
  return ((item.content ?? []) as Array<{ text?: string }>).map((part) => part.text ?? "").join("");
}
