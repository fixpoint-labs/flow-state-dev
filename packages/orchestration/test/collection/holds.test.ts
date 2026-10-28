/**
 * A task held on questions (FIX-2133), on both backings: one list of holds on
 * the row, `holds`, and the one write every change to it goes through.
 *
 * What it proves, each against the committed row:
 *
 * - **Before the start.** Filed on questions, the row is `pending` and nothing
 *   starts it (the claim, the admission predicate, the ready preview); one
 *   answer leaves it held; the last makes it claimable, its first attempt a
 *   start, its brief holding every answer.
 * - **Midway.** An ask drops the lease and ends the turn unsettled; the row is
 *   never renewed, reclaimed or settled while held; the last answer owes one
 *   more turn on the same attempt, which the claim takes, uncharged; the
 *   asking turn's late write after that claim is refused (the turn fence).
 * - **The rules of an answer.** A retry is `unchanged`, a competing answer is
 *   refused, a cancel closes every hold, the steer cap keeps every question
 *   answerable, a deadline the host set closes a question "no answer came",
 *   and one with none stays open.
 */
import { describe, expect, it } from "vitest";
import {
  createResourceBackedTaskCollection,
  createStateBackedTaskCollection,
  isClaimable,
  isReady,
  MAX_STEERS,
  NO_ANSWER_CAME,
  openQuestions,
  steerFromLine,
  ticketForClaim,
  TaskFilingRefusedError,
  type QuestionInit,
  type SuspensionQuestion,
  type Task,
  type TaskCollectionRef,
} from "../../src/tasks";
import { packWorkerInput } from "../../src/task-board/blocks/worker-step";
import { createFakeResourceCollection, createFakeSequencerState } from "../helpers";

const CSV = "Which CSV export should the script read?";
const COLUMN = "Which date column?";
const ask = (prompt: string): QuestionInit => ({ kind: "question", prompt });

type Make = (options?: { questionDueMs?: number }) => Promise<{ board: TaskCollectionRef; clock: { at: number } }>;

const sequencerBacking: Make = async (options = {}) => {
  const clock = { at: 1_000 };
  const board = createStateBackedTaskCollection({
    collectionId: "tasks",
    state: createFakeSequencerState<{ tasks: Record<string, unknown> }>({ tasks: {} }),
    now: () => clock.at,
    ...(options.questionDueMs !== undefined ? { filing: { questionDueMs: options.questionDueMs } } : {}),
  });
  return { board, clock };
};

const resourceBacking: Make = async (options = {}) => {
  const clock = { at: 1_000 };
  const board = await createResourceBackedTaskCollection({
    collectionId: "tasks",
    collection: createFakeResourceCollection(),
    now: () => clock.at,
    ...(options.questionDueMs !== undefined ? { filing: { questionDueMs: options.questionDueMs } } : {}),
  });
  return { board, clock };
};

const holdIds = (row: Task | undefined) => (row === undefined ? [] : openQuestions(row).map((hold) => hold.id));
const user = (hold: string, message: string, by = "u1") => ({ hold, message, from: "user" as const, by });

describe.each([
  ["sequencer-backed", sequencerBacking],
  ["resource-backed", resourceBacking],
])("a task held on questions (%s)", (_name, make) => {
  /** Filed on two questions: the before-start legs a, b and c. */
  async function filed() {
    const made = await make();
    const row = await made.board.addTask({ id: "t1", goal: "Write the adoption script", questions: [ask(CSV), ask(COLUMN)] });
    const [csv, column] = row.questions!.map((hold) => hold.id);
    return { ...made, csv: csv!, column: column! };
  }

  /** Claimed, then asked midway: leg d. */
  async function askedMidway() {
    const made = await make();
    await made.board.addTask({ id: "t4", goal: "Clean the export" });
    const claimed = (await made.board.claim("w", { leaseDurationMs: 10_000 }))!;
    const ticket = ticketForClaim("tasks", claimed);
    const asked = await made.board.ask!("t4", [ask(COLUMN)], { claim: ticket });
    expect(asked.outcome).toBe("recorded");
    return { ...made, ticket, hold: asked.questions![0]! };
  }

  describe("before the start", () => {
    it("holds the task pending on its questions: nothing starts it, and each is the user's with no deadline", async () => {
      const { board } = await filed();
      const row = board.get("t1")!;
      expect(row).toMatchObject({ status: "pending", attempts: 0 });
      expect(openQuestions(row).map((hold) => [hold.actor, hold.ask, hold.source, hold.due])).toEqual([
        ["user", { kind: "question", prompt: CSV }, { kind: "row", closedBy: [{ by: "answer" }] }, undefined],
        ["user", { kind: "question", prompt: COLUMN }, { kind: "row", closedBy: [{ by: "answer" }] }, undefined],
      ]);
      const lookup = (id: string) => board.get(id);
      expect(isClaimable(row, lookup, board.now())).toBe(false);
      expect(isReady(row, lookup)).toBe(false);
      expect(await board.claim("w")).toBeNull();
    });

    it("one answer leaves it held on the other; the last makes it claimable, its first attempt a start with both answers in its brief", async () => {
      const { board, csv, column } = await filed();
      expect(await board.answer!("t1", user(csv, "The March export"))).toEqual({ outcome: "recorded" });
      expect(holdIds(board.get("t1"))).toEqual([column]);
      expect(await board.claim("w")).toBeNull();

      expect(await board.answer!("t1", user(column, "signup_date"))).toEqual({ outcome: "recorded" });
      expect(holdIds(board.get("t1"))).toEqual([]);
      const claimed = await board.claim("w");
      expect(claimed).toMatchObject({ id: "t1", status: "in_progress", attempts: 1, turn: 1 });
      expect(claimed?.turnOwed).toBeUndefined();
      const brief = await packWorkerInput(claimed!, board);
      expect(brief.steers).toEqual([
        { message: "The March export", from: "user", question: CSV },
        { message: "signup_date", from: "user", question: COLUMN },
      ]);
    });

    it("a held start composes with its questions: both must clear", async () => {
      const { board } = await make();
      const row = await board.addTask({ id: "t2", goal: "g", held: true, questions: [ask(CSV)] });
      await board.answer!("t2", user(row.questions![0]!.id, "the March one"));
      expect(await board.claim("w")).toBeNull();
      await board.release("t2");
      expect(await board.claim("w")).toMatchObject({ id: "t2", attempts: 1 });
    });

    it("refuses questions it can't keep, filing nothing", async () => {
      const { board } = await make();
      await expect(board.addTask({ id: "x", goal: "g", questions: [ask("")] })).rejects.toBeInstanceOf(TaskFilingRefusedError);
      await expect(board.addTask({ id: "y", goal: "g", questions: [ask("?".repeat(1_001))] })).rejects.toMatchObject({ rule: "questions_not_kept" });
      const many = Array.from({ length: MAX_STEERS + 1 }, (_, i) => ask(`question ${i}`));
      await expect(board.addTask({ id: "z", goal: "g", questions: many })).rejects.toMatchObject({ rule: "questions_not_kept" });
      expect(board.list()).toEqual([]);
    });
  });

  describe("a confirm's No", () => {
    it("is stored on every confirm from its first write: cancel unless its filer said continue, and never on a question", async () => {
      const { board } = await make();
      const row = await board.addTask({
        id: "t10",
        goal: "g",
        questions: [{ kind: "confirm", prompt: "Ship it?" }, { kind: "confirm", prompt: "Tag it?", onNo: "continue" }, ask(CSV)],
      });
      expect(row.questions!.map((hold) => hold.ask)).toEqual([
        { kind: "confirm", prompt: "Ship it?", onNo: "cancel" },
        { kind: "confirm", prompt: "Tag it?", onNo: "continue" },
        { kind: "question", prompt: CSV },
      ]);
      await expect(board.addTask({ id: "t11", goal: "g", questions: [{ kind: "question", prompt: CSV, onNo: "cancel" }] })).rejects.toThrow(/only a confirm takes onNo/);
    });

    it("a cancel for a No lands only while its confirm is open, decided on the committed row: after a yes it is refused as answered", async () => {
      const { board } = await make();
      const row = await board.addTask({ id: "t12", goal: "g", questions: [{ kind: "confirm", prompt: "Drop it?" }] });
      const hold = row.questions![0]!.id;
      await board.answer!("t12", user(hold, "Yes, go ahead."));
      expect(await board.cancel("t12", 'No to "Drop it?"', { whileQuestionOpen: hold })).toMatchObject({ outcome: "declined", reason: "answered" });
      expect(board.get("t12")!.status).toBe("pending");
      expect(await board.cancel("t12", "x", { whileQuestionOpen: "hold_none" })).toMatchObject({ outcome: "declined", reason: "no-such-question" });
    });

    it("a yes and a No's cancel at once: exactly one wins", async () => {
      const { board } = await make();
      const row = await board.addTask({ id: "t13", goal: "g", questions: [{ kind: "confirm", prompt: "Drop it?" }] });
      const hold = row.questions![0]!.id;
      const [yes, no] = await Promise.all([
        board.answer!("t13", user(hold, "Yes, go ahead.")),
        board.cancel("t13", 'No to "Drop it?"', { whileQuestionOpen: hold }),
      ]);
      expect([yes.outcome, no.outcome].filter((outcome) => outcome === "recorded")).toHaveLength(1);
      const after = board.get("t13")!;
      expect(after.status === "cancelled").toBe(no.outcome === "recorded");
      expect(after.steers?.some((steer) => steer.answers === hold) ?? false).toBe(yes.outcome === "recorded");
    });
  });

  describe("an answer's rules", () => {
    it("the same answer again is unchanged; other words, or another user, are refused as answered; an unknown id is no such hold", async () => {
      const { board, csv } = await filed();
      await board.answer!("t1", user(csv, "The March export"));
      expect(await board.answer!("t1", user(csv, "The March export"))).toEqual({ outcome: "unchanged" });
      expect(await board.answer!("t1", user(csv, "The April export"))).toMatchObject({ outcome: "declined", reason: "answered" });
      expect(await board.answer!("t1", user(csv, "The March export", "u2"))).toMatchObject({ outcome: "declined", reason: "answered" });
      expect(await board.answer!("t1", user("hold_nope", "x"))).toMatchObject({ outcome: "declined", reason: "no-such-question" });
      expect(board.get("t1")!.steers).toHaveLength(1);
    });

    it("two answers to the last question at once release the row once", async () => {
      const { board, csv, column } = await filed();
      await board.answer!("t1", user(csv, "The March export"));
      const [a, b] = await Promise.all([board.answer!("t1", user(column, "signup_date")), board.answer!("t1", user(column, "created_at"))]);
      expect([a.outcome, b.outcome].sort()).toEqual(["declined", "recorded"]);
      expect(board.get("t1")!.steers).toHaveLength(2);
      expect(await board.claim("w")).toMatchObject({ attempts: 1 });
      expect(await board.claim("w")).toBeNull();
    });

    it("a retried answer after the task finished is unchanged; any other answer to it is refused as finished", async () => {
      const { board, csv, column } = await filed();
      await board.answer!("t1", user(csv, "The March export"));
      await board.answer!("t1", user(column, "signup_date"));
      const claimed = (await board.claim("w"))!;
      await board.complete("t1", "done", { claim: ticketForClaim("tasks", claimed) });
      expect(await board.answer!("t1", user(csv, "The March export"))).toEqual({ outcome: "unchanged" });
      expect(await board.answer!("t1", user("hold_other", "x"))).toMatchObject({ outcome: "declined", reason: "terminal" });
    });

    it("a cancel closes every question with the row, and a later answer is refused as finished", async () => {
      const { board, csv } = await filed();
      await board.cancel("t1", "not needed");
      expect(board.get("t1")).toMatchObject({ status: "cancelled" });
      expect(openQuestions(board.get("t1")!)).toEqual([]);
      expect(await board.answer!("t1", user(csv, "x"))).toMatchObject({ outcome: "declined", reason: "terminal" });
    });

    it("the steer cap keeps every open question answerable: at the cap an ask and a steer are refused, an answer still lands", async () => {
      const { board, ticket, hold } = await askedMidway();
      for (let i = 0; board.get("t4")!.steers?.length !== MAX_STEERS - 1; i += 1) {
        expect((await board.steer!("t4", { message: `steer ${i}`, from: "filer" })).outcome).toBe("recorded");
      }
      // 19 steers + 1 open question = 20 places taken.
      expect(await board.steer!("t4", { message: "one more", from: "filer" })).toMatchObject({ outcome: "declined", reason: "steer-limit" });
      expect(await board.ask!("t4", [ask("another?")], { claim: ticket })).toMatchObject({ outcome: "declined", reason: "steer-limit" });
      expect(await board.answer!("t4", user(hold, "signup_date"))).toEqual({ outcome: "recorded" });
      expect(board.get("t4")!.steers).toHaveLength(MAX_STEERS);
    });

    it("at one place short of the cap, an ask and a steer at once leave exactly one, and the reservation is filled by the answer", async () => {
      const { board } = await make();
      await board.addTask({ id: "t7", goal: "g" });
      const claimed = (await board.claim("w", { leaseDurationMs: 10_000 }))!;
      const ticket = ticketForClaim("tasks", claimed);
      for (let i = 0; i < MAX_STEERS - 1; i += 1) await board.steer!("t7", { message: `steer ${i}`, from: "filer" });
      const [asked, steered] = await Promise.all([
        board.ask!("t7", [ask("the date column?")], { claim: ticket }),
        board.steer!("t7", { message: "the last steer", from: "filer" }),
      ]);
      expect([asked.outcome, steered.outcome].filter((outcome) => outcome === "recorded")).toHaveLength(1);
      const row = board.get("t7")!;
      expect((row.steers?.length ?? 0) + openQuestions(row).length).toBe(MAX_STEERS);
      if (asked.outcome === "recorded") {
        expect(await board.answer!("t7", user(asked.questions![0]!, "signup_date"))).toEqual({ outcome: "recorded" });
        expect(board.get("t7")!.steers).toHaveLength(MAX_STEERS);
      }
    });
  });

  describe("midway", () => {
    it("an ask drops the lease and ends the turn unsettled: no renewal, no reclaim, no claim, no settle while held", async () => {
      const { board, clock, ticket } = await askedMidway();
      const row = board.get("t4")!;
      // The turn that asked is marked on the row, by its generation: it may not stop for the user or settle.
      expect(row).toMatchObject({ status: "in_progress", attempts: 1, askedInTurn: ticket.turn });
      expect(row.leaseUntil).toBeUndefined();
      expect(await board.renewLease("t4", clock.at + 10_000, { claim: ticket })).toMatchObject({ outcome: "declined", reason: "open-question" });
      clock.at += 60_000;
      expect(await board.reclaim()).toBe(0);
      expect(await board.claim("w")).toBeNull();
      expect(await board.complete("t4", "done", { claim: ticket, ifAllowed: true })).toMatchObject({ outcome: "declined", reason: "open-question" });
      expect(await board.fail("t4", "boom", { claim: ticket, ifAllowed: true })).toMatchObject({ outcome: "declined", reason: "open-question" });
      expect(board.get("t4")).toMatchObject({ status: "in_progress", attempts: 1 });
    });

    it("the last answer owes one more turn on the same attempt, which the claim takes uncharged; the asking turn's late write is refused", async () => {
      const { board, ticket, hold } = await askedMidway();
      await board.answer!("t4", user(hold, "signup_date"));
      expect(board.get("t4")).toMatchObject({ status: "in_progress", attempts: 1, turnOwed: true });
      const taken = (await board.claim("w", { leaseDurationMs: 10_000 }))!;
      expect(taken).toMatchObject({ attempts: 1, turn: 2 });
      expect(taken.turnOwed).toBeUndefined();
      expect(await board.claim("w")).toBeNull();
      // The asking turn's late writes, after its successor's claim.
      expect(await board.reportProgress!("t4", { statusNote: "late" }, { claim: ticket })).toMatchObject({ outcome: "declined", reason: "lost-claim" });
      expect(await board.complete("t4", "late", { claim: ticket, ifAllowed: true })).toMatchObject({ outcome: "declined", reason: "lost-claim" });
      // The successor's own settle lands.
      expect(await board.complete("t4", "done", { claim: ticketForClaim("tasks", taken), ifAllowed: true })).toEqual({ outcome: "recorded" });
      expect(board.get("t4")).toMatchObject({ status: "completed", attempts: 1, output: "done" });
    });

    it("the asking turn settles nothing even once its question is answered and before the next turn's claim", async () => {
      // An inline drain's recorder settles after the worker returns, with the asking turn's claim.
      // The answer has closed the hold by then, so the open-hold refusal alone would let it through.
      const { board, ticket, hold } = await askedMidway();
      await board.answer!("t4", user(hold, "signup_date"));
      expect(board.get("t4")).toMatchObject({ status: "in_progress", attempts: 1, turnOwed: true });
      expect(await board.complete("t4", "done", { claim: ticket, ifAllowed: true })).toMatchObject({ outcome: "declined", reason: "open-question" });
      expect(await board.fail("t4", "boom", { claim: ticket, ifAllowed: true })).toMatchObject({ outcome: "declined", reason: "open-question" });
      // The owed turn is still there for the next claim, on the same attempt.
      expect(board.get("t4")).toMatchObject({ status: "in_progress", attempts: 1, turnOwed: true });
      expect(await board.claim("w", { leaseDurationMs: 10_000 })).toMatchObject({ attempts: 1, turn: 2 });
    });

    it("an ask with no questions is refused, and leaves the turn's lease as it was", async () => {
      const { board } = await make();
      await board.addTask({ id: "t4", goal: "g" });
      const claimed = (await board.claim("w", { leaseDurationMs: 10_000 }))!;
      await expect(board.ask!("t4", [], { claim: ticketForClaim("tasks", claimed) })).rejects.toThrow(/no question was asked/);
      expect(board.get("t4")!.leaseUntil).toBe(claimed.leaseUntil);
    });

    it("the asking turn takes no answer as a steer: the answers are the next turn's", async () => {
      const { board, ticket, hold } = await askedMidway();
      await board.answer!("t4", user(hold, "signup_date"));
      expect(await board.takeSteers!("t4", { claim: ticket, takenIn: "step:asking" })).toMatchObject({ taken: [] });
      expect(board.get("t4")!.steers?.every((steer) => steer.takenIn === undefined)).toBe(true);
    });

    it("an admission that takes the owed turn is that turn's claim: the generation moves and the claim's mark clears", async () => {
      const { board, clock, ticket, hold } = await askedMidway();
      await board.answer!("t4", user(hold, "signup_date"));
      const admitted = await board.setKeptOpenBy!("t4", null, { claim: ticket, leaseUntil: clock.at + 10_000 });
      expect(admitted).toEqual({ outcome: "recorded" });
      expect(board.get("t4")).toMatchObject({ turn: 2, attempts: 1 });
      expect(board.get("t4")!.turnOwed).toBeUndefined();
      // The board's claim arriving after finds nothing owed.
      expect(await board.claim("w")).toBeNull();
    });

    it("a question with a stop for a person open on the row is refused: one wait at a time", async () => {
      const { board } = await make();
      await board.addTask({ id: "t9", goal: "g" });
      const claimed = (await board.claim("w", { leaseDurationMs: 10_000 }))!;
      const ticket = ticketForClaim("tasks", claimed);
      const stop: SuspensionQuestion = {
        id: "sp1",
        actor: "user",
        openedAt: 1,
        source: { kind: "suspension", requestId: "r1", suspensionId: "sp1" },
        ask: { kind: "approval", prompt: "Ship it?" },
      };
      await board.setKeptOpenBy!("t9", "wait", { claim: ticket, question: stop });
      expect(await board.ask!("t9", [ask(COLUMN)], { claim: ticket })).toMatchObject({ outcome: "declined", reason: "open-question" });
    });
  });

  describe("a deadline", () => {
    it("closes a question past the due time a host set, no answer came, and the work goes on; none set, it never does", async () => {
      const due = await make({ questionDueMs: 5_000 });
      const t5 = await due.board.addTask({ id: "t5", goal: "g", questions: [ask(CSV)] });
      expect(t5.questions![0]!.due).toBe(1_000 + 5_000);
      expect(await due.board.payQuestionDeadlines!()).toEqual([]);
      due.clock.at += 5_000;
      // The rows it paid, so a board wakes only those.
      expect(await due.board.payQuestionDeadlines!()).toEqual(["t5"]);
      expect(openQuestions(due.board.get("t5")!)).toEqual([]);
      expect(due.board.get("t5")!.steers).toMatchObject([{ from: "board", message: NO_ANSWER_CAME, answers: t5.questions![0]!.id }]);
      expect(await due.board.claim("w")).toMatchObject({ id: "t5", attempts: 1 });

      const none = await make();
      const t6 = await none.board.addTask({ id: "t6", goal: "g", questions: [ask(CSV)] });
      expect(t6.questions![0]!.due).toBeUndefined();
      none.clock.at += 30 * 86_400_000;
      expect(await none.board.payQuestionDeadlines!()).toEqual([]);
      expect(holdIds(none.board.get("t6"))).toEqual([t6.questions![0]!.id]);
      expect(await none.board.claim("w")).toBeNull();
    });
  });

  describe("a line typed in the task's session (steerFromLine)", () => {
    const line = (id: string) => ({ user: { identity: { userId: "u1" } }, request: { identity: { id } } });

    it("answers the oldest open question and leaves the other; replayed, it answers nothing more", async () => {
      const { board, csv, column } = await filed();
      expect(await steerFromLine(board, "t1", "The March export", line("req_line"))).toBeUndefined();
      expect(holdIds(board.get("t1"))).toEqual([column]);
      expect(board.get("t1")!.steers).toMatchObject([{ answers: csv, from: "user", by: "u1", message: "The March export" }]);
      expect(await steerFromLine(board, "t1", "The March export", line("req_line"))).toBeUndefined();
      expect(holdIds(board.get("t1"))).toEqual([column]);
    });

    it("never answers a confirm: a typed line is no yes or no, so it steers and the confirm stays open", async () => {
      const { board } = await make();
      const row = await board.addTask({ id: "t10", goal: "g", questions: [{ kind: "confirm", prompt: "Ship v2?" }] });
      expect(await steerFromLine(board, "t10", "sounds good", line("req_line2"))).toBeUndefined();
      expect(holdIds(board.get("t10"))).toEqual([row.questions![0]!.id]);
      expect(board.get("t10")!.steers).toMatchObject([{ message: "sounds good" }]);
      expect(board.get("t10")!.steers![0]!.answers).toBeUndefined();
    });
  });
});
