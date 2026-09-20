/**
 * Goal check — the seat a file declared commits work its own brief described.
 *
 * **The honesty half.** Its model-free sibling,
 * `it-wakes-the-seat-a-file-declared`, drives this same tree, the same hire and
 * the same wiring with a scripted stub in the harness slot, and grades what the
 * plumbing carried. It cannot reach one leg: that a *real* coding agent, handed
 * the prompt the manager built out of the seat's own files, working in the
 * checkout the row derived, leaves a commit the base ref does not have.
 *
 * One expression differs between the two checks — the harness slot. That is D2,
 * and it is why the `coder` kind takes a slot rather than naming an agent.
 *
 * ## What it grades, and what it deliberately does not
 *
 * - **The prompt**, for the same held-out tokens the gate grades, asserted
 *   *before* any verdict is read. The tokens live one per convention file and
 *   in none of the lab's code, so a prompt carrying them is a prompt built out
 *   of the seat's own files.
 * - **A commit on the run's branch that the base ref does not have**, read out
 *   of the scratch repository with git.
 *
 * It does **not** grade what the run wrote. A model writes a plausible
 * `GREETING.md` without reading anything, so the file's contents are not
 * evidence that a document was read — the prompt is. That asymmetry is the
 * whole reason the two halves exist.
 *
 * ## It runs against a repository this check made
 *
 * A fresh git repository under the OS temp directory, with one commit. Not the
 * developer's tree: this check's side effects would otherwise be somebody's
 * working copy. Conductor already proves the `gh` probe, so the done-condition
 * here is a commit rather than a pull request — which is what keeps this
 * re-runnable a year from now.
 *
 * Requires a signed-in Claude Code Agent SDK. There is no stub fallback and
 * there deliberately is not one: a model-backed check that silently degrades to
 * a scripted run is the failure its sibling exists to detect.
 *
 * Run: pnpm tsx goals/devforce-lab/it-commits-from-the-seats-own-file/run.mts
 */
import { execFileSync } from "node:child_process";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { handler, harnessRunHandleSchema, harnessRunInputSchema, sequencer } from "@flow-state-dev/core";
import { inMemoryStores } from "@flow-state-dev/engine";
import { claudeCodeAgent } from "@flow-state-dev/claude-code/sdk";
import type { HarnessBlock } from "@flow-state-dev/core/types";
import { z } from "zod";
import { GIT_TIMEOUT_MS } from "@flow-state-dev/harness-manager/checkout";
import type { Task } from "@flow-state-dev/orchestration/tasks";
import { runGoal, silentLogger, stripIntentOverrides } from "../../lib/index.mts";
import { LAB_TREE, openLab } from "../lab/host.mts";
import { BASE_REF, createScratchRepo } from "../lab/scratch-repo.mts";
import { PHASE } from "../lab/phase.mts";

stripIntentOverrides();

/** The seat the board's `coder` assignee is addressed to, and the row it is handed. */
const ASSIGNED_SEAT = "eng.coder";
const COORDINATOR_SEAT = "eng.em";
const ROW = { issue: "greeting-module", goal: "Add a greeting module to the repository." };
const TASK_ID = `${ROW.issue}--${PHASE}`;

/**
 * The tokens the prompt must carry, and the file each one lives in.
 *
 * Read off the tree at run time rather than restated here: the claim is that
 * the prompt carried what the seat's own files say, and a list this check typed
 * out would be a list this check could get right while the tree changed.
 */
const PROMPT_TOKEN_HOMES = {
  "CODER-INSTRUCTIONS-B42D9": "teams/eng/workers/coder/WORKER.md",
  "FEATURE-BRIEF-E61B8": "teams/eng/resources/feature-brief.md",
  "COMMIT-STYLE-F70C4": "teams/eng/skills/commit-style/SKILL.md",
  "BRANCH-NAMING-1B9E7": "teams/eng/workers/coder/skills/branch-naming/SKILL.md",
} as const;

const LAB_ROOT = fileURLToPath(new URL("../lab", import.meta.url));

const RUN_TIMEOUT_MS = 10 * 60_000;
const SETTLE_TIMEOUT_MS = 12 * 60_000;

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/** Every file under a directory, recursively, as [relative path, contents]. */
function filesUnder(root: string, prefix = ""): Array<[string, string]> {
  const out: Array<[string, string]> = [];
  for (const entry of readdirSync(root)) {
    const full = join(root, entry);
    const rel = prefix === "" ? entry : `${prefix}/${entry}`;
    if (statSync(full).isDirectory()) out.push(...filesUnder(full, rel));
    else out.push([rel, readFileSync(full, "utf8")]);
  }
  return out;
}

await runGoal(async () => {
  const failures: string[] = [];
  const evidence: string[] = [];

  // The held-out half, first and separately: a token the lab's own code could
  // have produced proves nothing about a file being read.
  {
    const tree = filesUnder(LAB_TREE);
    const code = filesUnder(LAB_ROOT).filter(([path]) => path.endsWith(".mts"));
    for (const [token, home] of Object.entries(PROMPT_TOKEN_HOMES)) {
      const carriers = tree.filter(([, text]) => text.includes(token)).map(([path]) => path);
      if (carriers.length !== 1 || carriers[0] !== home) {
        failures.push(`token ${token} should live only in ${home}; found in ${carriers.join(", ")}`);
      }
      if (code.some(([, text]) => text.includes(token))) {
        failures.push(`token ${token} appears in the lab's own code`);
      }
    }
  }
  if (failures.length > 0) return { failures, evidence: "" };

  const dirs = createScratchRepo("honesty");
  const git = (...args: string[]): string =>
    execFileSync("git", args, { cwd: dirs.sourceRepo, encoding: "utf8", timeout: GIT_TIMEOUT_MS });

  /** Every prompt the manager built, so the anti-game reads what was actually sent. */
  const prompts: string[] = [];

  /**
   * Record the prompt on its way into the harness.
   *
   * A `.tap()` in front of the agent rather than a hook on the phase: the claim
   * is about what the *manager* handed the run, and re-running this check's own
   * copy of `buildPrompt` would grade a string this file produced. The tap sees
   * the block input the agent is about to receive, which is the same string by
   * construction. Its composition is exercised model-free by the sibling gate's
   * own stub, so a change that breaks the wrap does not first show up here.
   */
  const recordPrompt = handler({
    name: "devforce-record-prompt",
    inputSchema: harnessRunInputSchema,
    outputSchema: z.object({ recorded: z.number() }),
    execute: (input: { prompt: string }) => ({ recorded: prompts.push(input.prompt) }),
  });

  const lab = await openLab({
    stores: inMemoryStores(),
    workspace: { root: dirs.root, sourceRepo: dirs.sourceRepo, baseRef: BASE_REF },
    coderSeatId: ASSIGNED_SEAT,
    runTimeoutMs: RUN_TIMEOUT_MS,
    logger: silentLogger,
    // ---- the one expression that differs from the contract gate ----
    //
    // `detached: true` is not decoration: the harness becomes a child block of
    // the flow's gated task entry, and the claim gate refuses an entry that
    // authors session state anywhere beneath it. `recordWork: true` keys the
    // index of what the run touched to the run's own checkout.
    harness: ({ cwd, resume, onSession }) =>
      sequencer({
        name: "devforce-lab-recorded-harness",
        inputSchema: harnessRunInputSchema,
        outputSchema: harnessRunHandleSchema,
      })
        .tap(recordPrompt)
        .step(
          claudeCodeAgent({
            cwd,
            resume,
            onSession,
            detached: true,
            recordWork: true,
            allowedTools: ["Read", "Write", "Edit", "Bash"],
            permissionMode: "acceptEdits",
            maxTurns: 30,
            systemPrompt:
              "You are a coding agent working in the directory you have been placed in. " +
              "Do what your instructions and your brief say, then commit your work with git. " +
              "Do nothing else.",
          } as never) as never,
        ) as unknown as HarnessBlock,
  });

  try {
    const filed = await lab.file(COORDINATOR_SEAT, { issue: ROW.issue, goal: ROW.goal });
    if (filed.error !== undefined) return { failures: [`filing refused — ${filed.error}`], evidence: "" };

    await lab.drain(COORDINATOR_SEAT);

    const deadline = Date.now() + SETTLE_TIMEOUT_MS;
    let row: Task | undefined;
    while (Date.now() < deadline) {
      row = await lab.row(TASK_ID);
      if (row !== undefined && row.status !== "in_progress" && row.status !== "pending") break;
      await sleep(1_000);
    }

    if (row?.status !== "completed") {
      failures.push(
        `the row settled "${row?.status ?? "never"}"; wanted "completed"` +
          `${row?.feedback === undefined ? "" : ` — ${row.feedback}`}`,
      );
    }

    // The branch the run worked on, and whether it carries anything the base
    // does not. Read out of the SOURCE repository: a worktree's commits are in
    // the same object store, so the branch is visible from here and the check
    // does not depend on the checkout still existing.
    const branches = git("branch", "--list", "conductor/*", "--format=%(refname:short)")
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.length > 0);
    if (branches.length !== 1) {
      failures.push(`the run left ${branches.length} branches under conductor/, wanted 1`);
    }
    const branch = branches[0];
    if (branch !== undefined) {
      const ahead = Number.parseInt(
        git("rev-list", "--count", `${BASE_REF}..${branch}`).trim(),
        10,
      );
      if (ahead < 1) {
        failures.push(`branch ${branch} carries no commit that ${BASE_REF} does not have`);
      }
      evidence.push(`branch ${branch} is ${ahead} commit(s) ahead of ${BASE_REF}`);
    }

    // The anti-game, on the prompt that was actually sent.
    const prompt = prompts[0];
    if (prompt === undefined) {
      failures.push("the manager built no prompt, so the run was never reached");
    } else {
      for (const [token, home] of Object.entries(PROMPT_TOKEN_HOMES)) {
        if (!prompt.includes(token)) {
          failures.push(`the prompt does not carry ${token}, which lives only in ${home}`);
        }
      }
      evidence.push(
        `the prompt that produced it carried all ${Object.keys(PROMPT_TOKEN_HOMES).length} ` +
          `held-out tokens from the seat's own instructions, brief and skills`,
      );
    }

    return { failures, evidence: evidence.join("; ") };
  } finally {
    await lab.dispose();
  }
});
