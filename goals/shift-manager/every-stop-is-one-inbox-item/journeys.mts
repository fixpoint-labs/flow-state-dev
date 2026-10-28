/**
 * The journeys (FIX-2134's plan, row 2), each through the teams table's *after* that the legs
 * don't already walk:
 *
 * - **j1**, someone who files work: the filer's steer answers its own task's midway question, and
 *   nothing else.
 * - **j2**, someone who writes a flow that asks: on a host of its own, a call's deadline on an
 *   approval reads as a no, on an input fails the try, the host's person-stop setting lets a
 *   held question go ahead from its brief, and a user's stop cancels the task.
 * - **j3**, someone who runs Shift Manager on their own machine: the host is killed while all six
 *   stops wait; after a restart all six are listed once, and each is answered once and carries on.
 */
import type { Shipped } from "../workers-message-each-other/legs.mts";
import { CAST } from "./cast.mts";
import { checkSix, fileSix, legB, untilWaiting, waiting, type Context, type Filed } from "./legs.mts";
import { aliceIn, proofsOf, rowHolds, serveLab, show, sleep, TERMINAL, type Row, type Serving } from "./world.mts";

type Contextual = (alice: Context["alice"], files: { proof: string; store: string }) => Context;

/**
 * j1: `desk.front`'s model files work and answers for it. `j1:filer-answers-own` its steer
 * naming the question its asker's task asked midway answers it, and the task goes on on the
 * same attempt; `j1:routed-answers-nothing` its steer naming the question a task was filed
 * held on, the user's to answer, is refused and answers nothing.
 */
export async function journeyFiles(c: Context): Promise<void> {
  const before = new Set((await c.alice.rows()).map((r) => r.id));
  const goal = `Write a one-line greeting for the ${c.words.topic} gala.`;
  const filedTurn = await c.alice.say(`File one task for ${CAST.asker} with the goal "${goal}". File nothing else, and don't wait on it.`);
  const mine = (await c.alice.rows()).filter((r) => !before.has(r.id) && r.assignee === CAST.asker);
  if (filedTurn.status !== "completed" || mine.length !== 1) {
    c.fail("j1:filer-files", `desk.front's turn ${filedTurn.status} filed ${mine.length} task(s) for ${CAST.asker}`);
    return;
  }
  const id = mine[0]!.id as string;
  const asked = await c.alice.until(() => c.alice.row(id), (r) => waiting("midway", r) || TERMINAL.has(r?.status), 240_000);
  const question = rowHolds(asked)[0];
  if (question === undefined) {
    c.fail("j1:filer-answers-own", `the asker's task never asked midway: ${asked?.status}, holds ${show(asked?.holds)}`);
    return;
  }
  const answer = "Formal, for the board members.";
  const told = await c.alice.say(`Your task ${id} for ${CAST.asker} asked you a question. The answer is: "${answer}"`);
  const after = await c.alice.until(() => c.alice.row(id), (r) => TERMINAL.has(r?.status), 240_000);
  const steers = ((after?.steers ?? []) as Row[]).filter((s) => s.answers === question.id);
  if (told.status !== "completed" || steers.length === 0) {
    c.fail("j1:filer-calls", `desk.front's turn ${told.status} left the question unanswered: steers ${show(after?.steers)}`);
  } else if (steers[0]!.from !== "filer" || after?.status !== "completed" || after.attempts !== 1) {
    c.fail("j1:filer-answers-own", `the filer's answer reads ${show(steers[0])}; the task ended ${after?.status} on attempt ${after?.attempts}`);
  }

  // A question the user is asked at filing is the user's: the filer's steer naming it answers nothing.
  const heldBefore = new Set((await c.alice.rows()).map((r) => r.id));
  const heldTurn = await c.alice.say(
    `File one task for ${CAST.doer} with the goal "Sort the ${c.words.topic} photos." It must not start until I answer this question: "Which album should they go in?" Put that question, word for word, in the task's questions. File nothing else.`,
  );
  const held = (await c.alice.rows()).find((r) => !heldBefore.has(r.id) && r.assignee === CAST.doer && rowHolds(r).length > 0);
  if (heldTurn.status !== "completed" || held === undefined) {
    c.fail("j1:filer-files", `desk.front's turn ${heldTurn.status} filed no task held on the album question`);
    return;
  }
  const hold = rowHolds(held)[0]!;
  const tried = await c.alice.say(
    `Task ${held.id} is waiting on a question. Answer it yourself now: read it with getTask, then call updateTask with the task's id, the question's id as question, and the message "The spring album." Tell me what the tool answered.`,
  );
  // The filer must have tried: its own updateTask on this question, refused as the user's.
  const turn = (await c.alice.client.sessions.requests(c.alice.conversation, { includeItems: true })).find((r) => r.id === tried.requestId);
  const calls = ((turn?.items ?? []) as Row[]).filter((i) => i.type === "tool_output" && /updateTask/.test(String(i.toolCall?.name)) && String(i.toolCall?.arguments).includes(hold.id));
  if (!calls.some((i) => /question_is_the_users/.test(JSON.stringify(i.output ?? i.modelOutput)))) {
    c.fail("j1:filer-calls", `desk.front's turn ${tried.status} made no updateTask on ${hold.id} that came back question_is_the_users: ${show(calls.map((i) => i.output))}`);
  }
  const still = await c.alice.row(held.id);
  c.note(`j1: desk.front's turn on the user's question ended ${tried.status}, its updateTask refused ${calls.length} time(s); the row reads ${show({ status: still?.status, holds: still?.holds?.map((h: Row) => h.id), steers: still?.steers })}`);
  if (still?.status !== "pending" || !rowHolds(still).some((h) => h.id === hold.id) || (await c.alice.itemOf(held.id)) === undefined) {
    c.fail("j1:routed-answers-nothing", `the filer's steer answered the user's question: ${show({ status: still?.status, holds: still?.holds, steers: still?.steers })}`);
  }
  // Tidy: the user answers it, so the leg leaves nothing waiting.
  const item = await c.alice.itemOf(held.id);
  if (item !== undefined) await c.alice.answer(item, { text: "The spring album." });
}

/**
 * j2, on a host whose person-stop setting is `serving.userDeadlineMs`: `j2:approval-reads-no`
 * an approval past its call's deadline reads as a no, on attempt 1; `j2:input-fails-try` an
 * input past its call's deadline fails the try; `j2:held-deadline-goes-ahead` a held question
 * past the host's deadline closes unanswered and its task starts from its brief;
 * `j2:stop-cancels-task` the user's stop of a waiting run cancels its task on attempt 1.
 */
export async function journeyDeadlines(serving: Serving, shipped: Shipped, context: Contextual): Promise<void> {
  const served = await serveLab(serving, "j2");
  try {
    const c = context(await aliceIn(shipped, served.origin), serving.files);
    const file = async (init: Record<string, unknown>) => {
      const filed = await c.alice.file(init);
      if (filed.id === undefined) throw new Error(`j2: a task wasn't filed: ${show(filed.acted)}`);
      return filed.id;
    };
    const approval = await file({ goal: `[approval][deadline:2000] Ship ${c.words.topic} on time.`, assignee: CAST.doer });
    const input = await file({ goal: `[input][deadline:2000] Pick a region for ${c.words.topic}.`, assignee: CAST.doer, maxAttempts: 1 });
    const held = await file({ goal: `Label the ${c.words.topic} boxes.`, assignee: CAST.doer, questions: ["Which label colour?"] });
    const stopped = await file({ goal: `[approval] Ship ${c.words.topic} late.`, assignee: CAST.doer });

    const settle = (id: string) => c.alice.until(() => c.alice.row(id), (r) => TERMINAL.has(r?.status), 90_000);
    const proofs = (id: string, kind: string) => proofsOf(c.proof).filter((p) => p.kind === kind && p.taskId === id);

    const waitingRow = await c.alice.until(() => c.alice.row(stopped), (r) => waiting("approval", r) || TERMINAL.has(r?.status), 60_000);
    const run = waitingRow?.run as { requestId?: string; flowId?: string } | undefined;
    if (!waiting("approval", waitingRow) || run?.requestId === undefined) {
      c.fail("j2:stop-cancels-task", `the approval to stop never waited: ${show(waitingRow)}`);
    } else {
      await c.alice.client.flow(run.flowId ?? "doer").request(run.requestId).abort();
      const ended = await settle(stopped);
      if (ended?.status !== "cancelled" || ended.attempts !== 1 || proofs(stopped, "resumed").length !== 0 || (await c.alice.itemOf(stopped)) !== undefined) {
        c.fail("j2:stop-cancels-task", `the stopped task ended ${ended?.status} on attempt ${ended?.attempts}; resumed ${proofs(stopped, "resumed").length}; item ${(await c.alice.itemOf(stopped)) === undefined ? "closed" : "still listed"}`);
      }
    }
    const approved = await settle(approval);
    const read = proofs(approval, "resumed")[0]?.outcome;
    if (approved?.status !== "completed" || approved.attempts !== 1 || read?.approved !== false || read?.deadline !== true) {
      c.fail("j2:approval-reads-no", `the approval past its deadline ended ${approved?.status} on attempt ${approved?.attempts}, the block reading ${show(read)}`);
    }
    const inputRow = await settle(input);
    if (inputRow?.status !== "errored" || proofs(input, "resumed").length !== 0) {
      c.fail("j2:input-fails-try", `the input past its deadline ended ${inputRow?.status} (${show(inputRow?.error)}), the block resuming ${proofs(input, "resumed").length} time(s)`);
    }
    // The host's deadline on the held question, then a board touch.
    await sleep((serving.userDeadlineMs ?? 0) + 3_000);
    await c.alice.rows();
    const heldRow = await settle(held);
    const turns = proofs(held, "turn");
    if (heldRow?.status !== "completed" || heldRow.attempts !== 1 || turns.length !== 1 || !/no answer came/i.test(String(turns[0]?.message))) {
      c.fail("j2:held-deadline-goes-ahead", `the held task past the host's deadline ended ${heldRow?.status} on attempt ${heldRow?.attempts}, its turns' messages ${show(turns.map((t) => String(t.message).slice(0, 200)))}`);
    }

  } finally {
    await served.stop();
  }
}

/**
 * j3: the six of leg a, the host killed (SIGKILL) while all wait, restarted on the same store.
 * `j3:six-after-restart` all six are listed once, as leg a reads them; `j3:answered-after-restart`
 * each answered once in the Inbox carries on as leg b says.
 */
export async function journeyRestart(serving: Serving, shipped: Shipped, context: Contextual): Promise<void> {
  let served = await serveLab(serving, "j3-before");
  let filed: Filed;
  const retag = (c: Context, tag: string): Context => ({ ...c, fail: (inner, what) => c.fail(tag, `${inner}: ${what}`) });
  try {
    const c = retag(context(await aliceIn(shipped, served.origin), serving.files), "j3:six-before");
    const ids = await fileSix(c);
    const rows = await untilWaiting(c, ids, serving.harness === "claude-code" ? 15 * 60_000 : 180_000);
    const notWaiting = Object.entries(ids).filter(([stop]) => !waiting(stop as never, rows[stop as keyof typeof rows]));
    if (notWaiting.length > 0) {
      c.fail("a:six-items", `before the kill, ${notWaiting.map(([s]) => s).join(", ")} never waited`);
      await served.stop();
      return;
    }
    filed = { ids, closed: [] };
  } catch (error) {
    await served.stop();
    throw error;
  }
  served.child.kill("SIGKILL");
  await served.exited;
  await sleep(2_000);
  served = await serveLab(serving, "j3-after");
  try {
    const base = context(await aliceIn(shipped, served.origin), serving.files);
    const rows = await untilWaiting(base, filed.ids, 60_000);
    await checkSix(retag(base, "j3:six-after-restart"), filed.ids, rows, "j3");
    await legB(retag(base, "j3:answered-after-restart"), filed, "j3");
  } finally {
    await served.stop();
  }
}
