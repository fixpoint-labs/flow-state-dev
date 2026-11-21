/**
 * `codingBrief`: the one brief a coding run starts from, whatever app hands it
 * the task and whichever harness runs it.
 *
 * It is the task prompt, not a harness's system prompt, so Codex and Cursor
 * read it as Claude Code does. The task leads: where the app's parts disagree
 * with it, the task wins. Then the app's own parts (the worker's
 * instructions, a standing brief, conventions), where and how to work, what
 * the run was answered, the report it owes, and why the last attempt stopped.
 *
 * The checks a run is held to are not a part: `commandCheck`'s `inBrief`
 * adds them from the list it runs, so the brief can't name a check that
 * doesn't run.
 *
 * ```ts
 * const phase = commandCheck(
 *   { phase: "code", buildPrompt: (run) => codingBrief(run, { instructions }), isDone },
 *   { commands: projectChecks(), timeoutMs, inBrief: true },
 * );
 * ```
 */
import { harnessFeatureOf, type PromptRunContext } from "./manager";
import { RUN_REPORT_ASK } from "./run-report";

/** What an app puts in a coding brief beside the task. Every part is optional. */
export interface CodingBriefParts {
  /** The worker's own instructions: its `WORKER.md` body. */
  instructions?: string;
  /** A document the worker works from, by its name. */
  standingBrief?: { name: string; text: string };
  /** How this team works. Absent: one line pointing at the repository's `AGENTS.md` or `CLAUDE.md`. */
  conventions?: string;
  /** The app's own terms, under where and how to work: what counts as done, how to ask. */
  terms?: readonly string[];
  /**
   * `false` leaves out the report of changes and checks: for a run whose last
   * message is the answer the user reads, and which no check follows. Default: on.
   */
  report?: false;
}

/** The conventions line when the app hands none. The helper reads no file. */
const DEFAULT_CONVENTIONS =
  "Follow the repository's own conventions: read its AGENTS.md or CLAUDE.md first, if it has one.";

/**
 * The most of each of `deps` and `priorWork` a brief carries, in characters of
 * its JSON, so a large dependency output can't push the rest of the brief
 * toward the end of the context. The goal and context are never capped: they
 * are what a person wrote.
 */
const MAX_TASK_OUTPUT_CHARS = 4_000;

/** `value` as indented JSON, cut at {@link MAX_TASK_OUTPUT_CHARS} with a visible marker. */
function cappedJson(value: unknown): string {
  const text = JSON.stringify(value, null, 2);
  if (text.length <= MAX_TASK_OUTPUT_CHARS) return text;
  return `${text.slice(0, MAX_TASK_OUTPUT_CHARS)}\n[truncated: ${text.length - MAX_TASK_OUTPUT_CHARS} more characters]`;
}

/** A section: a heading and its body, or nothing when the body is empty. */
function section(heading: string, body: string | undefined): string[] {
  const text = body?.trim() ?? "";
  return text === "" ? [] : [`# ${heading}`, "", text, ""];
}

/**
 * The brief for one attempt of a coding run.
 *
 * @param run What the manager hands a prompt builder.
 * @param parts The app's own parts.
 * @returns The prompt.
 */
export function codingBrief(run: PromptRunContext, parts: CodingBriefParts): string {
  const { task } = run;
  // A board that mints its own row ids runs a feature row under the minted id, so name the issue too.
  const issue = harnessFeatureOf(task.input)?.issue;
  return [
    `# Your task`,
    ``,
    ...(task.title === undefined ? [] : [task.title, ``]),
    task.goal.trim(),
    ``,
    ...(task.context === undefined ? [] : [task.context.trim(), ``]),
    ...(task.deps === undefined ? [] : [`What the tasks this one depends on produced:`, ``, cappedJson(task.deps), ``]),
    ...(task.priorWork === undefined ? [] : [`What earlier tasks on this board found:`, ``, cappedJson(task.priorWork), ``]),
    ...section("Your instructions", parts.instructions),
    ...(parts.standingBrief === undefined
      ? []
      : section(`Your team's standing brief (${parts.standingBrief.name})`, parts.standingBrief.text)),
    ...section("Your team's conventions", parts.conventions ?? DEFAULT_CONVENTIONS),
    `# Where and how to work`,
    ``,
    `Task ${run.issue}, phase ${run.phase}, attempt ${run.attempt}.`,
    ...(issue !== undefined && issue !== run.issue ? [`Issue ${issue}.`] : []),
    run.branch === "" ? `Work in ${run.workspacePath}.` : `Work in ${run.workspacePath}, on branch ${run.branch}.`,
    ...(parts.terms ?? []),
    ``,
    ...(run.answers.length === 0
      ? []
      : [
          `# Answers to your questions`,
          ``,
          ...run.answers.map((answered) => `You asked: ${answered.question}\nThey answered: ${answered.answer}`),
          ``,
        ]),
    ...(parts.report === false ? [] : [`# Your report`, ``, RUN_REPORT_ASK]),
    ...(run.feedback === undefined ? [] : [``, `# Why the last attempt stopped`, ``, run.feedback]),
  ].join("\n");
}
