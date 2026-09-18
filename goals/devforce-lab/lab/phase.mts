/**
 * The one phase this lab runs — the prompt it builds, and what counts as done.
 *
 * Two halves, and the split is the whole claim:
 *
 * - **`buildPrompt` is composed out of the seat's own configuration**, read
 *   through the block context the manager hands it. Nothing here names a file,
 *   a seat or a token: the instructions are the `WORKER.md` body the mint put
 *   on the seat, the brief is whatever ref that seat's own frontmatter declared,
 *   and the conventions are the skill union the tree resolved for it. That is
 *   what makes BR-10 gradeable — the prompt carries three tokens that live in
 *   three different files and in none of this lab's code.
 * - **`isDone` refuses a run that reported `stopped-at-limit`, and otherwise is
 *   a commit the base ref does not have**, read out of the run's
 *   own checkout with git. Not a pull request: conductor already proves the `gh`
 *   probe, and re-proving it would make this check expensive to re-run a year
 *   from now, which is the one thing a goal is for.
 *
 * The done-condition is the authority on completion, and the run record never
 * is. A harness that reports a clean finish and leaves no commit does not settle
 * its row (BR-14); one that reports a clean finish and commits does (BR-13).
 */

import { assertBaseRefExists } from "@flow-state-dev/harness-manager";
import type {
  CompletionRunContext,
  PhaseSpec,
  PromptRunContext,
  WorkspaceConfig,
} from "@flow-state-dev/harness-manager";
import { GIT_TIMEOUT_MS, run } from "@flow-state-dev/harness-manager/checkout";

/** The phase segment of every run record's topic, and of every row filed here. */
export const PHASE = "implement";

/** What a seat of the `coder` kind carries in its settings bag, where the bag's type is erased. */
interface SeatConfig {
  instructions?: string;
  document?: string;
  seatSkills?: Array<{ name: string; skillMd: string }>;
}

/** What {@link implementPhase}'s `validate` learned, handed back to `isDone`. */
interface ValidatedWorkspace {
  baseRef: string;
}

/**
 * Compose the prompt out of the seat that was woken.
 *
 * Exported because the honesty check grades the same prompt the gate does: one
 * builder, two harnesses, which is the only way "the prompt carried the seat's
 * own files" means the same thing in both halves.
 *
 * @param run What the manager hands a prompt builder for this attempt.
 * @returns The prompt, with the seat's instructions, brief and conventions in it.
 * @throws If the seat declares a document it does not hold — a seat reading
 *   nothing is the silent pass this whole lab exists to refuse, so it is loud.
 */
export async function buildSeatPrompt(run: PromptRunContext): Promise<string> {
  const ctx = run.ctx;
  const config = (ctx.flow.config ?? {}) as SeatConfig;

  const documentRef = config.document;
  if (documentRef === undefined) {
    throw new Error(
      `the seat handed row ${run.issue} declares no \`document:\`, so it has no brief to ` +
        `work from. Every seat of this kind names one file-declared document.`,
    );
  }
  const ref = ctx.resources[documentRef];
  if (ref === undefined) {
    throw new Error(
      `the seat handed row ${run.issue} names document "${documentRef}", which is not ` +
        `installed on its flow. Installed: ${Object.keys(ctx.resources).join(", ")}`,
    );
  }
  const brief = (await (ref as { readContent(): Promise<string | null> }).readContent()) ?? "";

  const skills = config.seatSkills ?? [];

  return [
    `# Your instructions`,
    ``,
    (config.instructions ?? "").trim(),
    ``,
    `# Your brief (${documentRef})`,
    ``,
    brief.trim(),
    ``,
    `# Your team's conventions`,
    ``,
    skills.map((skill) => skill.skillMd.trim()).join("\n\n"),
    ``,
    `# This row`,
    ``,
    `Row ${run.issue}, phase ${run.phase}, attempt ${run.attempt}.`,
    `Work in ${run.workspacePath}, on branch ${run.branch}.`,
    `Commit your work. A row is done when this branch carries a commit its base does not.`,
    ...(run.feedback === undefined
      ? []
      : ["", `# Why the last attempt stopped`, "", run.feedback]),
  ].join("\n");
}

/**
 * Is there a commit on this run's branch that the base ref does not have?
 *
 * `rev-list --count <base>..HEAD` inside the run's own checkout. Reading HEAD
 * rather than the branch name by design: the claim is about the tree this
 * attempt was given, and a branch name resolves the same from anywhere.
 */
async function hasNewCommit(workspacePath: string, baseRef: string): Promise<boolean> {
  const { stdout } = await run("git", ["rev-list", "--count", `${baseRef}..HEAD`], {
    cwd: workspacePath,
    timeoutMs: GIT_TIMEOUT_MS,
  });
  return Number.parseInt(stdout.trim(), 10) > 0;
}

/**
 * The phase.
 *
 * `validate` runs at construction, where a misconfiguration is an operator's
 * problem rather than a charged attempt's: it pins the base ref this phase
 * compares against and confirms the source repository actually has it.
 */
export const implementPhase: PhaseSpec = {
  phase: PHASE,
  buildPrompt: buildSeatPrompt,
  isDone: async (context: CompletionRunContext) => {
    // **The run itself says it ran out of road, so a commit is not the job.**
    // Checked before the probe: "a commit the base ref lacks" is the weakest
    // completion signal this repo ships, and a budget-stopped run is precisely
    // the case where committing something and finishing the work come apart.
    if (context.stopReport === "stopped-at-limit") return false;

    const validated = context.validated as ValidatedWorkspace | undefined;
    if (validated === undefined) {
      throw new Error(
        "the implement phase was constructed without its `validate` hook, so it does not " +
          "know which ref to compare against.",
      );
    }
    return await hasNewCommit(context.workspacePath, validated.baseRef);
  },
  validate: (workspace: WorkspaceConfig): ValidatedWorkspace => {
    // Refused here, before any row is claimed: a base ref the repository does
    // not have fails the done-condition on EVERY attempt, each time after the
    // run has already been paid for. This is the exact shape `validate` exists
    // for — a precondition only the phase knows about, over a workspace only
    // the host holds.
    assertBaseRefExists(workspace.sourceRepo, workspace.baseRef, "workspace.baseRef");
    return { baseRef: workspace.baseRef };
  },
};
