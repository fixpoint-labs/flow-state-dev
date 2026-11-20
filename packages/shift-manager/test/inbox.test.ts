/**
 * Shift Manager's Inbox, against a real Lab: the inbox view's items, which
 * Inbox, its count and the summary draw (`useInbox`), are orchestration's one
 * item type, and `reconcileInbox` is green on them.
 *
 * The check's truth is read apart from the list: each listed session's
 * suspended requests with their items, never the session item log the asks
 * are read from, and the board's rows through the Lab's collection read. Each
 * control breaks the list one way and must turn the check red.
 */
import { afterEach, describe, expect, it } from "vitest";
import { readEveryCollectionPage, type Client } from "@flow-state-dev/client";
import { createInboxClient, inboxItems, taskActionName, type InboxItem } from "@flow-state-dev/orchestration/inbox";
import { reconcileInbox, taskTruthOf, suspensionTruthOf, taskItemId, type InboxTruth } from "@flow-state-dev/orchestration/inbox/check";
import { DEFAULT_ORG_ID } from "@flow-state-dev/core";
import { COORDINATOR_FLOW, sessionIdOfFiling } from "@flow-state-dev/workforce";
import { boardTaskOf, inboxViewRef, type InboxSuspensionDetail } from "@flow-state-dev/workforce/browser";
import { connect } from "../src/lib/connection";
import type { BoardTaskView } from "../src/lib/boards";
import { CONVERSATION_BOARD_COLLECTION, conversationBoardRef } from "../src/lib/boards";
import { ASK_LAB_USER_ID, openAskLab } from "./fixtures/ask-lab/lab.mts";
import { ASKER_FLOW } from "./fixtures/ask-lab/asker.mts";
import { eventually, serveLab, type ServedLab } from "./helpers/serve-lab";

const served: ServedLab[] = [];
afterEach(async () => {
  await Promise.all(served.splice(0).map((lab) => lab.handle.close()));
});

async function lab() {
  return (await labWithState()).client;
}

async function labWithState() {
  const opened = await openAskLab();
  const s = await serveLab(opened.flowState);
  served.push(s);
  return { client: await connect({ baseUrl: s.baseUrl, userId: ASK_LAB_USER_ID }), flowState: opened.flowState };
}

type Item = InboxItem<InboxSuspensionDetail>;

/**
 * The conversation a conversation-ledger row belongs to: its topic is
 * `<partition>/<taskId>`, the partition the conversation's `filingSessionId`
 * percent-encoded into one segment.
 */
const conversationOfTopic = (topic: string): string => sessionIdOfFiling(decodeURIComponent(topic.split("/")[0] ?? ""));

/** Every board row the user's ledger holds, read through `sessionId`'s flow, not through the inbox view. */
async function boardRows(client: Client, sessionId: string): Promise<BoardTaskView[]> {
  const rows = await readEveryCollectionPage(client.resources, sessionId, CONVERSATION_BOARD_COLLECTION, { limit: 200 });
  return rows.map((row) => {
    const holder = conversationOfTopic(row.topic);
    return boardTaskOf(conversationBoardRef(holder), holder, row.topic, row.clientData);
  });
}

/** The truth: every listed session's suspended requests, and the board's rows. */
async function readTruth(client: Client, rows: BoardTaskView[]): Promise<InboxTruth> {
  const sessions = await client.sessions.list({ include: "dispatch-runs" });
  const suspensions = [];
  for (const session of sessions) {
    suspensions.push(...suspensionTruthOf(session.id, await client.sessions.requests(session.id, { status: "suspended", includeItems: true })));
  }
  return { suspensions, rows: taskTruthOf(rows.map((row) => ({ ...row, board: row.boardRef }))) };
}

/**
 * The first read listing `count` items, each answerable. A row can record its run's stop before
 * the session listing a read began with holds the run, and the item then reads unanswerable for
 * that one read: the next one names the run's flow.
 */
async function settled(client: Client, count: number): Promise<Item[]> {
  return eventually(async () => {
    const { items } = (await client.view(inboxViewRef, {})).value;
    return items.length === count && items.every((i) => i.answerable) ? items : undefined;
  }, `${count} answerable Inbox item(s)`);
}

describe("the Inbox against a real Lab", () => {
  it("a task run's approval lists once, from its row, answerable; the answer closes it", async () => {
    const client = await lab();
    // The desk hands the post to its two delegates, each as a task whose run stops for the user's approval.
    await client.flow(COORDINATOR_FLOW).send("respond", { message: "ship it" }, { sessionId: "ops.desk" });
    const items = await settled(client, 2);
    for (const item of items) {
      expect(item.task).not.toBeNull();
      expect(item.id).toBe(taskItemId(item.task!.board, item.task!.taskId));
      expect(item).toMatchObject({ answerable: true, unanswerable: null, holds: [expect.objectContaining({ source: expect.objectContaining({ kind: "suspension" }), answerable: true })] });
      // Drawn with the pending ask the run's session holds, though it lists from the row.
      expect(item.holds[0]!.detail?.suspensionId).toBe(item.holds[0]!.id);
    }
    const rows = await boardRows(client, "ops.desk");
    const truth = await readTruth(client, rows);
    expect(truth.suspensions.filter((s) => s.taskRun)).toHaveLength(2);
    // Green, the answerable clause included: FIX-2129's route answers a task run's stop.
    expect(reconcileInbox(items, truth)).toEqual({ green: true, missing: [], duplicate: [], orphan: [], drift: [], unanswerable: [], reopened: [] });

    // Control duplicate-item: red.
    // The item twice, and with it the stop it shows.
    expect(reconcileInbox([...items, items[0]!], truth)).toMatchObject({ green: false, duplicate: [items[0]!.id, items[0]!.holds[0]!.id] });
    // Control drop-row-holds: the list without the boards' items. Red: the tasks' items are missing.
    const droppedResult = reconcileInbox(items.filter((i) => i.task === null), truth);
    expect(droppedResult.green).toBe(false);
    expect(droppedResult.missing.sort()).toEqual(items.map((i) => i.id).sort());
    // The answerable clause can still fail. The same rows and stops, listed again through the production
    // list (orchestration's `inboxItems`, which the server's view lists through), once with each stop's flow
    // and each session's owner as the view hands them over, and once with none of them naming a flow.
    const stops = items.flatMap((i) => i.holds).flatMap((h) => (h.detail === undefined ? [] : [h.detail]));
    const relist = (flowOf: (sessionId: string) => string | null | undefined, flowIdOf: (stop: InboxSuspensionDetail) => string | null) =>
      inboxItems<InboxSuspensionDetail>({
        rows: rows.map((row) => ({ ...row, board: row.boardRef, holder: { sessionId: row.ownerSessionId, action: taskActionName("updateTask", CONVERSATION_BOARD_COLLECTION) } })),
        suspensions: stops.map((stop) => ({ sessionId: stop.sessionId!, flowId: flowIdOf(stop), requestId: stop.requestId, suspensionId: stop.suspensionId, kind: stop.kind, prompt: stop.message, since: stop.createdAt, detail: stop })),
        flowOf,
      });
    const sessions = await client.sessions.list({ include: "dispatch-runs" });
    const ownerOf = new Map(sessions.map((s) => [s.id, s.flowId ?? null]));
    expect(stops).toHaveLength(2);
    expect(reconcileInbox(relist((id) => ownerOf.get(id), (stop) => stop.flowId ?? null), truth).unanswerable).toEqual([]);
    expect(reconcileInbox(relist(() => undefined, () => null), truth).unanswerable).toHaveLength(2);

    // Answer the first through the Inbox's one call. Its item goes, and stays gone.
    const answered = items[0]!;
    await createInboxClient(client).answer(answered, { approved: true });
    const left = await settled(client, 1);
    const rowsAfter = await boardRows(client, "ops.desk");
    const truthAfter = await readTruth(client, rowsAfter);
    expect(reconcileInbox(left, { ...truthAfter, closed: [answered.holds[0]!.id] })).toMatchObject({ green: true });
    // Control mirror-skips-close: the row as it was before the resume, against the stops as they are now. Red.
    const stale = reconcileInbox(left, { ...truthAfter, rows: truth.rows });
    expect(stale.green).toBe(false);
    expect(stale.drift).toEqual([`question ${answered.holds[0]!.id} on ${answered.task!.board}:${answered.task!.taskId}: no live stop`]);
  });

  it("a user's own ask, with no task: listed once, on its own, answerable and green", async () => {
    const client = await lab();
    const sessionId = "s_ops_loner";
    await client.flow(ASKER_FLOW).createSession({ sessionId, state: { workerId: "ops.loner" } });
    await client.flow(ASKER_FLOW).send("ask", { what: "ship it" }, { sessionId });
    const items = await settled(client, 1);
    expect(items[0]).toMatchObject({ task: null, answerable: true, holds: [expect.objectContaining({ source: expect.objectContaining({ kind: "suspension" }) })] });
    const truth = await readTruth(client, await boardRows(client, sessionId));
    expect(reconcileInbox(items, truth)).toMatchObject({ green: true });
  });
});
