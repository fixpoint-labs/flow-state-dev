/**
 * The round trip, on the surface nothing else covers: **handed off, user-scoped,
 * cross-request.**
 *
 * The park, the drain's exit and the cross-request resume are pinned upstream
 * for the inline, session-scoped path. What is net-new is conductor's own
 * behaviour on top of them — a run that asks, a board that lets go, and an
 * operator's answer that starts it again through one action.
 *
 * **Every assertion is on the BOARD ROW and the INBOX ROW, read through
 * `status` and `answer`'s own output.** A declined settlement is silent, so the
 * run record and the request both read as success over an open row; and a
 * declined answer that threw instead of reporting would be the same defect
 * relocated.
 */
import { describe, expect, it, afterEach } from "vitest";
import type { ResolveClaudeAgent, SdkMessageLike } from "@flow-state-dev/claude-code/sdk";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { conductorFlow } from "../src/flow";
import type { BlockContext } from "@flow-state-dev/core";
import { askQuestion, questionFingerprint, questionTopic } from "../src/inbox";
import type { AnswerOutput } from "../src/answer";
import {
  createConductorHarness,
  sdkResult,
  type ConductorHarness,
  seedRepo,
} from "./harness";

const ISSUE = "FIX-1166";
const PHASE = "implement";
/** The harness's default epic, so the ledger can be addressed by accessor key. */
const COLLECTION_ID = "conductor-tasks--t0--harness-manager";

type StatusRow = {
  taskId: string;
  issue: string | null;
  phase: string | null;
  status: string;
  attempts: number;
  feedback: string | null;
  run: { outcome: string | null; reason: string | null } | null;
  questions: Array<{ question: string; text: string; attempt: number; askedAt: number | null }>;
};

let live: ConductorHarness | undefined;
afterEach(() => {
  live?.dispose();
  live = undefined;
});

/** What one attempt's stubbed run does. */
interface Turn {
  /** The question it writes to this attempt's marker, if any. */
  question?: string;
  /** The SDK result subtype. Only `"success"` is a non-errored verdict. */
  subtype?: string;
  /** Whether the done-condition holds after this attempt. */
  done?: boolean;
}

/**
 * A `query` that plays one {@link Turn} per attempt.
 *
 * The marker is written to **the path the prompt named**, parsed back out of
 * the prompt rather than derived here — so a prompt that stopped naming the
 * marker makes this stub write nowhere, which is what a real coding agent would
 * do with the same prompt. That is the one part of the ask this suite can check
 * without a live model.
 */
function turnAgent(
  turns: Turn[],
  seen: { prompts: string[]; cwds: (string | undefined)[]; turn: number },
): ResolveClaudeAgent {
  return () => ({
    query: async function* (args) {
      const prompt = String(args.prompt);
      seen.prompts.push(prompt);
      seen.cwds.push(args.options?.cwd);
      const turn = turns[Math.min(seen.turn, turns.length - 1)] ?? {};
      seen.turn += 1;
      if (turn.question !== undefined) {
        const named = /^ {2}(\S*\/\.fsdev\/ask\/\d+\.md)\s*$/m.exec(prompt);
        expect(named, "the prompt must name this attempt's marker path").not.toBeNull();
        const target = named![1]!;
        mkdirSync(dirname(target), { recursive: true });
        writeFileSync(target, turn.question);
      }
      yield sdkResult(turn.subtype ?? "success") as SdkMessageLike;
    },
  });
}

function seenTurns() {
  return { prompts: [] as string[], cwds: [] as (string | undefined)[], turn: 0 };
}

async function readStatus(h: ConductorHarness): Promise<StatusRow> {
  const { rows } = await h.call<{ rows: StatusRow[] }>("status", { issue: ISSUE });
  return rows[0]!;
}

/** Wait until the board row reaches a status that is not `in_progress`. */
async function settle(h: ConductorHarness, timeoutMs = 10_000): Promise<StatusRow> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const row = await readStatus(h);
    if (row !== undefined && row.status !== "in_progress") return row;
    if (Date.now() >= deadline) {
      throw new Error(
        `the row never left in_progress within ${timeoutMs}ms — last seen ${JSON.stringify(row)}`,
      );
    }
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

async function seedAndSettle(h: ConductorHarness): Promise<StatusRow> {
  await h.call("seed", { issue: ISSUE, phase: PHASE });
  return settle(h);
}

/** The board's exit verdict, which lives on the completion item and nowhere else. */
function terminationReason(items: readonly unknown[]): string | undefined {
  type MetaItem = { type?: string; component?: string; data?: unknown };
  const meta = (items as MetaItem[]).find(
    (i) => i.type === "component" && i.component === "task-board-meta",
  );
  return (meta?.data as { terminationReason?: string } | undefined)?.terminationReason;
}

/** The key attempt N's question lands on. */
function topicFor(question: string, attempt: number): string {
  return questionTopic(ISSUE, PHASE, attempt, questionFingerprint(question));
}

// ───────────────────────────────────────────────────────────────────────────
// The park, and what the drain does with it
// ───────────────────────────────────────────────────────────────────────────

describe("the park — a handed-off worker's own hold survives its normal return", () => {
  it("leaves the row parked and the question open", async () => {
    // Behaviour 1. The worker calls `awaitReview` on its OWN row and then
    // returns normally; the recorders decline a parked row, so nothing settles
    // it on the way out. `completed` here would mean the park was tidied away.
    const seen = seenTurns();
    live = createConductorHarness({
      resolveClaudeAgent: turnAgent([{ question: "which path?" }], seen),
      isDone: () => false,
    });

    const row = await seedAndSettle(live);

    expect(row.status).toBe("parked");
    expect(row.questions).toHaveLength(1);
    expect(row.questions[0]!.text).toBe("which path?");
    expect(row.questions[0]!.attempt).toBe(1);
    // The row's name is what an answer takes, and it is per-attempt.
    expect(row.questions[0]!.question).toBe(topicFor("which path?", 1));
  });

  it("reports parked-for-review and dispatches nothing on the next drain", async () => {
    // Behaviour 2. The reason string is asserted rather than "the row is still
    // parked", because only `onReview: "exit"` can produce it — a board that
    // lost the option holds the drain open and reports something else, so this
    // assertion cannot pass on a build where the option did nothing.
    const seen = seenTurns();
    live = createConductorHarness({
      resolveClaudeAgent: turnAgent([{ question: "which path?" }], seen),
      isDone: () => false,
    });
    await seedAndSettle(live);
    const runsBefore = seen.turn;

    const { items } = await live.callWithItems("wake", {});

    expect(terminationReason(items)).toBe("parked-for-review");
    // Nothing was re-dispatched: a parked row is not claimable.
    expect(seen.turn).toBe(runsBefore);
    expect((await readStatus(live)).status).toBe("parked");
  });

  it("does NOT report parked-for-review when nothing is parked", async () => {
    // Behaviour 3's arm on THIS board: the verdict tracks the park rather than
    // being a constant this board always emits. (The substrate flip — the same
    // board with and without the option — is pinned upstream by
    // `task-board-park-exit-drain.test.ts`.)
    const seen = seenTurns();
    live = createConductorHarness({
      resolveClaudeAgent: turnAgent([{ subtype: "success" }], seen),
      isDone: () => true,
    });
    await seedAndSettle(live);

    const { items } = await live.callWithItems("wake", {});

    expect(terminationReason(items)).not.toBe("parked-for-review");
  });

  it("constructs the board with the option alongside the ledger, onIdle and seeding", async () => {
    // Behaviour 21. All three park-exit refusals are construction-time throws,
    // so the regression is that the flow cannot be built at all.
    // **A real repository, because construction now validates one.** This used
    // to pass `/tmp/nowhere`, which was fine when nothing checked it. The base
    // branch since refuses a `sourceRepo` that is not a git repository — a
    // permanent configuration error caught before a row is claimed and charged.
    // The behaviour under test is the board's park-exit options, so the
    // workspace only has to be valid, not special.
    const repo = mkdtempSync(join(tmpdir(), "conductor-construction-"));
    seedRepo(repo);
    const root = mkdtempSync(join(tmpdir(), "conductor-construction-root-"));

    expect(() =>
      conductorFlow({
        epic: "construction-check",
        workspace: { root, sourceRepo: repo, baseRef: "main" },
      }),
    ).not.toThrow();
  });
});

// ───────────────────────────────────────────────────────────────────────────
// The three decide arms, and the fourth combination
// ───────────────────────────────────────────────────────────────────────────

describe("the decide arms — asserted on the board row AND the inbox row", () => {
  it("parks an attempt that asked even when the done-condition already holds", async () => {
    // Arm 1 beats arm 2, and the precedence is the guarantee. A marker is the
    // run saying outright that it needs a decision, and it says it about THIS
    // attempt. The done-condition says whether the JOB is done, over a branch
    // every attempt on the task shares — so it cannot speak for one attempt,
    // and it must not settle one that asked for a person.
    //
    // The cost, stated rather than hidden: a run that asked, unblocked itself
    // and finished anyway now parks for one human round trip instead of
    // completing. That is the safe direction of the same mistake.
    const seen = seenTurns();
    live = createConductorHarness({
      resolveClaudeAgent: turnAgent([{ question: "which path?" }], seen),
      isDone: () => true,
    });

    const row = await seedAndSettle(live);

    expect(row.status).toBe("parked");
    expect(row.questions.map((q) => q.text)).toEqual(["which path?"]);

    // And the question is answerable, which is the whole point of holding it.
    const answered = await live.call<AnswerOutput>("answer", {
      question: topicFor("which path?", 1),
      answer: "the second one",
    });
    expect(answered.result).toBe("answered");
  });

  it("does not complete an attempt that asked, on a pull request an earlier attempt left", async () => {
    // The branch is derived from (epic, issue, phase), so every attempt on a
    // task shares it and the completion probe keys on nothing else. Attempt 1
    // opens a pull request and then runs out of turns; attempt 2 asks a
    // question and stops, having produced nothing of its own. The probe still
    // sees attempt 1's pull request, so the done-condition holds for an attempt
    // that did no work — and the arm order used to read that as "the run
    // answered its own question", withdraw the question and complete the row.
    //
    // The visible cost of getting this wrong: a person is asked something, the
    // question disappears from the inbox before they see it, and the phase
    // reports done. A silent wrong success arriving through the completion
    // check itself.
    const seen = seenTurns();
    live = createConductorHarness({
      resolveClaudeAgent: turnAgent(
        [{ subtype: "error_max_turns" }, { question: "which path?" }],
        seen,
      ),
      // True from attempt 1 onwards — the pull request is on the branch and
      // still open, which is exactly what the probe reports and all it reports.
      isDone: () => true,
    });

    const failed = await seedAndSettle(live);
    expect(failed.status).toBe("pending");

    await live.call("wake", {});
    const parked = await settle(live);

    expect(parked.status).toBe("parked");
    expect(parked.questions.map((q) => q.text)).toContain("which path?");
  });

  it("parks when the verdict did not fail and this attempt asked", async () => {
    const seen = seenTurns();
    live = createConductorHarness({
      resolveClaudeAgent: turnAgent([{ question: "which path?" }], seen),
      isDone: () => false,
    });
    const row = await seedAndSettle(live);
    expect(row.status).toBe("parked");
    expect(row.questions).toHaveLength(1);
  });

  it("re-pends with no question row when the attempt asked nothing", async () => {
    const seen = seenTurns();
    live = createConductorHarness({
      resolveClaudeAgent: turnAgent([{ subtype: "success" }], seen),
      isDone: () => false,
    });
    const row = await seedAndSettle(live);
    expect(row.status).toBe("pending");
    expect(row.questions).toHaveLength(0);
  });

  it("takes the FAILURE path on a marker paired with an errored verdict", async () => {
    // **The fourth combination, and the one that can fail.** A suite that pairs
    // marker-with-success and no-marker-with-failure passes with arm 1's
    // verdict half missing, because neither of those puts a marker and a
    // failure on the same attempt — which is exactly what that half excludes.
    //
    // The SDK reports a turn cap or an exhausted budget by RETURNING an errored
    // handle, not by throwing, so this run looks ordinary right up to the
    // verdict. An arm gated on the marker alone parks a run that is already
    // dead: the row never re-pends, the retry budget is never spent, and
    // nothing reports it.
    const seen = seenTurns();
    live = createConductorHarness({
      resolveClaudeAgent: turnAgent(
        [{ question: "which path?", subtype: "error_max_turns" }],
        seen,
      ),
      isDone: () => true,
    });

    const row = await seedAndSettle(live);

    expect(row.status).toBe("pending");
    expect(row.status).not.toBe("parked");
    expect(row.run?.outcome).toBe("failed");

    // **`present` is half the assertion.** The row is created BEFORE the arms,
    // so a failure path has something to withdraw — a design that created it
    // inside the park arm leaves nothing here, and an assertion that only
    // checked "not open" would pass against an absent row.
    const late = await live.call<AnswerOutput>("answer", {
      question: topicFor("which path?", 1),
      answer: "too late",
    });
    expect(late.reason).not.toBe("unknown-question");
    expect(late.questionStatus).toBe("withdrawn");
  });
});

// ───────────────────────────────────────────────────────────────────────────
// The answer, end to end
// ───────────────────────────────────────────────────────────────────────────

describe("the answer — one action, and the run comes back holding it", () => {
  it("re-dispatches the run with the answer in its prompt, through `answer` alone", async () => {
    // Behaviour 7. **Driven through `answer` alone**: a test that drains by hand
    // afterwards passes with the missing drain in place, and §5's promise that
    // "an answer starts the run again" is exactly what that would break.
    const seen = seenTurns();
    live = createConductorHarness({
      resolveClaudeAgent: turnAgent(
        [{ question: "which path?" }, { subtype: "success" }],
        seen,
      ),
      isDone: () => false,
    });
    const parked = await seedAndSettle(live);
    expect(parked.status).toBe("parked");

    const outcome = await live.call<AnswerOutput>("answer", {
      question: topicFor("which path?", 1),
      answer: "Correct the path only. Leave the symlink alone.",
    });
    expect(outcome.result).toBe("answered");
    await settle(live);

    // A second run happened, and it was told the answer.
    expect(seen.prompts).toHaveLength(2);
    expect(seen.prompts[1]).toContain("Correct the path only. Leave the symlink alone.");
    expect(seen.prompts[1]).toContain("which path?");
  });

  it("charges the answer one of the run's retries", async () => {
    // Behaviour 14, pinning decision 2's cost so it cannot regress into a
    // surprise. `attempts` advances at claim time and only abandonments are
    // discounted, so answering three questions on a three-retry budget leaves
    // none for a real failure.
    const seen = seenTurns();
    live = createConductorHarness({
      resolveClaudeAgent: turnAgent(
        [{ question: "which path?" }, { subtype: "success" }],
        seen,
      ),
      isDone: () => false,
    });
    const parked = await seedAndSettle(live);
    expect(parked.attempts).toBe(1);

    await live.call("answer", {
      question: topicFor("which path?", 1),
      answer: "the second one",
    });
    const resumed = await settle(live);

    expect(resumed.attempts).toBe(2);
  });

  it("carries TWO answered rows into the prompt oldest first", async () => {
    // Behaviour 7's second arm — §7's fold promise, which cannot fail on a
    // single-answer test.
    const seen = seenTurns();
    live = createConductorHarness({
      resolveClaudeAgent: turnAgent(
        [{ question: "first question" }, { question: "second question" }, { subtype: "success" }],
        seen,
      ),
      isDone: () => false,
    });
    await seedAndSettle(live);
    await live.call("answer", {
      question: topicFor("first question", 1),
      answer: "first answer",
    });
    await settle(live);
    await live.call("answer", {
      question: topicFor("second question", 2),
      answer: "second answer",
    });
    await settle(live);

    const third = seen.prompts[2]!;
    expect(third).toContain("first answer");
    expect(third).toContain("second answer");
    expect(third.indexOf("first answer")).toBeLessThan(third.indexOf("second answer"));
  });

  it("asks the SAME question again in a later attempt rather than reading the old answer", async () => {
    // Behaviour 15, and what the key's attempt segment buys. Without it the two
    // attempts collide onto one row: the second ask is a create-only write
    // against an `answered` row, so it is a read — the question is never asked,
    // the run parks on nothing, and the manager folds a stale answer into the
    // prompt instead. **A key without the attempt segment passes every other
    // behaviour in this file and fails only here.**
    const seen = seenTurns();
    live = createConductorHarness({
      resolveClaudeAgent: turnAgent([{ question: "which path?" }], seen),
      isDone: () => false,
    });
    await seedAndSettle(live);
    await live.call("answer", {
      question: topicFor("which path?", 1),
      answer: "the first answer",
    });
    const parkedAgain = await settle(live);

    // Attempt 2 asked the identical question and is waiting on it — on its OWN
    // row, which nobody has answered.
    expect(parkedAgain.status).toBe("parked");
    expect(parkedAgain.questions.map((q) => q.question)).toEqual([
      topicFor("which path?", 2),
    ]);
    expect(parkedAgain.questions[0]!.attempt).toBe(2);
    // And attempt 1's answer still reached attempt 2's prompt — the fold reads
    // answered rows across attempts, which is question history rather than a
    // freshness assumption.
    expect(seen.prompts[1]).toContain("the first answer");
  });

  it("takes the no-question path when a later attempt leaves the stale marker untouched", async () => {
    // Behaviour 11, at the seam that matters. The checkout survives a retry, so
    // attempt 1's question file is still on disk when attempt 2 starts. **A
    // fixed marker path passes every other behaviour in this file and fails
    // here**: the manager would read the stale file, write a new row under
    // attempt 2's key, and park a run that quietly did nothing.
    const seen = seenTurns();
    live = createConductorHarness({
      resolveClaudeAgent: turnAgent(
        [{ question: "which path?" }, { subtype: "success" }],
        seen,
      ),
      isDone: () => false,
    });
    await seedAndSettle(live);
    await live.call("answer", {
      question: topicFor("which path?", 1),
      answer: "the answer",
    });
    const after = await settle(live);

    // Attempt 2 wrote no marker of its own, so it is an ordinary failed
    // attempt — re-pended, not parked.
    expect(after.status).toBe("pending");
    expect(after.status).not.toBe("parked");
    // And no second question appeared out of the stale file.
    expect(after.questions).toHaveLength(0);
  });

  it("never lets the two channels carry each other", async () => {
    // Behaviour 8, and the behaviour that fails SILENTLY. The board's
    // `feedback` says why the last attempt FAILED; the inbox row says what an
    // operator answered. Handing the answer back through `feedback` is the
    // cheapest wiring and would tell the run *"your last attempt stopped
    // because: take the second option."*
    const seen = seenTurns();
    live = createConductorHarness({
      resolveClaudeAgent: turnAgent(
        [
          // Attempt 1: a real failure, so `feedback` carries a reason.
          { subtype: "error_max_turns" },
          // Attempt 2: asks, and parks.
          { question: "which path?" },
          // Attempt 3: the resumed run.
          { subtype: "success" },
        ],
        seen,
      ),
      isDone: () => false,
    });
    const failed = await seedAndSettle(live);
    expect(failed.status).toBe("pending");
    expect(failed.feedback).toContain("error_max_turns");

    await live.call("wake", {});
    const parked = await settle(live);
    expect(parked.status).toBe("parked");
    // Attempt 2 WAS told why attempt 1 stopped — that channel still works.
    expect(seen.prompts[1]).toContain("error_max_turns");

    await live.call("answer", {
      question: topicFor("which path?", 2),
      answer: "Correct the path only.",
    });
    await settle(live);

    const resumed = seen.prompts[2]!;
    // The answer arrives as an answer …
    expect(resumed).toContain("Correct the path only.");
    // … and NOT as this attempt's failure reason. `unpark` is called
    // with no feedback, which also clears the previous failure's.
    expect(resumed).not.toContain("The last attempt stopped for this reason");
    expect(resumed).not.toContain("error_max_turns");
  });
});

// ───────────────────────────────────────────────────────────────────────────
// The guard: a decline is reported, and it is a PAIR
// ───────────────────────────────────────────────────────────────────────────

describe("the guard — reported declines, and the row half of the pair", () => {
  it("refuses an answer to a row that was never parked, and says so", async () => {
    // Behaviour 13. The substrate refuses a non-parked task too (`unpark` is
    // fenced to `parked` since FIX-1244); this pins conductor's own row-level
    // half, the one that tells attempt 1's withdrawn row from attempt 2's open
    // one. A silent decline is the defect class this lab exists to remove,
    // relocated.
    const seen = seenTurns();
    live = createConductorHarness({
      resolveClaudeAgent: turnAgent([{ question: "which path?", subtype: "success" }], seen),
      isDone: () => false,
    });
    await seedAndSettle(live);
    const topic = topicFor("which path?", 1);

    // The first answer re-queues the row.
    const first = await live.call<AnswerOutput>("answer", { question: topic, answer: "A" });
    expect(first.result).toBe("answered");

    // The second is the duplicate: the row is no longer `open`, so it declines
    // rather than re-queueing a run that is already moving.
    const second = await live.call<AnswerOutput>("answer", { question: topic, answer: "B" });
    expect(second.result).toBe("declined");
    expect(second.drained).toBe(false);
    expect(second.reason).not.toBeNull();
  });

  it("refuses an answer naming a name that is not a question", async () => {
    const seen = seenTurns();
    live = createConductorHarness({
      resolveClaudeAgent: turnAgent([{ subtype: "success" }], seen),
      isDone: () => true,
    });
    await seedAndSettle(live);

    const outcome = await live.call<AnswerOutput>("answer", {
      question: "../../etc/passwd",
      answer: "nope",
    });
    expect(outcome.result).toBe("declined");
    expect(outcome.reason).toBe("malformed-question");
  });

  it("refuses an answer naming an EARLIER attempt's withdrawn row, with the task still parked", async () => {
    // Behaviour 16's first arm, and the row half of the pair. The task is
    // shared across attempts, the row is per-attempt: a late answer naming
    // attempt 1's WITHDRAWN row passes a task-only guard, flips it to
    // `answered` and re-queues the run — while attempt 2's real question is
    // still open and never gets answered.
    const seen = seenTurns();
    live = createConductorHarness({
      resolveClaudeAgent: turnAgent(
        [
          // Attempt 1 asks and then FAILS, so its row is withdrawn (arm 3).
          { question: "attempt one's question", subtype: "error_max_turns" },
          // Attempt 2 asks its own question and parks.
          { question: "attempt two's question", subtype: "success" },
        ],
        seen,
      ),
      isDone: () => false,
    });
    await seedAndSettle(live);
    await live.call("wake", {});
    const parked = await settle(live);
    expect(parked.status).toBe("parked");
    expect(parked.questions.map((q) => q.text)).toEqual(["attempt two's question"]);

    const stale = await live.call<AnswerOutput>("answer", {
      question: topicFor("attempt one's question", 1),
      answer: "an answer to a dead question",
    });

    expect(stale.result).toBe("declined");
    expect(stale.questionStatus).toBe("withdrawn");
    expect(stale.drained).toBe(false);
    // **Refused by the GUARD, not by the row write.** A task-only guard would
    // still fall out declined here — the conditional `open → answered`
    // transition catches it a step later — so the reason is what separates the
    // two. Without this line the test passes with the row half of the pair
    // removed.
    expect(stale.reason).toBe("question-not-open");

    // Attempt 1's row is untouched, attempt 2's is still open, and the task was
    // NOT re-queued.
    const after = await readStatus(live);
    expect(after.status).toBe("parked");
    expect(after.questions.map((q) => q.text)).toEqual(["attempt two's question"]);
  });

  it("refuses an ANSWERED earlier row while a later question is open", async () => {
    // Behaviour 16's second arm, **and the one the recovery rule can fail.**
    // Attempt 1's row is `answered`, so the proceed path is not taken and the
    // conditional write never runs — nothing downstream can save this. Recovery
    // reads a durable patch and a parked task, and a rule keyed on those alone
    // resumes attempt 2 holding attempt 1's answer while Q2 is still open. The
    // real question is then never answered.
    //
    // What refuses it is the other half of recovery's condition: **no row under
    // `<issue>/<phase>/` may be open.** Answered rows are retained forever, so
    // without it every settled question stays a live re-entry point.
    const seen = seenTurns();
    live = createConductorHarness({
      resolveClaudeAgent: turnAgent(
        [
          { question: "attempt one's question" },
          { question: "attempt two's question" },
          { subtype: "success" },
        ],
        seen,
      ),
      isDone: () => false,
    });
    await seedAndSettle(live);

    const firstTopic = topicFor("attempt one's question", 1);
    const first = await live.call<AnswerOutput>("answer", {
      question: firstTopic,
      answer: "answer to Q1",
    });
    expect(first.result).toBe("answered");
    const parkedOnTwo = await settle(live);
    expect(parkedOnTwo.status).toBe("parked");
    expect(parkedOnTwo.questions.map((q) => q.text)).toEqual(["attempt two's question"]);
    const runsBefore = seen.turn;

    const replay = await live.call<AnswerOutput>("answer", {
      question: firstTopic,
      answer: "answer to Q1, again",
    });

    expect(replay.result).toBe("declined");
    expect(replay.reason).toBe("another-question-open");
    expect(replay.drained).toBe(false);
    // Nothing ran, attempt 2 is still waiting, and the task was not re-queued.
    expect(seen.turn).toBe(runsBefore);
    const after = await readStatus(live);
    expect(after.status).toBe("parked");
    expect(after.questions.map((q) => q.text)).toEqual(["attempt two's question"]);
  });
});

// ───────────────────────────────────────────────────────────────────────────
// Reconciliation: the orphan, and the cancel
// ───────────────────────────────────────────────────────────────────────────

describe("reconciliation — an unanswerable row is never left displayed as answerable", () => {
  it("withdraws an orphaned open row before the next attempt runs", async () => {
    // Behaviour 10, and the staging is the whole test. The create-only write
    // commits BEFORE the outcome arms, so a process that dies in between leaves
    // attempt 1's row `open` with **no arm having decided it** — which is a
    // different state from a row an arm withdrew.
    //
    // Staged by writing that row directly, because nothing between the commit
    // and the park is reachable from a test seam any more. Written rather than
    // simulated: the state under test is "an open row no arm decided", and
    // planting it says so, where crashing a hook said it only as long as that
    // hook happened to run in the gap. A staging that instead let attempt 1
    // FAIL proves nothing here — arm 3 withdraws the row on its way out, so the
    // reconciliation has nothing left to do and the test passes with it deleted.
    //
    // Left alone, the orphan satisfies the proceed guard the moment attempt 2
    // parks, and answering it re-queues the run with the real question still
    // open.
    const seen = seenTurns();
    const board = ledgerCapture();
    live = createConductorHarness({
      resolveClaudeAgent: turnAgent(
        [
          // Attempt 1 asks nothing and does not finish, so it re-pends with no
          // question row of its own — the orphan below is the only one.
          { subtype: "success" },
          { question: "the real question", subtype: "success" },
        ],
        seen,
      ),
      onPrompt: board.onPrompt,
      isDone: () => false,
    });
    const crashed = await seedAndSettle(live);
    expect(crashed.status).toBe("pending");
    expect(crashed.questions).toHaveLength(0);

    await board.plantOpenQuestion(topicFor("orphaned question", 1), {
      question: "orphaned question",
      askedBy: crashed.taskId,
    });
    // The orphan is genuinely open at this point — no arm reached it.
    expect((await readStatus(live)).questions.map((q) => q.text)).toEqual(["orphaned question"]);

    await live.call("wake", {});
    const parked = await settle(live);

    expect(parked.status).toBe("parked");
    // At most ONE open row per issue-phase — what the proceed guard and
    // recovery's nothing-open condition both assume.
    expect(parked.questions.map((q) => q.text)).toEqual(["the real question"]);

    const orphan = await live.call<AnswerOutput>("answer", {
      question: topicFor("orphaned question", 1),
      answer: "answering the orphan",
    });
    expect(orphan.result).toBe("declined");
    expect(orphan.questionStatus).toBe("withdrawn");
    expect(orphan.drained).toBe(false);
    // The task was NOT re-queued, and the real question is still waiting.
    const after = await readStatus(live);
    expect(after.status).toBe("parked");
    expect(after.questions.map((q) => q.text)).toEqual(["the real question"]);
  });

  it("does not strand a cancelled task's question — `status` reconciles what it reads", async () => {
    // Behaviour 18's first arm. The board's `cancel` writes the task row and
    // nothing else, so the manager never runs again and neither of its
    // withdrawal arms fires. The question is then unanswerable by construction,
    // because the guard refuses a terminal task — so left alone it shows here
    // forever as a question nobody can act on.
    const seen = seenTurns();
    const board = ledgerCapture();
    live = createConductorHarness({
      resolveClaudeAgent: turnAgent([{ question: "which path?" }], seen),
      onPrompt: board.onPrompt,
      isDone: () => false,
    });
    const parked = await seedAndSettle(live);
    expect(parked.status).toBe("parked");
    expect(parked.questions).toHaveLength(1);
    const topic = topicFor("which path?", 1);

    await board.cancel(parked.taskId);

    const afterStatus = await readStatus(live);
    expect(afterStatus.status).toBe("cancelled");
    expect(afterStatus.questions).toHaveLength(0);

    const late = await live.call<AnswerOutput>("answer", { question: topic, answer: "nope" });
    expect(late.result).toBe("declined");
    expect(late.questionStatus).toBe("withdrawn");
  });

  it("withdraws the row on `answer`'s OWN refusal, with no intervening `status`", async () => {
    // Behaviour 18's second arm, and the one it exists for. §7 promises BOTH
    // surfaces reconcile; with only the first arm, an `answer` that declines
    // and leaves the row `open` passes.
    const seen = seenTurns();
    const board = ledgerCapture();
    live = createConductorHarness({
      resolveClaudeAgent: turnAgent([{ question: "which path?" }], seen),
      onPrompt: board.onPrompt,
      isDone: () => false,
    });
    const parked = await seedAndSettle(live);
    const topic = topicFor("which path?", 1);
    await board.cancel(parked.taskId);

    // Straight to `answer` — nothing has read the pair in between.
    const late = await live.call<AnswerOutput>("answer", { question: topic, answer: "nope" });

    expect(late.result).toBe("declined");
    expect(late.reason).toBe("task-terminal");
    // The refusal itself left the row withdrawn — the only write a refusal
    // makes.
    expect(late.questionStatus).toBe("withdrawn");
    expect((await readStatus(live)).questions).toHaveLength(0);
  });
});

// ───────────────────────────────────────────────────────────────────────────
// The read surface, across the session boundary
// ───────────────────────────────────────────────────────────────────────────

describe("the inbox crosses the session boundary, and `status` is what reads it", () => {
  it("reports a question written inside the child session to a DIFFERENT coordinator session", async () => {
    // Behaviour 6. The row was written inside the child session's request,
    // with no `sharedToLineage` declared anywhere — `user` scope is what
    // spans them. **Second arm:** the read is the `status` ACTION, which is the
    // whole of how an operator sees a question with no UI built and with Relay
    // absent. A suite that read the collection directly would prove the
    // substrate and leave the product promise untested.
    const seen = seenTurns();
    live = createConductorHarness({
      resolveClaudeAgent: turnAgent([{ question: "which path?" }, { subtype: "success" }], seen),
      isDone: () => false,
    });
    await seedAndSettle(live);

    const other = "sess_a_completely_different_coordinator";
    const { rows } = await live.call<{ rows: StatusRow[] }>("status", { issue: ISSUE }, other);

    expect(rows[0]!.status).toBe("parked");
    expect(rows[0]!.questions.map((q) => q.text)).toEqual(["which path?"]);

    // And that other session can act on what it read.
    const outcome = await live.call<AnswerOutput>(
      "answer",
      { question: rows[0]!.questions[0]!.question, answer: "the second one" },
      other,
    );
    expect(outcome.result).toBe("answered");
  });
});

// ───────────────────────────────────────────────────────────────────────────
// The announcement
// ───────────────────────────────────────────────────────────────────────────

describe("the announcement — what is announced is already answerable", () => {
  it("fires AFTER the park, naming the row, and a caller answering on it is accepted", async () => {
    // Behaviour 19. The seam is a no-op until Relay lands, so the assertion is
    // on the stub's call ORDER — which is the point, because the defect only
    // becomes visible once a real subscriber exists. Announced first, a
    // subscriber fast enough to act is refused by the parked-only guard and
    // then watches the task park on the question it just tried to answer.
    const seen = seenTurns();
    const announced: Array<{ question: string; statusAtAnnounce: string | undefined }> = [];
    let readStatusAtAnnounce: (() => Promise<string | undefined>) | undefined;

    live = createConductorHarness({
      resolveClaudeAgent: turnAgent([{ question: "which path?" }, { subtype: "success" }], seen),
      isDone: () => false,
      announce: async (event) => {
        announced.push({
          question: event.question,
          statusAtAnnounce: await readStatusAtAnnounce?.(),
        });
      },
    });
    readStatusAtAnnounce = async () => (await readStatus(live!)).status;

    await seedAndSettle(live);

    expect(announced).toHaveLength(1);
    expect(announced[0]!.question).toBe(topicFor("which path?", 1));
    // The park had ALREADY landed when the announcement fired.
    expect(announced[0]!.statusAtAnnounce).toBe("parked");

    // And a caller acting the moment it fires is accepted, not refused.
    const outcome = await live.call<AnswerOutput>("answer", {
      question: announced[0]!.question,
      answer: "the second one",
    });
    expect(outcome.result).toBe("answered");
  });

  it("does not announce when nothing parked", async () => {
    const seen = seenTurns();
    const announced: string[] = [];
    live = createConductorHarness({
      resolveClaudeAgent: turnAgent([{ subtype: "success" }], seen),
      isDone: () => true,
      announce: (event) => {
        announced.push(event.question);
      },
    });
    await seedAndSettle(live);
    expect(announced).toEqual([]);
  });
});

/**
 * A handle on the board's ledger, captured from inside the run.
 *
 * Behaviour 18 needs a task settled **from outside conductor** — the board's
 * own `cancel` is reachable by an operator without going through this lab,
 * which is the whole reason the reconciliation lives at the read rather than in
 * a conductor `cancel` wrapper that could be bypassed. There is no conductor
 * action that writes a terminal status, and adding one for a test would be the
 * wrapper this design rejected, so the ledger is reached the way
 * `manager.spec.ts` already reaches it: off a real block context.
 */
type Ledger = { upsert(key: string, update: unknown): Promise<unknown> };

function ledgerCapture(): {
  onPrompt: (run: { ctx: unknown }) => void;
  cancel: (taskId: string) => Promise<void>;
  plantOpenQuestion: (topic: string, entry: { question: string; askedBy: string }) => Promise<void>;
} {
  // Captured from `buildPrompt` rather than the done-condition, because that is
  // the hook every attempt reaches. An attempt that parks on a question never
  // reaches `isDone` — the park arm decides before it, deliberately — so a
  // capture hung there records nothing for exactly the runs these tests stage.
  let ctx: BlockContext | undefined;
  const captured = (): BlockContext => {
    if (ctx === undefined) throw new Error("no attempt ever ran, so no context was captured");
    return ctx;
  };
  return {
    onPrompt: (run) => {
      ctx = run.ctx as BlockContext;
    },
    cancel: async (taskId) => {
      const ledger = (captured() as unknown as { resources: Record<string, Ledger> }).resources[
        COLLECTION_ID
      ]!;
      await ledger.upsert(taskId, { status: "cancelled" });
    },
    plantOpenQuestion: async (topic, entry) => {
      await askQuestion(captured(), topic, { ...entry, askedAt: Date.now() });
    },
  };
}
