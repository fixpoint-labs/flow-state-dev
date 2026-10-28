/**
 * `sendMessage` (FIX-1989): the tool a worker's model sends a message with,
 * as one capability a worker turn composes. Talk, not delegation: no task
 * row, no delegate, no result owed.
 *
 * Its input is strict (`to`, `text`, `inReplyTo`), so a call can't name a
 * sender or a hop count, and a session only as a target the server checks
 * (FIX-2160), and there is no `wait`: an answer arrives
 * later as a message of the recipient's own and wakes this worker. Its description
 * lists who the worker can message, read before each model call: the roster's
 * workers that have a conversation, by id and description.
 */
import { defineCapability, handler } from "@flow-state-dev/core";
import type { BlockContext } from "@flow-state-dev/core/types";
import { z } from "zod";
import type { WorkerInstallation } from "../workers/installation";
import { WORKER_ID_STATE_KEY } from "../workers/keys";
import { messageTurnStateSchema } from "./hop";
import { SEND_MESSAGE_TOOL } from "./keys";
import { MAX_MESSAGE_CHARS, workerMessagesResources } from "./message-log";
import { conversationLedgerResources } from "../conversation-board/ledger";
import { recipientRefusal, sendMessage } from "./send-message";

/** The most workers the description lists, and the longest description it quotes for one. */
const MAX_LISTED = 25;
const MAX_DESCRIPTION = 160;

/** What the model passes. Strict: nothing else is taken. */
export const sendMessageInputSchema = z
  .object({
    to: z
      .union([
        z.string().min(1),
        z.object({ task: z.string().min(1) }).strict(),
        z.object({ session: z.string().min(1) }).strict()
      ])
      .describe(
        "Who to message: a worker's id, as the list below names it; { task: id } for the session that works a task; " +
          "or { session: id } for one of the user's conversations, when the user gives you its id."
      ),
    // Something other than blank space: the send refuses a blank message too.
    text: z.string().max(MAX_MESSAGE_CHARS).regex(/\S/, "say something").describe("What to say."),
    inReplyTo: z
      .string()
      .min(1)
      .optional()
      .describe("When this answers a message, that message's id (it starts msg_). Leave it out to start a new one.")
  })
  .strict();

const sendMessageOutputSchema = z.union([
  z.object({ sent: z.string() }),
  z.object({ ok: z.literal(false), error: z.string() })
]);

const BASE_DESCRIPTION =
  "Send a short message to another worker on your team: a question, an FYI, a heads-up. It lands in that worker's " +
  "conversation and wakes it. This is not a task: nothing is filed and no result is owed, and you don't wait for an " +
  "answer. If it answers, it sends you a message of its own, which wakes you. To answer a message " +
  "you were sent, pass its id as inReplyTo. A message can't be waited on: to wait on a colleague's result before " +
  "you answer, file a task for them with createTask, then call getTask({ id, wait: true }) where getTask takes wait. " +
  "To ask about a task, send to { task: id }: it lands in the session working that task, after its current turn, " +
  "and doesn't change the task. To reach a conversation the user named, send to { session: id }.";

/** Who the running worker can message, as the description's list: every roster worker the send would take. */
async function recipientsLine(ctx: BlockContext, installation: WorkerInstallation, self: string): Promise<string> {
  const roster = await installation.roster(ctx as never);
  const listed = roster
    .filter((worker) => recipientRefusal(installation, self, worker.id, worker) === undefined)
    .slice(0, MAX_LISTED)
    .map((worker) => {
      const description = (worker.description ?? "").replace(/\s+/g, " ").trim();
      const short = description.length > MAX_DESCRIPTION ? `${description.slice(0, MAX_DESCRIPTION - 1)}…` : description;
      return `- ${worker.id}${short === "" ? "" : `: ${short}`}`;
    });
  return listed.length === 0 ? "\n\nNo other worker on your roster can be messaged now." : `\n\nWorkers you can message:\n${listed.join("\n")}`;
}

/**
 * The capability: `sendMessage` on every turn of a session that runs a
 * worker. `controlTools`, so a worker's `tools:` line doesn't fence it out.
 *
 * @param flowKind The flow the sessions run on: where an answer comes back.
 */
export function defineSendMessageCapability(installation: WorkerInstallation, flowKind: string) {
  const toolWith = (description: string) =>
    handler({
      name: SEND_MESSAGE_TOOL,
      description,
      inputSchema: sendMessageInputSchema,
      outputSchema: sendMessageOutputSchema,
      requestStateSchema: messageTurnStateSchema,
      // The conversation ledger finds a `{ task }` target's row by id (FIX-2160).
      resources: { ...installation.resources, ...workerMessagesResources, ...conversationLedgerResources },
      execute: async (input, ctx) => {
        const sent = await sendMessage(ctx as never, installation, flowKind, input, SEND_MESSAGE_TOOL);
        if (!sent.ok) return { ok: false as const, error: sent.error };
        return { sent: sent.id };
      }
    });
  // One tool per distinct list, so a roster that doesn't change keeps one block.
  const built = new Map<string, ReturnType<typeof toolWith>>();
  return defineCapability({
    name: "workerMessages",
    resources: { ...workerMessagesResources },
    presets: {
      tools: {
        controlTools: async (ctx) => {
          const self = (ctx.session.state as Record<string, unknown> | undefined)?.[WORKER_ID_STATE_KEY];
          if (typeof self !== "string") return [];
          const description = BASE_DESCRIPTION + (await recipientsLine(ctx as never, installation, self));
          let tool = built.get(description);
          if (tool === undefined) {
            if (built.size > 64) built.clear();
            tool = toolWith(description);
            built.set(description, tool);
          }
          return [tool];
        }
      },
      default: ["tools"]
    }
  });
}
