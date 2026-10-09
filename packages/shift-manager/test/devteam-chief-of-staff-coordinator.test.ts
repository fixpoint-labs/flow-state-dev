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
 * conversation's list, with what each takes), BR-9's record of a default that
 * can't take a post (the coder, which takes tasks), naming the delegate that
 * can, and the EM as a delegate that takes posts: it
 * files the feature line a handed-on post carries, or says it filed nothing.
 */
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { FlowInstance, GeneratorModel, ModelResolver } from "@flow-state-dev/core/types";
import { inMemoryStores, runAction } from "@flow-state-dev/engine";
import { harnessTaskId } from "@flow-state-dev/harness-manager/checkout";
import { selectHarness } from "../teams/devteam/harness.mts";
import { PHASE } from "../teams/devteam/phase.mts";
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

async function open(stores: ReturnType<typeof inMemoryStores> = inMemoryStores()): Promise<Lab> {
  const harness = selectHarness();
  opened = await openLab({
    modelResolver: Object.assign((...args: Parameters<ModelResolver>) => model!(...args), { resolveId: (id: string) => id }),
    stores,
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

describe("the chief of staff as a coordinator (S10)", () => {
  it("runs on the coordinator flow, by judgment, its delegates starting from the standard workers its file names (BR-33, BR-10)", async () => {
    const lab = await open();
    const runtime = await lab.state.getRuntime();
    expect(runtime.registry.get("coordinator")).toBeDefined();
    const id = await conversation(lab);
    const listed = await act(lab, id, "listDelegates", {});
    expect(listed.error).toBeUndefined();
    // What each one does (its WORKER.md description) and takes: the EM's flow takes posts and the
    // coder's only tasks. What the chief of staff picks a hand-off by.
    expect(listed.output.delegates).toEqual([
      { worker: "eng.em", description: "Files each feature on the team's board; never does the work itself.", takes: "posts" },
      { worker: "eng.coder", description: "Does the work a filed row names, in a checkout of its own.", takes: "tasks" },
    ]);
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
    model = scripted([{ toolName: "handOff", args: { worker: "eng.coder" } }]);
    expect((await act(lab, id, "run", { message: "plan the release" })).error).toBeUndefined();
    const items = await settledItems(lab, id);
    const [record] = items.filter((item) => item.type === "component" && item.component === "coordinator-route");
    expect(record.data.delegates).toEqual([
      {
        worker: "eng.coder",
        outcome: "skipped",
        reason: 'Worker "eng.coder" runs on flow "coder", which can\'t take a delegated post. Delegates here that take posts: eng.em.',
      },
    ]);
  });

  it("hands feature work to its EM delegate, which files the post's feature line and says so (BR-12, BR-20)", async () => {
    const lab = await open();
    const id = await conversation(lab);
    const issue = `cart-${globalThis.crypto.randomUUID().slice(0, 6)}`;
    model = scripted([{ toolName: "handOff", args: { worker: "eng.em" } }]);
    const post = `Get this filed for the team:\n${issue}: show a badge on the cart`;
    expect((await act(lab, id, "run", { message: post })).error).toBeUndefined();
    const items = await settledItems(lab, id);
    const [record] = items.filter((item) => item.type === "component" && item.component === "coordinator-route");
    expect(record.data).toMatchObject({ by: "judgment", delegates: [{ worker: "eng.em", outcome: "delivered" }] });
    // The row the door would file for the line typed alone, on the EM's board.
    const taskId = harnessTaskId(issue, PHASE);
    expect((await lab.row(taskId))?.goal).toBe("show a badge on the cart");
    // The EM's answer lands under its name, once.
    const answers = items.filter((item) => item.type === "message" && item.agentName === "eng.em").map(textOf);
    expect(answers).toEqual([`Filed ${taskId} on the board.`]);
  });

  // Only a whole line in the door's feature shape files: not a colon inside a
  // sentence, not a label, not a link, and nothing in the delivery's heading.
  for (const post of [
    "can the team make the cart nicer?",
    "Please investigate: https://example.com",
    "Context: label: value",
    "Look at this one:\nhttps://example.com/cart",
  ]) {
    it(`has its EM delegate file nothing, and say so, for ${JSON.stringify(post)}`, async () => {
      const lab = await open();
      const id = await conversation(lab);
      model = scripted([{ toolName: "handOff", args: { worker: "eng.em" } }]);
      const before = Object.keys(await lab.rows()).length;
      expect((await act(lab, id, "run", { message: post })).error).toBeUndefined();
      const items = await settledItems(lab, id);
      const answers = items.filter((item) => item.type === "message" && item.agentName === "eng.em").map(textOf);
      expect(answers).toEqual([
        'Nothing filed: the line does not name a feature; this seat files from "<issue-slug>: <what the feature is>".',
      ]);
      expect(Object.keys(await lab.rows())).toHaveLength(before);
    });
  }

  it("tells a coordinator with rounds when the EM's handed-on run is cancelled, so the round doesn't wait for its deadline", async () => {
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
                if (JSON.stringify(args)?.includes(issue)) await held;
                return value.apply(target, args);
              };
            },
          });
        }
        return registry;
      },
    });
    // A coordinator of the person's own, with a round to send answers on, and the EM as its delegate.
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
    model = scripted([{ toolName: "handOff", args: { worker: "eng.em" } }]);
    expect((await act(lab, id, "run", { message: `${issue}: the release notes` })).error).toBeUndefined();

    const runtime = await lab.state.getRuntime();
    let running: { id: string } | undefined;
    for (const until = Date.now() + 5_000; running === undefined && Date.now() < until; await new Promise((r) => setTimeout(r, 20))) {
      running = (await runtime.stores.request.list({})).find((r) => r.status === "in_progress" && r.actionName === "onDelegatedPost");
    }
    expect(running, "the EM's handed-on run never started").toBeDefined();
    expect((await lab.door("POST", `em/requests/${running!.id}/abort`)).status).toBe(204);
    // The held write gives up, as a store call does when its request is cancelled under it.
    abandon(new Error("the write was abandoned: its request was cancelled"));
    await settledItems(lab, id);

    const deliveries = ((await runtime.stores.session.get(id))?.state as { deliveries: any[] }).deliveries;
    expect(deliveries.find((d) => d.delegate.worker === "eng.em")).toMatchObject({
      answered: false,
      missed: "its turn failed: its run was cancelled",
    });
  });
});

/** A stored message's text. */
function textOf(item: { content?: unknown; text?: unknown }): string {
  if (typeof item.text === "string") return item.text;
  if (typeof item.content === "string") return item.content;
  return ((item.content ?? []) as Array<{ text?: string }>).map((part) => part.text ?? "").join("");
}
