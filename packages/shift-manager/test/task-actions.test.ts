/**
 * The Lab reader's task actions, against a real Lab: `taskActions` hands back
 * orchestration's board actions for one conversation, and each step is read
 * back through the reader's own board read, never the action's return alone.
 *
 * The re-file leg is the reason the row model reads `context`: a re-file from
 * the row the reader drew must carry the brief the row was filed with.
 */
import { afterEach, describe, expect, it } from "vitest";
import type { Client } from "@flow-state-dev/client";
import { taskActionName } from "@flow-state-dev/orchestration/inbox";
import { COORDINATOR_FLOW } from "@flow-state-dev/workforce";
import { connect } from "../src/lib/connection";
import { CONVERSATION_BOARD_COLLECTION, createLabReader, type BoardRow } from "../src/lib/reads";
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

/** File a row on the conversation's board directly, as a worker would, and wait for it to show. */
async function file(client: Client, goal: string, context: string): Promise<BoardRow> {
  await client.flow(COORDINATOR_FLOW).send(taskActionName("createTask", CONVERSATION_BOARD_COLLECTION), { goal, context }, { sessionId: CONVERSATION });
  const reader = createLabReader(client);
  return eventually(async () => (await reader.readBoard(CONVERSATION)).find((row) => row.goal === goal), `the row "${goal}"`);
}

describe("the Lab reader's task actions, against a real Lab", () => {
  it("steers, cancels and re-files a conversation's task, and a finished task refuses a steer", async () => {
    const client = await lab();
    const reader = createLabReader(client);
    const flowId = (await client.sessions.get(CONVERSATION)).flowId!;
    const row = await file(client, "draft the release notes", "Keep it to the user-facing changes.");
    // The row model reads the brief's context, which a re-file needs.
    expect(row.context).toBe("Keep it to the user-facing changes.");

    const actions = reader.taskActions({ id: CONVERSATION, flowId });
    await actions.steer(row.id, "mention the new retry button");
    const steered = (await reader.readBoard(CONVERSATION)).find((r) => r.id === row.id)!;
    expect(steered.steers).toHaveLength(1);

    await expect(actions.cancel(row.id)).resolves.toEqual([]);
    expect((await reader.readBoard(CONVERSATION)).find((r) => r.id === row.id)?.status).toBe("cancelled");

    // Refusal: the board's own words, and nothing written.
    await expect(actions.steer(row.id, "too late")).rejects.toThrow(/finished|cancelled/i);
    expect((await reader.readBoard(CONVERSATION)).find((r) => r.id === row.id)!.steers).toHaveLength(1);

    // Re-file the row the reader drew, with one field overridden.
    const cancelled = (await reader.readBoard(CONVERSATION)).find((r) => r.id === row.id)!;
    // A drawn row's goal is nullable and its priority is text, so those two are mapped; the rest copies as drawn.
    const refiled = await actions.refile({ ...cancelled, goal: cancelled.goal!, priority: null }, { title: "Release notes, again" });
    const fresh = (await reader.readBoard(CONVERSATION)).find((r) => r.id === refiled)!;
    expect(fresh).toMatchObject({ status: "pending", goal: row.goal, context: row.context, title: "Release notes, again" });
    expect(fresh.id).not.toBe(row.id);
  });

  it("control: bound to a flow that doesn't hold the board, every action rejects", async () => {
    const client = await lab();
    const reader = createLabReader(client);
    const row = await file(client, "a row the wrong flow can't reach", "none");
    const wrong = reader.taskActions({ id: CONVERSATION, flowId: ASKER_FLOW });
    await expect(wrong.steer(row.id, "hello")).rejects.toThrow();
    await expect(wrong.cancel(row.id)).rejects.toThrow();
    expect((await reader.readBoard(CONVERSATION)).find((r) => r.id === row.id)).toMatchObject({ status: "pending", steers: [] });
  });
});
