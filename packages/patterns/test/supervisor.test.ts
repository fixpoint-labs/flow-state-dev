/**
 * Supervisor pattern tests (post-FIX-447 migration onto taskBoard).
 *
 * Preserves the externally-visible behavioral assertions from the
 * pre-migration suite — output shape via the synthesizer, custom
 * planner / reviewer / synthesizer invocation, `maxConcurrency`,
 * `onSubTaskError: "skip" | "fail"`, and `reviewCriteria` forwarding.
 *
 * Adds per-task review tests covering: approve, reject-then-retry,
 * exhaust-retries → terminal error labelled `failed-review`, custom
 * rubric forwarding, reviewer service error path, and
 * `legacyWorkerAdapter` round-trip.
 */
import { describe, expect, it } from "vitest";
import { testBlock } from "@flow-state-dev/testing";
import { handler } from "@flow-state-dev/core";
import { z } from "zod";
import {
  supervisor,
  reviewerVerdictSchema,
  executableTaskSchema,
  legacyWorkerAdapter,
  type ReviewerInput,
  type ReviewerVerdict,
} from "../src/supervisor";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Echo worker. Receives substrate `TaskWorkerInput`. */
const echoWorker = handler({
  name: "echo-worker",
  inputSchema: z.any(),
  outputSchema: z.object({ source: z.string(), finding: z.string() }),
  execute: (input: any) => ({
    source: typeof input === "string" ? input : JSON.stringify(input),
    finding: `Result for: ${input?.goal ?? input?.taskId ?? "unknown"}`,
  }),
});

const failingWorker = handler({
  name: "failing-worker",
  inputSchema: z.any(),
  outputSchema: z.any(),
  execute: () => {
    throw new Error("sub-task failed");
  },
});

function makeDeterministicPlanner(
  name: string,
  tasks: Array<{
    id: string;
    goal: string;
    deps?: string[];
    assignee?: string;
  }>,
) {
  return handler({
    name,
    inputSchema: z.any(),
    outputSchema: z.object({
      tasks: z.array(
        z.object({
          id: z.string(),
          goal: z.string(),
          deps: z.array(z.string()).optional(),
          assignee: z.string().optional(),
        }),
      ),
    }),
    execute: () => ({ tasks }),
  });
}

/** Make a deterministic reviewer that returns a fixed sequence of verdicts. */
function makeScriptedReviewer(
  name: string,
  script: ReviewerVerdict[] | ((input: ReviewerInput) => ReviewerVerdict),
) {
  let callIndex = 0;
  const calls: ReviewerInput[] = [];
  const block = handler({
    name,
    inputSchema: z.any(),
    outputSchema: reviewerVerdictSchema,
    execute: (input: any) => {
      calls.push(input as ReviewerInput);
      if (typeof script === "function") return script(input as ReviewerInput);
      const verdict = script[Math.min(callIndex, script.length - 1)];
      callIndex += 1;
      return verdict;
    },
  });
  return Object.assign(block, { calls });
}

/** Reviewer that always approves. */
function makeApprovingReviewer(name: string) {
  return makeScriptedReviewer(name, () => ({
    decision: "approve" as const,
    feedback: "looks good",
  }));
}

/** Reviewer that throws (simulates LLM service error). */
function makeErroringReviewer(name: string) {
  return handler({
    name,
    inputSchema: z.any(),
    outputSchema: reviewerVerdictSchema,
    execute: () => {
      throw new Error("reviewer service unavailable");
    },
  });
}

/** Synthesizer that summarises results into a known shape. */
function makeDeterministicSynthesizer(name: string) {
  return handler({
    name,
    inputSchema: z.any(),
    outputSchema: z.object({
      synthesis: z.string(),
      count: z.number(),
    }),
    execute: (input: unknown) => {
      const data = input as { goal?: string; results?: unknown[] };
      const results = Array.isArray(data?.results) ? data.results : [];
      return {
        synthesis: `Synthesized ${results.length} results`,
        count: results.length,
      };
    },
  });
}

// ---------------------------------------------------------------------------
// Preserved behavioral assertions
// ---------------------------------------------------------------------------

describe("supervisor pattern", () => {
  it("single-pass success — all tasks approved on first review", async () => {
    const planner = makeDeterministicPlanner("sp-planner", [
      { id: "t1", goal: "Task A" },
      { id: "t2", goal: "Task B" },
    ]);
    const reviewer = makeApprovingReviewer("sp-reviewer");
    const synth = makeDeterministicSynthesizer("sp-synth");

    const sup = supervisor({
      name: "single-pass",
      worker: echoWorker,
      planner,
      reviewer,
      synthesizer: synth,
    });

    const result = await testBlock(sup, { input: { goal: "Test single pass" } });

    expect(result.error).toBeNull();
    const output = result.output as { synthesis: string; count: number };
    expect(output.count).toBe(2);
    expect(output.synthesis).toContain("Synthesized 2");
  });

  it("uses custom planner when provided", async () => {
    let plannerCalled = false;
    const planner = handler({
      name: "custom-planner",
      inputSchema: z.any(),
      outputSchema: z.object({
        tasks: z.array(z.object({ id: z.string(), goal: z.string() })),
      }),
      execute: (input: any) => {
        plannerCalled = true;
        return { tasks: [{ id: "c1", goal: `Custom: ${input.goal}` }] };
      },
    });
    const reviewer = makeApprovingReviewer("cp-reviewer");
    const synth = makeDeterministicSynthesizer("cp-synth");

    const sup = supervisor({
      name: "custom-planner-test",
      worker: echoWorker,
      planner,
      reviewer,
      synthesizer: synth,
    });

    const result = await testBlock(sup, {
      input: { goal: "Test custom planner" },
    });

    expect(result.error).toBeNull();
    expect(plannerCalled).toBe(true);
  });

  it("uses custom reviewer when provided", async () => {
    let reviewerCalled = false;
    const reviewer = handler({
      name: "custom-reviewer",
      inputSchema: z.any(),
      outputSchema: reviewerVerdictSchema,
      execute: () => {
        reviewerCalled = true;
        return { decision: "approve" as const, feedback: "custom" };
      },
    });
    const planner = makeDeterministicPlanner("cr-planner", [
      { id: "t1", goal: "Task" },
    ]);
    const synth = makeDeterministicSynthesizer("cr-synth");

    const sup = supervisor({
      name: "custom-reviewer-test",
      worker: echoWorker,
      planner,
      reviewer,
      synthesizer: synth,
    });

    const result = await testBlock(sup, { input: { goal: "Test reviewer" } });

    expect(result.error).toBeNull();
    expect(reviewerCalled).toBe(true);
  });

  it("uses custom synthesizer when provided", async () => {
    const synth = handler({
      name: "custom-synth",
      inputSchema: z.any(),
      outputSchema: z.object({ summary: z.string(), n: z.number() }),
      execute: (input: any) => {
        const results = input?.results ?? [];
        return { summary: `Custom synth: ${results.length}`, n: results.length };
      },
    });
    const planner = makeDeterministicPlanner("cs-planner", [
      { id: "t1", goal: "Task" },
    ]);
    const reviewer = makeApprovingReviewer("cs-reviewer");

    const sup = supervisor({
      name: "custom-synth-test",
      worker: echoWorker,
      planner,
      reviewer,
      synthesizer: synth,
    });

    const result = await testBlock(sup, { input: { goal: "Test synth" } });

    expect(result.error).toBeNull();
    const output = result.output as { summary: string; n: number };
    expect(output.summary).toContain("Custom synth");
    expect(output.n).toBe(1);
  });

  it("forwards reviewCriteria to the reviewer's input", async () => {
    const reviewer = makeScriptedReviewer("rc-reviewer", () => ({
      decision: "approve" as const,
      feedback: "ok",
    }));
    const planner = makeDeterministicPlanner("rc-planner", [
      { id: "t1", goal: "Task A" },
    ]);
    const synth = makeDeterministicSynthesizer("rc-synth");

    const sup = supervisor({
      name: "rubric-test",
      worker: echoWorker,
      planner,
      reviewer,
      synthesizer: synth,
      reviewCriteria: ["clarity", "correctness"],
    });

    const result = await testBlock(sup, { input: { goal: "Rubric forwarding" } });

    expect(result.error).toBeNull();
    expect(reviewer.calls).toHaveLength(1);
    expect(reviewer.calls[0]?.criteria).toEqual(["clarity", "correctness"]);
  });

  it("respects maxConcurrency by routing all tasks to a single worker", async () => {
    // Indirectly: the worker call count equals the number of tasks
    // regardless of concurrency. A direct concurrency assertion requires
    // observing pool size, which the substrate doesn't expose; this test
    // verifies maxConcurrency doesn't break dispatch.
    let calls = 0;
    const trackingWorker = handler({
      name: "tracking-worker",
      inputSchema: z.any(),
      outputSchema: z.object({ done: z.boolean() }),
      execute: () => {
        calls += 1;
        return { done: true };
      },
    });
    const planner = makeDeterministicPlanner("mc-planner", [
      { id: "t1", goal: "A" },
      { id: "t2", goal: "B" },
      { id: "t3", goal: "C" },
    ]);
    const reviewer = makeApprovingReviewer("mc-reviewer");
    const synth = makeDeterministicSynthesizer("mc-synth");

    const sup = supervisor({
      name: "concurrency-test",
      worker: trackingWorker,
      planner,
      reviewer,
      synthesizer: synth,
      maxConcurrency: 2,
    });

    const result = await testBlock(sup, { input: { goal: "Concurrency" } });

    expect(result.error).toBeNull();
    expect(calls).toBe(3);
  });

  it("aborts on worker failure with onSubTaskError='fail'", async () => {
    const planner = makeDeterministicPlanner("fail-planner", [
      { id: "t1", goal: "Will fail" },
    ]);

    const sup = supervisor({
      name: "fail-test",
      worker: failingWorker,
      planner,
      reviewer: false,
      onSubTaskError: "fail",
    });

    const result = await testBlock(sup, { input: { goal: "Test fail" } });

    expect(result.error).not.toBeNull();
  });

  it("continues on worker failure with onSubTaskError='skip' (default)", async () => {
    let calls = 0;
    const partialFail = handler({
      name: "partial-fail",
      inputSchema: z.any(),
      outputSchema: z.object({ ok: z.boolean() }),
      execute: () => {
        calls += 1;
        if (calls === 2) throw new Error("second failed");
        return { ok: true };
      },
    });

    const planner = makeDeterministicPlanner("skip-planner", [
      { id: "t1", goal: "First" },
      { id: "t2", goal: "Second (fails)" },
      { id: "t3", goal: "Third" },
    ]);
    const reviewer = makeApprovingReviewer("skip-reviewer");
    const synth = makeDeterministicSynthesizer("skip-synth");

    const sup = supervisor({
      name: "skip-test",
      worker: partialFail,
      planner,
      reviewer,
      synthesizer: synth,
      onSubTaskError: "skip",
      maxAttemptsPerTask: 1,
    });

    const result = await testBlock(sup, { input: { goal: "Skip test" } });

    expect(result.error).toBeNull();
    const output = result.output as { count: number };
    // Two tasks should complete; the failing task is errored.
    expect(output.count).toBe(2);
  });

  it("is composable — the returned block has kind 'sequencer'", () => {
    const planner = makeDeterministicPlanner("comp-planner", [
      { id: "t1", goal: "Task" },
    ]);
    const reviewer = makeApprovingReviewer("comp-reviewer");
    const synth = makeDeterministicSynthesizer("comp-synth");

    const sup = supervisor({
      name: "comp-test",
      worker: echoWorker,
      planner,
      reviewer,
      synthesizer: synth,
    });

    expect(sup.kind).toBe("sequencer");
    expect(sup.name).toBe("comp-test");
  });
});

// ---------------------------------------------------------------------------
// Per-task review (FIX-447 new tests)
// ---------------------------------------------------------------------------

describe("supervisor per-task review", () => {
  it("approves on first attempt — task completes", async () => {
    const planner = makeDeterministicPlanner("a1-planner", [
      { id: "t1", goal: "Task" },
    ]);
    const reviewer = makeScriptedReviewer("a1-reviewer", [
      { decision: "approve", feedback: "good" },
    ]);
    const synth = makeDeterministicSynthesizer("a1-synth");

    const sup = supervisor({
      name: "approve-first",
      worker: echoWorker,
      planner,
      reviewer,
      synthesizer: synth,
    });

    const result = await testBlock(sup, { input: { goal: "Approve" } });

    expect(result.error).toBeNull();
    const output = result.output as { count: number };
    expect(output.count).toBe(1);
    // Reviewer ran exactly once.
    expect(reviewer.calls).toHaveLength(1);
    // Substrate increments attempts at claim time; first attempt is 1.
    expect(reviewer.calls[0]?.attempts).toBeGreaterThanOrEqual(1);
  });

  it("reject-then-retry — task completes on attempt 2", async () => {
    let workerCalls = 0;
    const trackingWorker = handler({
      name: "tracking-w",
      inputSchema: z.any(),
      outputSchema: z.object({ attempt: z.number() }),
      execute: () => {
        workerCalls += 1;
        return { attempt: workerCalls };
      },
    });

    const planner = makeDeterministicPlanner("rr-planner", [
      { id: "t1", goal: "Task" },
    ]);
    const reviewer = makeScriptedReviewer("rr-reviewer", [
      { decision: "needs-revision", feedback: "fix this" },
      { decision: "approve", feedback: "better" },
    ]);
    const synth = makeDeterministicSynthesizer("rr-synth");

    const sup = supervisor({
      name: "reject-retry",
      worker: trackingWorker,
      planner,
      reviewer,
      synthesizer: synth,
      maxAttemptsPerTask: 3,
    });

    const result = await testBlock(sup, { input: { goal: "Reject then retry" } });

    expect(result.error).toBeNull();
    expect(workerCalls).toBe(2);
    expect(reviewer.calls).toHaveLength(2);
    // Second reviewer call sees attempts >= 1 (substrate increments before re-claim).
    expect(reviewer.calls[1]?.attempts).toBeGreaterThanOrEqual(1);
    const output = result.output as { count: number };
    expect(output.count).toBe(1);
  });

  it("exhausts retries — task errored + label 'failed-review', siblings continue", async () => {
    const planner = makeDeterministicPlanner("ex-planner", [
      { id: "t1", goal: "Will be rejected" },
      { id: "t2", goal: "Will pass" },
    ]);
    const reviewer = makeScriptedReviewer("ex-reviewer", (input) => {
      if (input.taskId === "t1") {
        return { decision: "reject", feedback: "always wrong" };
      }
      return { decision: "approve", feedback: "ok" };
    });
    const synth = makeDeterministicSynthesizer("ex-synth");

    const sup = supervisor({
      name: "exhaust-retries",
      worker: echoWorker,
      planner,
      reviewer,
      synthesizer: synth,
      maxAttemptsPerTask: 2,
    });

    const result = await testBlock(sup, { input: { goal: "Exhaust" } });

    expect(result.error).toBeNull();
    // Reviewer ran 2x for t1 and 1x for t2 = 3 total.
    const t1Calls = reviewer.calls.filter((c) => c.taskId === "t1");
    expect(t1Calls.length).toBeGreaterThanOrEqual(2);

    // Sibling t2 still completes.
    const output = result.output as { count: number };
    expect(output.count).toBe(1);

    // Verify the substrate emitted task-change events showing t1 errored
    // with the failed-review label.
    const taskChangeItems = result.items.filter(
      (item: any) =>
        item.type === "component" && item.component === "task-change",
    );
    const t1Changes = taskChangeItems.filter(
      (it: any) => it.data?.task?.id === "t1",
    );
    const lastT1 = t1Changes[t1Changes.length - 1] as any;
    expect(lastT1?.data?.task?.status).toBe("errored");
    // Labels include 'failed-review' once labelFailedReviews fires.
    const t1Labeled = taskChangeItems.find(
      (it: any) =>
        it.data?.task?.id === "t1" &&
        Array.isArray(it.data.task?.labels) &&
        it.data.task.labels.includes("failed-review"),
    );
    expect(t1Labeled).toBeDefined();
  });

  it("multi-criterion verdict — feedback propagates as task.feedback on retry", async () => {
    const seenFeedback: Array<string | undefined> = [];
    const w = handler({
      name: "feedback-w",
      inputSchema: z.any(),
      outputSchema: z.object({ done: z.boolean() }),
      execute: (input: any) => {
        seenFeedback.push(input?.feedback);
        return { done: true };
      },
    });

    const planner = makeDeterministicPlanner("mf-planner", [
      { id: "t1", goal: "Task" },
    ]);
    const reviewer = makeScriptedReviewer("mf-reviewer", [
      {
        decision: "needs-revision",
        feedback: "tighten the second paragraph",
        criteria: [
          { name: "clarity", score: 0.6 },
          { name: "correctness", score: 0.9 },
        ],
      },
      { decision: "approve", feedback: "good now" },
    ]);
    const synth = makeDeterministicSynthesizer("mf-synth");

    const sup = supervisor({
      name: "multi-criterion",
      worker: w,
      planner,
      reviewer,
      synthesizer: synth,
      maxAttemptsPerTask: 3,
    });

    const result = await testBlock(sup, { input: { goal: "Multi" } });

    expect(result.error).toBeNull();
    expect(seenFeedback).toHaveLength(2);
    expect(seenFeedback[0]).toBeUndefined();
    expect(seenFeedback[1]).toBe("tighten the second paragraph");
  });

  it("custom rubric appears in the reviewer's input.criteria", async () => {
    const reviewer = makeScriptedReviewer("crit-reviewer", () => ({
      decision: "approve" as const,
      feedback: "ok",
    }));
    const planner = makeDeterministicPlanner("crit-planner", [
      { id: "t1", goal: "Task" },
    ]);
    const synth = makeDeterministicSynthesizer("crit-synth");

    const sup = supervisor({
      name: "custom-rubric",
      worker: echoWorker,
      planner,
      reviewer,
      synthesizer: synth,
      reviewCriteria: ["accuracy", "tone"],
    });

    const result = await testBlock(sup, { input: { goal: "Rubric test" } });

    expect(result.error).toBeNull();
    expect(reviewer.calls[0]?.criteria).toEqual(["accuracy", "tone"]);
  });

  it("reviewer service error — task errored + label 'reviewer-error'", async () => {
    const planner = makeDeterministicPlanner("re-planner", [
      { id: "t1", goal: "Task" },
    ]);
    const reviewer = makeErroringReviewer("re-reviewer");
    const synth = makeDeterministicSynthesizer("re-synth");

    const sup = supervisor({
      name: "reviewer-error",
      worker: echoWorker,
      planner,
      reviewer,
      synthesizer: synth,
      maxAttemptsPerTask: 1,
    });

    const result = await testBlock(sup, { input: { goal: "Reviewer error" } });

    expect(result.error).toBeNull();

    const taskChangeItems = result.items.filter(
      (item: any) =>
        item.type === "component" && item.component === "task-change",
    );
    const labelled = taskChangeItems.find(
      (it: any) =>
        it.data?.task?.id === "t1" &&
        Array.isArray(it.data.task?.labels) &&
        it.data.task.labels.includes("reviewer-error"),
    );
    expect(labelled).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// Legacy worker adapter
// ---------------------------------------------------------------------------

describe("legacyWorkerAdapter", () => {
  it("passes through workers that don't declare executableTaskSchema", () => {
    const w = handler({
      name: "modern-w",
      inputSchema: z.object({ goal: z.string() }),
      outputSchema: z.string(),
      execute: () => "ok",
    });
    const adapted = legacyWorkerAdapter(w);
    expect(adapted).toBe(w);
  });

  it("wraps workers declaring executableTaskSchema and round-trips inputs", async () => {
    const seen: Array<{ id: string; goal: string; context?: string; feedback?: string }> = [];
    const legacyWorker = handler({
      name: "legacy-w",
      inputSchema: executableTaskSchema,
      outputSchema: z.object({ ok: z.boolean() }),
      execute: (input) => {
        seen.push(input);
        return { ok: true };
      },
    });

    const planner = makeDeterministicPlanner("lw-planner", [
      { id: "t1", goal: "Legacy task" },
    ]);
    const reviewer = makeApprovingReviewer("lw-reviewer");
    const synth = makeDeterministicSynthesizer("lw-synth");

    const sup = supervisor({
      name: "legacy-roundtrip",
      worker: legacyWorker,
      planner,
      reviewer,
      synthesizer: synth,
    });

    const result = await testBlock(sup, { input: { goal: "Legacy round-trip" } });

    expect(result.error).toBeNull();
    expect(seen).toHaveLength(1);
    expect(seen[0]?.id).toBe("t1");
    expect(seen[0]?.goal).toBe("Legacy task");
  });
});
