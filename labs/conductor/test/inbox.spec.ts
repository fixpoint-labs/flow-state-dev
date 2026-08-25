/**
 * The inbox at its own seam: the key grammar, the create-only ask, the two
 * conditional transitions, and the marker path.
 *
 * Tested against a collection fake that models the registry's **compare-and-
 * swap**, not a map. That is the whole point of the fake: `updateState` re-runs
 * its updater against refreshed state when another writer commits underneath
 * it, and the racing behaviours below can only fail on a read-then-patch
 * implementation if the seam they run against actually has that window. A fake
 * that wrote straight through would pass on the bug.
 */
import { describe, expect, it } from "vitest";
import type { BlockContext } from "@flow-state-dev/core/types";
import { execFileSync } from "node:child_process";
import { sep } from "node:path";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import {
  INBOX,
  askQuestion,
  answerQuestion,
  listQuestions,
  parseQuestionTopic,
  questionFingerprint,
  questionTopic,
  questionTopicPrefix,
  readQuestion,
  withdrawEarlierQuestions,
  withdrawQuestion,
} from "../src/inbox";
import { ASK_MARKER_DIR, askMarkerPath, readAskMarker } from "../src/ask";
import { contextWithInbox, fakeInbox } from "./inbox-fake";

const ISSUE = "FIX-1166";
const PHASE = "implement";

/** The key one attempt's question lands on. */
function topicFor(question: string, attempt: number): string {
  return questionTopic(ISSUE, PHASE, attempt, questionFingerprint(question));
}

async function ask(
  ctx: BlockContext,
  question: string,
  attempt: number,
  askedAt = 1_000 + attempt,
): Promise<string> {
  const topic = topicFor(question, attempt);
  await askQuestion(ctx, topic, { question, askedBy: "task_1", askedAt });
  return topic;
}

describe("the inbox key — issue-first, attempt-keyed, hash-named", () => {
  it("is one contiguous range per issue-phase, and reads back into its parts", () => {
    const topic = topicFor("which path?", 2);
    expect(topic.startsWith(questionTopicPrefix(ISSUE, PHASE))).toBe(true);
    expect(parseQuestionTopic(topic)).toEqual({
      issue: ISSUE,
      phase: PHASE,
      attempt: 2,
      fingerprint: questionFingerprint("which path?"),
    });
  });

  it("keys the SAME question in a LATER attempt to a different row", () => {
    // What the attempt segment buys. A key without it passes every other
    // behaviour in this file: the two attempts collide onto one row, and a
    // later attempt asking the identical question would read the earlier
    // attempt's answer instead of asking.
    expect(topicFor("which path?", 1)).not.toBe(topicFor("which path?", 2));
  });

  it("refuses a name that is not a question key", () => {
    // The one place caller-supplied text becomes a key, so it is the one place
    // the grammar is checked (BP-031). A traversal must never reach a task id.
    expect(parseQuestionTopic("FIX-1/implement/1")).toBeUndefined();
    expect(parseQuestionTopic("FIX-1/implement/1/a/b")).toBeUndefined();
    expect(parseQuestionTopic("FIX-1/implement/x/abcd")).toBeUndefined();
    expect(parseQuestionTopic("../../etc/passwd")).toBeUndefined();
    expect(parseQuestionTopic("FIX-1/../1/abcd")).toBeUndefined();
    expect(parseQuestionTopic("FIX-1/implement/1/NOTHEX")).toBeUndefined();
  });
});

describe("the ask — create-only, so a replay is a read", () => {
  it("writes ONE row when the same question is asked twice in one attempt", async () => {
    const inbox = fakeInbox();
    const ctx = contextWithInbox(inbox);
    await ask(ctx, "which path?", 1);
    await ask(ctx, "which path?", 1);
    expect(await listQuestions(ctx, ISSUE, PHASE)).toHaveLength(1);
  });

  it("CANNOT erase an answer when the ask step re-executes", async () => {
    // The obligation this issue owns. The ask step commits no output, so it
    // re-executes on recovery — and a replay that reset the row would drop an
    // answer the operator watched land, or reopen a row nobody is reading.
    //
    // **A test that only replays an `open` row passes with the bug in place**,
    // because an unguarded write of the same `open` payload is invisible. So
    // the row is ANSWERED first, and the replay is asserted against that.
    const inbox = fakeInbox();
    const ctx = contextWithInbox(inbox);
    const topic = await ask(ctx, "which path?", 1);
    await answerQuestion(ctx, topic, "the second one");

    await ask(ctx, "which path?", 1);

    const row = await readQuestion(ctx, topic);
    expect(row?.status).toBe("answered");
    expect(row?.answer).toBe("the second one");
  });
});

describe("the transitions — conditional off `open`, never patches", () => {
  it("refuses a withdrawal that RACES an accepted answer, and the answer stands", async () => {
    // Racing two *answers* leaves this untested, because both writers move off
    // `open` and only one of them is an answer. A literal `patchState` would
    // overwrite `answered` with `withdrawn` here and destroy an answer the
    // operator watched land.
    const inbox = fakeInbox();
    const ctx = contextWithInbox(inbox);
    const topic = await ask(ctx, "which path?", 1);

    // Barriered: both read the row `open` before either commits.
    const [answered, withdrawn] = await Promise.all([
      answerQuestion(ctx, topic, "the second one"),
      withdrawQuestion(ctx, topic),
    ]);

    // Exactly one transition applied, and the row is never both.
    expect([answered.outcome, withdrawn.outcome].filter((o) => o === "applied")).toHaveLength(1);
    const row = await readQuestion(ctx, topic);
    if (answered.outcome === "applied") {
      expect(row?.status).toBe("answered");
      expect(row?.answer).toBe("the second one");
      expect(withdrawn.observed).toBe("answered");
    } else {
      expect(row?.status).toBe("withdrawn");
    }
  });

  it("applies exactly ONE of two answers racing one open row, and never rewrites the body", async () => {
    // **The only behaviour that forces an atomic conditional update.** A
    // read-then-write guard (`get`, check `open`, `patchState`) passes every
    // other behaviour in this file and silently loses the first answer here:
    // both callers read `open`, both write, and the second body wins.
    const inbox = fakeInbox();
    const ctx = contextWithInbox(inbox);
    const topic = await ask(ctx, "which path?", 1);

    const [first, second] = await Promise.all([
      answerQuestion(ctx, topic, "answer A"),
      answerQuestion(ctx, topic, "answer B"),
    ]);

    const applied = [first, second].filter((w) => w.outcome === "applied");
    const refused = [first, second].filter((w) => w.outcome === "refused");
    expect(applied).toHaveLength(1);
    expect(refused).toHaveLength(1);
    // The loser saw the winner's committed state — refused, not swallowed.
    expect(refused[0]!.observed).toBe("answered");

    const row = await readQuestion(ctx, topic);
    expect(row?.status).toBe("answered");
    // The body is the winner's, never both and never the second's over the
    // first's.
    expect(["answer A", "answer B"]).toContain(row?.answer);
    expect(row?.answer).toBe(first.outcome === "applied" ? "answer A" : "answer B");
  });

  it("reports a refusal against an already-withdrawn row rather than applying it", async () => {
    const inbox = fakeInbox();
    const ctx = contextWithInbox(inbox);
    const topic = await ask(ctx, "which path?", 1);
    await withdrawQuestion(ctx, topic);

    const write = await answerQuestion(ctx, topic, "too late");

    expect(write.outcome).toBe("refused");
    expect(write.observed).toBe("withdrawn");
    // Withdrawn, never deleted — the question history a later attempt reads.
    expect((await readQuestion(ctx, topic))?.status).toBe("withdrawn");
    expect((await readQuestion(ctx, topic))?.answer).toBeNull();
  });
});

describe("the fold — every answered row for the issue-phase, oldest first", () => {
  it("orders two answered rows oldest first, across attempts", async () => {
    // §7's fold promise, and it cannot fail on a single-answer test.
    const inbox = fakeInbox();
    const ctx = contextWithInbox(inbox);
    const older = await ask(ctx, "first question", 1, 1_000);
    const newer = await ask(ctx, "second question", 2, 2_000);
    // Answered out of order, deliberately: the fold orders on when the question
    // was ASKED, not on when the answer landed.
    await answerQuestion(ctx, newer, "second answer");
    await answerQuestion(ctx, older, "first answer");

    const rows = await listQuestions(ctx, ISSUE, PHASE);
    expect(rows.map((r) => r.state.answer)).toEqual(["first answer", "second answer"]);
  });
});

describe("start-of-attempt reconciliation — an orphan cannot be answered", () => {
  it("withdraws an EARLIER attempt's open row and leaves this attempt's alone", async () => {
    // A crash between the create-only write and the arms leaves attempt 1's row
    // `open` with no arm having decided it. Left alone it satisfies the
    // answer's proceed guard the moment attempt 2 parks.
    const inbox = fakeInbox();
    const ctx = contextWithInbox(inbox);
    const orphan = await ask(ctx, "orphaned question", 1);
    const live = await ask(ctx, "the real question", 2);

    const withdrawn = await withdrawEarlierQuestions(ctx, ISSUE, PHASE, 2);

    expect(withdrawn).toEqual([orphan]);
    expect((await readQuestion(ctx, orphan))?.status).toBe("withdrawn");
    // At most ONE open row per issue-phase afterwards — what both the proceed
    // guard and recovery's nothing-open condition already assumed.
    expect((await readQuestion(ctx, live))?.status).toBe("open");
    const open = (await listQuestions(ctx, ISSUE, PHASE)).filter(
      (r) => r.state.status === "open",
    );
    expect(open).toHaveLength(1);
  });

  it("never withdraws an answer an earlier attempt already received", async () => {
    // Conditional off `open`, so the history survives: the fold reads answered
    // rows across ALL attempts, deliberately.
    const inbox = fakeInbox();
    const ctx = contextWithInbox(inbox);
    const answered = await ask(ctx, "settled question", 1);
    await answerQuestion(ctx, answered, "do it this way");

    await withdrawEarlierQuestions(ctx, ISSUE, PHASE, 2);

    expect((await readQuestion(ctx, answered))?.status).toBe("answered");
    expect((await readQuestion(ctx, answered))?.answer).toBe("do it this way");
  });

  it("leaves THIS attempt's own open row alone, so a replay cannot withdraw it", async () => {
    const inbox = fakeInbox();
    const ctx = contextWithInbox(inbox);
    const mine = await ask(ctx, "my question", 2);
    await withdrawEarlierQuestions(ctx, ISSUE, PHASE, 2);
    expect((await readQuestion(ctx, mine))?.status).toBe("open");
  });
});

describe("the marker — inside the checkout, gitignored, and per-attempt", () => {
  it("derives a path INSIDE the checkout, under this attempt's own name", () => {
    const checkout = join(sep, "runs", "checkout");
    const path = askMarkerPath(checkout, 3);
    // Inside, because outside is unwritable: the SDK denies an out-of-tree
    // Write under exactly the config every call site uses, and reports the run
    // as a success anyway.
    expect(path.startsWith(`${checkout}${sep}`)).toBe(true);
    expect(path).not.toContain("..");
    expect(path.endsWith(join(ASK_MARKER_DIR, "3.md"))).toBe(true);
    // Per-attempt, which is the whole reason a stale marker cannot fake a
    // question.
    expect(askMarkerPath(checkout, 1)).not.toBe(askMarkerPath(checkout, 2));
  });

  it("is IGNORED by this repository's own .gitignore", () => {
    // The trade-off `./ask` names, pinned: the guarantee that a question never
    // rides into the product PR is coupled to that entry staying accurate.
    // Narrow the pattern or rename the directory and this fails rather than
    // leaking the question text into a diff.
    const derived = askMarkerPath(process.cwd(), 1);
    const ignored = execFileSync(
      "git",
      ["check-ignore", derived],
      { cwd: process.cwd(), encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] },
    );
    expect(ignored.trim()).toBe(derived);
  });

  it("reads only THIS attempt's file, so a stale marker cannot fake a question", async () => {
    // The checkout survives a retry, so last attempt's question file is still
    // on disk when the next attempt starts. A fixed path would read it and park
    // a run that quietly did nothing.
    const dir = mkdtempSync(join(tmpdir(), "conductor-marker-"));
    try {
      const first = askMarkerPath(dir, 1);
      mkdirSync(dirname(first), { recursive: true });
      writeFileSync(first, "attempt one's question");

      expect(await readAskMarker(dir, 1)).toBe("attempt one's question");
      expect(await readAskMarker(dir, 2)).toBeUndefined();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("reads a blank marker as NO question", async () => {
    const dir = mkdtempSync(join(tmpdir(), "conductor-marker-"));
    try {
      const path = askMarkerPath(dir, 1);
      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(path, "   \n\n  ");
      expect(await readAskMarker(dir, 1)).toBeUndefined();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
