/**
 * The walk's legs, each over one served Lab, as Alice: the six stops raised (a), answered (b),
 * cancelled (c), steered (d), and the journeys (j1 to j3). Each failure is tagged
 * `<leg>:<assertion>`; `run.mts` says which are structural.
 */
import type { InboxItem } from "@flow-state-dev/orchestration/inbox";
import { allTaskRows } from "../../coordinators/files-tasks-down-the-owners-chain/store.mts";
import { CAST, type Words } from "./cast.mts";
import { proofsOf, rowHolds, show, sleep, STOREFRONT, suspensionHolds, TERMINAL, type Alice, type Row } from "./world.mts";

/** The six stops, by the kind each one's Inbox item names. */
export const STOPS = ["approval", "review", "input", "held", "midway", "coding"] as const;
export type Stop = (typeof STOPS)[number];
/** The ask kind each stop's hold carries. */
export const ASK_KIND: Record<Stop, string> = { approval: "approval", review: "review", input: "input", held: "question", midway: "question", coding: "question" };
/** Whether each stop suspends its run (a suspension hold) or holds its row (a row hold). */
export const SUSPENDS: Record<Stop, boolean> = { approval: true, review: true, input: true, held: false, midway: false, coding: false };

/** What a leg hands on: the tasks it filed, by stop, and the holds answered so far, which none may list again. */
export interface Filed {
  ids: Partial<Record<Stop, string>>;
  closed: string[];
}

export interface Context {
  alice: Alice;
  words: Words;
  proof: string;
  /** The Lab's store file, read only for what no public read shows: a row's lease and turn. */
  store: string;
  /** The coding task's goal and answer (`fixtures/input.json`). */
  coding: { goal: string; answer: string; factFile: string };
  /** The fact only the first coding run reads, when Claude Code runs it; `""` for the stub. */
  fact: string;
  harness: "claude-code" | "stub";
  sweepMs: number;
  fail(tag: string, what: string): void;
  note(line: string): void;
  say(line: string): void;
}

/** A row as stored, read-only: its lease and turn, which `getTask` doesn't show. */
export const stored = (c: Context, id: string | undefined): Row | undefined => (id === undefined ? undefined : (allTaskRows(c.store).find((r) => r.id === id) as Row | undefined));

const proofsFor = (c: Context, taskId: string | undefined, kind: string) => proofsOf(c.proof).filter((p) => p.kind === kind && p.taskId === taskId);

/** Whether a row waits on the person the way its stop does. */
export function waiting(stop: Stop, row: Row | undefined): boolean {
  if (row === undefined) return false;
  if (stop === "held") return row.status === "pending" && rowHolds(row).length > 0;
  if (SUSPENDS[stop]) return row.status === "in_progress" && suspensionHolds(row).length === 1;
  return row.status === "in_progress" && rowHolds(row).length > 0;
}

/** The goal a doer task stopping for `stop` is filed with. */
const doerGoal = (stop: "approval" | "review" | "input", words: Words, extra = "") => `[${stop}]${extra} Release chore for ${words.topic}: ${stop}.`;

/**
 * File one task per stop: the held one through `desk.front`'s model (`questions` at filing),
 * the rest as a screen files them. Returns each task's id.
 */
export async function fileSix(c: Context, only: readonly Stop[] = STOPS, tag = "a"): Promise<Partial<Record<Stop, string>>> {
  const ids: Partial<Record<Stop, string>> = {};
  for (const stop of only) {
    if (stop === "approval" || stop === "review" || stop === "input") {
      const filed = await c.alice.file({ goal: doerGoal(stop, c.words), assignee: CAST.doer });
      if (filed.id === undefined) c.fail(`${tag}:filed`, `the ${stop} task wasn't filed: ${filed.acted.status} ${filed.acted.error ?? show(filed.acted.output)}`);
      else ids[stop] = filed.id;
    } else if (stop === "midway") {
      const filed = await c.alice.file({ goal: `Write a one-line greeting for the ${c.words.topic} launch.`, assignee: CAST.asker });
      if (filed.id === undefined) c.fail(`${tag}:filed`, `the asker's task wasn't filed: ${filed.acted.status} ${filed.acted.error ?? show(filed.acted.output)}`);
      else ids.midway = filed.id;
    } else if (stop === "coding") {
      const filed = await c.alice.file({ goal: c.coding.goal, assignee: CAST.coder, input: { project: STOREFRONT } });
      if (filed.id === undefined) c.fail(`${tag}:filed`, `the coder's task wasn't filed: ${filed.acted.status} ${filed.acted.error ?? show(filed.acted.output)}`);
      else ids.coding = filed.id;
    } else {
      // The question at filing is the model's: desk.front files the task held on it.
      const before = new Set((await c.alice.rows()).map((r) => r.id));
      const goal = `Tidy the release notes for ${c.words.topic}.`;
      const said = await c.alice.say(
        `File one task for ${CAST.doer} with the goal "${goal}". It must not start until I answer this question: "${c.words.heldQuestion}" Put that question, word for word, in the task's questions when you file it. File nothing else.`,
      );
      const filed = (await c.alice.rows()).filter((r) => !before.has(r.id));
      const held = filed.find((r) => r.assignee === CAST.doer && rowHolds(r).some((h) => h.ask?.prompt?.includes(c.words.heldQuestion.replace(/\?$/, ""))));
      if (said.status !== "completed" || held === undefined) {
        c.fail(`${tag}:held-filed`, `desk.front's turn ${said.status} filed ${show(filed.map((r) => ({ goal: r.goal, assignee: r.assignee, holds: r.holds })))}, no task for ${CAST.doer} held on "${c.words.heldQuestion}"`);
      } else ids.held = held.id;
      if (filed.length > 1) c.fail(`${tag}:held-filed`, `desk.front filed ${filed.length} tasks, not one`);
    }
  }
  return ids;
}

/** Wait until every filed task waits the way its stop does, or `ms` passes. Each row as last read. */
export async function untilWaiting(c: Context, ids: Partial<Record<Stop, string>>, ms: number): Promise<Partial<Record<Stop, Row | undefined>>> {
  const read = async () => {
    const out: Partial<Record<Stop, Row | undefined>> = {};
    for (const [stop, id] of Object.entries(ids) as Array<[Stop, string]>) out[stop] = await c.alice.row(id);
    return out;
  };
  return c.alice.until(read, (rows) => (Object.keys(ids) as Stop[]).every((stop) => waiting(stop, rows[stop]) || TERMINAL.has(rows[stop]?.status)), ms);
}

/**
 * Leg a: all six wait at once. `a:six-items` the Inbox lists exactly one answerable item per
 * task, each naming its stop, and FIX-2133's reconciler is green; `a:rows-read` the suspended
 * rows each carry one open suspension hold and keep their claim, the held rows an open row hold
 * and no lease, none `parked`; `a:no-deadline-waits` none has a deadline, and past the
 * sweeper's interval and a board touch all six are still listed and none has resumed.
 */
export async function legA(c: Context, tag = "a"): Promise<Filed> {
  const ids = await fileSix(c, STOPS, tag);
  const waitMs = c.harness === "claude-code" ? 15 * 60_000 : 180_000;
  const rows = await untilWaiting(c, ids, waitMs);
  for (const stop of STOPS) {
    if (ids[stop] !== undefined && !waiting(stop, rows[stop])) {
      c.fail(`${tag}:six-items`, `the ${stop} task never waited: ${rows[stop]?.status}, holds ${show(rows[stop]?.holds)}${rows[stop]?.error ? `, error ${show(rows[stop]?.error)}` : ""}`);
    }
  }
  await checkSix(c, ids, rows, tag);
  return { ids, closed: [] };
}

/** The six-at-once reads, shared by leg a and journey j3 after its restart. */
export async function checkSix(c: Context, ids: Partial<Record<Stop, string>>, rows: Partial<Record<Stop, Row | undefined>>, tag: string): Promise<void> {
  const items = await c.alice.inbox();
  for (const stop of STOPS) {
    const id = ids[stop];
    if (id === undefined) continue;
    const mine = items.filter((item) => item.task?.taskId === id);
    if (mine.length !== 1) {
      c.fail(`${tag}:six-items`, `the ${stop} task has ${mine.length} Inbox items: ${show(mine.map((i) => i.holds.map((h) => [h.ask.kind, h.ask.prompt])))}`);
      continue;
    }
    const holds = mine[0]!.holds;
    if (holds.length !== 1 || holds[0]!.ask.kind !== ASK_KIND[stop]) c.fail(`${tag}:six-items`, `the ${stop} item's holds are ${show(holds.map((h) => h.ask.kind))}, not one ${ASK_KIND[stop]}`);
    if (holds.some((h) => h.unanswerable !== null)) c.fail(`${tag}:six-items`, `the ${stop} item says it can't be answered: ${show(holds.map((h) => h.unanswerable))}`);
    if (holds.some((h) => h.source.kind !== (SUSPENDS[stop] ? "suspension" : "row"))) c.fail(`${tag}:six-items`, `the ${stop} item answers through ${show(holds.map((h) => h.source.kind))}`);
    if (holds.some((h) => h.due !== undefined)) c.fail(`${tag}:no-deadline-waits`, `the ${stop} item has a deadline: ${show(holds.map((h) => h.due))}`);
  }
  const strays = items.filter((item) => item.task === null || !Object.values(ids).includes(item.task.taskId));
  if (strays.length > 0) c.fail(`${tag}:six-items`, `the Inbox lists ${strays.length} item(s) beside the six: ${show(strays.map((i) => [i.task?.taskId ?? i.id, i.holds.map((h) => h.ask.kind)]))}`);
  const drift = await c.alice.reconciled([]);
  if (drift !== undefined) c.fail(`${tag}:six-items`, `the reconciler isn't green: ${drift}`);

  for (const stop of STOPS) {
    const row = rows[stop];
    if (row === undefined) continue;
    const kept = stored(c, ids[stop]);
    if (row.status === "parked") c.fail(`${tag}:rows-read`, `the ${stop} row reads parked`);
    if (SUSPENDS[stop]) {
      if (suspensionHolds(row).length !== 1 || rowHolds(row).length !== 0) c.fail(`${tag}:rows-read`, `the ${stop} row's holds are ${show(row.holds)}, not one open suspension hold`);
      // Its claim kept: the run that stopped is still the row's, on its first attempt, and the stop's
      // mirror names that run. The lease is dropped in the write that mirrors the stop (FIX-2129).
      const mirror = suspensionHolds(row)[0];
      if (row.attempts !== 1 || row.run?.requestId == null || mirror?.source?.requestId !== row.run.requestId) {
        c.fail(`${tag}:rows-read`, `the ${stop} row doesn't keep its claim: attempt ${row.attempts}, run ${show(row.run)}, its stop's mirror ${show(mirror?.source)}`);
      }
      if (kept?.leaseUntil != null) c.fail(`${tag}:rows-read`, `the ${stop} row holds a lease (${kept.leaseUntil}) while its run waits on a person`);
    } else {
      if (rowHolds(row).length !== 1 || suspensionHolds(row).length !== 0) c.fail(`${tag}:rows-read`, `the ${stop} row's holds are ${show(row.holds)}, not one open row hold`);
      if (kept?.leaseUntil != null) c.fail(`${tag}:rows-read`, `the ${stop} row holds a lease (${kept.leaseUntil}) while it waits on a person`);
    }
    if ((row.holds ?? []).some((h: Row) => h.due != null)) c.fail(`${tag}:no-deadline-waits`, `the ${stop} row's hold has a deadline: ${show(row.holds)}`);
  }

  // Past the sweeper's interval, twice, and a board touch: nothing ends a stop with no deadline.
  await sleep(c.sweepMs * 2 + 2_000);
  await c.alice.rows();
  await sleep(2_000);
  const later = await c.alice.inbox();
  for (const stop of STOPS) {
    const id = ids[stop];
    if (id === undefined) continue;
    const row = await c.alice.row(id);
    if (!waiting(stop, row) || later.filter((i) => i.task?.taskId === id).length !== 1) {
      c.fail(`${tag}:no-deadline-waits`, `past the sweeper's interval the ${stop} task reads ${row?.status}, holds ${show(row?.holds)}, ${later.filter((i) => i.task?.taskId === id).length} item(s)`);
    }
    if (proofsFor(c, id, "resumed").length > 0) c.fail(`${tag}:no-deadline-waits`, `the ${stop} task's block resumed with no answer: ${show(proofsFor(c, id, "resumed"))}`);
  }
}

/** The answer each stop takes in the Inbox. */
export function answerFor(c: Context, stop: Stop): unknown {
  switch (stop) {
    case "approval":
      return { approved: true };
    case "review":
      return { value: "Reads well." };
    case "input":
      return { value: "eu-west" };
    case "held":
      return { text: "Keep a Changelog." };
    case "midway":
      return { text: "Cheerful, for first-time customers in spring." };
    case "coding":
      return { text: c.coding.answer };
  }
}

/** How each stop carries on once answered: the same attempt, the work run once, the answer read. */
async function carriedOn(c: Context, stop: Stop, id: string, done: Row | undefined, tag: string): Promise<void> {
  const same = `${tag}:${stop}-same-attempt`;
  if (done?.status !== "completed") c.fail(same, `the ${stop} task ended ${done?.status}: ${show(done?.error ?? done?.output ?? null)}`);
  if (done?.attempts !== 1) c.fail(same, `the ${stop} task is on attempt ${done?.attempts}; an answer spends no try`);
  if (stop === "approval" || stop === "review" || stop === "input") {
    const work = proofsFor(c, id, "work");
    const resumed = proofsFor(c, id, "resumed");
    if (work.length !== 1) c.fail(same, `the ${stop} task's work ran ${work.length} times; the resume runs no finished step again`);
    if (resumed.length !== 1 || resumed[0]!.attempt !== 1) c.fail(same, `the ${stop} block resumed ${resumed.length} time(s): ${show(resumed)}`);
    const answered = resumed[0]?.outcome;
    const reads = stop === "approval" ? answered?.approved === true : JSON.stringify(answered ?? null).includes(stop === "review" ? "Reads well." : "eu-west");
    if (!reads) c.fail(same, `the ${stop} block read ${show(answered)}, not the Inbox's answer`);
  }
  if (stop === "held") {
    const turns = proofsFor(c, id, "turn");
    if (turns.length !== 1 || turns[0]!.attempt !== 1) c.fail(same, `the held task took ${turns.length} turn(s): ${show(turns.map((t) => [t.attempt, t.turn]))}; its first attempt starts once`);
    if (!turns.some((t) => String(t.message).includes("Keep a Changelog."))) c.fail(same, `the held task's brief doesn't carry the answer: ${show(turns.map((t) => t.message))}`);
  }
  if (stop === "midway" && (stored(c, id)?.turn ?? 0) !== 2) c.fail(same, `the asker's task took ${stored(c, id)?.turn} turn(s); the answer takes exactly one more`);
  if (stop === "coding") {
    const runs = proofsOf(c.proof).filter((p) => p.kind === "harness-run");
    const sessions = proofsOf(c.proof).filter((p) => p.kind === "harness-session");
    const resumes = proofsOf(c.proof).filter((p) => p.kind === "harness-resume");
    if (runs.length !== 2) c.fail(same, `the coder ran ${runs.length} time(s); the answer takes one more run`);
    if (resumes[1]?.resume == null || resumes[1]?.resume !== sessions[0]?.sessionId) c.fail(same, `the answer's run resumed ${show(resumes[1]?.resume)}, not the first run's session ${show(sessions[0]?.sessionId)}`);
    if (new Set(runs.map((r) => r.prompt)).size !== runs.length) c.fail(same, "a coding run was handed a prompt an earlier run was");
    if (c.fact !== "") {
      const { existsSync, readFileSync } = await import("node:fs");
      const { join } = await import("node:path");
      const at = runs[0] === undefined ? "" : join(runs[0].cwd as string, c.coding.factFile);
      const written = at !== "" && existsSync(at) ? readFileSync(at, "utf8") : null;
      if (written === null || !written.includes(c.fact)) c.fail(same, `${at} holds ${show(written)}, not the fact only the first run read`);
    }
  }
}

/**
 * Leg b: each stop answered once in the Inbox carries on as its row says (`b:<stop>-same-attempt`);
 * `b:answered-once` its item leaves the list, and a second answer is told it's resolved.
 */
export async function legB(c: Context, filed: Filed, tag = "b", only: readonly Stop[] = STOPS): Promise<void> {
  const settleMs = c.harness === "claude-code" ? 15 * 60_000 : 180_000;
  const answered: Array<{ stop: Stop; id: string; item: InboxItem<unknown> }> = [];
  for (const stop of only) {
    const id = filed.ids[stop];
    if (id === undefined) continue;
    const item = await c.alice.itemOf(id);
    if (item === undefined) {
      c.fail(`${tag}:${stop}-same-attempt`, `the ${stop} task has no Inbox item to answer`);
      continue;
    }
    const sent = await c.alice.answer(item, answerFor(c, stop));
    if (sent !== "ok") c.fail(`${tag}:${stop}-same-attempt`, `the Inbox's answer to the ${stop} stop was refused: ${sent}`);
    else {
      filed.closed.push(item.holds[0]!.id);
      answered.push({ stop, id, item });
    }
  }
  for (const { stop, id, item } of answered) {
    const done = await c.alice.until(() => c.alice.row(id), (row) => TERMINAL.has(row?.status), settleMs);
    await carriedOn(c, stop, id, done, tag);
    if ((await c.alice.itemOf(id)) !== undefined) c.fail(`${tag}:answered-once`, `the ${stop} task's item is still listed after its answer`);
    // A row hold takes the same words again as a success (FIX-2133), so the second answer differs.
    const again = await c.alice.answerHold(item.holds[0]!, SUSPENDS[stop] ? answerFor(c, stop) : { text: "A different answer." });
    // Only the stop's own refusal counts: 409 for a suspension, question_answered for a row hold.
    if (!(SUSPENDS[stop] ? /\b409\b/ : /question_answered/).test(again)) c.fail(`${tag}:answered-once`, `a second answer to the ${stop} stop wasn't refused as resolved: ${again.slice(0, 160)}`);
    else c.note(`${tag}: a second answer to the ${stop} stop: ${again.slice(0, 160)}`);
  }
  const drift = await c.alice.reconciled(filed.closed);
  if (drift !== undefined) c.fail(`${tag}:answered-once`, `the reconciler isn't green after the answers: ${drift}`);
}

/**
 * Leg c: an approval and a held task, each waiting, cancelled with `updateTask`.
 * `c:item-closes` both items close, the approval's block resumes cancelled once and nothing it
 * writes is kept; `c:held-cancel-closes-questions` the cancelled held row shows no open hold.
 */
export async function legC(c: Context): Promise<void> {
  const suspended = await c.alice.file({ goal: doerGoal("approval", c.words, " (cancel)"), assignee: CAST.doer });
  const held = await c.alice.file({ goal: `Archive the ${c.words.topic} drafts.`, assignee: CAST.doer, questions: ["Which folder should the drafts go to?"] });
  if (suspended.id === undefined || held.id === undefined) {
    c.fail("c:item-closes", `the two tasks weren't filed: ${show([suspended.acted, held.acted])}`);
    return;
  }
  const rows = await untilWaiting(c, { approval: suspended.id, held: held.id }, 120_000);
  if (!waiting("approval", rows.approval) || !waiting("held", rows.held)) {
    c.fail("c:item-closes", `the two tasks never waited: ${show([rows.approval?.status, rows.approval?.holds, rows.held?.status, rows.held?.holds])}`);
    return;
  }
  const items = [await c.alice.itemOf(suspended.id), await c.alice.itemOf(held.id)];
  if (items.some((i) => i === undefined)) c.fail("c:item-closes", "a waiting task has no Inbox item before the cancel");
  for (const id of [suspended.id, held.id]) {
    const cancelled = await c.alice.update({ id, status: "cancelled" });
    if (cancelled.status !== "completed" || cancelled.output?.ok === false) c.fail("c:item-closes", `the cancel of ${id} ended ${cancelled.status}: ${show(cancelled.output ?? cancelled.error)}`);
  }
  const ended = await c.alice.until(
    async () => [await c.alice.row(suspended.id!), await c.alice.row(held.id!)],
    (both) => both.every((r) => r?.status === "cancelled") && proofsFor(c, suspended.id, "resumed").length > 0,
    60_000,
  );
  await sleep(3_000);
  for (const [i, id] of [suspended.id, held.id].entries()) {
    if (ended[i]?.status !== "cancelled") c.fail("c:item-closes", `${id} reads ${ended[i]?.status}, not cancelled`);
    if ((await c.alice.itemOf(id)) !== undefined) c.fail("c:item-closes", `${id}'s Inbox item is still listed after the cancel`);
  }
  const resumed = proofsFor(c, suspended.id, "resumed");
  if (resumed.length !== 1 || resumed[0]!.outcome?.cancelled !== true) c.fail("c:item-closes", `the cancelled approval's block resumed ${show(resumed)}; it resumes cancelled once`);
  if (ended[0]?.output != null) c.fail("c:item-closes", `the cancelled approval task kept output ${show(ended[0]?.output)}`);
  const heldRow = await c.alice.row(held.id);
  // What getTask shows, read as shown: it lists a row's open holds only, so a cancelled row lists none.
  const shown = (heldRow?.holds ?? []) as Row[];
  c.note(`c: the cancelled held row reads ${show({ status: heldRow?.status, holds: shown })}`);
  if (heldRow?.status !== "cancelled" || shown.length > 0) {
    c.fail("c:held-cancel-closes-questions", `getTask on the cancelled held row reads ${heldRow?.status} with open holds ${show(shown)}`);
  }
  const drift = await c.alice.reconciled([]);
  if (drift !== undefined) c.fail("c:item-closes", `the reconciler isn't green after the cancels: ${drift}`);
}

/** The requests in a session, through Alice's routes. */
const requestsIn = (c: Context, sessionId: string) => c.alice.person.routes.requests(sessionId);

/**
 * Leg d: steering while a stop waits. `d:no-request-beside` a steer into a task waiting on a
 * review starts no request beside it, and one more turn takes it after the answer;
 * `d:answer-by-id` a held question is answered by a steer carrying its question id, and by a
 * line typed in the task's session; `d:plain-answers-nothing` a steer naming no question, and
 * a line to the worker outside the task, answer nothing.
 */
export async function legD(c: Context): Promise<void> {
  const review = await c.alice.file({ goal: doerGoal("review", c.words, " (steered)"), assignee: CAST.doer });
  const byId = await c.alice.file({ goal: `Write a one-line greeting for the ${c.words.topic} beta.`, assignee: CAST.asker });
  const byLine = await c.alice.file({ goal: `Write a one-line greeting for the ${c.words.topic} webinar.`, assignee: CAST.asker });
  if (review.id === undefined || byId.id === undefined || byLine.id === undefined) {
    c.fail("d:no-request-beside", `leg d's tasks weren't filed: ${show([review.acted, byId.acted, byLine.acted])}`);
    return;
  }
  const rows = await untilWaiting(c, { review: review.id, midway: byId.id, coding: byLine.id }, 240_000);
  if (!waiting("review", rows.review) || !waiting("midway", rows.midway) || !waiting("midway", rows.coding)) {
    c.fail("d:no-request-beside", `leg d's tasks never waited: ${show([rows.review?.status, rows.midway?.status, rows.midway?.holds, rows.coding?.status, rows.coding?.holds])}`);
    return;
  }

  const session = rows.review!.run?.sessionId as string;
  const before = await requestsIn(c, session);
  const steer = `Mention the ${c.words.topic} launch date.`;
  const steered = await c.alice.update({ id: review.id, message: steer });
  if (steered.output?.ok === false) c.fail("d:no-request-beside", `the steer was refused: ${show(steered.output)}`);
  await sleep(6_000);
  const beside = (await requestsIn(c, session)).filter((r) => !before.some((b) => b.id === r.id));
  if (beside.length > 0) c.fail("d:no-request-beside", `the steer started ${beside.length} request(s) beside the waiting one: ${show(beside.map((r) => [r.id, r.status]))}`);
  if ((await c.alice.itemOf(review.id)) === undefined) c.fail("d:no-request-beside", "the steer closed the review's item");
  const item = await c.alice.itemOf(review.id);
  if (item !== undefined) await c.alice.answer(item, { value: "Reads well." });
  const done = await c.alice.until(() => c.alice.row(review.id!), (r) => TERMINAL.has(r?.status), 120_000);
  const turns = proofsFor(c, review.id, "turn");
  if (done?.status !== "completed" || done.attempts !== 1 || turns.length !== 2 || !String(turns[1]?.message).includes(steer)) {
    c.fail("d:no-request-beside", `after the answer the task ended ${done?.status} on attempt ${done?.attempts} with ${turns.length} turn(s): ${show(turns.map((t) => [t.attempt, t.turn, String(t.message).slice(0, 120)]))}; one more turn takes the steer`);
  }

  const question = rowHolds(rows.midway)[0]!;
  const plain = await c.alice.update({ id: byId.id, message: "Make it cheerful." });
  c.note(`d: a steer naming no question answered ${show(plain.output)}`);
  const outside = await c.alice.person.workforce.ensureWorkerSession({ worker: CAST.asker });
  const talked = await c.alice.act(outside.flowKind, outside.id, "respond", { message: "Cheerful, please." }, 180_000);
  c.note(`d: a line to desk.asker outside the task ended ${talked.status}`);
  await sleep(3_000);
  const still = await c.alice.row(byId.id);
  if (!rowHolds(still).some((h) => h.id === question.id) || (await c.alice.itemOf(byId.id)) === undefined) {
    c.fail("d:plain-answers-nothing", `a steer naming no question, or a line outside the task, answered it: holds ${show(still?.holds)}, steers ${show(still?.steers)}`);
  }

  const answered = await c.alice.update({ id: byId.id, message: "Cheerful, for first-time customers in spring.", question: question.id });
  if (answered.output?.ok === false || answered.status !== "completed") c.fail("d:answer-by-id", `the steer naming the question was refused: ${show(answered.output ?? answered.error)}`);
  const byIdDone = await c.alice.until(() => c.alice.row(byId.id!), (r) => TERMINAL.has(r?.status), 180_000);
  if (byIdDone?.status !== "completed" || byIdDone.attempts !== 1) c.fail("d:answer-by-id", `after the steer naming its question the task ended ${byIdDone?.status} on attempt ${byIdDone?.attempts}`);

  // A line typed in the task's session answers its oldest open question (`steerFromLine`).
  const lineSession = rows.coding!.run?.sessionId as string;
  const lineFlow = (rows.coding!.run?.flowId as string | undefined) ?? "agent";
  const typed = await c.alice.act(lineFlow, lineSession, "respond", { message: "Cheerful, for first-time customers in spring." }, 60_000);
  const lineRow = await c.alice.until(() => c.alice.row(byLine.id!), (r) => TERMINAL.has(r?.status), 180_000);
  const steers = ((lineRow?.steers ?? []) as Row[]).filter((s) => s.answers !== undefined);
  if (typed.status !== "completed" || lineRow?.status !== "completed" || lineRow.attempts !== 1 || steers.length !== 1) {
    c.fail("d:answer-by-id", `a line typed in the task's session (${typed.status}) left the task ${lineRow?.status} on attempt ${lineRow?.attempts} with ${steers.length} answering steer(s)`);
  }
  const drift = await c.alice.reconciled([]);
  if (drift !== undefined) c.fail("d:answer-by-id", `the reconciler isn't green after leg d: ${drift}`);
}
