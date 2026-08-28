/**
 * The coordinator turn — the operator talks, this action files and wakes work.
 *
 * Slash verbs stay the direct door (`seed`, `wake`, `answer`). This is the
 * other door: a short model turn that sees the current board and may call
 * those same verbs as tools. It does not implement. Workers do.
 *
 * Context is the board snapshot from `status`, not a workstream transcript.
 * History is capped so this session cannot rot the way a mega-chat does.
 */

import { z } from "zod";

/** Input the operator (or the TUI) sends. */
export const steerInputSchema = z.object({
  message: z.string().min(1),
});

export type SteerInput = z.infer<typeof steerInputSchema>;

/** One board row as the coordinator is allowed to see it. */
export const coordinatorRowSchema = z.object({
  issue: z.string().nullable(),
  phase: z.string().nullable(),
  status: z.string(),
  attempts: z.number(),
  feedback: z.string().nullable(),
  outcome: z.string().nullable(),
  reason: z.string().nullable(),
  healed: z.array(z.string()).nullable(),
  questions: z.array(
    z.object({
      question: z.string(),
      text: z.string(),
    }),
  ),
});

/** What the coordinator generator receives after `status` is read. */
export const coordinatorInputSchema = z.object({
  message: z.string().min(1),
  rows: z.array(coordinatorRowSchema),
});

export type CoordinatorInput = z.infer<typeof coordinatorInputSchema>;
export type CoordinatorRow = z.infer<typeof coordinatorRowSchema>;

/**
 * Default coordinator model. Override with `CONDUCTOR_COORDINATOR_MODEL`.
 * Implement still goes through the Claude Code SDK; this is only the talk turn.
 */
export function coordinatorModelId(): string {
  const named = process.env.CONDUCTOR_COORDINATOR_MODEL;
  return named !== undefined && named !== "" ? named : "openai/gpt-5.4-mini";
}

/** How many prior coordinator turns stay in context. */
export const COORDINATOR_HISTORY_LIMIT = 8;

/**
 * Phase a talk-turn `seed_issue` should file.
 *
 * Models often pass `default` for an optional field. That is not a phase
 * this board runs, so treat it — and an empty string — as omitted.
 */
export function coordinatorPhase(
  supplied: string | undefined,
  boardPhase: string,
): string {
  const trimmed = supplied?.trim();
  if (trimmed === undefined || trimmed === "" || trimmed.toLowerCase() === "default") {
    return boardPhase;
  }
  return trimmed;
}

/**
 * The coordinator's job, stated as instructions the model cannot outgrow.
 *
 * It classifies and routes. It does not hold a workstream's transcript, edit
 * product code, or grant a spec. Failed setup that provisioning already heals
 * (a missing `.fsdev/` ignore) is a `wake_board`. A tracked question marker
 * is something a person has to remove — say so, do not invent a git rewrite.
 */
export const STEER_PROMPT = [
  "You are the conductor coordinator.",
  "You talk to the operator of this epic's board.",
  "You do not implement, review diffs, or edit product code.",
  "Coding workers do that after you file or wake a row.",
  "",
  "The <board> snapshot is the truth. Open questions and failed rows are what you act on.",
  "Use tools when the operator wants work started, retried, or a question answered.",
  "If they only asked what is on the board, answer from <board> and do not wake anything.",
  "",
  "seed_issue — file an issue-phase and start a worker. When the operator already said what the ticket is, pass that as brief so attempt 1 has it. Omit phase unless they named one. Never pass default.",
  "wake_board — claim pending or failed rows and start or retry their workers.",
  "answer_question — reply to one open question (use the question id verbatim) and resume that worker.",
  "",
  "A missing .fsdev ignore is already healed on the work branch when a worker starts. Wake those rows.",
  "A question file that is already tracked cannot be healed here. Tell the operator to remove it.",
  "Stay short. Say what you did, or what you need from them.",
].join("\n");

/**
 * Project a `status` row down to what the coordinator may see.
 *
 * Status carries checkout paths, session ids, and token counts. Those belong
 * on the board the operator is already looking at. Putting them here would
 * grow the talk turn toward a workstream transcript.
 */
export function projectCoordinatorRow(row: {
  issue: string | null;
  phase: string | null;
  status: string;
  attempts: number;
  feedback: string | null;
  run?: {
    outcome?: string | null;
    reason?: string | null;
    healed?: string[] | null;
  } | null;
  questions: ReadonlyArray<{ question: string; text: string }>;
}): CoordinatorRow {
  return {
    issue: row.issue,
    phase: row.phase,
    status: row.status,
    attempts: row.attempts,
    feedback: row.feedback,
    outcome: row.run?.outcome ?? null,
    reason: row.run?.reason ?? null,
    healed: row.run?.healed ?? null,
    questions: row.questions.map((q) => ({ question: q.question, text: q.text })),
  };
}

/** Render the board snapshot the coordinator reasons over. */
export function formatCoordinatorBoard(rows: readonly CoordinatorRow[]): string {
  if (rows.length === 0) {
    return "No rows. The operator has not filed an issue-phase yet.";
  }
  const lines: string[] = [];
  for (const row of rows) {
    const name = row.issue ?? "(unnamed)";
    const phase = row.phase ?? "?";
    lines.push(`${name}  ${phase}  ${row.status}  attempt ${row.attempts}`);
    if (row.outcome != null) lines.push(`  outcome: ${row.outcome}`);
    if (row.reason != null && row.reason !== "") lines.push(`  reason: ${row.reason}`);
    if (row.feedback != null && row.feedback !== "") lines.push(`  feedback: ${row.feedback}`);
    if (row.healed != null) {
      for (const heal of row.healed) lines.push(`  healed: ${heal}`);
    }
    for (const q of row.questions) {
      lines.push(`  question ${q.question}: ${q.text}`);
    }
  }
  return lines.join("\n");
}
