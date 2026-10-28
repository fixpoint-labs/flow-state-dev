/**
 * The DevTeam's Shift Coordinator as a coordinator (FIX-1791 S10), on the real
 * Lab: its file names `flow: coordinator`, `routing: best-fit` with a floor,
 * and standard workers as default delegates; best fit's one evaluation sends
 * a plain ask straight to the EM, and anything else to its judgment, the
 * agent's own turn, with its hire and the delegate tools; and a message it
 * routes, as a task (FIX-2083), is answered in its conversation under the
 * delegate's name.
 *
 * The models are scripted by block: best fit's evaluation answers the route
 * a test names (by default the Shift Coordinator itself); the Shift Coordinator's
 * judgment (`coordinator-judgment`) makes the tool calls a test names, then
 * stops; the EM's turn (`devforce-em-turn`) makes the tool calls a test names
 * for it, then answers "Filed."; an `agent` worker's turn (`agent-answer`)
 * answers with a fixed line.
 *
 * Checks (`specs/issues/FIX-1791/BUSINESS-RULES.md`, as amended by
 * `specs/issues/FIX-1833/`): BR-33 (the Shift Coordinator runs on the
 * coordinator flow, routing by best fit), FIX-1833 BR-6, BR-7, BR-17, BR-19
 * and BR-20 (a plain ask to the EM with no turn; its own job, a doubtful pick
 * or a failed call to its turn, recorded with why), BR-34's
 * mechanism (hire, add, route), BR-10 (its delegate read is the
 * conversation's list, with what each takes), and the EM as a delegate: its
 * turn files the coder's task on the board of the session the routed task
 * reached. BR-9's record of a default that can't take a post is retired by
 * FIX-2083: every delegate here takes tasks, the coder included.
 *
 * Retired here (BR-24): the cases that had the EM file nothing, and say so,
 * for a line not in the `<issue-slug>: <what the feature is>` shape. That
 * parse is gone: whether a post asks for a feature is the EM's model's
 * judgement now, graded with a real model where the EM files from its
 * workstream session (`devteam-em-workstream.test.ts`).
 */
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { FlowInstance, GeneratorModel, ModelResolver } from "@flow-state-dev/core/types";
import { inMemoryStores, runAction } from "@flow-state-dev/engine";
import { selectHarness } from "../teams/devteam/harness.mts";
import { PHASE } from "../teams/devteam/phase.mts";
import { LAB_ORG_ID, LAB_USER_ID, openLab, type Lab } from "../teams/devteam/host.mts";
import { EM_TURN } from "../teams/devteam/workforce/flows/workers/em.mts";

/** The EM's description, as its `WORKER.md` writes it: what a coordinator picks it by. */
const EM_DESCRIPTION =
  "Files each feature as a task for the coder, and keeps the workstream it leads current; never does the work itself.";

const SHIFT_COORDINATOR = "shift-coordinator";

let opened: Lab | undefined;
afterEach(async () => {
  await opened?.dispose();
  opened = undefined;
});

type ToolCall = { toolName: string; args: Record<string, unknown> };

/** What best fit's one evaluation answers: a choice and the confidence it reports, or a failed call. */
type Route = { choice: string; confidence?: number } | { fail: string };

/** Every best-fit evaluation the Shift Coordinator made: the choices it was offered. */
let routeCalls: Array<Record<string, string>> = [];

/** Best fit's evaluation model, answering `route` and recording the choices each call offered. */
function scriptedRoute(route: Route) {
  return {
    specificationVersion: "v4",
    provider: "test",
    modelId: "test/route",
    supportedQuestionTypes: ["choice", "score", "boolean"],
    async doEvaluate(call: { questions: Record<string, { criteria?: Record<string, string> }> }) {
      routeCalls.push(call.questions.worker?.criteria ?? {});
      if ("fail" in route) throw new Error(route.fail);
      return {
        answers: { worker: { type: "choice", choice: route.choice } },
        usage: { inputTokens: 1, outputTokens: 1 },
        warnings: [],
        providerMetadata: route.confidence === undefined ? undefined : { typesafe: { confidence: { worker: route.confidence } } },
      };
    },
  };
}

/** A model that makes `calls`, one per step, then answers `closing`; `steps()` counts its steps. */
function stepping(id: string, calls: ToolCall[], closing: string): GeneratorModel & { steps: () => number } {
  // One call per step, each after the last one's result: a later call depends on an earlier one.
  let step = 0;
  return {
    modelId: id,
    async generate() {
      throw new Error("the owned tool loop calls generateStep");
    },
    async generateStep() {
      const call = calls[step];
      step += 1;
      if (call === undefined) return { text: closing, finishReason: "stop" };
      return { toolCalls: [{ toolCallId: `${id}-${step}`, ...call }], finishReason: "tool-calls" };
    },
    steps: () => step,
  };
}

/**
 * The judgment's tool calls, one per step, then a closing line; the EM's turn
 * makes `em`'s calls, then answers "Filed."; an agent worker's turn answers
 * with a fixed line; best fit's evaluation answers `route`, by default the
 * Shift Coordinator itself, sure of it, so its own turn takes the post.
 */
function scripted(calls: ToolCall[], route: Route = { choice: SHIFT_COORDINATOR, confidence: 0.95 }, em: ToolCall[] = []): ModelResolver {
  const judgment = stepping("test/judgment", calls, "Handed on.");
  const emTurn = stepping("test/em", em, "Filed.");
  const helper: GeneratorModel = {
    modelId: "test/helper",
    async generate() {
      throw new Error("the owned tool loop calls generateStep");
    },
    async generateStep() {
      return { text: "The licenses are all MIT.", finishReason: "stop" };
    },
  };
  return Object.assign(
    (_id: string, block?: string) =>
      block?.startsWith("coordinator-judgment") ? judgment : block === EM_TURN ? emTurn : helper,
    {
      resolveId: (id: string) => id,
      resolveEvaluationModel: () => scriptedRoute(route),
      judgmentSteps: () => judgment.steps(),
    },
  ) as unknown as ModelResolver;
}

let model: ModelResolver | undefined;

async function open(stores: ReturnType<typeof inMemoryStores> = inMemoryStores()): Promise<Lab> {
  const harness = selectHarness();
  routeCalls = [];
  opened = await openLab({
    modelResolver: Object.assign((...args: Parameters<ModelResolver>) => model!(...args), {
      resolveId: (id: string) => id,
      resolveEvaluationModel: (...args: unknown[]) => (model as any).resolveEvaluationModel(...args),
    }),
    stores,
    harness: harness.slot,
    runTimeoutMs: harness.runTimeoutMs,
    workspace: { root: mkdtempSync(join(tmpdir(), "devteam-shift-coordinator-coordinator-")), remotes: { allow: ["file"] } },
    coderWorkerId: "eng.coder",
    inventory: true,
  });
  return opened;
}

/** A conversation with the Shift Coordinator, opened as an app does: a session on its flow, naming it. */
async function conversation(lab: Lab): Promise<string> {
  const sessionId = `s-shift-coordinator-${globalThis.crypto.randomUUID()}`;
  const created = await lab.door("POST", `coordinator/sessions`, {
    body: { userId: LAB_USER_ID, sessionId, state: { workerId: SHIFT_COORDINATOR } },
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

/** The conversation's items, once nothing in the Lab is still running. */
async function settledItems(lab: Lab, sessionId: string) {
  const runtime = await lab.state.getRuntime();
  const deadline = Date.now() + 10_000;
  while ((await runtime.stores.request.list({})).some((r) => r.status === "in_progress")) {
    if (Date.now() > deadline) throw new Error("a request never finished");
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  const requests = await runtime.stores.request.list({ sessionId, withItems: true });
  return requests.sort((a, b) => a.createdAt - b.createdAt).flatMap((r) => ((r as unknown as { items?: any[] }).items ?? []));
}

describe("the Shift Coordinator as a coordinator (S10)", () => {
  for (const [why, route, reason] of [
    ["its own job, at any confidence", { choice: SHIFT_COORDINATOR, confidence: 0.4 }, "coordinator"],
    ["a vague ask Jev isn't sure of", { choice: "eng.em", confidence: 0.36 }, "below-floor"],
    ["an evaluation the gateway can't serve", { fail: "the gateway refused the call" }, "failed"],
  ] as const) {
    it(`runs its own turn on ${why}, recorded with why (FIX-1833 BR-7, BR-19, BR-20)`, async () => {
      const lab = await open();
      const id = await conversation(lab);
      model = scripted([], route);
      expect((await act(lab, id, "respond", { message: "who works here?" })).error).toBeUndefined();
      const items = await settledItems(lab, id);
      expect(routeCalls).toHaveLength(1);
      expect((model as any).judgmentSteps()).toBe(1);
      const [record] = items.filter((item) => item.type === "component" && item.component === "coordinator-route");
      expect(record.data).toMatchObject({ by: "judgment", policy: "best-fit", delegates: [], fit: { reason } });
      expect(textOf(items.filter((item) => item.type === "message" && item.role === "assistant").at(-1) ?? {})).toBe("Handed on.");
    });
  }

  it("runs on the coordinator flow, its delegates starting from the standard workers its file names (BR-33, BR-10)", async () => {
    const lab = await open();
    const runtime = await lab.state.getRuntime();
    expect(runtime.registry.get("coordinator")).toBeDefined();
    const id = await conversation(lab);
    const listed = await act(lab, id, "listDelegates", {});
    expect(listed.error).toBeUndefined();
    // What each one does (its WORKER.md description) and takes: both flows take a conversation's
    // tasks (FIX-1866, FIX-2083). What the Shift Coordinator picks a routed task and a filing by.
    expect(listed.output.delegates).toEqual([
      { worker: "eng.em", description: EM_DESCRIPTION, takes: "tasks" },
      { worker: "eng.coder", description: "Does the work a filed row names, in a checkout of its own.", takes: "tasks" },
    ]);
    // The agent flow refuses it: a session names the flow its worker runs on.
    const onAgent = await lab.door("POST", `agent/sessions`, { body: { userId: LAB_USER_ID, state: { workerId: SHIFT_COORDINATOR } } });
    expect(onAgent.status).toBe(400);
  });

  it("refuses a coder session seeded with server-only fields, naming the field, as the coordinator and the EM do", async () => {
    const lab = await open();
    // The coder's session has no delegate or board fields: without the refusal, the create answers 201 and drops them.
    for (const field of ["delegates", "fallback", "taskNotices"]) {
      const created = await lab.door("POST", `coder/sessions`, { body: { userId: LAB_USER_ID, state: { workerId: "eng.coder", [field]: [] } } });
      expect(created.status, `${field}: ${JSON.stringify(created.body)}`).toBe(400);
      expect(created.body).toMatchObject({ field });
    }
    const seeded = await lab.door("POST", `coder/sessions`, {
      body: { userId: LAB_USER_ID, state: { workerId: "eng.coder", filingSessionId: "someone-else~1" } },
    });
    expect(seeded.status).toBe(400);
    expect(JSON.stringify(seeded.body)).toContain("filingSessionId");
    const plain = await lab.door("POST", `coder/sessions`, { body: { userId: LAB_USER_ID, state: { workerId: "eng.coder" } } });
    expect(plain.status).toBe(201);
  });

  it("hires a worker, adds it, and routes it the message, whose answer lands under its name (BR-34's mechanism, BR-20)", async () => {
    const lab = await open();
    const id = await conversation(lab);
    model = scripted([
      { toolName: "hire", args: { id: "licenses", flow: "agent", description: "Audits dependency licenses." } },
      { toolName: "addDelegate", args: { worker: "licenses" } },
      { toolName: "createTask", args: { goal: "Take this", assignee: "licenses", session: "ongoing", resultTo: "conversation" } },
    ]);
    const turn = await act(lab, id, "respond", { message: "audit our dependencies' licenses" });
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

  it("sends a plain ask Jev is sure of straight to its EM delegate, with no turn of its own, and the EM files it (FIX-1833 BR-6, BR-17)", async () => {
    const lab = await open();
    const id = await conversation(lab);
    const issue = `cart-${globalThis.crypto.randomUUID().slice(0, 6)}`;
    model = scripted([{ toolName: "createTask", args: { goal: "Take this", assignee: "eng.em", session: "ongoing", resultTo: "conversation" } }], { choice: "eng.em", confidence: 0.9 }, [
      {
        toolName: "createTask",
        args: { goal: "show a badge on the cart", assignee: "eng.coder", input: { harnessFeature: { issue, phase: PHASE } } },
      },
    ]);
    const post = `Get this filed for the team:\n${issue}: show a badge on the cart`;
    expect((await act(lab, id, "respond", { message: post })).error).toBeUndefined();
    // The EM's routed task stays open while the coder's task it filed runs (FIX-2083, rule 6):
    // its answer lands once that work ends.
    let items = await settledItems(lab, id);
    for (const until = Date.now() + 10_000; Date.now() < until; ) {
      if (items.some((item) => item.type === "message" && item.agentName === "eng.em")) break;
      await new Promise((resolve) => setTimeout(resolve, 50));
      items = await settledItems(lab, id);
    }
    // One evaluation, over the EM, the coder (a delegate that takes tasks) and the Shift Coordinator itself, by its description.
    expect(routeCalls).toEqual([
      {
        "eng.em": EM_DESCRIPTION,
        "eng.coder": "Does the work a filed row names, in a checkout of its own.",
        [SHIFT_COORDINATOR]: "The user's one point of contact. Hires and fires workers, starts projects, and answers questions about the team, its workers and its delegates.",
      },
    ]);
    expect((model as any).judgmentSteps()).toBe(0);
    expect(items.filter((item) => item.type === "message" && item.role === "assistant").map((item) => item.agentName)).toEqual(["eng.em"]);
    const [record] = items.filter((item) => item.type === "component" && item.component === "coordinator-route");
    expect(record.data).toMatchObject({ by: "evaluated", delegates: [{ worker: "eng.em", outcome: "delivered" }] });
    // The coder's task, on the board of the EM session the post reached: feature work, naming the issue
    // and the phase, for the coder.
    const filed = Object.values(await stored(lab, "tasks/")).filter((row: any) => row.input?.harnessFeature?.issue === issue);
    expect(filed).toEqual([
      expect.objectContaining({ goal: "show a badge on the cart", assignee: "eng.coder", input: { harnessFeature: { issue, phase: PHASE } } }),
    ]);
    // The EM's answer lands under its name, once.
    const answers = items.filter((item) => item.type === "message" && item.agentName === "eng.em").map(textOf);
    expect(answers).toEqual(["Filed."]);
  });

  it("closes a coordinator's round when the user cancels the EM's routed task while it works, so the round doesn't wait for its deadline", async () => {
    // The EM's board read for one issue is held, so its run is still going when it is cancelled.
    const issue = `hold-${globalThis.crypto.randomUUID().slice(0, 6)}`;
    let abandon = (_error: Error) => {};
    const held = new Promise<void>((_resolve, reject) => (abandon = reject));
    const memory = inMemoryStores();
    let holding = false;
    const lab = await open({
      ...memory,
      async resolve(...slots: Parameters<typeof memory.resolve>) {
        const registry = await memory.resolve(...slots);
        const store = registry.resourceState;
        if (!holding && store !== undefined) {
          holding = true;
          // The board's write of the issue's row waits, inside the EM's turn.
          registry.resourceState = new Proxy(store, {
            get(target, key, receiver) {
              const value = Reflect.get(target, key, receiver);
              if (typeof value !== "function") return value;
              return async (...args: unknown[]) => {
                // The coder's row only: the post to the EM names the issue too, and must land.
                const written = JSON.stringify(args) ?? "";
                if (written.includes(issue) && written.includes('"eng.coder"')) await held;
                return value.apply(target, args);
              };
            },
          });
        }
        return registry;
      },
    });
    // A coordinator of the user's own, with a round to send answers on, and the EM as its delegate.
    const hired = await act(
      lab,
      "roster-cancel-test",
      "hire",
      { id: "release-desk", flow: "coordinator", description: "Runs the release.", settings: { delegates: ["eng.em"], rounds: 1 } },
      "workforce-roster",
    );
    expect(hired.error).toBeUndefined();
    const id = `s-desk-${globalThis.crypto.randomUUID()}`;
    expect((await lab.door("POST", "coordinator/sessions", { body: { userId: LAB_USER_ID, sessionId: id, state: { workerId: "release-desk" } } })).status).toBe(201);
    model = scripted([{ toolName: "createTask", args: { goal: "Take this", assignee: "eng.em", session: "ongoing", resultTo: "conversation" } }], undefined, [
      { toolName: "createTask", args: { goal: "the release notes", assignee: "eng.coder", input: { harnessFeature: { issue, phase: PHASE } } } },
    ]);
    expect((await act(lab, id, "respond", { message: `${issue}: the release notes` })).error).toBeUndefined();

    const runtime = await lab.state.getRuntime();
    let running: { id: string } | undefined;
    for (const until = Date.now() + 5_000; running === undefined && Date.now() < until; await new Promise((r) => setTimeout(r, 20))) {
      running = (await runtime.stores.request.list({})).find((r) => r.status === "in_progress" && r.actionName === "work");
    }
    expect(running, "the EM's routed task never started").toBeDefined();
    // The user cancels the routed task from the conversation's board, while the EM's turn still runs.
    const [routed] = Object.values(await stored(lab, "tasks/")).filter((row: any) => typeof row.sealed?.postId === "string") as any[];
    expect((await act(lab, id, "updateTask_tasks", { id: routed.id, status: "cancelled" })).output).toEqual({ ok: true });
    // The held write gives up, as a store call does when its request is cancelled under it.
    abandon(new Error("the write was abandoned: its request was cancelled"));
    await settledItems(lab, id);

    // The EM's routed task ended with the cancel, and the round closed on it.
    const ended = Object.values(await stored(lab, "tasks/")).filter((row: any) => typeof row.sealed?.postId === "string");
    expect(ended).toEqual([expect.objectContaining({ assignee: "eng.em", status: "cancelled" })]);
    expect(((await runtime.stores.session.get(id))?.state as { openRounds: unknown[] }).openRounds).toEqual([]);
  });
});

/** The lab user's stored rows under `prefix`, by key. */
async function stored(lab: Lab, prefix: string): Promise<Record<string, unknown>> {
  return lab.stored("user", prefix);
}

/** A stored message's text. */
function textOf(item: { content?: unknown; text?: unknown }): string {
  if (typeof item.text === "string") return item.text;
  if (typeof item.content === "string") return item.content;
  return ((item.content ?? []) as Array<{ text?: string }>).map((part) => part.text ?? "").join("");
}
