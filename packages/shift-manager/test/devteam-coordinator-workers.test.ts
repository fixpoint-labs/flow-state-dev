/**
 * DevTeam's coordinator worker, `eng.triage`, on the real Lab: a `WORKER.md`
 * on the built-in `coordinator` flow with the EM as its one delegate and
 * `routing: everyone`, so a message to it reaches the EM as a routed task
 * (FIX-2083) with no model call of the coordinator's own, and the EM answers
 * it in that conversation under its own name. The EM is the only worker it
 * hands to: its turn files the coder's task on the board of the session the
 * routed task reached, which is how the test knows the message reached
 * `eng.em` rather than any worker.
 *
 * Only the EM's turn has a model, scripted to file the feature the message names:
 * `everyone` neither evaluates nor runs a judgment turn of the coordinator's
 * own. A resolver that throws for any other block proves it.
 */
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { FlowInstance, ModelResolver } from "@flow-state-dev/core/types";
import { inMemoryStores, runAction } from "@flow-state-dev/engine";
import type { GeneratorModel } from "@flow-state-dev/core/types";
import { selectHarness } from "../teams/devteam/harness.mts";
import { PHASE } from "../teams/devteam/phase.mts";
import { LAB_ORG_ID, LAB_USER_ID, openLab, type Lab } from "../teams/devteam/host.mts";
import { EM_TURN } from "../teams/devteam/workforce/flows/workers/em.mts";

/** A project the EM names on the coder's task: the coder's flow refuses a task filed with none (FIX-2333). */
const STOREFRONT = { visibility: "shared", id: "storefront" } as const;

let opened: Lab | undefined;
afterEach(async () => {
  await opened?.dispose();
  opened = undefined;
});

/** Every block the Lab asked a model for: a message routed to everyone asks for the EM's alone. */
let asked: string[] = [];

/** The EM's turn for this test: one model, whose steps run on across its calls. */
let em: GeneratorModel | undefined;

/** The EM's turn: it files the feature the message's own line names, for the coder, then says so. */
function emTurn(): GeneratorModel {
  let step = 0;
  return {
    modelId: "test/em",
    async generate() {
      throw new Error("the owned tool loop calls generateStep");
    },
    async generateStep(call: { messages?: Array<{ role: string; content: unknown }> }) {
      step += 1;
      if (step > 1) return { text: "Filed.", finishReason: "stop" };
      const said = JSON.stringify(call.messages ?? []);
      const [, issue, goal] = /(report-[a-f0-9]{6}): ([^"\\]+)/.exec(said) ?? [];
      return {
        toolCalls: [{ toolCallId: "em-1", toolName: "createTask", args: { goal, assignee: "eng.coder", input: { harnessFeature: { issue, phase: PHASE }, project: STOREFRONT } } }],
        finishReason: "tool-calls",
      };
    },
  } as unknown as GeneratorModel;
}

/** A resolver that answers the EM's turn alone, recording who asked. */
const noModel = Object.assign(
  (id: string, block?: string) => {
    asked.push(block ?? id);
    if (block === EM_TURN) return (em ??= emTurn());
    throw new Error(`no model in this test: ${block ?? id} asked for one`);
  },
  {
    resolveId: (id: string) => id,
    resolveEvaluationModel: () => {
      asked.push("evaluation");
      throw new Error("no evaluation model in this test");
    },
  },
) as unknown as ModelResolver;

async function open(): Promise<Lab> {
  const harness = selectHarness();
  asked = [];
  em = undefined;
  opened = await openLab({
    modelResolver: noModel,
    stores: inMemoryStores(),
    harness: harness.slot,
    runTimeoutMs: harness.runTimeoutMs,
    workspace: { root: mkdtempSync(join(tmpdir(), "devteam-coordinator-workers-")), remotes: { allow: ["file"] } },
    coderWorkerId: "eng.coder",
    inventory: true,
  });
  return opened;
}

/** A conversation with `workerId`, opened as an app does: a session on the coordinator flow, naming it. */
async function conversation(lab: Lab, workerId: string): Promise<string> {
  const sessionId = `s-${workerId}-${globalThis.crypto.randomUUID()}`;
  const created = await lab.door("POST", "coordinator/sessions", { body: { userId: LAB_USER_ID, sessionId, state: { workerId } } });
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
  while ((await runtime.stores.request.list({})).some((r) => r.status === "in_progress")) {
    if (Date.now() > deadline) throw new Error("a request never finished");
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  const requests = await runtime.stores.request.list({ sessionId, withItems: true });
  return requests.sort((a, b) => a.createdAt - b.createdAt).flatMap((r) => ((r as unknown as { items?: any[] }).items ?? []));
}

/** A stored message's text. */
function textOf(item: { content?: unknown; text?: unknown }): string {
  if (typeof item.text === "string") return item.text;
  if (typeof item.content === "string") return item.content;
  return ((item.content ?? []) as Array<{ text?: string }>).map((part) => part.text ?? "").join("");
}

describe("DevTeam's triage coordinator", () => {
  const workerId = "eng.triage";
  it(`${workerId} is a worker on the coordinator flow whose one delegate is the EM, which takes tasks`, async () => {
    const lab = await open();
    const id = await conversation(lab, workerId);
    const listed = await act(lab, id, "listDelegates", {});
    expect(listed.error).toBeUndefined();
    expect(listed.output.delegates).toEqual([
      {
        worker: "eng.em",
        description: "Files each feature as a task for the coder, and keeps the workstream it leads current; never does the work itself.",
        takes: "tasks",
      },
    ]);
  });

  it(`a message to ${workerId} reaches eng.em with no model call of its own, and the EM files the feature it carries`, async () => {
    const lab = await open();
    const id = await conversation(lab, workerId);
    const issue = `report-${globalThis.crypto.randomUUID().slice(0, 6)}`;
    expect((await act(lab, id, "respond", { message: `${issue}: the cart badge is off by one` })).error).toBeUndefined();
    // The EM's routed task stays open while the coder's task it filed runs (FIX-2083, rule 6):
    // its answer lands once that work ends.
    let items = await settledItems(lab, id);
    for (const until = Date.now() + 10_000; Date.now() < until; ) {
      if (items.some((item) => item.type === "message" && item.agentName === "eng.em")) break;
      await new Promise((resolve) => setTimeout(resolve, 50));
      items = await settledItems(lab, id);
    }
    expect([...new Set(asked)]).toEqual([EM_TURN]);
    const [record] = items.filter((item) => item.type === "component" && item.component === "coordinator-route");
    expect(record.data).toMatchObject({ by: "everyone", delegates: [{ worker: "eng.em", outcome: "delivered" }] });
    // The board of the EM session the routed task reached holds the coder's task only the EM files, and
    // its answer lands here under its name.
    const filed = Object.values(await lab.stored("user", "tasks/")).filter((row: any) => row.input?.harnessFeature?.issue === issue);
    expect(filed).toEqual([expect.objectContaining({ goal: "the cart badge is off by one", assignee: "eng.coder" })]);
    const answers = items.filter((item) => item.type === "message" && item.agentName === "eng.em").map(textOf);
    expect(answers).toEqual(["Filed."]);
  });
});
