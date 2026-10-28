/**
 * The DevTeam's chief of staff files tasks (FIX-1794 S11), on the real Lab:
 * its turn carries Orchestration's task tools once each, and a task it files
 * for one of its delegates runs in a task session of the user's and is
 * heard back in the conversation once.
 *
 * The model is scripted by block: the chief of staff's judgment
 * (`coordinator-judgment`) makes the tool calls a test names, then answers;
 * an `agent` worker's turn (`agent-answer`) answers with a fixed line.
 *
 * And a task it files for the coder (FIX-1866) runs as a supervised coding
 * run in the project's repository, its answer heard back the same way.
 *
 * The chief of staff keeps its memory to its own flow (`isolateUserState`),
 * and the task session runs on `agent`, which doesn't: the conversation's
 * board has to sit where both read it, or every task it files fails at the
 * task session's gate.
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { z } from "zod";
import { handler, harnessRunHandleSchema, harnessRunInputSchema, type GeneratorTool } from "@flow-state-dev/core";
import type { FlowInstance, GeneratorModel, ModelResolver } from "@flow-state-dev/core/types";
import { inMemoryStores, resolveUserStorageKey, runAction } from "@flow-state-dev/engine";
import { runBoardSegment } from "@flow-state-dev/harness-manager";
import { openRowQuestions } from "@flow-state-dev/orchestration/tasks";
import { encodeUserSegment } from "@flow-state-dev/core/types";
import { createTaskToolsCapability } from "@flow-state-dev/orchestration";
import { LIST_TASKS_ACTION } from "../src/lib/conversation-tasks";
import { UPDATE_TASK_ACTION } from "../src/lib/reads";
import { selectHarness } from "../teams/devteam/harness.mts";
import { LAB_ORG_ID, LAB_USER_ID, openLab, type Lab } from "../teams/devteam/host.mts";
import { harnessStub, type HarnessStub, type HarnessStubOptions, type StubRun } from "../teams/devteam/harness-stub.mts";
import { commitAll, createBareRemote } from "../teams/devteam/scratch-repo.mts";

/** The capability's tool list as a turn with no ask host gets it: the list is chosen per turn (FIX-1816). */
const resolvedControlTools = (list: unknown): GeneratorTool[] =>
  (typeof list === "function" ? list({}) : (list ?? [])) as GeneratorTool[];

const COS = "chief-of-staff";
const DELEGATE_ANSWER = "The licenses are all MIT.";

let opened: Lab | undefined;
afterEach(async () => {
  await opened?.dispose();
  opened = undefined;
});

type ToolCall = { toolName: string; args: Record<string, unknown> };

/** Ends the turn it falls in, so the calls after it run in the next turn. */
const END_TURN = null;

/**
 * The judgment's tool calls, one per step, then a closing line; it records
 * the tool names each step was handed, and what it was handed in `inputs`. An `agent` worker's turn answers with
 * a fixed line.
 */
function scripted(calls: Array<ToolCall | typeof END_TURN>, seen: string[][] = [], inputs: unknown[] = []): ModelResolver {
  let step = 0;
  const judgment: GeneratorModel = {
    modelId: "test/judgment",
    async generate() {
      throw new Error("the owned tool loop calls generateStep");
    },
    async generateStep(options: { tools?: Array<{ name: string }> }) {
      seen.push((options.tools ?? []).map((tool) => tool.name));
      inputs.push(options);
      const call = calls[step];
      step += 1;
      if (call === undefined || call === END_TURN) return { text: "Noted.", finishReason: "stop" };
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
    coderWorkerId: "eng.coder",
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
  const capability = createTaskToolsCapability(async () => undefined) as unknown as {
    __presetDefs?: { tools?: { controlTools?: unknown } };
  };
  const names = resolvedControlTools(capability.__presetDefs?.tools?.controlTools).map((tool) => tool.config?.name ?? tool.name);
  expect(names.length).toBeGreaterThan(0);
  return names;
}

/** Hire an agent worker, which takes a conversation's task, and add it as a delegate. */
const hireTaskTaker: ToolCall[] = [
  { toolName: "hire", args: { id: "licenses", flow: "agent", description: "Audits dependency licenses." } },
  { toolName: "addDelegate", args: { worker: "licenses" } },
];

describe("the chief of staff files tasks (FIX-1794 S11)", () => {
  it("carries each of the task tools exactly once on its turn", async () => {
    const seen: string[][] = [];
    // A delegate that takes a task first: a conversation with none files nothing (FIX-1802 D1),
    // and neither of the DevTeam's defaults takes a conversation's task (FIX-1842).
    const lab = await open(scripted([...hireTaskTaker, END_TURN], seen));
    const id = await conversation(lab);
    expect((await act(lab, id, "respond", { message: "hire someone to audit licenses" })).error).toBeUndefined();
    seen.length = 0;
    expect((await act(lab, id, "respond", { message: "what's on my board?" })).error).toBeUndefined();
    expect(seen).toHaveLength(1);
    const [names] = seen as [string[]];
    for (const tool of taskToolNames()) {
      expect(names.filter((name) => name === tool), `${tool} on the turn`).toHaveLength(1);
    }
    expect(new Set(names).size).toBe(names.length);
  });

  it("files a task for an agent delegate, which runs it in a task session of the user's, and hears it complete once", async () => {
    const goal = `audit the licenses of ${globalThis.crypto.randomUUID().slice(0, 8)}`;
    // The task tools come with a delegate that takes a task, so the filing is the next turn's (FIX-1802 D1).
    const lab = await open(scripted([...hireTaskTaker, END_TURN, { toolName: "createTask", args: { goal, assignee: "licenses" } }]));
    const id = await conversation(lab);
    expect((await act(lab, id, "respond", { message: "hire someone to audit licenses" })).error).toBeUndefined();
    expect((await act(lab, id, "respond", { message: "have our dependencies' licenses audited" })).error).toBeUndefined();

    // The conversation's own read, the one Shift Manager's TASKS panel makes: the task, completed by its delegate.
    const listed = await until(
      async () => (await act(lab, id, LIST_TASKS_ACTION, {})).output as { tasks: Array<Record<string, unknown>> },
      (out) => out.tasks?.[0]?.status === "completed" || out.tasks?.[0]?.status === "errored",
      "the filed task",
    );
    expect(listed.tasks).toEqual([expect.objectContaining({ goal, assignee: "licenses", status: "completed", attempts: 1 })]);
    const taskId = listed.tasks[0]!.id as string;
    await quiet(lab);

    // It ran in a session of its own: the user's, a child of the conversation, on `agent`, born naming its worker and task.
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

/**
 * The coder takes a conversation's task (FIX-1866): the chief of staff files
 * it with `createTask`, the coder works it as a supervised coding run in a
 * checkout of the project's repository, and the conversation hears one line
 * under `eng.coder`. The harness is a stub that answers with what it finds in
 * its working folder; Jev is scripted through the model resolver's evaluation
 * hook, by its question id.
 */
const CODER = "eng.coder";
const MARKER_FILE = "MARKER.txt";
const STOREFRONT = { visibility: "shared", id: "storefront" } as const;

/** What the scripted judge answers, in order, and why when not done; past the end, `done`. `throw` fails the call. */
type Verdict = { choice: string; why?: string; confidence?: number } | "throw";

/** A scripted model: the judgment's calls, a helper's fixed line, and the judge's verdicts, recording what it was asked. */
function scriptedCoder(calls: Array<ToolCall | typeof END_TURN>, verdicts: Verdict[] = [], judged: unknown[] = []): ModelResolver {
  const base = scripted(calls) as unknown as ((...args: unknown[]) => unknown) & Record<string, unknown>;
  let verdict = 0;
  const judge = {
    specificationVersion: "v4",
    provider: "test",
    modelId: "test/jev",
    supportedQuestionTypes: ["choice", "score", "boolean"],
    async doEvaluate(call: { questions: Record<string, unknown>; state?: unknown }) {
      // Best fit's route: no pick, so the chief of staff's judgment takes the message, as without the hook.
      if (!("verdict" in call.questions)) throw new Error("no route in this test");
      judged.push(call);
      const next = verdicts[verdict] ?? { choice: "done", confidence: 0.95 };
      verdict += 1;
      if (next === "throw") throw new Error("the gateway is down");
      return {
        answers: {
          verdict: { type: "choice", choice: next.choice },
          // Jev answers every question it is asked; why is read only for not done.
          why: { type: "choice", choice: next.why ?? "off-target" },
        },
        usage: { inputTokens: 1, outputTokens: 1 },
        warnings: [],
        providerMetadata: next.confidence === undefined ? undefined : { typesafe: { confidence: { verdict: next.confidence } } },
      };
    },
  };
  return Object.assign((...args: unknown[]) => base(...args), {
    resolveId: (id: string) => id,
    resolveEvaluationModel: () => judge,
  }) as unknown as ModelResolver;
}

/** File one task for the coder, from the chief of staff's first turn. */
const fileForCoder = (goal: string, input?: Record<string, unknown>): ToolCall => ({
  toolName: "createTask",
  args: { goal, assignee: CODER, ...(input === undefined ? {} : { input }) },
});

/** A lab with storefront (a bare repository holding a marker) and sandbox (no repository), and a coder harness `stub`. */
async function openCoderLab(model: ModelResolver, stub: HarnessStub, options: { withoutJudge?: boolean } = {}) {
  const marker = `marker-${globalThis.crypto.randomUUID()}`;
  const remote = createBareRemote("coder-tasks", { seed: { [MARKER_FILE]: `${marker}\n` } });
  opened = await openLab({
    modelResolver: model,
    stores: inMemoryStores(),
    harness: stub.slot,
    runTimeoutMs: 30_000,
    workspace: { root: mkdtempSync(join(tmpdir(), "devteam-coder-tasks-")), remotes: { allow: ["file"] } },
    coderWorkerId: CODER,
    inventory: true,
    projects: [
      { id: "storefront", title: "Storefront", repository: remote.url },
      { id: "sandbox", title: "Sandbox" },
    ],
    ...(options.withoutJudge === true ? { withoutJudge: true } : {}),
  });
  return { lab: opened, marker, remote };
}

/** A stub that answers with the marker file it finds in its working folder, and commits nothing. */
const readsMarker = (extra: HarnessStubOptions = {}) =>
  harnessStub({
    finalMessage: (run) => {
      const at = join(run.cwd, MARKER_FILE);
      return existsSync(at) ? `The marker reads ${readFileSync(at, "utf8").trim()}.` : "I could not find the repository.";
    },
    ...extra,
  });

/** File `call` from a new chief-of-staff conversation, and wait for the task to settle. */
async function fileAndSettle(lab: Lab, message = "the coder should take a look at our repo") {
  const id = await conversation(lab);
  const filed = await act(lab, id, "respond", { message });
  expect(filed.error).toBeUndefined();
  const listed = await until(
    async () => (await act(lab, id, LIST_TASKS_ACTION, {})).output as { tasks: Array<Record<string, any>> },
    (out) => ["completed", "errored", "cancelled"].includes(out.tasks?.[0]?.status),
    "the coder's task",
  );
  await quiet(lab);
  const task = listed.tasks[0]!;
  return { id, task, taskId: task.id as string };
}

/** The conversation's lines under the coder's name that name the task. */
async function coderLines(lab: Lab, id: string, taskId: string) {
  return (await messages(lab, id)).filter((m) => m.agentName === CODER && m.text.includes(`(${taskId})`));
}

/** Wait for the conversation's one task to be held on a question; its id and that open question. */
async function heldOnQuestion(lab: Lab, id: string): Promise<{ taskId: string; question: Record<string, any> }> {
  const listed = await until(
    async () => (await act(lab, id, LIST_TASKS_ACTION, {})).output as { tasks: Array<Record<string, any>> },
    (out) => out.tasks?.[0]?.id !== undefined,
    "the filed task",
  );
  const taskId = listed.tasks[0]!.id as string;
  const held = await until(
    async () => storedTask(lab, taskId),
    (task) => task?.status === "in_progress" && task.leaseUntil == null && openRowQuestions(task as never).length > 0,
    "the task held on a question",
  );
  expect(held).toMatchObject({ attempts: 1 });
  return { taskId, question: openRowQuestions(held as never)[0]! as unknown as Record<string, any> };
}

/** The task's row as stored on the conversation's board, in the user's scope. */
async function storedTask(lab: Lab, taskId: string): Promise<Record<string, any> | undefined> {
  const rows = await lab.stored("user", "tasks/");
  return Object.entries(rows).find(([key]) => key.endsWith(`/${taskId}`))?.[1] as Record<string, any> | undefined;
}

describe("a task for the coder, from a conversation (FIX-1866)", () => {
  it("runs in a checkout of the named project's repository, answers from it, and the conversation hears one completed line", async () => {
    const judged: unknown[] = [];
    const goal = `take a look at our repo ${globalThis.crypto.randomUUID().slice(0, 6)}`;
    const stub = readsMarker();
    const { lab, marker, remote } = await openCoderLab(scriptedCoder([fileForCoder(goal, { project: STOREFRONT })], [], judged), stub);
    const branchesBefore = execFileSync("git", ["-C", remote.path, "branch", "--list"], { encoding: "utf8" });

    const { id, task, taskId } = await fileAndSettle(lab);

    expect(task).toMatchObject({ goal, assignee: CODER, status: "completed", attempts: 1 });
    // One run, in a checkout of its own, not in the project's repository.
    expect(stub.runs).toHaveLength(1);
    const [run] = stub.runs as [StubRun];
    expect(run.cwd.startsWith(remote.path)).toBe(false);
    expect(execFileSync("git", ["-C", remote.path, "branch", "--list"], { encoding: "utf8" })).toBe(branchesBefore);
    // The answer phase's prompt: the task, the worker's own files, then what it owes.
    expect(run.prompt).toContain(goal);
    expect(run.prompt).toContain("# Your instructions");
    expect(run.prompt).toContain("Answer in your last message");
    expect(run.prompt).not.toContain(marker);
    // Read-only, and done anyway: an answer, no commit, judged once.
    expect((await storedTask(lab, taskId))?.output).toMatchObject({
      answer: `The marker reads ${marker}.`,
      commits: 0,
      judged: true,
    });
    expect(judged).toHaveLength(1);
    expect(JSON.stringify(judged[0])).toContain(goal);

    const lines = await coderLines(lab, id, taskId);
    expect(lines).toHaveLength(1);
    expect(lines[0]!.text).toContain(`completed by ${CODER}`);
    expect(lines[0]!.text).toContain(marker);
  });

  it("works in a project with no repository on the project's files", async () => {
    const stub = readsMarker();
    const { lab } = await openCoderLab(
      scriptedCoder([fileForCoder("what's in our sandbox?", { project: { visibility: "shared", id: "sandbox" } })]),
      stub,
    );
    const { task } = await fileAndSettle(lab);
    expect(task).toMatchObject({ status: "completed", attempts: 1 });
    expect(stub.runs[0]!.cwd.endsWith("workspace")).toBe(true);
  });

  it("ends errored after two attempts with the run's error, one failed line, in one session and one checkout", async () => {
    const boom = `boom-${globalThis.crypto.randomUUID()}`;
    const stub = harnessStub({
      duringRun: () => {
        throw new Error(boom);
      },
    });
    const { lab } = await openCoderLab(scriptedCoder([fileForCoder("look at the repo", { project: STOREFRONT })]), stub);
    const { id, task, taskId } = await fileAndSettle(lab);

    expect(task).toMatchObject({ status: "errored", attempts: 2 });
    expect(stub.runs).toHaveLength(2);
    // The second attempt in the same checkout, resuming the first's session.
    expect(stub.runs[1]!.cwd).toBe(stub.runs[0]!.cwd);
    expect(stub.runs[1]!.resume).toBe("sess_stub_1");
    const runtime = await lab.state.getRuntime();
    const sessions = new Set((await runtime.stores.request.list({})).filter((r) => r.actionName === "work").map((r) => r.sessionId));
    expect(sessions.size).toBe(1);

    const failed = (await coderLines(lab, id, taskId)).filter((m) => m.text.includes("failed for good"));
    expect(failed).toHaveLength(1);
    expect(failed[0]!.text).toContain(boom);
  });

  it("refuses a task that names no project after one attempt, without running, and says it can name one", async () => {
    const stub = readsMarker();
    const { lab } = await openCoderLab(scriptedCoder([fileForCoder("look at our repo")]), stub);
    const { id, task, taskId } = await fileAndSettle(lab);

    expect(task).toMatchObject({ status: "errored", attempts: 1 });
    expect(stub.runs).toHaveLength(0);
    const failed = (await coderLines(lab, id, taskId)).filter((m) => m.text.includes("failed for good"));
    expect(failed).toHaveLength(1);
    expect(failed[0]!.text).toContain("input.project");
  });

  it("refuses a project named by its id alone, saying a project is named by its visibility and id", async () => {
    const stub = readsMarker();
    const { lab } = await openCoderLab(scriptedCoder([fileForCoder("look at our repo", { project: "storefront" })]), stub);
    const { id, task, taskId } = await fileAndSettle(lab);
    expect(task).toMatchObject({ status: "errored", attempts: 1 });
    expect(stub.runs).toHaveLength(0);
    expect((await coderLines(lab, id, taskId)).map((m) => m.text).join("\n")).toContain("visibility and id");
  });

  it("refuses a task naming only one of issue and phase after the claim, without running it as an answer", async () => {
    const stub = readsMarker();
    const { lab } = await openCoderLab(scriptedCoder([fileForCoder("ship it", { project: STOREFRONT, issue: "greeting" })]), stub);
    const { id, task, taskId } = await fileAndSettle(lab);
    expect(task).toMatchObject({ status: "errored", attempts: 1 });
    expect(stub.runs).toHaveLength(0);
    expect((await coderLines(lab, id, taskId)).map((m) => m.text).join("\n")).toContain("Feature work names both");
  });

  it("fails a run that stopped at its limit, and one that ended with no answer", async () => {
    for (const stub of [readsMarker({ outcomeOf: () => "stopped-at-limit" }), harnessStub({ finalMessage: "   " })]) {
      const { lab } = await openCoderLab(scriptedCoder([fileForCoder("look at the repo", { project: STOREFRONT })]), stub);
      const { task } = await fileAndSettle(lab);
      expect(task).toMatchObject({ status: "errored", attempts: 2 });
      expect(stub.runs).toHaveLength(2);
      await lab.dispose();
      opened = undefined;
    }
  });

  it("retries a run the judge says missed the goal with its reason, and ends errored with that reason on the line", async () => {
    const stub = harnessStub({ finalMessage: "Storefront is a project." });
    const notDone = { choice: "not-done", why: "off-target", confidence: 0.9 };
    const { lab } = await openCoderLab(
      scriptedCoder([fileForCoder("explain the checkout flow", { project: STOREFRONT })], [notDone, notDone]),
      stub,
    );
    const { id, task, taskId } = await fileAndSettle(lab);
    expect(task).toMatchObject({ status: "errored", attempts: 2 });
    expect(stub.runs[1]!.prompt).toContain("The answer does not address what the goal asks.");
    const failed = (await coderLines(lab, id, taskId)).filter((m) => m.text.includes("failed for good"));
    expect(failed).toHaveLength(1);
    expect(failed[0]!.text).toContain("The answer does not address what the goal asks.");
  });

  it("closes as done on a miss under the floor, and on the phase's check alone when the judge fails", async () => {
    for (const verdict of [{ choice: "not-done", why: "off-target", confidence: 0.5 }, "throw"] as Verdict[]) {
      const stub = readsMarker();
      const { lab } = await openCoderLab(scriptedCoder([fileForCoder("look at the repo", { project: STOREFRONT })], [verdict]), stub);
      const { task, taskId } = await fileAndSettle(lab);
      expect(task).toMatchObject({ status: "completed", attempts: 1 });
      expect((await storedTask(lab, taskId))?.output?.judged).toBe(verdict !== "throw");
      await lab.dispose();
      opened = undefined;
    }
  });

  it("with no judge, an answer that misses the goal closes as completed (the control's red state)", async () => {
    const stub = harnessStub({ finalMessage: "Storefront is a project." });
    const { lab } = await openCoderLab(
      scriptedCoder([fileForCoder("explain the checkout flow", { project: STOREFRONT })], [{ choice: "not-done", why: "off-target", confidence: 0.9 }]),
      stub,
      { withoutJudge: true },
    );
    const { task, taskId } = await fileAndSettle(lab);
    expect(task).toMatchObject({ status: "completed" });
    expect((await storedTask(lab, taskId))?.output?.judged).toBe(false);
  });

  it("holds the task on the judge's question, and the user's answer continues the same session on the same attempt", async () => {
    const reply = `the checkout flow ${globalThis.crypto.randomUUID().slice(0, 6)}`;
    const stub = readsMarker();
    const { lab } = await openCoderLab(
      scriptedCoder([fileForCoder("look at the flow", { project: STOREFRONT })], [{ choice: "ask", confidence: 0.9 }]),
      stub,
    );
    const id = await conversation(lab);
    expect((await act(lab, id, "respond", { message: "the coder should look at the flow" })).error).toBeUndefined();
    const { taskId, question } = await heldOnQuestion(lab, id);
    await quiet(lab);
    expect(stub.runs).toHaveLength(1);

    expect((await act(lab, id, UPDATE_TASK_ACTION, { id: taskId, answers: question.id, message: reply })).output).toMatchObject({ ok: true });
    const done = await until(async () => storedTask(lab, taskId), (task) => task?.status === "completed", "the answered task");
    await quiet(lab);
    expect(done).toMatchObject({ attempts: 1 });
    expect(stub.runs).toHaveLength(2);
    expect(stub.runs[1]!.prompt).toContain(reply);
    expect(stub.runs[1]!.resume).toBe("sess_stub_1");
  });

  it("holds the task on the run's own question, tells the conversation, and the answer continues the same session on the same attempt", async () => {
    const reply = `use the main branch ${globalThis.crypto.randomUUID().slice(0, 6)}`;
    const stub = readsMarker({
      duringRun: (run) => {
        if (stub.runs.length > 1) return;
        const marker = /\S*\.fsdev\/ask\/\d+-\d+\.md/.exec(run.prompt)?.[0];
        if (marker === undefined) throw new Error("the prompt names no ask marker");
        mkdirSync(dirname(marker), { recursive: true });
        writeFileSync(marker, "Which branch should I read?");
      },
    });
    const { lab } = await openCoderLab(scriptedCoder([fileForCoder("look at the repo", { project: STOREFRONT })]), stub);
    const id = await conversation(lab);
    expect((await act(lab, id, "respond", { message: "the coder should take a look at our repo" })).error).toBeUndefined();
    const { taskId, question } = await heldOnQuestion(lab, id);
    expect(question.ask.prompt).toBe("Which branch should I read?");
    await quiet(lab);
    // The conversation that filed it hears the question once, from the coder, with what to answer it by (FIX-2241).
    expect((await coderLines(lab, id, taskId)).map((line) => line.text)).toEqual([
      expect.stringMatching(new RegExp(`asks: "Which branch should I read\\?"\\n.*answers: "${question.id}"`)),
    ]);

    expect((await act(lab, id, UPDATE_TASK_ACTION, { id: taskId, answers: question.id, message: reply })).output).toMatchObject({ ok: true });
    const done = await until(async () => storedTask(lab, taskId), (task) => task?.status === "completed", "the answered task");
    expect(done).toMatchObject({ attempts: 1 });
    expect(stub.runs[1]!.prompt).toContain(reply);
    expect(stub.runs[1]!.resume).toBe("sess_stub_1");
  });

  it("holds a conversation's feature task to feature work's rules: it runs, and never closes as an answer", async () => {
    // A task naming an issue and a phase is feature work wherever it was filed: the implement
    // manager runs it under the id its board minted, and it is done only on a commit. This run
    // answers and commits nothing, so the task fails rather than closing as an answer task.
    const stub = readsMarker();
    const { lab } = await openCoderLab(
      scriptedCoder([fileForCoder("ship the greeting", { project: STOREFRONT, issue: "greeting", phase: "implement" })]),
      stub,
    );
    const { task } = await fileAndSettle(lab);
    expect(task.status).toBe("errored");
    expect(stub.runs.length).toBeGreaterThan(0);
    // Every attempt was the implement phase's: its prompt names the row and asks for a commit.
    for (const run of stub.runs) expect(run.prompt).toMatch(/\nRow task_\w+, phase implement, attempt \d/);
    // The row's id is the board's, so the issue the filer named is rendered on its own:
    // without it the coder is told which row it holds and never which issue.
    for (const run of stub.runs) expect(run.prompt).toContain("\nIssue greeting.");
  });

  it("completes a conversation's feature task once its run commits", async () => {
    const stub = readsMarker({
      duringRun: async (run) => {
        writeFileSync(join(run.cwd, "GREETING.md"), "hello\n");
        commitAll(run.cwd, "add the greeting");
      },
    });
    const { lab } = await openCoderLab(
      scriptedCoder([fileForCoder("ship the greeting", { project: STOREFRONT, issue: "greeting", phase: "implement" })]),
      stub,
    );
    const { task } = await fileAndSettle(lab);
    expect(task.status).toBe("completed");
    expect(stub.runs).toHaveLength(1);
  });

  it("runs the EM's feature row and a conversation's task at once, each in its own checkout, and judges each", async () => {
    const judged: unknown[] = [];
    let release: () => void = () => {};
    const held = new Promise<void>((resolve) => (release = resolve));
    const stub = readsMarker({
      duringRun: async (run) => {
        // A feature run commits; the conversation's run holds until the feature row is done.
        if (run.prompt.includes("\nRow ")) {
          writeFileSync(join(run.cwd, "GREETING.md"), "hello\n");
          commitAll(run.cwd, "feature run: add the greeting");
          return;
        }
        await held;
      },
    });
    const { lab } = await openCoderLab(scriptedCoder([fileForCoder("look at the repo", { project: STOREFRONT })], [], judged), stub);
    const id = await conversation(lab);
    expect((await act(lab, id, "respond", { message: "the coder should take a look at our repo" })).error).toBeUndefined();
    await until(async () => stub.runs.length, (n) => n >= 1, "the conversation's run");

    expect(
      (await lab.file("eng.em", { issue: "greeting", goal: "Add a greeting.", maxAttempts: 1, project: STOREFRONT })).error,
    ).toBeUndefined();
    const feature = await until(
      async () => {
        const row = await lab.featureRow("greeting");
        if (row === undefined || row.status === "pending") await lab.drain("eng.em");
        return row;
      },
      (row) => row?.status === "completed" || row?.status === "errored",
      "the feature row",
    );
    release();
    expect(feature?.status).toBe("completed");
    const listed = await until(
      async () => (await act(lab, id, LIST_TASKS_ACTION, {})).output as { tasks: Array<Record<string, any>> },
      (out) => out.tasks?.[0]?.status === "completed",
      "the conversation's task",
    );
    expect(listed.tasks[0]!.status).toBe("completed");
    await quiet(lab);
    expect(stub.runs).toHaveLength(2);
    expect(stub.runs[0]!.cwd).not.toBe(stub.runs[1]!.cwd);
    // The EM's row is a session's task like any other: the judge reads it against its own goal.
    expect(feature?.output).toMatchObject({ judged: true });
    expect(judged).toHaveLength(2);
    expect(judged.map((input) => JSON.stringify(input)).join("\n")).toContain("look at the repo");
    expect(judged.map((input) => JSON.stringify(input)).join("\n")).toContain("Add a greeting.");
  });

  it("refuses to open with a harness that isn't detached, naming the entry", async () => {
    const attached = () =>
      handler({
        name: "attached-harness",
        inputSchema: harnessRunInputSchema,
        outputSchema: harnessRunHandleSchema,
        sessionStateSchema: z.object({ turns: z.number().default(0) }),
        execute: async () => {
          throw new Error("never runs");
        },
      }) as never;
    await expect(
      openLab({
        stores: inMemoryStores(),
        harness: attached,
        workspace: { root: mkdtempSync(join(tmpdir(), "devteam-coder-attached-")), remotes: { allow: ["file"] } },
        coderWorkerId: CODER,
      }),
    ).rejects.toThrow(/task entry "work".*sessionStateSchema/);
  });

  it("takes a user's message into a running run as a steer: the same attempt resumes its session with it", async () => {
    const said = `also check the tests ${globalThis.crypto.randomUUID().slice(0, 6)}`;
    // The first harness step holds until the test lets it go; the next one answers at once.
    let started: () => void = () => {};
    let release: () => void = () => {};
    const firstStarted = new Promise<void>((resolve) => (started = resolve));
    const held = new Promise<void>((resolve) => (release = resolve));
    const stub = harnessStub({
      finalMessage: "I looked at the repository.",
      duringRun: async () => {
        if (stub.runs.length > 1) return;
        started();
        await held;
      },
    });
    const { lab } = await openCoderLab(scriptedCoder([fileForCoder("look at the repo", { project: STOREFRONT })]), stub);
    const id = await conversation(lab);
    expect((await act(lab, id, "respond", { message: "the coder should take a look at our repo" })).error).toBeUndefined();
    await firstStarted;

    const runtime = await lab.state.getRuntime();
    const taskSession = (await runtime.stores.request.list({})).find((r) => r.actionName === "work")!.sessionId!;
    // The door steers the open task and returns at once; the running step is not ended for it.
    const sent = await act(lab, taskSession, "respond", { message: said }, "coder");
    expect(sent.error).toBeUndefined();
    const taskId = (sent.output as { steered?: string }).steered;
    expect(taskId).toBeTypeOf("string");
    const steered = await storedTask(lab, taskId!);
    expect(steered?.status).toBe("in_progress");
    expect(steered?.attempts).toBe(1);
    release();

    await until(async () => (await storedTask(lab, taskId!))?.status, (status) => status === "completed", "the steered task");
    // One attempt: the next step resumed the session the first confirmed, with the user's words.
    expect(stub.runs).toHaveLength(2);
    expect(stub.runs[0]!.prompt).not.toContain(said);
    expect(stub.runs[1]!.prompt).toContain(said);
    expect(stub.runs[1]!.resume).toBe("sess_stub_1");
    expect((await storedTask(lab, taskId!))?.attempts).toBe(1);
    expect((await runtime.stores.request.list({})).filter((r) => r.actionName === "work")).toHaveLength(1);
    await quiet(lab);
  });
});

describe("a line the coder's door kept before lines became steers (FIX-2086)", () => {
  it("becomes a steer on its task when the Lab starts, once", async () => {
    // A Lab that ran before: a conversation, and one of its coder tasks with
    // a line kept for its next attempt, as the retired door left them.
    const stores = inMemoryStores();
    const first = await openLab({
      modelResolver: scriptedCoder([]),
      stores,
      harness: harnessStub().slot,
      runTimeoutMs: 30_000,
      workspace: { root: mkdtempSync(join(tmpdir(), "devteam-coder-upgrade-")), remotes: { allow: ["file"] } },
      coderWorkerId: CODER,
    });
    opened = first;
    const conv = await conversation(first);
    await first.dispose();
    opened = undefined;
    const cell = resolveUserStorageKey(LAB_USER_ID, LAB_ORG_ID, { id: "", isolateUserState: false });
    const segment = runBoardSegment("tasks", conv);
    const rowKey = `tasks/${encodeUserSegment(conv)}/task_kept`;
    // The store the Lab's runtime resolves, the same across both starts.
    const resourceState = (await stores.resolve(["primary"])).resourceState!;
    const seed = async (key: string, state: Record<string, unknown>) => resourceState.set("user", cell, key, state as never, "any" as never);
    await seed(rowKey, { id: "task_kept", goal: "look at the repo", status: "parked", parkedForTurn: true, attempts: 1, assignee: CODER, createdAt: 1, updatedAt: 1, revision: 1 }); // retired-name-refusal: the row shape the message door stored
    await seed(`runs/${segment}/task_kept/answer`, { taskId: "task_kept", sessionId: "sess_stub_1" });
    await seed("turns/task_kept/answer/2/k1", { message: "Check the tests too.", keptAt: 5, forAttempt: 2, deliveredTo: null, withdrawn: false });

    const read = async () => (await resourceState.get("user", cell, rowKey))?.state as { steers?: Array<Record<string, unknown>> };
    for (let start = 0; start < 2; start += 1) {
      opened = await openLab({
        modelResolver: scriptedCoder([]),
        stores,
        harness: harnessStub().slot,
        runTimeoutMs: 30_000,
        workspace: { root: mkdtempSync(join(tmpdir(), "devteam-coder-upgrade-")), remotes: { allow: ["file"] } },
        coderWorkerId: CODER,
      });
      await opened.dispose();
      opened = undefined;
      expect((await read()).steers).toEqual([
        expect.objectContaining({ id: "turn:turns/task_kept/answer/2/k1", message: "Check the tests too.", from: "user", by: LAB_USER_ID }),
      ]);
    }
  });
});

/** A stored message's text. */
function textOf(item: { content?: unknown; text?: unknown }): string {
  if (typeof item.text === "string") return item.text;
  if (typeof item.content === "string") return item.content;
  return ((item.content ?? []) as Array<{ text?: string }>).map((part) => part.text ?? "").join("");
}
