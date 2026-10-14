/**
 * `messageWorker` (FIX-1989), composed onto a worker turn. No `wait`: an
 * answer arrives later as its own line. The description is rebuilt each
 * turn from roster workers that have a conversation.
 */
import { defineCapability, handler } from "@flow-state-dev/core";
import type { BlockContext } from "@flow-state-dev/core/types";
import { z } from "zod";
import type { WorkerInstallation } from "../workers/installation";
import { WORKER_ID_STATE_KEY } from "../workers/keys";
import { messageTurnStateSchema } from "./hop";
import { MESSAGE_WORKER_TOOL } from "./keys";
import { MAX_MESSAGE_CHARS, workerMessagesResources } from "./message-log";
import { sendWorkerMessage, takesWorkerMessages } from "./send-message";

/** The most workers the description lists, and the longest description it quotes for one. */
const MAX_LISTED = 25;
const MAX_DESCRIPTION = 160;

/** What the model passes. Strict: nothing else is taken. */
export const messageWorkerInputSchema = z
  .object({
    to: z.string().min(1).describe("The id of the worker to message, as the list below names it."),
    text: z.string().min(1).max(MAX_MESSAGE_CHARS).describe("What to say."),
    replyTo: z
      .string()
      .min(1)
      .optional()
      .describe("When this answers a message, that message's id (it starts msg_). Leave it out to start a new one.")
  })
  .strict();

export const messageWorkerOutputSchema = z.union([
  z.object({ sent: z.string(), unconfirmed: z.string().optional() }),
  z.object({ ok: z.literal(false), error: z.string() })
]);

const BASE_DESCRIPTION =
  "Send a short message to another worker on your team: a question, an FYI, a heads-up. It lands in that worker's " +
  "conversation and wakes it. This is not a task: nothing is filed and no result is owed, and you don't wait for an " +
  "answer. If it answers, the answer arrives later as a line from that worker and wakes you. To answer a message " +
  "you were sent, pass its id as replyTo.";

/** Who the running worker can message, as the description's list. */
async function recipientsLine(ctx: BlockContext, installation: WorkerInstallation): Promise<string> {
  const self = (ctx.session.state as Record<string, unknown> | undefined)?.[WORKER_ID_STATE_KEY];
  const flows = installation.workerFlows();
  const listed = (await installation.roster(ctx as never))
    .filter((worker) => worker.id !== self && worker.problem === undefined && takesWorkerMessages(flows[worker.flow]?.flow))
    .slice(0, MAX_LISTED)
    .map((worker) => {
      const description = (worker.description ?? "").replace(/\s+/g, " ").trim();
      const short = description.length > MAX_DESCRIPTION ? `${description.slice(0, MAX_DESCRIPTION - 1)}…` : description;
      return `- ${worker.id}${short === "" ? "" : `: ${short}`}`;
    });
  return listed.length === 0 ? "\n\nNo other worker on your roster can be messaged now." : `\n\nWorkers you can message:\n${listed.join("\n")}`;
}

/**
 * The capability: `messageWorker` on every turn of a session that runs a
 * worker. `controlTools`, so a worker's `tools:` line doesn't fence it out.
 *
 * @param flowKind The flow the sessions run on: where an answer comes back.
 */
export function defineMessageWorkerCapability(installation: WorkerInstallation, flowKind: string) {
  const toolWith = (description: string) =>
    handler({
      name: MESSAGE_WORKER_TOOL,
      description,
      inputSchema: messageWorkerInputSchema,
      outputSchema: messageWorkerOutputSchema,
      requestStateSchema: messageTurnStateSchema,
      resources: { ...installation.resources, ...workerMessagesResources },
      execute: async (input, ctx) => {
        const sent = await sendWorkerMessage(ctx as never, installation, flowKind, input, MESSAGE_WORKER_TOOL);
        if (!sent.ok) return { ok: false as const, error: sent.error };
        return sent.unconfirmed === undefined ? { sent: sent.id } : { sent: sent.id, unconfirmed: sent.unconfirmed };
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
          const description = BASE_DESCRIPTION + (await recipientsLine(ctx as never, installation));
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
