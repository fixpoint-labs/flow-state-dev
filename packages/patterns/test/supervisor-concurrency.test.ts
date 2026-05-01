/**
 * FIX-492 regression: supervisor with `maxConcurrency: 3` and a
 * sibling-task DAG must complete reliably across many sequential runs
 * with zero `ConcurrentModificationError`.
 *
 * Pre-fix symptom: workers W1/W2/W3 racing on `claim` / `complete` /
 * `fail` plus reviewer-chain audit writes against the request-scoped
 * task collection exhausted the CAS retry budget. The fix moves
 * reviewer audit-state to the supervisor sequencer's outer (in-memory,
 * lock-serialized) state and lets `applyMutation` serialize
 * non-persist scopes through `withScopeLock` instead of CAS.
 */
import { describe, expect, it } from "vitest";
import { testBlock } from "@flow-state-dev/testing";
import { handler } from "@flow-state-dev/core";
import { z } from "zod";
import {
  supervisor,
  reviewerVerdictSchema,
  type ReviewerVerdict,
} from "../src/supervisor";

const trackingWorker = handler({
  name: "fix492-worker",
  inputSchema: z.any(),
  outputSchema: z.object({ id: z.string(), result: z.string() }),
  execute: (input: any) => ({
    id: input?.taskId ?? "unknown",
    result: `done:${input?.goal ?? input?.taskId ?? "unknown"}`,
  }),
});

const fourTaskPlanner = handler({
  name: "fix492-planner",
  inputSchema: z.any(),
  outputSchema: z.object({
    tasks: z.array(
      z.object({
        id: z.string(),
        goal: z.string(),
        deps: z.array(z.string()).optional(),
      }),
    ),
  }),
  // DAG: task_1 → task_2 → { task_3, task_4 } (siblings — eligible together).
  execute: () => ({
    tasks: [
      { id: "task_1", goal: "first" },
      { id: "task_2", goal: "second", deps: ["task_1"] },
      { id: "task_3", goal: "third", deps: ["task_2"] },
      { id: "task_4", goal: "fourth", deps: ["task_2"] },
    ],
  }),
});

const approvingReviewer = handler({
  name: "fix492-reviewer",
  inputSchema: z.any(),
  outputSchema: reviewerVerdictSchema,
  execute: (): ReviewerVerdict => ({
    decision: "approve",
    feedback: "ok",
  }),
});

const synthesizer = handler({
  name: "fix492-synth",
  inputSchema: z.any(),
  outputSchema: z.object({ count: z.number() }),
  execute: (input: any) => ({
    count: Array.isArray(input?.results) ? input.results.length : 0,
  }),
});

describe("FIX-492: supervisor with concurrency > 1 + sibling tasks", () => {
  it("completes 50 sequential runs with concurrency=3 and zero ConcurrentModificationError", async () => {
    let runs = 0;
    let failures = 0;
    const errors: string[] = [];

    for (let i = 0; i < 50; i += 1) {
      const sup = supervisor({
        name: `fix492-sup-${i}`,
        worker: trackingWorker,
        planner: fourTaskPlanner,
        reviewer: approvingReviewer,
        synthesizer,
        maxConcurrency: 3,
      });

      const result = await testBlock(sup, { input: { goal: "regression" } });
      runs += 1;
      if (result.error !== null) {
        failures += 1;
        errors.push(String(result.error));
      } else {
        const output = result.output as { count: number };
        if (output.count !== 4) {
          failures += 1;
          errors.push(`run ${i}: expected count=4, got ${output.count}`);
        }
      }
    }

    expect(runs).toBe(50);
    expect({ failures, sample: errors.slice(0, 3) }).toEqual({
      failures: 0,
      sample: [],
    });
  }, 30_000);

  it("labels failed-review tasks via supervisor-state reviewMetadata, not task metadata", async () => {
    let reviewerCalls = 0;
    const rejectingReviewer = handler({
      name: "fix492-rej-reviewer",
      inputSchema: z.any(),
      outputSchema: reviewerVerdictSchema,
      execute: (): ReviewerVerdict => {
        reviewerCalls += 1;
        return { decision: "reject", feedback: "no" };
      },
    });

    const singleTaskPlanner = handler({
      name: "fix492-single-planner",
      inputSchema: z.any(),
      outputSchema: z.object({
        tasks: z.array(z.object({ id: z.string(), goal: z.string() })),
      }),
      execute: () => ({ tasks: [{ id: "only", goal: "single" }] }),
    });

    const sup = supervisor({
      name: "fix492-rejecting",
      worker: trackingWorker,
      planner: singleTaskPlanner,
      reviewer: rejectingReviewer,
      synthesizer,
      maxAttemptsPerTask: 1,
    });

    const result = await testBlock(sup, { input: { goal: "label-test" } });

    // The reviewer ran (so `stampReviewEntered` and `applyVerdict` both
    // wrote to the supervisor sequencer's `reviewMetadata`) and the
    // synthesizer subsequently produced output (so `labelFailedReviews`
    // ran without crashing on the new sequencer-state read path).
    expect(reviewerCalls).toBeGreaterThan(0);
    expect(result.error).toBeNull();
  });
});
