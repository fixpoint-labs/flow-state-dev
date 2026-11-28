/**
 * A conversation's task actions, against a real Lab: the board actions the
 * task screens act through (`useBoardActions`: orchestration's
 * `inbox.board(...)` bound to the conversation and the flow that owns it), and
 * each step read back through the inbox view's tasks, the rows Tasks and a
 * task's screen draw (`useInbox`), never the action's return alone.
 *
 * The re-file leg is the reason the row model reads `context`: a re-file from
 * the row a screen drew must carry the brief the row was filed with.
 */
import { afterEach, describe, expect, it } from "vitest";
import type { Client } from "@flow-state-dev/client";
import { createInboxClient, taskActionName } from "@flow-state-dev/orchestration/inbox";
import { COORDINATOR_FLOW } from "@flow-state-dev/workforce";
import { inboxViewRef } from "@flow-state-dev/workforce/browser";
import { connect } from "../src/lib/connection";
import { CONVERSATION_BOARD_COLLECTION } from "../src/lib/boards";
import { ASK_LAB_USER_ID, openAskLab } from "./fixtures/ask-lab/lab.mts";
import { ASKER_FLOW } from "./fixtures/ask-lab/asker.mts";
import { eventually, serveLab, type ServedLab } from "./helpers/serve-lab";

const served: ServedLab[] = [];
afterEach(async () => {
  await Promise.all(served.splice(0).map((lab) => lab.handle.close()));
});

const CONVERSATION = "ops.desk";

async function lab(): Promise<Client> {
  const opened = await openAskLab();
  const s = await serveLab(opened.flowState);
  served.push(s);
  return connect({ baseUrl: s.baseUrl, userId: ASK_LAB_USER_ID });
}

/** The conversation's board, as the inbox view answers it: finished rows too, as Jump to asks. */
async function readBoard(client: Client) {
  return (await client.view(inboxViewRef, { done: true })).value.tasks.filter((task) => task.ownerSessionId === CONVERSATION);
}

/** The task actions a screen binds for the conversation: `useBoardActions`' call. */
const boardActions = (client: Client, flowId: string) => createInboxClient(client).board({ flowId, sessionId: CONVERSATION, board: CONVERSATION_BOARD_COLLECTION });

/** File a row on the conversation's board directly, as a worker would, and wait for it to show. */
async function file(client: Client, goal: string, context: string) {
  await client.flow(COORDINATOR_FLOW).send(taskActionName("createTask", CONVERSATION_BOARD_COLLECTION), { goal, context }, { sessionId: CONVERSATION });
  return eventually(async () => (await readBoard(client)).find((row) => row.goal === goal), `the row "${goal}"`);
}

describe("a conversation's task actions, against a real Lab", () => {
  it("steers, cancels and re-files a conversation's task, and a finished task refuses a steer", async () => {
    const client = await lab();
    const flowId = (await client.sessions.get(CONVERSATION)).flowId!;
    const row = await file(client, "draft the release notes", "Keep it to the user-facing changes.");
    // The row model reads the brief's context, which a re-file needs.
    expect(row.context).toBe("Keep it to the user-facing changes.");

    const actions = boardActions(client, flowId);
    await actions.steer(row.id, "mention the new retry button");
    const steered = (await readBoard(client)).find((r) => r.id === row.id)!;
    expect(steered.steers).toHaveLength(1);

    await expect(actions.cancel(row.id)).resolves.toEqual([]);
    expect((await readBoard(client)).find((r) => r.id === row.id)?.status).toBe("cancelled");

    // Refusal: the board's own words, and nothing written.
    await expect(actions.steer(row.id, "too late")).rejects.toThrow(/finished|cancelled/i);
    expect((await readBoard(client)).find((r) => r.id === row.id)!.steers).toHaveLength(1);

    // Re-file the row as the view drew it, with one field overridden.
    const cancelled = (await readBoard(client)).find((r) => r.id === row.id)!;
    // A drawn row's goal is nullable and its priority is text, so those two are mapped; the rest copies as drawn.
    const refiled = await actions.refile({ ...cancelled, goal: cancelled.goal!, priority: null }, { title: "Release notes, again" });
    const fresh = (await readBoard(client)).find((r) => r.id === refiled)!;
    expect(fresh).toMatchObject({ status: "pending", goal: row.goal, context: row.context, title: "Release notes, again" });
    expect(fresh.id).not.toBe(row.id);
  });

  it("control: bound to a flow that doesn't hold the board, every action rejects", async () => {
    const client = await lab();
    const flowId = (await client.sessions.get(CONVERSATION)).flowId!;
    // The control's flow is not the one that holds the board, so every action it binds misses it.
    expect(ASKER_FLOW).not.toBe(flowId);
    const row = await file(client, "a row the wrong flow can't reach", "none");
    const wrong = boardActions(client, ASKER_FLOW);
    await expect(wrong.steer(row.id, "hello")).rejects.toThrow();
    await expect(wrong.cancel(row.id)).rejects.toThrow();
    expect((await readBoard(client)).find((r) => r.id === row.id)).toMatchObject({ status: "pending", steers: [] });
  });
});
