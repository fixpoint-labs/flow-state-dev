/**
 * Consulting a conversation (FIX-2173): a worker answers a read-only question
 * from another of its user's conversations, without waking it.
 *
 * `consultSessionsCapability(installation)` puts `consultSessionHistory` on a
 * worker's turns: core's `utility.consultSessionHistoryTool`, which reads the
 * conversation's finished turns through the engine's session read (the user's
 * own sessions only) and answers on a cheaper model. Nothing lands in that
 * conversation, nothing runs there, and no message-log row is written.
 *
 * What it adds to core's tool is `of`, which names a conversation the way
 * `sendMessage`'s `to` does: a worker's id reads the user's existing
 * conversation with that worker (it never opens one), `{ task: id }` the
 * session that works the task, open or finished, and `{ session: id }` that
 * conversation whatever it runs. The checks that exist because a message runs
 * its target (a coding task still open, a task session addressed as a
 * conversation) don't apply to a read; the engine's owner rule does.
 *
 * Its one preset, `consult`, is off until a worker's own file names it:
 *
 * ```yaml
 * capabilities:
 *   consultSessions: [consult]
 * ```
 */
import { defineCapability, utility, type GeneratorConfig } from "@flow-state-dev/core";
import type { BlockContext } from "@flow-state-dev/core/types";
import { z } from "zod";
import { conversationLedgerResources } from "../conversation-board/ledger";
import type { WorkerInstallation } from "../workers/installation";
import { WORKER_ID_STATE_KEY } from "../workers/keys";
import { SEND_MESSAGE_TOOL } from "./keys";
import { taskSessionOf } from "./message-target";
import { messageHearingOf } from "./received-mark";
import { conversationAddress } from "./send-message";

/** The capability's name, as a worker file names it. */
export const CONSULT_SESSIONS_CAPABILITY = "consultSessions";
/** The tool's name, as the model calls it. */
export const CONSULT_SESSION_HISTORY_TOOL = "consultSessionHistory";

/** What the model passes. Strict: nothing else is taken. */
export const consultSessionHistoryInputSchema = z
  .object({
    of: z
      .union([
        z.string().min(1),
        z.object({ task: z.string().min(1) }).strict(),
        z.object({ session: z.string().min(1) }).strict()
      ])
      .describe(
        "Whose conversation to read: a worker's id, for the user's conversation with that worker; { task: id } for the " +
          "session that works a task; or { session: id } for one of the user's conversations, when the user gives you its id."
      ),
    question: z.string().min(1).max(2_000).describe("What to find out from that conversation.")
  })
  .strict();

const DESCRIPTION =
  "Read another conversation of the user's and answer a question from what it already holds: what the user told " +
  "another worker, what a task's session found along the way. It reads that conversation's finished turns on a " +
  "smaller model and returns a reading as of a time, not that worker's reply. The worker is not told, runs nothing " +
  `and doesn't change, so this only finds what was already said there. To have a worker act, decide, or learn something, use ${SEND_MESSAGE_TOOL}.`;

/** Options for {@link consultSessionsCapability}. */
export type ConsultSessionsOptions = {
  /** The model the answer runs on. Default `intent/utility`: the app's `models.intents.utility`. */
  model?: GeneratorConfig["model"];
  /** The hard cap on the history tokens one consult reads. Default 24,000. */
  budgetTokens?: number;
};

/** Where `of` reads, or why it can't. Each miss reads as `sendMessage`'s refusal where it has one. */
async function resolveOf(
  ctx: BlockContext,
  installation: WorkerInstallation,
  of: z.infer<typeof consultSessionHistoryInputSchema>["of"]
): Promise<{ ok: true; sessionId: string; of: unknown } | { ok: false; error: string }> {
  if (typeof of === "object" && "session" in of) return { ok: true, sessionId: of.session, of };
  if (typeof of === "object") {
    const found = await taskSessionOf(ctx, of.task);
    if (found === undefined) {
      return { ok: false, error: `no_task_session: no task "${of.task}" of yours has a session to read. A task that hasn't started has none.` };
    }
    return { ok: true, sessionId: found.sessionId, of };
  }
  const state = (ctx.session.state ?? {}) as Record<string, unknown>;
  if (of === state[WORKER_ID_STATE_KEY]) return { ok: false, error: "self: that is you; your own conversation is already yours." };
  const worker = await installation.rosterWorker(ctx as never, of);
  if (worker === undefined) return { ok: false, error: `no_worker: no worker "${of}" on your roster.` };
  if (messageHearingOf(installation.workerFlows()[worker.flow]?.flow) === "task-sessions") {
    return { ok: false, error: `no_conversation: "${of}" has no conversation with the user; read one of its tasks with of: { task: id }.` };
  }
  const address = await conversationAddress(ctx, installation, worker.id, worker.flow, state);
  // Read, never opened: a worker the user never spoke to has no session, and the read answers none.
  if ((await ctx.requestHost?.sessions?.read(address.sessionId)) === undefined) {
    return { ok: false, error: `no_conversation: the user has no conversation with "${of}" yet.` };
  }
  return { ok: true, sessionId: address.sessionId, of };
}

/**
 * The capability: `consultSessionHistory` on the turns of a worker whose own
 * file names `consultSessions: [consult]`.
 *
 * @example
 *   defineAgentWorkerFlow({ installation, model, uses: [consultSessionsCapability(installation)] });
 *   // and the app says what "cheaper" is, once:
 *   createFlowState({ flows, stores, models: { default: model, intents: { utility: ["openai/gpt-6-luna"] } } });
 */
export function consultSessionsCapability(installation: WorkerInstallation, options: ConsultSessionsOptions = {}) {
  const tool = utility.consultSessionHistoryTool({
    name: CONSULT_SESSION_HISTORY_TOOL,
    description: DESCRIPTION,
    ...(options.model !== undefined ? { model: options.model } : {}),
    ...(options.budgetTokens !== undefined ? { budgetTokens: options.budgetTokens } : {}),
    target: {
      inputSchema: consultSessionHistoryInputSchema,
      resolve: (input: z.infer<typeof consultSessionHistoryInputSchema>, ctx) => resolveOf(ctx, installation, input.of)
    }
  });
  return defineCapability({
    name: CONSULT_SESSIONS_CAPABILITY,
    // `{ task }` finds its row in the conversation ledger.
    resources: { ...installation.resources, ...conversationLedgerResources },
    presets: {
      consult: { tools: [tool] },
      default: []
    }
  });
}
