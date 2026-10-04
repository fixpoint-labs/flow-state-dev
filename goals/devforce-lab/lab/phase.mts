/**
 * The one phase this lab runs — the prompt it builds, and what counts as done.
 *
 * Two halves, and the split is the whole claim:
 *
 * - **`buildPrompt` leads with the task the manager hands over** (`run.task`,
 *   the work a person approved or posted), **then is composed out of the seat's
 *   own configuration**, read through the block context the manager hands it.
 *   Nothing here names a file, a seat or a token: the instructions are the
 *   `WORKER.md` body the mint put on the seat, the brief is whatever ref that
 *   seat's own frontmatter declared, and the conventions are the skill union
 *   the tree resolved for it. That is what makes BR-10 gradeable — the prompt
 *   carries three tokens that live in three different files and in none of
 *   this lab's code.
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
import { runAcceptance } from "./acceptance.mts";
import type { SeatConfig } from "./seat-config.mts";

/** The phase segment of every run record's topic, and of every row filed here. */
export const PHASE = "implement";

/** What {@link implementPhase}'s `validate` learned, handed back to `isDone`. */
interface ValidatedWorkspace {
  baseRef: string;
}

/**
 * Compose the prompt: the task first, then the seat that was woken.
 *
 * The task is the job, as the board handed it over (`run.task`): what a person
 * approved or posted, word for word. The seat's files are how this team works:
 * its instructions, its standing brief and its conventions. Where the two
 * disagree, the task wins, which is why it comes first. The mailbox's charter
 * follows when the woken seat is a declared member of the mailbox whose board
 * holds the task, and the run's terms close it.
 *
 * Nothing else reaches the prompt: not the coordinator's session, not the
 * mailbox's transcript, not the environment.
 *
 * Exported because the honesty check grades the same prompt the gate does: one
 * builder, two harnesses, which is the only way "the prompt carried the seat's
 * own files" means the same thing in both halves.
 *
 * @param run What the manager hands a prompt builder for this attempt.
 * @param options The phase's options: the mailbox's charter and members, and
 *   whether acceptance decides.
 * @returns The prompt.
 * @throws If the seat declares a document it does not hold — a seat reading
 *   nothing is the silent pass this whole lab exists to refuse, so it is loud.
 */
export async function buildSeatPrompt(
  run: PromptRunContext,
  options: ImplementPhaseOptions = {},
): Promise<string> {
  const ctx = run.ctx;
  const config = (ctx.flow.config ?? {}) as unknown as SeatConfig;

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
  // Membership is read off the declared tree and the woken seat's own id (the
  // hire imposes it on the seat's settings), never off the row: who may see a
  // mailbox is not the filer's to say.
  const charter =
    options.mailbox !== undefined &&
    config.seatId !== undefined &&
    options.mailbox.members.includes(config.seatId)
      ? options.mailbox
      : undefined;

  return [
    ...(options.dropTask === true ? [] : taskSection(run.task)),
    `# Your instructions`,
    ``,
    (config.instructions ?? "").trim(),
    ``,
    `# Your team's standing brief (${documentRef})`,
    ``,
    brief.trim(),
    ``,
    `# Your team's conventions`,
    ``,
    skills.map((skill) => skill.skillMd.trim()).join("\n\n"),
    ``,
    ...(charter === undefined
      ? []
      : [`# The charter of ${charter.id}, the mailbox this task is on`, ``, charter.charter.trim(), ``]),
    `# Where and how to work`,
    ``,
    `Row ${run.issue}, phase ${run.phase}, attempt ${run.attempt}.`,
    `Work in ${run.workspacePath}, on branch ${run.branch}.`,
    options.requireAcceptance === true
      ? `Commit your work. The task is done when this branch carries a commit its base does not ` +
        `and the acceptance check that comes with your brief passes against it. The acceptance ` +
        `check decides, not your own tests.`
      : `Commit your work. The task is done when this branch carries a commit its base does not.`,
    ...(run.feedback === undefined
      ? []
      : ["", `# Why the last attempt stopped`, "", run.feedback]),
  ].join("\n");
}

/**
 * The most of each of `deps` and `priorWork` a prompt carries, in characters of
 * its JSON. The task leads the prompt, so an uncapped dependency output would
 * push the seat's files and the run's terms toward the end of the context. The
 * goal and context are never capped: they are what a person wrote.
 */
const MAX_TASK_OUTPUT_CHARS = 4_000;

/** `value` as indented JSON, cut at {@link MAX_TASK_OUTPUT_CHARS} with a visible marker. */
function cappedJson(value: unknown): string {
  const text = JSON.stringify(value, null, 2);
  if (text.length <= MAX_TASK_OUTPUT_CHARS) return text;
  const dropped = text.length - MAX_TASK_OUTPUT_CHARS;
  return `${text.slice(0, MAX_TASK_OUTPUT_CHARS)}\n[truncated: ${dropped} more characters]`;
}

/**
 * The task's section, as the board packed it: the goal, then what the row adds.
 *
 * `input` is deliberately not rendered: this team's rows carry only
 * `{ issue, phase }`, which the run's terms already name.
 */
function taskSection(task: PromptRunContext["task"]): string[] {
  return [
    `# Your task`,
    ``,
    ...(task.title === undefined ? [] : [task.title, ``]),
    task.goal.trim(),
    ``,
    ...(task.context === undefined ? [] : [task.context.trim(), ``]),
    ...(task.deps === undefined
      ? []
      : [`What the tasks this one depends on produced:`, ``, cappedJson(task.deps), ``]),
    ...(task.priorWork === undefined
      ? []
      : [`What earlier tasks on this board found:`, ``, cappedJson(task.priorWork), ``]),
  ];
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
export interface ImplementPhaseOptions {
  /**
   * Also require the brief's acceptance check to pass before the row settles.
   *
   * **Off by default, and that is not timidity — it is what keeps the two older
   * checks meaning what their verdict logs say.** Their scripted stub writes a
   * file the current brief does not name, so a phase that demanded acceptance
   * unconditionally would fail rows those checks expect to complete, and would
   * rewrite claims this issue promised not to touch (S6, BR-17).
   *
   * On, it closes [BR-4](../../../specs/issues/FIX-1496/BUSINESS-RULES.md): *a
   * run that produces an artifact which does not satisfy the acceptance check
   * does not settle `completed`.* Without it the done-condition is "a commit
   * exists", the row settles `completed` for work that ignored the brief
   * entirely, and the goal's later rejection does not undo that — **the row is
   * what survives the run, and it would be lying.**
   */
  requireAcceptance?: boolean;
  /**
   * The mailbox whose board holds this phase's rows: its id, its charter, and
   * its declared members. The charter reaches a run's prompt only when the
   * woken seat is one of the members. Absent, no prompt carries a charter.
   */
  mailbox?: { id: string; charter: string; members: readonly string[] };
  /**
   * Control only: build the prompt without the task the manager handed over,
   * as the builder did before it led with it. The red state of "a run is
   * handed the work a person approved".
   */
  dropTask?: boolean;
}

/**
 * Build the implement phase.
 *
 * @param options `requireAcceptance` to add the brief's condition to the
 *   done-condition, and `mailbox` to hand member seats its charter. See
 *   {@link ImplementPhaseOptions}.
 * @returns The phase spec to hand the coder kind.
 */
export function defineImplementPhase(options: ImplementPhaseOptions = {}): PhaseSpec {
  return {
    phase: PHASE,
    buildPrompt: (run: PromptRunContext) => buildSeatPrompt(run, options),
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
      if (!(await hasNewCommit(context.workspacePath, validated.baseRef))) return false;
      if (options.requireAcceptance !== true) return true;

      // The requester's condition, run against the tree this attempt produced.
      // A rejection re-pends the row with the reason, exactly as any other
      // unfinished attempt does, so the retry budget still applies.
      return runAcceptance(context.workspacePath).accepted;
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
}

/** The phase the two older checks use — commit only, unchanged. */
export const implementPhase: PhaseSpec = defineImplementPhase();
