/**
 * Shift Manager's Inbox, against a real Lab: the snapshot's `inbox` section is
 * orchestration's one item type, and `reconcileInbox` is green on it.
 *
 * The check's truth is read apart from the list: each listed session's
 * suspended requests with their items, never the session item log the asks
 * are read from, and the board's rows through the Lab's collection read. Each
 * control breaks the list one way and must turn the check red.
 */
import { afterEach, describe, expect, it } from "vitest";
import { readEveryCollectionPage, type Client } from "@flow-state-dev/client";
import { createInboxClient } from "@flow-state-dev/orchestration/inbox";
import { reconcileInbox, rowTruthOf, suspensionTruthOf, taskItemId, type InboxTruth } from "@flow-state-dev/orchestration/inbox/check";
import { COORDINATOR_FLOW } from "@flow-state-dev/workforce";
import { connect } from "../src/lib/connection";
import {
  CONVERSATION_BOARD_COLLECTION,
  conversationBoardRef,
  conversationOfTopic,
  createLabReader,
  inboxSection,
  toBoardRow,
  type BoardRow,
  type LabSnapshot,
} from "../src/lib/reads";
import { ASK_LAB_USER_ID, openAskLab } from "./fixtures/ask-lab/lab.mts";
import { ASKER_FLOW } from "./fixtures/ask-lab/asker.mts";
import { eventually, serveLab, type ServedLab } from "./helpers/serve-lab";

const served: ServedLab[] = [];
afterEach(async () => {
  await Promise.all(served.splice(0).map((lab) => lab.handle.close()));
});

async function lab() {
  const opened = await openAskLab();
  const s = await serveLab(opened.flowState);
  served.push(s);
  return connect({ baseUrl: s.baseUrl, userId: ASK_LAB_USER_ID });
}

type Loaded = Exclude<LabSnapshot, { refused: object } | { unreachable: object }>;

/** Every board row the user's ledger holds, read through `sessionId`'s flow, not through the Lab reader. */
async function boardRows(client: Client, sessionId: string): Promise<BoardRow[]> {
  const rows = await readEveryCollectionPage(client.resources, sessionId, CONVERSATION_BOARD_COLLECTION, { limit: 200 });
  return rows.map((row) => {
    const holder = conversationOfTopic(row.topic);
    return toBoardRow(conversationBoardRef(holder), holder, row.topic, row.clientData);
  });
}

/** The truth: every listed session's suspended requests, and the board's rows. */
async function readTruth(client: Client, rows: BoardRow[]): Promise<InboxTruth> {
  const sessions = await client.sessions.list({ include: "dispatch-runs" });
  const suspensions = [];
  for (const session of sessions) {
    suspensions.push(...suspensionTruthOf(session.id, await client.sessions.requests(session.id, { status: "suspended", includeItems: true })));
  }
  return { suspensions, rows: rowTruthOf(rows.map((row) => ({ ...row, board: row.boardRef }))) };
}

/**
 * The first read listing `count` items, each answerable. A row can record its run's stop before
 * the session listing a read began with holds the run, and the item then reads unanswerable for
 * that one read: the next one names the run's flow.
 */
async function settled(client: Client, count: number): Promise<Loaded> {
  const reader = createLabReader(client);
  return eventually(async () => {
    const snapshot = (await reader.read()) as Loaded;
    return snapshot.inbox?.ok && snapshot.inbox.value.length === count && snapshot.inbox.value.every((i) => i.answerable) ? snapshot : undefined;
  }, `${count} answerable Inbox item(s)`);
}

describe("the Inbox against a real Lab", () => {
  it("a task run's approval lists once, from its row, answerable; the answer closes it", async () => {
    const client = await lab();
    // The desk hands the post to its two delegates, each as a task whose run stops for the user's approval.
    await client.flow(COORDINATOR_FLOW).send("respond", { message: "ship it" }, { sessionId: "ops.desk" });
    const snapshot = await settled(client, 2);
    const items = snapshot.inbox.ok ? snapshot.inbox.value : [];
    for (const item of items) {
      expect(item.task).not.toBeNull();
      expect(item.id).toBe(taskItemId(item.task!.board, item.task!.taskId));
      expect(item).toMatchObject({ answerable: true, unanswerable: null, questions: [expect.objectContaining({ source: expect.objectContaining({ kind: "suspension" }), answerable: true })] });
      // Drawn with the pending ask the run's session holds, though it lists from the row.
      expect(item.questions[0]!.detail?.item.suspensionId).toBe(item.questions[0]!.id);
    }
    const rows = await boardRows(client, "ops.desk");
    const truth = await readTruth(client, rows);
    expect(truth.suspensions.filter((s) => s.taskRun)).toHaveLength(2);
    // Green, the answerable clause included: FIX-2129's route answers a task run's stop.
    expect(reconcileInbox(items, truth)).toEqual({ green: true, missing: [], duplicate: [], orphan: [], drift: [], unanswerable: [], reopened: [] });

    // Control duplicate-item: red.
    // The item twice, and with it the stop it shows.
    expect(reconcileInbox([...items, items[0]!], truth)).toMatchObject({ green: false, duplicate: [items[0]!.id, items[0]!.questions[0]!.id] });
    // Control drop-row-holds: the same reads listed without the boards. Red: the tasks' items are missing.
    const dropped = inboxSection(snapshot.asks, {}, snapshot.sessions);
    const droppedResult = reconcileInbox(dropped.ok ? dropped.value : [], truth);
    expect(droppedResult.green).toBe(false);
    expect(droppedResult.missing.sort()).toEqual(items.map((i) => i.id).sort());
    // The answerable clause can still fail: the same reads with no session or ask naming its flow.
    const flowless = snapshot.asks.ok ? { ok: true as const, value: snapshot.asks.value.map((ask) => ({ ...ask, flowId: null })) } : snapshot.asks;
    const noFlows = inboxSection(flowless, snapshot.boards, []);
    expect(reconcileInbox(noFlows.ok ? noFlows.value : [], truth).unanswerable).toHaveLength(2);

    // Answer the first through the Inbox's one call. Its item goes, and stays gone.
    const answered = items[0]!;
    await createInboxClient(client).answer(answered, { approved: true });
    const after = await settled(client, 1);
    const left = after.inbox.ok ? after.inbox.value : [];
    const rowsAfter = await boardRows(client, "ops.desk");
    const truthAfter = await readTruth(client, rowsAfter);
    expect(reconcileInbox(left, { ...truthAfter, closed: [answered.questions[0]!.id] })).toMatchObject({ green: true });
    // Control mirror-skips-close: the row as it was before the resume, against the stops as they are now. Red.
    const stale = reconcileInbox(left, { ...truthAfter, rows: truth.rows });
    expect(stale.green).toBe(false);
    expect(stale.drift).toEqual([`hold ${answered.questions[0]!.id} on ${answered.task!.board}:${answered.task!.taskId}: no live stop`]);
  });

  it("a user's own ask, with no task row: listed once, on its own, answerable and green", async () => {
    const client = await lab();
    const sessionId = "s_ops_loner";
    await client.flow(ASKER_FLOW).createSession({ sessionId, state: { workerId: "ops.loner" } });
    await client.flow(ASKER_FLOW).send("ask", { what: "ship it" }, { sessionId });
    const snapshot = await settled(client, 1);
    const items = snapshot.inbox.ok ? snapshot.inbox.value : [];
    expect(items[0]).toMatchObject({ task: null, answerable: true, questions: [expect.objectContaining({ source: expect.objectContaining({ kind: "suspension" }) })] });
    const truth = await readTruth(client, await boardRows(client, sessionId));
    expect(reconcileInbox(items, truth)).toMatchObject({ green: true });
  });
});
