/**
 * The paced scripted coder a host serves when it is asked for no model: a
 * {@link harnessStub} that narrates five steps, writes `SCRIPTED-RUN.md` where
 * it works, commits it when that is a checkout, and ends with a one-line answer.
 *
 * One definition, so every host that offers a scripted coder (Shift Manager's
 * DevTeam, the Teammates lab) runs the same one.
 */

import { existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { CapabilityRef } from "@flow-state-dev/core";
import { GIT_TIMEOUT_MS, run as spawnRun } from "@flow-state-dev/workspace";
import { harnessStub, type HarnessStub, type StubRun } from "./harness-stub";

/** Options for {@link scriptedHarness}. */
export interface ScriptedHarnessOptions {
  /** The pause before each scripted step, in milliseconds. */
  stepEveryMs: number;
  /** Capabilities the slot holds when a host relays MCP tools (see `harnessStub`'s `mcpUses`). */
  mcpUses?: readonly CapabilityRef[];
}

/** The task line the manager's prompt carries (`Task <id>, phase <p>, attempt <n>.`), else "a task". */
function taskLine(prompt: string): string {
  return prompt.split("\n").find((line) => line.startsWith("Task ")) ?? "a task";
}

/** Run git in `cwd` through the workspace host's runner, bounded by {@link GIT_TIMEOUT_MS}, returning stdout. */
async function git(cwd: string, ...args: string[]): Promise<string> {
  return (await spawnRun("git", args, { cwd, timeoutMs: GIT_TIMEOUT_MS })).stdout;
}

/**
 * What the scripted run does where it works: one file, committed when that is
 * a checkout. A project with no repository runs in its files (no git), where
 * the file itself is the work and the manager saves it back.
 *
 * A retry runs in the checkout its first attempt left, where that attempt
 * already committed this same file. With nothing new to commit, `git commit`
 * fails, and that failure would replace why the first attempt was sent back
 * (most often the judge's verdict). The commit is skipped instead: the
 * attempt's work is already on the task's branch.
 *
 * @param run The attempt, as the stub hands it to `duringRun`.
 */
export async function commitScriptedWork(run: StubRun): Promise<void> {
  writeFileSync(join(run.cwd, "SCRIPTED-RUN.md"), `A scripted run, no model.\n\n${taskLine(run.prompt)}\n`);
  if (!existsSync(join(run.cwd, ".git")) || (await git(run.cwd, "status", "--porcelain")).trim() === "") return;
  await git(run.cwd, "add", "-A");
  await git(run.cwd, "-c", "user.email=devforce-lab@example.test", "-c", "user.name=DevForce Lab", "commit", "-m", "scripted run: note the task");
}

/**
 * The scripted coder: narrates a step every `stepEveryMs`, commits
 * ({@link commitScriptedWork}), finishes with a one-line answer, which is what
 * a conversation's task needs to be done.
 *
 * @returns The stub, whose `runs` log what each attempt was handed.
 */
export function scriptedHarness({ stepEveryMs, mcpUses }: ScriptedHarnessOptions): HarnessStub {
  return harnessStub({
    steps: [
      "Reading the worker's instructions, brief and conventions.",
      "Planning the change for this task.",
      "Writing SCRIPTED-RUN.md in the checkout.",
      "Checking the checkout before committing.",
      "Committing the work on the task's branch.",
    ],
    stepEveryMs,
    duringRun: commitScriptedWork,
    ...(mcpUses === undefined ? {} : { mcpUses }),
    finalMessage: "A scripted run, no model: it wrote SCRIPTED-RUN.md.",
  });
}
