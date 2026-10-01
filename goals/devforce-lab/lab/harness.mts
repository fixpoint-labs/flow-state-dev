/**
 * Which harness a served DevForce Lab puts in the `coder` kind's slot.
 *
 *     DEVFORCE_LAB_HARNESS=claude-code pnpm --filter @flow-state-dev/app-lab start \
 *       --config goals/devforce-lab/lab/fsdev.config.mts
 *
 * Two choices, picked by {@link HARNESS_ENV} and nothing else:
 *
 * - **`stub`** (the default): the lab's scripted run, no model. It says what it
 *   is doing in the run's session, then writes one file in its checkout and
 *   commits it, so the implement phase's done-condition (a commit the base ref
 *   does not have) is met and an approved row settles `completed`. The bare
 *   `harnessStub()` the config used before did neither: every attempt finished
 *   with no step and no commit, and the row went back to pending with nothing
 *   left to run it.
 * - **`claude-code`**: a real coding agent, Claude Code through its Agent SDK,
 *   set up exactly as the honesty check (`it-commits-from-the-seats-own-file`)
 *   sets it up. Needs a signed-in SDK or an Anthropic key. Nothing falls back
 *   to the stub when it is not there: a run that quietly used the stub would be
 *   reported as a model's.
 *
 * An unknown value is refused at startup rather than read as the default.
 */

import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { claudeCodeAgent } from "@flow-state-dev/claude-code/sdk";
import type { HarnessBlock, HarnessCallbackContext } from "@flow-state-dev/core/types";
import { harnessStub, type StubRun } from "./harness-stub.mts";
import { commitAll } from "./scratch-repo.mts";

/** The environment variable that picks the harness. */
export const HARNESS_ENV = "DEVFORCE_LAB_HARNESS";

/** The harnesses a served Lab can run. */
export const HARNESS_CHOICES = ["stub", "claude-code"] as const;
export type HarnessChoice = (typeof HARNESS_CHOICES)[number];

/** The three feeds the harness contract hands a slot. */
export interface HarnessFeeds {
  cwd: (ctx: HarnessCallbackContext) => string | Promise<string>;
  resume: (ctx: HarnessCallbackContext) => string | null | Promise<string | null>;
  onSession: (sessionId: string, ctx: HarnessCallbackContext) => void | Promise<void>;
}

/** A chosen harness: its name, the slot, and how long one run may take. */
export interface SelectedHarness {
  name: HarnessChoice;
  slot: (feeds: HarnessFeeds) => HarnessBlock;
  runTimeoutMs: number;
}

/**
 * Claude Code in the slot, as the honesty check runs it.
 *
 * `detached: true` because the harness is a child block of the flow's gated
 * task entry, and the claim gate refuses an entry that authors session state
 * beneath it. `recordWork: true` keys the index of what the run touched to the
 * run's own checkout, which is what the task inspector's plan and files read.
 */
export function claudeCodeHarness(feeds: HarnessFeeds): HarnessBlock {
  return claudeCodeAgent({
    ...feeds,
    detached: true,
    recordWork: true,
    allowedTools: ["Read", "Write", "Edit", "Bash"],
    permissionMode: "acceptEdits",
    maxTurns: 30,
    systemPrompt:
      "You are a coding agent working in the directory you have been placed in. " +
      "Do what your instructions and your brief say, then commit your work with git. " +
      "Do nothing else.",
  } as never) as unknown as HarnessBlock;
}

/** The row line the manager's prompt carries, `Row <id>, phase <p>, attempt <n>.` */
function rowLine(prompt: string): string {
  return prompt.split("\n").find((line) => line.startsWith("Row ")) ?? "a row";
}

/** What the scripted run does in its checkout: one file, committed. */
function commitScriptedWork(run: StubRun): void {
  writeFileSync(join(run.cwd, "SCRIPTED-RUN.md"), `A scripted run, no model.\n\n${rowLine(run.prompt)}\n`);
  commitAll(run.cwd, "scripted run: note the row");
}

/**
 * The pause before each scripted step. Long enough that a run opened from Tasks
 * is still running and its steps arrive while you watch; short enough that it
 * settles in seconds.
 */
export const SCRIPTED_STEP_MS = 2_000;

/**
 * The scripted run a served Lab uses by default: narrates a step every
 * {@link SCRIPTED_STEP_MS}, commits, finishes.
 *
 * @returns The stub, whose `runs` log what each attempt was handed.
 */
export function scriptedHarness() {
  return harnessStub({
    steps: [
      "Reading the seat's instructions, brief and conventions.",
      "Planning the change for this row.",
      "Writing SCRIPTED-RUN.md in the checkout.",
      "Checking the checkout before committing.",
      "Committing the work on the row's branch.",
    ],
    stepEveryMs: SCRIPTED_STEP_MS,
    duringRun: commitScriptedWork,
  });
}

/**
 * Pick the harness from the environment.
 *
 * @param value The raw choice, `process.env[HARNESS_ENV]` by default. Empty or
 *   absent means `stub`.
 * @returns The chosen harness.
 * @throws When the value names no harness this Lab can run.
 */
export function selectHarness(value: string | undefined = process.env[HARNESS_ENV]): SelectedHarness {
  const choice = value === undefined || value.trim() === "" ? "stub" : value.trim();
  switch (choice) {
    case "stub":
      return { name: "stub", slot: scriptedHarness().slot, runTimeoutMs: 60_000 };
    case "claude-code":
      return { name: "claude-code", slot: claudeCodeHarness, runTimeoutMs: 10 * 60_000 };
    default:
      throw new Error(
        `${HARNESS_ENV}="${choice}" names no harness this Lab can run; use one of ${HARNESS_CHOICES.join(", ")}.`,
      );
  }
}
