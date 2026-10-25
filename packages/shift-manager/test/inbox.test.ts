/**
 * The Inbox list and its check (`src/lib/inbox.ts`).
 *
 * The check is only worth anything if it fails when the list is wrong, so each
 * clause has a control here that breaks the list one way and must turn the
 * check red: a duplicated item, the held-question arm dropped, a row in both
 * arms, a closed item back. Against a real Lab, the check's truth is read
 * apart from the list: each listed session's suspended requests, with their
 * items, never the session item log the Inbox reads its asks from.
 */
import { afterEach, describe, expect, it } from "vitest";
import type { Client, SessionRequestSummary } from "@flow-state-dev/client";
import { COORDINATOR_FLOW } from "@flow-state-dev/workforce";
import { connect } from "../src/lib/connection";
import {
  inboxItems,
  questionItemId,
  reconcileInbox,
  suspensionItemId,
  suspensionTruthOf,
  type InboxItem,
  type InboxTruth,
} from "../src/lib/inbox";
import { createLabReader, DISPATCHED_RUN_UNANSWERABLE, PERSON_REASONS, toBoardRow, type Ask, type BoardRow, type LabSnapshot } from "../src/lib/reads";
import { ASK_LAB_USER_ID, openAskLab } from "./fixtures/ask-lab/lab.mts";
import { ASKER_FLOW } from "./fixtures/ask-lab/asker.mts";
import { eventually, serveLab, type ServedLab } from "./helpers/serve-lab";

const ask = (suspensionId: string, over: Partial<Ask> = {}): Ask => ({
  sessionId: `s_${suspensionId}`,
  workerId: "ops.a",
  flowId: "asker",
  parentSessionId: null,
  kind: "approval",
  item: { suspensionId, requestId: `r_${suspensionId}`, reason: "human_approval", message: "ok?" } as Ask["item"],
  since: 10,
  unanswerable: null,
  ...over,
});

/** A board row as its board publishes it, holding `questions`. */
const held = (id: string, questions: Array<{ id: string; prompt: string; askedAt: number; open: boolean }>, data: Record<string, unknown> = {}): BoardRow =>
  toBoardRow("s_desk.tasks", "s_desk", `s_desk/${id}`, { id, goal: `do ${id}`, status: "pending", questions, ...data });

const T1 = held("t1", [
  { id: "q1", prompt: "Which CSV export should the script read?", askedAt: 5, open: true },
  { id: "q2", prompt: "Which date column?", askedAt: 6, open: true },
]);

/** The truth for `asks` and `rows` as they should be: each ask's suspension, each held row's questions. */
function truthOf(asks: Ask[], rows: BoardRow[]): InboxTruth {
  return {
    suspensions: asks.map((a) => ({ id: suspensionItemId(a.item.suspensionId), sessionId: a.sessionId, requestId: a.item.requestId, taskId: null })),
    questions: rows.filter((r) => r.questions.length > 0).map((r) => ({ id: questionItemId(r.boardRef, r.id), boardRef: r.boardRef, taskId: r.id, open: r.questions.map((q) => q.id) })),
  };
}

describe("the Inbox list", () => {
  it("lists a row holding two questions once, with both, beside the asks, oldest first", () => {
    const items = inboxItems([ask("s1")], [T1, held("t9", [])]);
    expect(items.map((i) => [i.source, i.id])).toEqual([
      ["question", questionItemId("s_desk.tasks", "t1")],
      ["suspension", "s1"],
    ]);
    const question = items[0] as Extract<InboxItem, { source: "question" }>;
    expect(question.questions.map((q) => q.prompt)).toEqual(["Which CSV export should the script read?", "Which date column?"]);
  });

  it("lists only the questions a board marks open, and a row with none open not at all", () => {
    const answered = held("t2", [
      { id: "q1", prompt: "First?", askedAt: 1, open: false },
      { id: "q2", prompt: "Second?", askedAt: 2, open: true },
    ]);
    const closed = held("t3", [{ id: "q1", prompt: "Done?", askedAt: 1, open: false }]);
    // A row whose board publishes questions without saying which are open holds none: never a guess.
    const unsaid = toBoardRow("s_desk.tasks", "s_desk", "s_desk/t4", { id: "t4", questions: [{ id: "q1", prompt: "?" }] });
    const items = inboxItems([], [answered, closed, unsaid]);
    expect(items).toHaveLength(1);
    expect((items[0] as Extract<InboxItem, { source: "question" }>).questions.map((q) => q.id)).toEqual(["q2"]);
  });
});

describe("reconcileInbox: green on the list it should be", () => {
  it("is green when the list holds the truth once, answerably", () => {
    const asks = [ask("s1"), ask("s2")];
    const result = reconcileInbox(inboxItems(asks, [T1]), truthOf(asks, [T1]));
    expect(result).toEqual({ green: true, missing: [], duplicate: [], orphan: [], bothArms: [], unanswerable: [], reopened: [] });
  });
});

describe("reconcileInbox: each control turns it red", () => {
  const asks = [ask("s1")];
  const truth = truthOf(asks, [T1]);

  it("duplicate-item: an item listed twice", () => {
    const items = inboxItems(asks, [T1]);
    const result = reconcileInbox([...items, items[0]!], truth);
    expect(result.green).toBe(false);
    expect(result.duplicate).toEqual([items[0]!.id]);
  });

  it("drop-question-arm: a list built without the rows misses the held question", () => {
    const result = reconcileInbox(inboxItems(asks, []), truth);
    expect(result.green).toBe(false);
    expect(result.missing).toEqual([questionItemId("s_desk.tasks", "t1")]);
  });

  it("an item the truth doesn't hold is an orphan", () => {
    const result = reconcileInbox(inboxItems([...asks, ask("gone")], [T1]), truth);
    expect(result.orphan).toEqual(["gone"]);
  });

  it("a row in both arms: a held question and a suspension in the run that row waits on", () => {
    const running = held("t1", [{ id: "q1", prompt: "Which?", askedAt: 1, open: true }], {
      status: "in_progress",
      run: { sessionId: "s_run", requestId: "r_run", attempt: 1 },
    });
    const stop = ask("s_stop", { sessionId: "s_run", item: { suspensionId: "s_stop", requestId: "r_run", reason: "human_approval", message: "ok?" } as Ask["item"] });
    const items = inboxItems([stop], [running]);
    const both = reconcileInbox(items, {
      ...truthOf([stop], [running]),
      waitingRows: [{ boardRef: "s_desk.tasks", taskId: "t1", sessionId: "s_run", requestId: "r_run" }],
    });
    expect(both.bothArms).toEqual(["s_desk.tasks:t1"]);
    expect(both.green).toBe(false);
    // The same, joined by the task the suspension names in the row's run session.
    const named = ask("s_named", { sessionId: "s_run", item: { suspensionId: "s_named", requestId: "r_other", taskId: "t1", reason: "human_input", message: "?" } as Ask["item"] });
    expect(reconcileInbox(inboxItems([named], [running]), truthOf([named], [running])).bothArms).toEqual(["s_desk.tasks:t1"]);
  });

  it("an item its route can't answer", () => {
    const stuck = [ask("s1", { unanswerable: DISPATCHED_RUN_UNANSWERABLE })];
    const result = reconcileInbox(inboxItems(stuck, []), truthOf(stuck, []));
    expect(result.unanswerable).toEqual([{ id: "s1", why: DISPATCHED_RUN_UNANSWERABLE }]);
    expect(result.green).toBe(false);
  });

  it("an answered or cancelled item back in a later read, in the list or in the truth", () => {
    const items = inboxItems(asks, [T1]);
    expect(reconcileInbox(items, { ...truth, closed: ["s1"] }).reopened).toEqual(["s1"]);
    // Gone from the list but still in the truth is reopened too: the item would come back.
    const listedWithout = inboxItems([], [T1]);
    expect(reconcileInbox(listedWithout, { ...truth, closed: ["s1"] }).reopened).toEqual(["s1"]);
  });
});

describe("suspensionTruthOf: what a session's suspended requests record", () => {
  const request = (id: string, items: unknown[], status: SessionRequestSummary["status"] = "suspended") =>
    ({ id, flowKind: "f", actionName: "a", userId: "u", status, items, createdAt: 0, updatedAt: 0 }) as unknown as SessionRequestSummary;

  it("keeps a pending suspension for the user, and drops a resumed one, another reason and another status", () => {
    const requests = [
      request("r1", [
        { type: "suspension", suspensionId: "a", reason: "human_approval", taskId: "t1" },
        { type: "suspension", suspensionId: "b", reason: "human_input" },
        { type: "suspension_resume", suspensionId: "b" },
        { type: "suspension", suspensionId: "c", reason: "external_event" },
      ]),
      request("r2", [{ type: "suspension", suspensionId: "d", reason: "human_input" }], "completed"),
    ];
    expect(suspensionTruthOf("s", requests, (reason) => PERSON_REASONS.has(reason))).toEqual([{ id: "a", sessionId: "s", requestId: "r1", taskId: "t1" }]);
  });
});

// ---- against a real Lab ---------------------------------------------------------------------

const served: ServedLab[] = [];
afterEach(async () => {
  await Promise.all(served.splice(0).map((lab) => lab.handle.close()));
});

async function lab() {
  const opened = await openAskLab();
  const s = await serveLab(opened.flowState);
  served.push(s);
  return s;
}

type Loaded = Exclude<LabSnapshot, { refused: object } | { unreachable: object }>;

/**
 * The truth, read apart from the list: every session the Lab lists the user,
 * dispatch runs included, and in each its suspended requests with their
 * items. Not the session item log `readAsks` reads, and not the worker
 * inventory it picks sessions by.
 */
async function readTruth(client: Client): Promise<InboxTruth> {
  const sessions = await client.sessions.list({ include: "dispatch-runs" });
  const suspensions = [];
  for (const session of sessions) {
    const requests = await client.sessions.requests(session.id, { status: "suspended", includeItems: true });
    suspensions.push(...suspensionTruthOf(session.id, requests, (reason) => PERSON_REASONS.has(reason)));
  }
  // No board in this Lab holds a question: the question arm's truth is empty, and an item there would be an orphan.
  return { suspensions, questions: [] };
}

async function inboxOnceSettled(client: Client, count: number): Promise<{ items: InboxItem[]; snapshot: Loaded }> {
  const reader = createLabReader(client);
  return eventually(async () => {
    const snapshot = (await reader.read()) as Loaded;
    return snapshot.inbox?.ok && snapshot.inbox.value.length === count ? { items: snapshot.inbox.value, snapshot } : undefined;
  }, `${count} Inbox item(s)`);
}

describe("reconcileInbox against a real Lab", () => {
  it("a user's own ask: listed once, answerable, green against the request listing", async () => {
    const { baseUrl } = await lab();
    const client = connect({ baseUrl, userId: ASK_LAB_USER_ID });
    const sessionId = "s_ops_loner";
    await client.flow(ASKER_FLOW).createSession({ sessionId, state: { workerId: "ops.loner" } });
    await client.flow(ASKER_FLOW).send("ask", { what: "ship it" }, { sessionId });
    const { items, snapshot } = await inboxOnceSettled(client, 1);
    const truth = await readTruth(client);
    expect(truth.suspensions).toHaveLength(1);
    expect(reconcileInbox(items, truth)).toMatchObject({ green: true });
    // The section the sidebar counts and the Inbox draws is the asks read, listed through `inboxItems`.
    expect(items.map((i) => i.id)).toEqual(snapshot.asks.ok ? snapshot.asks.value.map((a) => a.item.suspensionId) : []);

    // Control duplicate-item on the real list: red.
    expect(reconcileInbox([...items, items[0]!], truth)).toMatchObject({ green: false, duplicate: [items[0]!.id] });
  });

  it("a task run's approval (a delegate's routed task, source \"task\"): listed once but unanswerable, so red (today's gap)", async () => {
    const { baseUrl } = await lab();
    const client = connect({ baseUrl, userId: ASK_LAB_USER_ID });
    await client.flow(COORDINATOR_FLOW).send("respond", { message: "ship it" }, { sessionId: "ops.desk" });
    const { items } = await inboxOnceSettled(client, 2);
    const result = reconcileInbox(items, await readTruth(client));
    // Every other clause holds: the list is the truth, once each.
    expect(result).toMatchObject({ missing: [], duplicate: [], orphan: [], bothArms: [], reopened: [] });
    // The answerable clause fails: a stop for the user in a dispatched run has no route from the Inbox yet.
    expect(result.green).toBe(false);
    expect(result.unanswerable.map((u) => u.why)).toEqual([DISPATCHED_RUN_UNANSWERABLE, DISPATCHED_RUN_UNANSWERABLE]);
  });
});
