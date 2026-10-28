/**
 * The one phase this lab runs — the prompt it builds, and what counts as done.
 *
 * Two halves, and the split is the whole claim:
 *
 * - **`buildPrompt` leads with the task the manager hands over** (`run.task`,
 *   the work a user approved or posted), **then is composed out of the worker's
 *   own configuration**: the worker the run's session names, loaded through
 *   the block context the manager hands it.
 *   Nothing here names a file, a worker or a token: the instructions are the
 *   `WORKER.md` body the mint put on the worker, the brief is whatever ref that
 *   worker's own frontmatter declared, and the conventions are the skill union
 *   the tree resolved for it. That is what makes BR-10 gradeable — the prompt
 *   carries three tokens that live in three different files and in none of
 *   this lab's code.
 * - **`isDone` refuses a run that reported `stopped-at-limit`, and otherwise is
 *   a commit the base ref does not have**, read out of the run's
 *   own checkout with git. Not a pull request: a `gh` probe would make this
 *   check expensive to re-run a year from now, which is the one thing a goal is
 *   for. On a workspace host the
 *   base is the remote the checkout was cut from, and a run in a project with
 *   no repository has no git at all: it is done when it left files in its
 *   `workspace/`, which the manager saves back to the project.
 *
 * The done-condition is the authority on completion, and the run record never
 * is. A harness that reports a clean finish and leaves no commit does not settle
 * its row (BR-14); one that reports a clean finish and commits does (BR-13).
 */

import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { basename, join } from "node:path";
import { ASK_MARKER_DIR, assertBaseRefExists, harnessFeatureOf } from "@flow-state-dev/harness-manager";
import type {
  CompletionRunContext,
  PhaseSpec,
  PromptRunContext,
  WorkspaceConfig,
} from "@flow-state-dev/harness-manager";
import { GIT_TIMEOUT_MS, run } from "@flow-state-dev/harness-manager/checkout";
import type { WorkspaceHost } from "@flow-state-dev/workspace";
import { runAcceptance } from "./acceptance.mts";
import type { WorkerOf } from "./worker-config.mts";

/** The phase segment of every run record's topic, and of every row filed here. */
export const PHASE = "implement";

/**
 * What {@link defineImplementPhase}'s `validate` learned, handed back to `isDone`:
 * the base ref of a fixed repository, or that runs come from a workspace host,
 * where each run's base is the remote it was cut from.
 */
type ValidatedWorkspace = { baseRef: string } | { host: true };

/**
 * Compose the prompt: the task first, then the worker that was woken.
 *
 * The task is the job, as the board handed it over (`run.task`): what a user
 * approved or posted, word for word. The worker's files are how this team works:
 * its instructions, its standing brief and its conventions. Where the two
 * disagree, the task wins, which is why it comes first. The run's terms close
 * it.
 *
 * Nothing else reaches the prompt: not the filing session, not the
 * environment.
 *
 * Exported because the honesty check grades the same prompt the gate does: one
 * builder, two harnesses, which is the only way "the prompt carried the worker's
 * own files" means the same thing in both halves.
 *
 * @param run What the manager hands a prompt builder for this attempt.
 * @param options The phase's options: how the run's worker is loaded, and
 *   whether acceptance decides.
 * @returns The prompt.
 * @throws If the worker declares a document it does not hold — a worker reading
 *   nothing is the silent pass this whole lab exists to refuse, so it is loud.
 */
export async function buildWorkerPrompt(
  run: PromptRunContext,
  options: ImplementPhaseOptions,
): Promise<string> {
  const { worker } = await workerSections(run, options.workerOf);

  return [
    ...(options.dropTask === true ? [] : taskSection(run.task)),
    ...worker,
    `# Where and how to work`,
    ``,
    `Row ${run.issue}, phase ${run.phase}, attempt ${run.attempt}.`,
    ...issueLine(run),
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
 * The prompt's sections out of the woken worker's own configuration: its
 * `WORKER.md` instructions, its standing brief and its conventions. Both
 * phases carry them, so a coder works the same way whichever board its task
 * came from.
 *
 * @throws If the worker declares a document it does not hold.
 */
async function workerSections(
  run: PromptRunContext,
  workerOf: WorkerOf,
): Promise<{ worker: string[] }> {
  const ctx = run.ctx;
  const { config } = await workerOf(ctx as never);

  const documentRef = config.document;
  if (documentRef === undefined) {
    throw new Error(
      `the worker handed row ${run.issue} declares no \`document:\`, so it has no brief to ` +
        `work from. Every worker on this flow names one file-declared document.`,
    );
  }
  const ref = ctx.resources[documentRef];
  if (ref === undefined) {
    throw new Error(
      `the worker handed row ${run.issue} names document "${documentRef}", which is not ` +
        `installed on its flow. Installed: ${Object.keys(ctx.resources).join(", ")}`,
    );
  }
  const brief = (await (ref as { readContent(): Promise<string | null> }).readContent()) ?? "";

  const skills = config.workerSkills ?? [];
  return {
    worker: [
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
    ],
  };
}

/**
 * The most of each of `deps` and `priorWork` a prompt carries, in characters of
 * its JSON. The task leads the prompt, so an uncapped dependency output would
 * push the worker's files and the run's terms toward the end of the context. The
 * goal and context are never capped: they are what a user wrote.
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
 * The issue the row's payload names, when the run's row id is not it: a
 * board that mints its own task ids runs a feature row under the minted id,
 * so without this line the prompt names the row and never the issue.
 */
function issueLine(run: PromptRunContext): string[] {
  const issue = harnessFeatureOf(run.task.input)?.issue;
  return issue !== undefined && issue !== run.issue ? [`Issue ${issue}.`] : [];
}

/**
 * The task's section, as the board packed it: the goal, then what the row adds.
 *
 * `input` is deliberately not rendered: this team's rows carry only
 * `{ harnessFeature: { issue, phase } }`, which the run's terms already name ({@link issueLine}
 * covers the one case where they don't).
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
 * Is there a commit on a host-provisioned checkout's branch that its remote
 * does not have?
 *
 * The host cuts the branch from a remote-tracking ref of its clone, so a
 * commit reachable from HEAD and from no remote-tracking ref is one the run
 * made. Read in the run's own checkout, like {@link hasNewCommit}.
 */
async function hasUnpushedCommit(workspacePath: string): Promise<boolean> {
  const { stdout } = await run("git", ["rev-list", "--count", "HEAD", "--not", "--remotes"], {
    cwd: workspacePath,
    timeoutMs: GIT_TIMEOUT_MS,
  });
  return Number.parseInt(stdout.trim(), 10) > 0;
}

/**
 * Does a run with no repository leave any of the project's files behind?
 *
 * Its working directory is the project's files (`workspace/`), saved back to
 * the project after the run, and there is no git to read a commit from. The
 * manager's own question directory is not the run's work.
 */
function leftFiles(workspacePath: string): boolean {
  const askRoot = ASK_MARKER_DIR.split(/[\\/]/)[0];
  return readdirSync(workspacePath).some((entry) => entry !== askRoot);
}

/**
 * What each files run's `workspace/` held when its harness started, by path.
 *
 * A run with no repository starts on the files earlier runs saved, so "it left
 * files" alone is true of a run that did nothing. Recorded by
 * {@link noteStartingFiles}, compared in the done-condition.
 */
const startingFiles = new Map<string, string>();

/**
 * Record what a run's `workspace/` holds as its harness starts. Wrap the
 * harness slot's `cwd` feed with it; a checkout of a repository is ignored,
 * since its done-condition reads git.
 */
export function noteStartingFiles(cwd: string): void {
  if (basename(cwd) === "workspace") startingFiles.set(cwd, filesFingerprint(cwd));
}

/** Every file under `dir` but the manager's question directory, as sorted path and content hash. */
function filesFingerprint(dir: string): string {
  const askRoot = ASK_MARKER_DIR.split(/[\\/]/)[0];
  const lines: string[] = [];
  const walk = (rel: string): void => {
    for (const entry of readdirSync(join(dir, rel), { withFileTypes: true })) {
      const path = rel === "" ? entry.name : `${rel}/${entry.name}`;
      if (rel === "" && entry.name === askRoot) continue;
      if (entry.isDirectory()) walk(path);
      else lines.push(`${path} ${createHash("sha256").update(readFileSync(join(dir, path))).digest("hex")}`);
    }
  };
  walk("");
  return lines.sort().join("\n");
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
 * problem rather than a charged attempt's: for a fixed repository it pins the
 * base ref this phase compares against and confirms the source repository
 * actually has it; for a workspace host it records that each run's base is
 * its own.
 */
export interface ImplementPhaseOptions {
  /** How a run loads the worker its session names: `workerOf(installation, CODER_FLOW)`. */
  workerOf: WorkerOf;
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
   * Control only: build the prompt without the task the manager handed over,
   * as the builder did before it led with it. The red state of "a run is
   * handed the work a user approved".
   */
  dropTask?: boolean;
}

/**
 * Build the implement phase.
 *
 * @param options `workerOf` to load the run's worker, `requireAcceptance` to add
 *   the brief's condition to the done-condition. See {@link ImplementPhaseOptions}.
 * @returns The phase spec to hand the coder worker flow.
 */
export function defineImplementPhase(options: ImplementPhaseOptions): PhaseSpec {
  return {
    phase: PHASE,
    buildPrompt: (run: PromptRunContext) => buildWorkerPrompt(run, options),
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
      if ("host" in validated) {
        // A host names the places it makes: `workspace/` for a run with no
        // repository, a checkout of the project's remote otherwise.
        if (basename(context.workspacePath) === "workspace") {
          // Files the run changed, not files an earlier run saved.
          if (!leftFiles(context.workspacePath)) return false;
          const before = startingFiles.get(context.workspacePath);
          if (before !== undefined && before === filesFingerprint(context.workspacePath)) return false;
        } else if (!(await hasUnpushedCommit(context.workspacePath))) {
          return false;
        }
      } else if (!(await hasNewCommit(context.workspacePath, validated.baseRef))) {
        return false;
      }
      if (options.requireAcceptance !== true) return true;

      // The requester's condition, run against the tree this attempt produced.
      // A rejection re-pends the row with the reason, exactly as any other
      // unfinished attempt does, so the retry budget still applies.
      return runAcceptance(context.workspacePath).accepted;
    },
    validate: (workspace: WorkspaceConfig | WorkspaceHost): ValidatedWorkspace => {
      // A workspace host has no one repository to check: each run's source
      // names its own, and the host refuses one it cannot reach before the
      // harness runs.
      if ("provision" in workspace) return { host: true };
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


/** The phase segment of an answer task's run record: a task a conversation filed naming no feature work. */
export const ANSWER_PHASE = "answer";

/** What the answer phase is built from. */
export interface AnswerPhaseOptions {
  /** How a run loads the worker its session names: `workerOf(installation, CODER_FLOW)`. */
  workerOf: WorkerOf;
}

/**
 * Compose an answer task's prompt: the task first, then the woken worker's
 * own instructions, brief and conventions, then what the run owes. An answer
 * task is a user's ask from a conversation, most often a question about the
 * code, so the run answers in its last message, and commits only when the
 * task asks for a change. It can ask the user back through its question
 * file, and the answers to what it asked come with the next attempt.
 *
 * @param run What the manager hands a prompt builder for this attempt.
 * @param options How the run's worker is loaded.
 * @returns The prompt.
 */
export async function buildAnswerPrompt(run: PromptRunContext, options: AnswerPhaseOptions): Promise<string> {
  const { worker } = await workerSections(run, options.workerOf);
  return [
    ...taskSection(run.task),
    ...worker,
    `# Where and how to work`,
    ``,
    `Task ${run.issue}, attempt ${run.attempt}.`,
    `Work in ${run.workspacePath}.`,
    `Answer in your last message: it is what the user who asked reads. Commit only if the ` +
      `task asks for a change.`,
    `If you can't go on without the user deciding something, write your question to ` +
      `${run.askMarkerPath} and stop.`,
    ...(run.answers.length === 0
      ? []
      : [
          "",
          `# Answers to your questions`,
          "",
          ...run.answers.map((answered) => `You asked: ${answered.question}\nThey answered: ${answered.answer}`),
        ]),
    ...(run.feedback === undefined ? [] : ["", `# Why the last attempt stopped`, "", run.feedback]),
  ].join("\n");
}

/**
 * Build the answer phase: the phase of a task that names no feature work
 * (no `harnessFeature`). Done means the run didn't stop at its limit and ended with an
 * answer; a commit is reported in the output, never required.
 *
 * @param options How the run's worker is loaded.
 * @returns The phase spec for the answer manager.
 */
export function defineAnswerPhase(options: AnswerPhaseOptions): PhaseSpec {
  return {
    phase: ANSWER_PHASE,
    buildPrompt: (run: PromptRunContext) => buildAnswerPrompt(run, options),
    isDone: (context: CompletionRunContext) =>
      context.stopReport !== "stopped-at-limit" && (context.answer ?? "").trim().length > 0,
  };
}
