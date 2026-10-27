/**
 * The closure's Lab (FIX-2134): DevTeam's Lab, opened by `openLab` on a tree the run writes,
 * served by Shift Manager's own command. One Lab and one Inbox, where all six stops for a
 * person wait at once (D1):
 *
 * - `desk.front`, the built-in `agent` worker Alice talks to, on the real model. Its model files
 *   a task held on a question before it starts (`createTask`'s `questions`).
 * - `desk.asker`, an `agent` worker on the real model, which asks a question midway
 *   (`askQuestion`) before it answers.
 * - `desk.doer`, on this Lab's `doer` worker flow: a block that stops for an approval, a review
 *   or an input (`ctx.waitForUser`) and reads the answer next. Marks in its task's goal pick the
 *   stop: `[approval]`, `[review]`, `[input]`, and `[deadline:MS]` sets the call's deadline.
 *   Its work is one step before the stop, noted in the proof file, so a step run twice counts 2.
 * - `eng.coder`, DevTeam's coder, whose run asks through its ask marker: Claude Code
 *   (`GOAL_HARNESS=claude-code`), or a stub that asks on a cold run and finishes on a resumed one.
 *
 * Read from the environment: `GOAL_STORE` (the store file), `GOAL_TREE` (the tree),
 * `GOAL_RUNS` (where coding runs work), `GOAL_REMOTE` (Storefront's repository), `GOAL_PROOF`
 * (the proof file the doer and the coding runs append to), `GOAL_HARNESS`, `GOAL_FACT` (what
 * the first coding run alone finds in `NOTE.txt`), and, for journey j2's host only,
 * `GOAL_USER_DEADLINE_MS`. `GOAL_SWEEP_MS` shortens the durability sweeper's interval, which
 * fakes time, not behaviour.
 *
 * Nothing here writes a row, a session or an answer.
 */
import { appendFileSync, existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import { defineFlow, handler, harnessRunInputSchema, sequencer } from "@flow-state-dev/core";
import type { BlockContext, HarnessBlock } from "@flow-state-dev/core/types";
import { sqliteStores } from "@flow-state-dev/store-sqlite";
import type { Task } from "@flow-state-dev/orchestration/tasks";
import { defineSessionBoard, filingConversationBoard, workerConfigSchema, workerTaskEntry } from "@flow-state-dev/workforce";
import { TASK_ID_STATE_KEY } from "../../../../packages/workforce/src/workers/keys.ts";
import { steerOrTalk } from "../../../../packages/workforce/src/conversation-board/steer.ts";
import { claudeCodeHarness } from "../../../../packages/shift-manager/teams/devteam/harness.mts";
import { harnessStub } from "../../../../packages/shift-manager/teams/devteam/harness-stub.mts";
import { openLab } from "../../../../packages/shift-manager/teams/devteam/host.mts";

const need = (name: string): string => {
  const value = process.env[name] ?? "";
  if (value === "") throw new Error(`${name} must name something`);
  return value;
};
const STORE = need("GOAL_STORE");
const TREE = need("GOAL_TREE");
const RUNS = need("GOAL_RUNS");
const REMOTE = need("GOAL_REMOTE");
const PROOF = need("GOAL_PROOF");
const HARNESS = process.env.GOAL_HARNESS === "claude-code" ? "claude-code" : "stub";
const FACT = process.env.GOAL_FACT ?? "";
const number = (name: string): number | undefined => {
  const raw = process.env[name] ?? "";
  if (raw === "") return undefined;
  const value = Number(raw);
  if (!(value > 0)) throw new Error(`${name} must be a positive number, not "${raw}"`);
  return value;
};

/** One line of evidence, appended from inside the run that did it. */
const prove = (proof: Record<string, unknown>) => appendFileSync(PROOF, `${JSON.stringify({ ...proof, at: Date.now(), pid: process.pid })}\n`, "utf8");
const proofs = (): Array<Record<string, any>> =>
  existsSync(PROOF)
    ? readFileSync(PROOF, "utf8")
        .split("\n")
        .filter((line) => line.trim() !== "")
        .map((line) => JSON.parse(line) as Record<string, any>)
    : [];

// ---- the doer: a block that stops for a person and reads the answer next --------------------

const STOPS = { approval: "Ship the release?", review: "Review the draft.", input: "Which region?" } as const;
const doorInput = z.object({ message: z.string() });

function doerFlows(installation: Parameters<typeof defineSessionBoard>[0]["installation"]) {
  const board = defineSessionBoard({ installation, flowKind: "doer" });
  const taskOf = (ctx: BlockContext) => (ctx.session.state as Record<string, unknown> | undefined)?.[TASK_ID_STATE_KEY] as string | undefined;
  const rowOf = async (ctx: BlockContext): Promise<Task | undefined> => {
    const taskId = taskOf(ctx);
    const filing = await filingConversationBoard(ctx);
    return taskId === undefined ? undefined : (filing?.tasks.get(taskId) as Task | undefined);
  };
  const stopOf = (message: string) => (Object.keys(STOPS) as Array<keyof typeof STOPS>).find((kind) => message.includes(`[${kind}]`));

  /** Each turn proves itself first: the row's attempt and turn as it read them, and its message. */
  const turn = handler({
    name: "closure-doer-turn",
    inputSchema: doorInput,
    outputSchema: doorInput,
    execute: async (input, rawCtx) => {
      const ctx = rawCtx as unknown as BlockContext;
      const row = await rowOf(ctx);
      prove({ kind: "turn", taskId: taskOf(ctx), requestId: ctx.request.identity.id, sessionId: ctx.session.identity.id, attempt: row?.attempts, turn: row?.turn, message: input.message });
      return input;
    },
  });
  /** The work, one step before the stop: a step run twice shows as a work counter of 2. */
  const work = handler({
    name: "closure-doer-work",
    inputSchema: doorInput,
    outputSchema: doorInput,
    execute: async (input, rawCtx) => {
      const ctx = rawCtx as unknown as BlockContext;
      prove({ kind: "work", taskId: taskOf(ctx), requestId: ctx.request.identity.id });
      return input;
    },
  });
  const stop = handler({
    name: "closure-doer-stop",
    inputSchema: doorInput,
    outputSchema: z.unknown(),
    execute: async (input, rawCtx) => {
      const ctx = rawCtx as unknown as BlockContext;
      const taskId = taskOf(ctx);
      const kind = stopOf(input.message);
      // A later turn on the same attempt (a steer's) does the work without stopping again.
      if (kind === undefined || ((await rowOf(ctx))?.turn ?? 1) > 1) return `done ${taskId ?? "no task"}`;
      const deadline = /\[deadline:(\d+)\]/.exec(input.message)?.[1];
      const answer = await ctx.waitForUser({ kind, prompt: STOPS[kind], ...(deadline === undefined ? {} : { deadline: Number(deadline) }) } as never);
      const row = await rowOf(ctx);
      prove({ kind: "resumed", taskId, stop: kind, requestId: ctx.request.identity.id, attempt: row?.attempts, outcome: answer });
      return { [kind]: answer };
    },
  });
  const doerWork = sequencer({ name: "closure-doer", inputSchema: doorInput }).step(turn).step(work).step(stop);
  const doerFlow = defineFlow({
    kind: "doer",
    configSchema: workerConfigSchema(),
    session: { ...installation.session(board.sessionStateShape), serverOwned: [...board.serverOwned] },
    resources: { ...installation.resources, ...board.resources },
    // A line typed in a task's session steers it, through the one home for what a line answers.
    actions: { respond: { inputSchema: doorInput.strict(), block: steerOrTalk(doerWork), userMessage: (i: { message: string }) => i.message }, ...board.actions },
    internal: { actions: board.entries(doerWork, () => "judgment") },
    task: { actions: { work: { ...workerTaskEntry({ name: "closure-doer-task", turn: doerWork }), durable: true } } },
  } as never);
  return { doer: { flow: doerFlow as never, roles: ["contributor", "manager"] } } as never;
}

// ---- the coder's harness, recorded ------------------------------------------------------------

/**
 * The stub's coding run: a cold run asks through the ask marker its prompt names; a resumed run
 * (the answer's) writes the fact the first run read and ends.
 */
const stub = harnessStub({
  finalMessage: "I did the task. DONE",
  duringRun: (run) => {
    if (run.resume === null) {
      const marker = /\S*\.fsdev\/ask\/\d+-\d+\.md/.exec(run.prompt)?.[0];
      if (marker === undefined) throw new Error("the prompt names no ask marker");
      const fact = existsSync(join(run.cwd, "NOTE.txt")) ? readFileSync(join(run.cwd, "NOTE.txt"), "utf8").trim() : "";
      writeFileSync(join(run.cwd, ".goal-fact"), fact);
      mkdirSync(join(marker, ".."), { recursive: true });
      writeFileSync(marker, "Should resume-proof.txt end with a trailing newline?");
      return;
    }
    const fact = existsSync(join(run.cwd, ".goal-fact")) ? readFileSync(join(run.cwd, ".goal-fact"), "utf8") : "";
    writeFileSync(join(run.cwd, "resume-proof.txt"), fact);
  },
});
const slot = HARNESS === "claude-code" ? claudeCodeHarness : stub.slot;

/**
 * The slot, recorded into the proof file: each run's prompt, the session it was asked to
 * resume and the one it confirmed, and its checkout. `NOTE.txt` is in the first run's checkout
 * only, so the answer's run can know the fact only from its session.
 */
function recorded(feeds: any): HarnessBlock {
  let cwd = "";
  const inner = (slot as (feeds: any) => HarnessBlock)({
    ...feeds,
    resume: async (ctx: unknown) => {
      const resume = await feeds.resume(ctx);
      prove({ kind: "harness-resume", resume });
      return resume;
    },
    onSession: async (sessionId: string, ctx: unknown) => {
      prove({ kind: "harness-session", sessionId });
      return feeds.onSession(sessionId, ctx);
    },
  });
  const before = handler({
    name: "closure-before-run",
    inputSchema: harnessRunInputSchema.passthrough(),
    outputSchema: harnessRunInputSchema.passthrough(),
    execute: async (input, ctx) => {
      cwd = await feeds.cwd(ctx);
      const first = !proofs().some((p) => p.kind === "harness-run" && p.cwd === cwd);
      if (first && FACT !== "") writeFileSync(join(cwd, "NOTE.txt"), `${FACT}\n`);
      prove({ kind: "harness-run", cwd, prompt: input.prompt });
      return input;
    },
  });
  const after = handler({
    name: "closure-after-run",
    inputSchema: z.unknown(),
    outputSchema: z.unknown(),
    execute: async (handle) => {
      if (cwd !== "" && existsSync(join(cwd, "NOTE.txt"))) unlinkSync(join(cwd, "NOTE.txt"));
      return handle;
    },
  });
  return sequencer({ name: "closure-recorded-harness", inputSchema: harnessRunInputSchema.passthrough() })
    .step(before)
    .step(inner as never)
    .step(after) as unknown as HarnessBlock;
}

const userDeadlineMs = number("GOAL_USER_DEADLINE_MS");
const sweepIntervalMs = number("GOAL_SWEEP_MS");
const lab = await openLab({
  root: TREE,
  stores: sqliteStores({ filename: STORE }),
  harness: recorded as never,
  runTimeoutMs: HARNESS === "claude-code" ? 15 * 60_000 : 30_000,
  workspace: { root: RUNS, remotes: { allow: ["file"] } },
  coderWorkerId: "eng.coder",
  inventory: true,
  devtool: true,
  withoutJudge: true,
  projects: [{ id: "storefront", title: "Storefront", repository: REMOTE }],
  workerFlows: doerFlows,
  ...(userDeadlineMs === undefined ? {} : { userDeadlineMs }),
  ...(sweepIntervalMs === undefined ? {} : { sweepIntervalMs }),
} as never);

export default lab.state;
