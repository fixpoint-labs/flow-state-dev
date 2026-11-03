/**
 * The paced scripted coder a host serves when it is asked for no model: a
 * {@link harnessStub} that narrates five steps, writes `SCRIPTED-RUN.md` where
 * it works, commits it when that is a checkout, and ends with a one-line answer.
 *
 * One definition, so every host that offers a scripted coder (Shift Manager's
 * DevTeam, the Teammates lab) runs the same one.
 */

import { execFileSync } from "node:child_process";
import { existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { CapabilityRef } from "@flow-state-dev/core";
import { GIT_TIMEOUT_MS } from "./checkout";
import { harnessStub, type HarnessStub, type StubRun } from "./harness-stub";

/** Options for {@link scriptedHarness}. */
export interface ScriptedHarnessOptions {
  /** The pause before each scripted step, in milliseconds. */
  stepEveryMs: number;
  /** Capabilities the slot holds when a host relays MCP tools (see `harnessStub`'s `mcpUses`). */
  mcpUses?: readonly CapabilityRef[];
}

/** The row line the manager's prompt carries, `Row <id>, phase <p>, attempt <n>.` */
function rowLine(prompt: string): string {
  return prompt.split("\n").find((line) => line.startsWith("Row ")) ?? "a row";
}

/** Run git in `cwd`, bounded by {@link GIT_TIMEOUT_MS}, returning stdout. */
function git(cwd: string, ...args: string[]): string {
  return execFileSync("git", args, { cwd, stdio: "pipe", encoding: "utf8", timeout: GIT_TIMEOUT_MS });
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
 * attempt's work is already on the row's branch.
 *
 * @param run The attempt, as the stub hands it to `duringRun`.
 */
export function commitScriptedWork(run: StubRun): void {
  writeFileSync(join(run.cwd, "SCRIPTED-RUN.md"), `A scripted run, no model.\n\n${rowLine(run.prompt)}\n`);
  if (!existsSync(join(run.cwd, ".git")) || git(run.cwd, "status", "--porcelain").trim() === "") return;
  git(run.cwd, "add", "-A");
  git(run.cwd, "-c", "user.email=devforce-lab@example.test", "-c", "user.name=DevForce Lab", "commit", "-m", "scripted run: note the row");
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
      "Planning the change for this row.",
      "Writing SCRIPTED-RUN.md in the checkout.",
      "Checking the checkout before committing.",
      "Committing the work on the row's branch.",
    ],
    stepEveryMs,
    duringRun: commitScriptedWork,
    ...(mcpUses === undefined ? {} : { mcpUses }),
    finalMessage: "A scripted run, no model: it wrote SCRIPTED-RUN.md.",
  });
}
