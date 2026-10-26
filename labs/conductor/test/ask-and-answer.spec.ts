/**
 * The round trip, on the surface nothing else covers: **handed off, user-scoped,
 * cross-request.**
 *
 * A run that asks holds its task on the question. `status` lists it, the
 * board's `updateTask` action answers it as the Inbox does, and the answer's
 * turn continues the same coding session on the same attempt.
 *
 * **Every assertion is on the BOARD ROW, read through `status` and the
 * action's own output.** A declined settlement is silent, so the run record
 * and the request both read as success over an open row.
 */
import { describe, expect, it, afterEach } from "vitest";
import type { ResolveClaudeAgent, SdkMessageLike } from "@flow-state-dev/claude-code/sdk";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { conductorFlow } from "../src/flow";
import { createConductorHarness, sdkResult, type ConductorHarness, seedRepo } from "./harness";

const ISSUE = "FIX-1166";
const PHASE = "implement";

type StatusRow = {
  taskId: string;
  issue: string | null;
  phase: string | null;
  status: string;
  attempts: number;
  feedback: string | null;
  run: { outcome: string | null; reason: string | null; sessionId: string | null } | null;
  questions: Array<{ question: string; text: string; askedAt: number }>;
};

let live: ConductorHarness | undefined;
afterEach(() => {
  live?.dispose();
  live = undefined;
});

/** What one run's stub does. */
interface Turn {
  /** The question it writes to this run's marker, if any. */
  question?: string;
  /** The SDK result subtype. Only `"success"` is a non-errored verdict. */
  subtype?: string;
}

/**
 * A `query` that plays one {@link Turn} per run, and records the session it
 * was asked to resume.
 *
 * The marker is written to **the path the prompt named**, parsed back out of
 * the prompt rather than derived here — so a prompt that stopped naming the
 * marker makes this stub write nowhere, which is what a real coding agent would
 * do with the same prompt.
 */
function turnAgent(turns: Turn[], seen: Seen): ResolveClaudeAgent {
  return () => ({
    query: async function* (args) {
      const prompt = String(args.prompt);
      seen.prompts.push(prompt);
      seen.resumes.push(args.options?.resume);
      const turn = turns[Math.min(seen.turn, turns.length - 1)] ?? {};
      seen.turn += 1;
      if (turn.question !== undefined) {
        const named = /^ {2}(\S*\/\.fsdev\/ask\/\d+-\d+\.md)\s*$/m.exec(prompt);
        expect(named, "the prompt must name this run's marker path").not.toBeNull();
        const target = named![1]!;
        mkdirSync(dirname(target), { recursive: true });
        writeFileSync(target, turn.question);
      }
      yield sdkResult(turn.subtype ?? "success") as SdkMessageLike;
    },
  });
}

interface Seen {
  prompts: string[];
  resumes: (string | undefined)[];
  turn: number;
}

function seenTurns(): Seen {
  return { prompts: [], resumes: [], turn: 0 };
}

async function readStatus(h: ConductorHarness, asSession?: string): Promise<StatusRow> {
  const { rows } = await h.call<{ rows: StatusRow[] }>("status", { issue: ISSUE }, asSession);
  return rows[0]!;
}

/** Wait until the row settles, re-pends, or is held on a question. */
async function settle(h: ConductorHarness, timeoutMs = 10_000): Promise<StatusRow> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const row = await readStatus(h);
    if (row !== undefined && (row.status !== "in_progress" || row.questions.length > 0)) return row;
    if (Date.now() >= deadline) {
      throw new Error(`the row never settled or held within ${timeoutMs}ms — last seen ${JSON.stringify(row)}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

async function seedAndSettle(h: ConductorHarness): Promise<StatusRow> {
  await h.call("seed", { issue: ISSUE, phase: PHASE });
  return settle(h);
}

/** Answer the row's oldest open question through the board's `updateTask` action, as the Inbox does. */
async function answer(h: ConductorHarness, row: StatusRow, message: string): Promise<{ ok: boolean; error?: string }> {
  return h.call(h.built.updateTaskAction, { id: row.taskId, question: row.questions[0]!.question, message });
}

// ───────────────────────────────────────────────────────────────────────────
// The hold, and what a drain does with it
// ───────────────────────────────────────────────────────────────────────────

describe("the hold — a run's question holds its task", () => {
  it("holds the task on the question, on its attempt, and status lists it", async () => {
    const seen = seenTurns();
    live = createConductorHarness({ resolveClaudeAgent: turnAgent([{ question: "which path?" }], seen), isDone: () => false });

    const row = await seedAndSettle(live);

    expect(row).toMatchObject({ status: "in_progress", attempts: 1 });
    expect(row.questions.map((q) => q.text)).toEqual(["which path?"]);
    // The record's outcome stays `running`: the attempt is not over.
    expect(row.run?.outcome).toBe("running");
  });

  it("dispatches nothing on the next drain while the question is open", async () => {
    const seen = seenTurns();
    live = createConductorHarness({ resolveClaudeAgent: turnAgent([{ question: "which path?" }], seen), isDone: () => false });
    await seedAndSettle(live);
    const runsBefore = seen.turn;

    await live.call("wake", {});

    expect(seen.turn).toBe(runsBefore);
    expect((await readStatus(live)).questions).toHaveLength(1);
  });

  it("constructs with the board's `updateTask` action, named for its ledger", async () => {
    const repo = mkdtempSync(join(tmpdir(), "conductor-construction-"));
    seedRepo(repo);
    const root = mkdtempSync(join(tmpdir(), "conductor-construction-root-"));

    const built = conductorFlow({ epic: "construction-check", workspace: { root, sourceRepo: repo, baseRef: "main" } });

    expect(built.updateTaskAction).toMatch(/^updateTask_/);
  });
});

// ───────────────────────────────────────────────────────────────────────────
// The decide arms
// ───────────────────────────────────────────────────────────────────────────

describe("the decide arms — asserted on the board row", () => {
  it("holds a run that asked even when the done-condition already holds", async () => {
    // A marker is the run saying it needs a decision, about THIS run. The
    // done-condition reads a branch every attempt shares, so it cannot speak
    // for one run, and must not settle one that asked for a person.
    const seen = seenTurns();
    live = createConductorHarness({ resolveClaudeAgent: turnAgent([{ question: "which path?" }], seen), isDone: () => true });

    const row = await seedAndSettle(live);

    expect(row.status).toBe("in_progress");
    expect(row.questions.map((q) => q.text)).toEqual(["which path?"]);
  });

  it("does not complete a run that asked, on a pull request an earlier attempt left", async () => {
    const seen = seenTurns();
    live = createConductorHarness({
      resolveClaudeAgent: turnAgent([{ subtype: "error_max_turns" }, { question: "which path?" }], seen),
      isDone: () => true,
    });

    const failed = await seedAndSettle(live);
    expect(failed.status).toBe("pending");

    await live.call("wake", {});
    const held = await settle(live);

    expect(held).toMatchObject({ status: "in_progress", attempts: 2 });
    expect(held.questions.map((q) => q.text)).toEqual(["which path?"]);
  });

  it("re-pends with no question when the run asked nothing", async () => {
    const seen = seenTurns();
    live = createConductorHarness({ resolveClaudeAgent: turnAgent([{ subtype: "success" }], seen), isDone: () => false });
    const row = await seedAndSettle(live);
    expect(row.status).toBe("pending");
    expect(row.questions).toHaveLength(0);
  });

  it("takes the FAILURE path on a marker paired with an errored verdict, and asks nobody", async () => {
    // The SDK reports a turn cap by RETURNING an errored handle. An arm gated
    // on the marker alone would hold a run that is already dead on a person.
    const seen = seenTurns();
    live = createConductorHarness({
      resolveClaudeAgent: turnAgent([{ question: "which path?", subtype: "error_max_turns" }], seen),
      isDone: () => true,
    });

    const row = await seedAndSettle(live);

    expect(row.status).toBe("pending");
    expect(row.run?.outcome).toBe("failed");
    expect(row.questions).toHaveLength(0);
  });
});

// ───────────────────────────────────────────────────────────────────────────
// The answer, end to end
// ───────────────────────────────────────────────────────────────────────────

describe("the answer — the board's `updateTask`, and the same session on the same attempt", () => {
  it("continues the run that asked with the answer in its prompt, through `updateTask` alone", async () => {
    // Driven through the action alone: a test that drained by hand afterwards
    // would pass with the action's drain missing.
    const seen = seenTurns();
    live = createConductorHarness({
      resolveClaudeAgent: turnAgent([{ question: "which path?" }, { subtype: "success" }], seen),
      isDone: () => false,
    });
    const held = await seedAndSettle(live);

    expect(await answer(live, held, "Correct the path only. Leave the symlink alone.")).toMatchObject({ ok: true });
    await settle(live);

    expect(seen.prompts).toHaveLength(2);
    expect(seen.prompts[1]).toContain("Correct the path only. Leave the symlink alone.");
    expect(seen.prompts[1]).toContain("which path?");
    // The same coding session, on the same try: no retry is spent on an answer.
    expect(seen.resumes).toEqual([undefined, "sess_stub"]);
    expect((await readStatus(live)).attempts).toBe(1);
  });

  it("carries TWO answers into the prompt oldest first, all on one attempt", async () => {
    const seen = seenTurns();
    live = createConductorHarness({
      resolveClaudeAgent: turnAgent([{ question: "first question" }, { question: "second question" }, { subtype: "success" }], seen),
      isDone: () => false,
    });
    const first = await seedAndSettle(live);
    await answer(live, first, "first answer");
    const second = await settle(live);
    expect(second.questions.map((q) => q.text)).toEqual(["second question"]);
    await answer(live, second, "second answer");
    const after = await settle(live);

    const third = seen.prompts[2]!;
    expect(third.indexOf("first answer")).toBeGreaterThan(-1);
    expect(third.indexOf("first answer")).toBeLessThan(third.indexOf("second answer"));
    expect(after.attempts).toBe(1);
  });

  it("takes the no-question path when the answer's run leaves the earlier run's marker untouched", async () => {
    // The checkout survives the answer's turn, so the asking run's question
    // file is still on disk. A marker path that did not name the run would
    // read it and hold the task on a question nobody asked again.
    const seen = seenTurns();
    live = createConductorHarness({
      resolveClaudeAgent: turnAgent([{ question: "which path?" }, { subtype: "success" }], seen),
      isDone: () => false,
    });
    const held = await seedAndSettle(live);
    await answer(live, held, "the answer");
    const after = await settle(live);

    expect(after.status).toBe("pending");
    expect(after.questions).toHaveLength(0);
  });

  it("never lets the answer arrive as a failure reason", async () => {
    // `feedback` says why an attempt FAILED; an answer says what a person
    // said. Handing the answer back through `feedback` would tell the run
    // *"your last attempt stopped because: take the second option."*
    const seen = seenTurns();
    live = createConductorHarness({
      resolveClaudeAgent: turnAgent([{ subtype: "error_max_turns" }, { question: "which path?" }, { subtype: "success" }], seen),
      isDone: () => false,
    });
    const failed = await seedAndSettle(live);
    expect(failed.feedback).toContain("stopped-at-limit");

    await live.call("wake", {});
    const held = await settle(live);
    expect(seen.prompts[1]).toContain("stopped-at-limit");

    await answer(live, held, "Correct the path only.");
    await settle(live);

    const resumed = seen.prompts[2]!;
    expect(resumed).toContain("Correct the path only.");
    const reason = resumed.split("The last attempt stopped for this reason:")[1] ?? "";
    expect(reason.split("\n\n")[0]).not.toContain("Correct the path only.");
  });
});

// ───────────────────────────────────────────────────────────────────────────
// The answer's rules, as the board's `updateTask` keeps them
// ───────────────────────────────────────────────────────────────────────────

describe("the answer's rules", () => {
  it("refuses an answer naming no question the task holds, and writes nothing", async () => {
    const seen = seenTurns();
    live = createConductorHarness({ resolveClaudeAgent: turnAgent([{ question: "which path?" }], seen), isDone: () => false });
    const held = await seedAndSettle(live);

    const refused = await live.call<{ ok: boolean; error?: string }>(live.built.updateTaskAction, {
      id: held.taskId,
      question: "hold_not_this_one",
      message: "an answer",
    });

    expect(refused.ok).toBe(false);
    expect(refused.error).toMatch(/no_such_question/);
    expect((await readStatus(live)).questions.map((q) => q.text)).toEqual(["which path?"]);
    expect(seen.turn).toBe(1);
  });

  it("closes the question with a cancel, and starts no further run", async () => {
    const seen = seenTurns();
    live = createConductorHarness({ resolveClaudeAgent: turnAgent([{ question: "which path?" }], seen), isDone: () => false });
    const held = await seedAndSettle(live);

    expect(await live.call(live.built.updateTaskAction, { id: held.taskId, status: "cancelled" })).toMatchObject({ ok: true });
    const after = await readStatus(live);

    expect(after.status).toBe("cancelled");
    expect(after.questions).toHaveLength(0);
    await live.call("wake", {});
    expect(seen.turn).toBe(1);
  });

  it("reports a question asked inside the child session to a DIFFERENT coordinator session", async () => {
    const seen = seenTurns();
    live = createConductorHarness({ resolveClaudeAgent: turnAgent([{ question: "which path?" }], seen), isDone: () => false });
    await seedAndSettle(live);

    const elsewhere = await readStatus(live, `sess_other_${Date.now()}`);

    expect(elsewhere.questions.map((q) => q.text)).toEqual(["which path?"]);
  });
});
