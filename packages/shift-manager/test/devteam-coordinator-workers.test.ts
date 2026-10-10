/**
 * DevTeam's two coordinator workers, `eng.triage` and `ops.oncall`, on the
 * real Lab: each is a `WORKER.md` on the built-in `coordinator` flow with the
 * EM as its one delegate and `routing: everyone`, so a post to either reaches
 * the EM with no model call of the coordinator's own, and the EM answers it in
 * that conversation under its own name. The EM is the only worker either one
 * hands to: a post carrying a feature line is filed on the EM's board, which
 * is how the test knows the post reached `eng.em` rather than any worker.
 *
 * No model is scripted to answer: `everyone` neither evaluates nor runs a
 * judgment turn, and the EM files from the line itself. A resolver that throws
 * when asked for any model proves both.
 */
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { FlowInstance, ModelResolver } from "@flow-state-dev/core/types";
import { inMemoryStores, runAction } from "@flow-state-dev/engine";
import { harnessTaskId } from "@flow-state-dev/harness-manager/checkout";
import { selectHarness } from "../teams/devteam/harness.mts";
import { PHASE } from "../teams/devteam/phase.mts";
import { LAB_ORG_ID, LAB_USER_ID, openLab, type Lab } from "../teams/devteam/host.mts";
import { createNotifyLog } from "../teams/devteam/notify.mts";

let opened: Lab | undefined;
afterEach(async () => {
  await opened?.dispose();
  opened = undefined;
});

/** Every model the Lab asked for, by block: a post routed to everyone asks for none. */
let asked: string[] = [];

/** A resolver that answers no model at all, recording who asked. */
const noModel = Object.assign(
  (id: string, block?: string) => {
    asked.push(block ?? id);
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
  opened = await openLab({
    modelResolver: noModel,
    stores: inMemoryStores(),
    harness: harness.slot,
    runTimeoutMs: harness.runTimeoutMs,
    workspace: { root: mkdtempSync(join(tmpdir(), "devteam-coordinator-workers-")), remotes: { allow: ["file"] } },
    coderSeatId: "eng.coder",
    mailboxes: { addresses: {}, log: createNotifyLog() },
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

describe("DevTeam's triage and oncall coordinators", () => {
  for (const workerId of ["eng.triage", "ops.oncall"]) {
    it(`${workerId} is a worker on the coordinator flow whose one delegate is the EM, which takes posts`, async () => {
      const lab = await open();
      const id = await conversation(lab, workerId);
      const listed = await act(lab, id, "listDelegates", {});
      expect(listed.error).toBeUndefined();
      expect(listed.output.delegates).toEqual([
        { worker: "eng.em", description: "Files each feature on the team's board; never does the work itself.", takes: "posts" },
      ]);
    });

    it(`a post to ${workerId} reaches eng.em with no model call, and the EM files the feature it carries`, async () => {
      const lab = await open();
      const id = await conversation(lab, workerId);
      const issue = `report-${globalThis.crypto.randomUUID().slice(0, 6)}`;
      expect((await act(lab, id, "run", { message: `${issue}: the cart badge is off by one` })).error).toBeUndefined();
      const items = await settledItems(lab, id);
      expect(asked).toEqual([]);
      const [record] = items.filter((item) => item.type === "component" && item.component === "coordinator-route");
      expect(record.data).toMatchObject({ by: "everyone", delegates: [{ worker: "eng.em", outcome: "delivered" }] });
      // The EM's board holds the row only the EM files, and its answer lands here under its name.
      const taskId = harnessTaskId(issue, PHASE);
      expect((await lab.row(taskId))?.goal).toBe("the cart badge is off by one");
      const answers = items.filter((item) => item.type === "message" && item.agentName === "eng.em").map(textOf);
      expect(answers).toEqual([`Filed ${taskId} on the board.`]);
    });
  }
});
