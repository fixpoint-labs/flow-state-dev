/**
 * Goal check — the delegation floor (FIX-940): a task whose assignee is unset or
 * unrecognized runs on the on-demand default worker, and its result is recorded
 * on the task. Declared workers are untouched; remove the floor and the same
 * task errors.
 *
 * Real model, real path, out of CI. See goal.md for the contract.
 *
 * What makes this a goal check, not a dressed-up unit test:
 *   - The floor is the REAL thing FIX-940 wires: `materializeWorker` builds a
 *     board worker from a synthetic `{ prompt }` spec (no tools, no identity),
 *     and `taskBoard({ defaultWorker })` threads it into `buildWorkerStep` as the
 *     `keyedRouter` fallback. Nothing here mocks the model — the floor generator
 *     actually runs through the REAL engine (`runAction`) and must produce the
 *     held-out answer for the task to record output.
 *   - Two anti-game contrasts over the SAME two seeded tasks:
 *       A) floor-ON vs floor-OFF: with the floor the unassigned task completes
 *          and carries the answer; without it (the identical board minus
 *          `defaultWorker`) the identical task ERRORS with no output. That the
 *          floor-off board cannot produce the answer is what proves the floor —
 *          not leakage, not a hardcoded string — did the work.
 *       B) declared vs floor: a task assigned to a declared worker still runs on
 *          THAT worker (its deterministic marker), never the floor — proving the
 *          floor is reached only on a genuine miss.
 *   - The graded answer is pulled from the fixture, never a literal here; swap in
 *     any other question+answer and a correct implementation still passes.
 *
 * Run: pnpm tsx goals/delegation-floor/runs-an-unassigned-task/run.mts
 */
import { readFileSync } from "node:fs";
import { defineFlow, handler } from "@flow-state-dev/core";
import {
  runAction,
  createInMemoryStores,
  createModelResolver,
} from "@flow-state-dev/engine";
import { materializeWorker } from "@flow-state-dev/orchestration";
import { taskBoard, taskWorkerInputSchema } from "@flow-state-dev/orchestration/task-board";
import { z } from "zod";

const MODEL = "openai/gpt-5.4-mini";

const fx = JSON.parse(
  readFileSync(new URL("./fixtures/input.json", import.meta.url), "utf8"),
) as { question: string; answer: string; specialistMarker: string };

// A bare createModelResolver (no declared intents) rejects an env intent-ladder
// override; clear it so the resolver auto-wires the AI Gateway from AI_GATEWAY_API_KEY.
for (const k of Object.keys(process.env)) {
  if (k === "FSDEV_DEFAULT_MODEL" || k.startsWith("FSDEV_INTENT_")) delete process.env[k];
}

// The floor — materialized exactly the way the delegation surface does: a
// synthetic baseline `{ prompt }` spec, no tools, model from the deps default.
const FLOOR_PROMPT =
  "You are a capable, careful generalist worker on a delegation team. You are handed one " +
  "task at a time: read its goal and do the work, returning a complete, self-contained answer. " +
  "Answer concisely with the value asked for.";
const floor = await materializeWorker(
  "__floor__",
  { prompt: FLOOR_PROMPT },
  { catalog: {}, skillName: "floor", defaultModelId: MODEL },
);

// A declared worker — deterministic, so its output is an unmistakable marker
// that could only appear if the DECLARED worker (not the floor) ran the task.
const specialist = handler({
  name: "specialist",
  inputSchema: taskWorkerInputSchema,
  outputSchema: z.string(),
  execute: () => fx.specialistMarker,
});

// The two seeded tasks the "coordinator" planned: one with NO assignee (floor
// territory) and one assigned to the declared specialist (must not touch the floor).
const initialTasks = [
  { id: "unassigned", goal: fx.question },
  { id: "declared", goal: "Return your marker.", assignee: "specialist" },
];

const boardOn = taskBoard({
  name: "floor-on",
  collection: { collectionId: "floor-on" },
  workers: { specialist } as never,
  defaultWorker: floor as never,
  dispatcher: "fifo",
  concurrency: 2,
  onError: "skip",
  initialTasks,
});

const boardOff = taskBoard({
  name: "floor-off",
  collection: { collectionId: "floor-off" },
  workers: { specialist } as never,
  // No defaultWorker — the unassigned task must error (I2).
  dispatcher: "fifo",
  concurrency: 2,
  onError: "skip",
  initialTasks,
});

const flow = defineFlow({
  kind: "delegation-floor-goal",
  requireUser: true,
  actions: {
    drainOn: { block: boardOn.drain as never },
    drainOff: { block: boardOff.drain as never },
  },
})({ id: "default" });

const stores = createInMemoryStores();
const runtimeConfig = { modelResolver: createModelResolver() } as never;

/** Final { status, output } per task id, read from the emitted task-change stream. */
function finalTaskState(items: unknown[]): Map<string, { status: string; output?: unknown }> {
  const out = new Map<string, { status: string; output?: unknown }>();
  for (const item of items as Array<{
    type?: string;
    component?: string;
    data?: { task?: { id: string; status: string; output?: unknown } };
  }>) {
    if (item.type === "component" && item.component === "task-change" && item.data?.task) {
      out.set(item.data.task.id, {
        status: item.data.task.status,
        output: item.data.task.output,
      });
    }
  }
  return out;
}

async function drain(actionName: "drainOn" | "drainOff") {
  const res = await runAction({
    flow,
    actionName: actionName as never,
    input: undefined,
    userId: "goal-user",
    sessionId: `${actionName}-session`,
    stores,
    runtimeConfig,
  });
  if (res.error) throw new Error(`${actionName} failed: ${res.error.message}`);
  return finalTaskState(res.items);
}

async function runGoalCheck(): Promise<string[]> {
  const failures: string[] = [];
  const has = (v: unknown, needle: string) =>
    String(v ?? "").toLowerCase().includes(needle.toLowerCase());

  // Honesty guard: the answer must not be in the task input, or "produced it"
  // proves nothing. The floor's turn is built from the goal (the question).
  if (has(fx.question, fx.answer)) {
    return ["setup invalid: the answer is contained in the question fixture"];
  }

  const on = await drain("drainOn");
  const off = await drain("drainOff");

  const onUnassigned = on.get("unassigned");
  const onDeclared = on.get("declared");
  const offUnassigned = off.get("unassigned");
  const offDeclared = off.get("declared");

  // A/I1 — floor ON: the unassigned task completed and its recorded output
  // carries the real-model answer.
  if (onUnassigned?.status !== "completed") {
    failures.push(
      `floor-on: unassigned task status is ${JSON.stringify(onUnassigned?.status)}, expected completed`,
    );
  } else if (!has(onUnassigned.output, fx.answer)) {
    failures.push(
      `floor-on: unassigned task completed but output did not contain "${fx.answer}" — ` +
        `the floor did not actually run. Output: ${JSON.stringify(String(onUnassigned.output).slice(0, 200))}`,
    );
  }

  // A/I2 — floor OFF: the identical task errors, with no answer output.
  if (offUnassigned?.status !== "errored") {
    failures.push(
      `floor-off: unassigned task status is ${JSON.stringify(offUnassigned?.status)}, expected errored ` +
        `(no defaultWorker → the miss must fail, proving the floor is what completed it in floor-on)`,
    );
  }
  if (has(offUnassigned?.output, fx.answer)) {
    failures.push(`floor-off: unassigned task produced the answer without a floor — contrast is void`);
  }

  // B/I3 — declared vs floor: the declared task ran on the declared worker in
  // BOTH boards (its marker), never the floor's answer.
  for (const [label, st] of [["floor-on", onDeclared], ["floor-off", offDeclared]] as const) {
    if (st?.status !== "completed" || !has(st.output, fx.specialistMarker)) {
      failures.push(
        `${label}: declared task did not run on its own worker (status ${JSON.stringify(st?.status)}, ` +
          `output ${JSON.stringify(String(st?.output).slice(0, 80))}) — expected the specialist marker`,
      );
    }
    if (has(st?.output, fx.answer)) {
      failures.push(`${label}: declared task output carried the floor's answer — the floor hijacked a declared task`);
    }
  }

  if (failures.length === 0) {
    console.log(
      `floor-on  unassigned → ${JSON.stringify(String(onUnassigned!.output).slice(0, 120))}  (contains "${fx.answer}")\n` +
        `floor-off unassigned → status "${offUnassigned?.status}", output ${JSON.stringify(offUnassigned?.output)}\n` +
        `declared task → "${String(onDeclared!.output)}" (the specialist marker, never the floor)`,
    );
  }
  return failures;
}

const failures = await runGoalCheck();
if (failures.length === 0) {
  console.log(
    `\nPASS — an unassigned task ran on the default worker (real model) and recorded the held-out ` +
      `answer; the identical board with no floor errored the same task; a declared assignee ran on ` +
      `its own worker, never the floor.`,
  );
  process.exit(0);
} else {
  console.error("\nFAIL —");
  for (const f of failures) console.error(`  - ${f}`);
  process.exit(1);
}
