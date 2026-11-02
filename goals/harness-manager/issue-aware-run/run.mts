/**
 * Goal check: a coding run told which issue it is for works on a branch named
 * after it, with the issue's spec in its brief (FIX-2388).
 *
 * Model-free. A stub harness records each prompt it is handed, over real git
 * checkouts holding a spec only this run wrote. Three legs:
 *
 *   a. A `harnessSessionFlow` session created through the HTTP create route
 *      with `issue`; two turns through the turn route.
 *   b. A `harnessManager` run on a board read from the claim, its task
 *      naming the issue under `harnessFeature`.
 *   c. The same two entries with no issue: prompts are the words alone.
 *
 * Controls (each must FAIL the named assertion):
 *   GOAL_CONTROL=no-brief     the hosts leave `issueSpec` off   → a:spec, b:spec
 *   GOAL_CONTROL=task-branch  the task names its issue in plain
 *                             `input.issue`, as before this key  → b:branch
 *
 * Run: pnpm tsx goals/harness-manager/issue-aware-run/run.mts
 */
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { handler } from "@flow-state-dev/core";
import type { HarnessBlock, HarnessCallbackContext } from "@flow-state-dev/core/types";
import { createFlowApiRouter, createFlowRegistry, createInMemoryStores } from "@flow-state-dev/engine";
import {
  HARNESS_FEATURE_KEY,
  harnessSessionFlow,
  runBoardSegment,
  runTopic,
  type HarnessSessionFeeds,
  type HarnessSessionPlace,
} from "@flow-state-dev/harness-manager";
import { z } from "zod";

import { goalTmpDir, runGoal } from "../../lib/index.mts";
import { CONVERSATIONS, PHASE, claimHost, cleanUpHosts, messageOf } from "../../../packages/harness-manager/test/claim-host.ts";

const CONTROL = process.env.GOAL_CONTROL ?? "";
if (!["", "no-brief", "task-branch"].includes(CONTROL)) throw new Error(`unknown GOAL_CONTROL "${CONTROL}"`);
const BRIEF = CONTROL !== "no-brief";

const ISSUE = "FIX-9001";
// Generated per run, so no prompt could hold it unless the file was read.
const MARKER = `marker-${randomUUID()}`;
const SPEC = `# ${ISSUE}\n\nOnly this run's spec holds ${MARKER}.\n`;
const KIND = "issue-goal-session";

/** A git checkout holding the issue's spec, committed. */
function specRepo(dir: string): void {
  mkdirSync(join(dir, "specs/issues", ISSUE), { recursive: true });
  writeFileSync(join(dir, "specs/issues", ISSUE, "SPEC.md"), SPEC);
  const git = (...args: string[]) => execFileSync("git", args, { cwd: dir, stdio: "pipe" });
  git("add", "specs");
  git("commit", "-m", "spec");
}

/** Leg a and c's session flow: a host whose sessions work in one checkout, logging each place. */
function sessionHost(checkout: string) {
  const places: HarnessSessionPlace[] = [];
  const prompts = new Map<string, string[]>();
  const flow = harnessSessionFlow({
    kind: KIND,
    issueSpec: BRIEF,
    workspace: {
      provision: async (place) => {
        places.push(place);
        return checkout;
      },
      locate: () => checkout,
      branch: () => null,
    },
    agent: (feeds: HarnessSessionFeeds) =>
      handler({
        name: "recording-harness",
        inputSchema: z.object({ prompt: z.string() }),
        execute: async (input, ctx) => {
          const hctx = ctx as unknown as HarnessCallbackContext;
          const id = hctx.session.identity.id;
          prompts.set(id, [...(prompts.get(id) ?? []), input.prompt]);
          await feeds.cwd(hctx);
          const asked = await feeds.resume(hctx);
          await feeds.onSession(asked ?? `conv-${id}`, hctx);
          return { outcome: "completed" };
        },
      }) as unknown as HarnessBlock,
  });
  const registry = createFlowRegistry();
  registry.register(flow);
  const router = createFlowApiRouter({ registry, stores: createInMemoryStores(), staleSweepIntervalMs: 0 });
  const post = async (path: string[], body: Record<string, unknown>) => {
    const res = await router.POST(
      new Request(`http://localhost/api/flows/${path.join("/")}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ userId: "goal-user", ...body }),
      }),
      { params: { path } },
    );
    return { status: res.status, body: (await res.json()) as Record<string, unknown> };
  };
  const create = async (state: Record<string, unknown>): Promise<string> => {
    const created = await post([KIND, "sessions"], { state });
    if (created.status !== 201) throw new Error(`create refused (${created.status}): ${JSON.stringify(created.body)}`);
    return String((created.body.session as { id?: string } | undefined)?.id ?? created.body.id);
  };
  const turn = async (sessionId: string, prompt: string): Promise<void> => {
    const res = await post([KIND, sessionId, "actions", "turn"], { sessionId, input: { prompt } });
    if (res.status >= 400) throw new Error(`turn refused (${res.status}): ${JSON.stringify(res.body)}`);
  };
  /** The turn's prompts, waited for: a turn's action answers before its run ends. */
  const promptsOf = async (sessionId: string, count: number): Promise<string[]> => {
    for (let i = 0; i < 200 && (prompts.get(sessionId)?.length ?? 0) < count; i++) await new Promise((r) => setTimeout(r, 25));
    return prompts.get(sessionId) ?? [];
  };
  return { create, turn, promptsOf, places };
}

await runGoal(async (failures, tell) => {
  const evidence: string[] = [];
  try {
    // ── Leg a: a session born with the issue ────────────────────────────
    const checkout = goalTmpDir("issue-aware-run");
    execFileSync("git", ["init", "--initial-branch=main", "."], { cwd: checkout, stdio: "pipe" });
    execFileSync("git", ["-c", "user.email=g@x", "-c", "user.name=g", "commit", "--allow-empty", "-m", "root"], { cwd: checkout, stdio: "pipe" });
    execFileSync("git", ["config", "user.email", "g@x"], { cwd: checkout });
    execFileSync("git", ["config", "user.name", "g"], { cwd: checkout });
    specRepo(checkout);
    const sessions = sessionHost(checkout);
    const withIssue = await sessions.create({ model: "stub", issue: ISSUE });
    await sessions.turn(withIssue, "Implement it.");
    await sessions.promptsOf(withIssue, 1);
    await sessions.turn(withIssue, "Now add a test.");
    const [first, second] = tell.over("a:turns", await sessions.promptsOf(withIssue, 2));
    if (first === undefined || !first.includes(MARKER)) failures.push("a:spec — the first turn's prompt lacks the issue's spec");
    if (second === undefined || second !== "Now add a test.") failures.push(`a:once — the second turn's prompt is not the words alone: ${JSON.stringify(second)}`);
    const placed = tell.over("a:places", sessions.places.filter((p) => p.sessionId === withIssue));
    if (!placed.every((p) => p.issue === ISSUE)) failures.push("a:place — the workspace was not handed the session's issue");
    evidence.push(`a: first prompt ${first?.length ?? 0} chars with the marker=${first?.includes(MARKER)}, second=${JSON.stringify(second)}`);

    // ── Leg c, session half: no issue ───────────────────────────────────
    const plain = await sessions.create({ model: "stub" });
    await sessions.turn(plain, "Just do it.");
    const plainPrompts = tell.over("c:session", await sessions.promptsOf(plain, 1));
    if (plainPrompts[0] !== "Just do it.") failures.push(`c:session — a session with no issue got more than its words: ${JSON.stringify(plainPrompts[0])}`);

    // ── Leg b: a board task naming the issue ────────────────────────────
    const lab = claimHost({ mode: "claim", manager: { issueSpec: BRIEF } });
    specRepo(join(lab.dir, "repo"));
    const input = CONTROL === "task-branch" ? { issue: ISSUE } : { [HARNESS_FEATURE_KEY]: { issue: ISSUE } };
    await lab.seed({ ledgerId: CONVERSATIONS, partition: "conv-goal", id: "task_goal", goal: "implement the issue", input });
    const { result } = await lab.runAttempt(CONVERSATIONS, "task_goal", "conv-goal");
    if (result.error !== undefined) failures.push(`b:ran — ${messageOf(result.error)}`);
    const record = await lab.record(runTopic(runBoardSegment(CONVERSATIONS, "conv-goal"), "task_goal", PHASE));
    const boardPrompts = tell.over("b:prompts", lab.seen.map((s) => s.prompt));
    if (!(boardPrompts[0] ?? "").includes(MARKER)) failures.push("b:spec — the board run's brief lacks the issue's spec");
    if (!(record?.branch ?? "").includes("fix-9001")) failures.push(`b:branch — the run's branch does not name the issue: ${record?.branch}`);
    evidence.push(`b: branch ${record?.branch}, brief has the marker=${(boardPrompts[0] ?? "").includes(MARKER)}`);

    // ── Leg c, board half: no issue ─────────────────────────────────────
    await lab.seed({ ledgerId: CONVERSATIONS, partition: "conv-goal", id: "task_plain", goal: "an ask", input: {} });
    await lab.runAttempt(CONVERSATIONS, "task_plain", "conv-goal");
    const plainBoard = tell.over("c:board", lab.seen.slice(1).map((s) => s.prompt));
    if ((plainBoard[0] ?? "").includes("## This work is for issue")) failures.push("c:board — a task naming no issue got an issue section");
  } finally {
    cleanUpHosts();
  }
  return { failures, evidence: `${evidence.join(" · ")}${CONTROL === "" ? "" : ` · control ${CONTROL}`}` };
});
