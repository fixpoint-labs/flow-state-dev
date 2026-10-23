/**
 * A routed task's brief (FIX-2083): what a coordinator attaches to each task
 * it files for a message it routes, and how the delegate's turn reads it.
 *
 * A routed task is an ordinary task on the conversation's board with three
 * settings (`session: "ongoing"`, `resultTo: "conversation"`, one attempt),
 * worked on the delegate's `work` entry. Its brief rides the task's
 * server-written payload (`Task.sealed`), written only by the coordinator's
 * filing step: the message as written, who wrote it, the coordinator, the
 * conversation's recent lines, and the message and round it was routed in.
 * No caller and no model writes it, so a delegate reads the words its user
 * wrote, never a paraphrase (FIX-1872 D2, kept).
 *
 * A post row stored before FIX-2083 carries the same fields in its payload,
 * so its brief reads the same way (the task map reads the rest of the row).
 *
 * **The lines.** The `work` entry notes a brief's lines for its request
 * ({@link noteRoutedLines}), and {@link routedTaskHistory} hands them to the
 * turn's model as one user-role message just before the message, on that turn
 * only. They are data from the conversation, never system text, so a line
 * written like an instruction carries no more authority than the message
 * itself. They are never the turn's stored message either, so the delegate's
 * own conversation never keeps them.
 */
import { handler } from "@flow-state-dev/core";
import type { BlockContext, LLMMessage } from "@flow-state-dev/core/types";
import { z } from "zod";
import { delegateRefSchema } from "../delegates/delegate-list";
import { conversationLineSchema, type ConversationLine } from "./coordinator-lines";

/** A routed task's brief: server-written, in `Task.sealed`. */
export const routedBriefSchema = z.object({
  /** The message as written: the user's, or the answers going back out in a later round. */
  body: z.string(),
  /** Who wrote it: the conversation's user, or the delegates whose answers it passes on. */
  from: z.string(),
  /** The coordinator it came through: its worker id. */
  coordinator: z.string(),
  /** The conversation's recent lines before the message, oldest first. Present only when there are any. */
  recent: z.array(conversationLineSchema).optional(),
  /** The user's message this hands on, by the request that routed it. Answers going back out keep its id. */
  postId: z.string().min(1),
  /** The round it was routed in: 0 for a user's message. */
  round: z.number().int().min(0),
  /** The delegate record it went to. */
  delegate: delegateRefSchema,
  /**
   * The judgment turn's tool call that filed it, by its logical id, so a
   * replay of that call finds its own task. Absent on a policy's filing.
   */
  call: z.string().optional()
});

export type RoutedBrief = z.infer<typeof routedBriefSchema>;

/** A task's brief, when its payload carries one that reads; `undefined` for any other task. */
export function routedBriefOf(task: { readonly sealed?: Readonly<Record<string, unknown>> } | undefined): RoutedBrief | undefined {
  if (task?.sealed === undefined) return undefined;
  const parsed = routedBriefSchema.safeParse(task.sealed);
  return parsed.success ? parsed.data : undefined;
}

/**
 * Whether a routed task was filed by the judgment turn's own `createTask`
 * (its brief names the call), so that turn is its filer and hears its failure
 * (FIX-2115). A policy's filing, and a post row stored before FIX-2083, name
 * none.
 */
export function filedByTurn(brief: RoutedBrief | undefined): boolean {
  return brief?.call !== undefined;
}

/** The message as the brief says it: who wrote it, through whom, and what it says. */
function said(brief: RoutedBrief): string {
  return `${brief.from}, through ${brief.coordinator}: ${brief.body}`;
}

/**
 * A routed task as its delegate's turn reads it: the message as written, and
 * the goal its filer gave beside it when the goal says more than the message
 * (a judgment coordinator's own brief).
 */
export function routedMessage(brief: RoutedBrief, goal: string): string {
  const message = said(brief);
  const own = goal.trim();
  // A policy files the message as its goal; a post row stored before FIX-2083 filed this very line.
  if (own === "" || own === brief.body.trim() || own === message.trim()) return message;
  return `${message}\n\nYour task: ${goal}`;
}

/** Request state: the lines of the routed task this request works, noted before its turn. */
const ROUTED_LINES_STATE = "routedLines";

const routedLinesStateSchema = z.object({
  [ROUTED_LINES_STATE]: z.object({ coordinator: z.string(), recent: z.array(conversationLineSchema) }).optional()
});

/**
 * Note the lines a routed task's brief carries, for the request working it:
 * a step before the turn on the `work` entry. Nothing for any other task.
 */
export const noteRoutedLines = handler({
  name: "routed-task-note-lines",
  inputSchema: z.unknown(),
  outputSchema: z.object({}),
  requestStateSchema: routedLinesStateSchema,
  execute: async (task: unknown, ctx) => {
    const brief = routedBriefOf(task as { sealed?: Record<string, unknown> });
    if (brief?.recent === undefined || brief.recent.length === 0) return {};
    await ctx.request.patchState({ [ROUTED_LINES_STATE]: { coordinator: brief.coordinator, recent: brief.recent } });
    return {};
  }
});

/**
 * The lines as the turn's model reads them: one user-role message,
 * `Recent lines in the conversation with <coordinator> before this message,
 * oldest first:` and then `- <from>: <text>` per line. `undefined` on any
 * other turn and on a routed task with no lines.
 */
function routedLinesMessage(ctx: { readonly request: { readonly state: unknown } }): LLMMessage | undefined {
  const noted = (ctx.request.state as z.infer<typeof routedLinesStateSchema> | undefined)?.[ROUTED_LINES_STATE];
  const recent: readonly ConversationLine[] = noted?.recent ?? [];
  if (noted === undefined || recent.length === 0) return undefined;
  return {
    role: "user",
    content: [
      `Recent lines in the conversation with ${noted.coordinator} before this message, oldest first:`,
      ...recent.map((line) => `- ${line.from}: ${line.text}`)
    ].join("\n")
  };
}

/**
 * A generator's `history` for a turn that may work a routed task: the
 * session's history, as `history: true` reads it, with the brief's lines as
 * one user-role message between the earlier turns and this turn's own items,
 * so just before the message. Resolved for each model call and never stored;
 * on any other turn, and on a routed task with no lines, it is the session's
 * history unchanged. The built-in `agent` flow's turn uses it; a flow of
 * your own whose `work` turn is a generator passes it as that generator's
 * `history` to show its model the same lines.
 */
export async function routedTaskHistory(_input: unknown, ctx: BlockContext): Promise<LLMMessage[]> {
  const lines = routedLinesMessage(ctx);
  const history = await ctx.session.items.history();
  if (lines === undefined) return history;
  // `history()` is the earlier turns with this request's own items after them.
  const earlier = await ctx.session.items.history({ includeInFlight: false });
  return [...history.slice(0, earlier.length), lines, ...history.slice(earlier.length)];
}
