/**
 * `sendMessage` (FIX-1989): the tool a worker's model sends a message with,
 * as one capability a worker turn composes. Talk, not delegation: no task
 * row, no delegate, no result owed.
 *
 * Its input is strict (`to`, `text`, `inReplyTo`, `replyRequested`, `wait`,
 * `deadline`), so a send can't name a sender or a hop count, and a session
 * only as a target the server checks (FIX-2160). One contract for getting an
 * answer (FIX-2318): `replyRequested: true` asks for a reply (FIX-2310,
 * `./owed-replies`), and one answer is owed and always comes, the recipient's
 * or a "no answer", as a message that wakes this worker. `wait: true` asks
 * the same way and waits for that answer in this request until the deadline
 * (`./wait-for-reply`): given in time, it is the tool's result and no message;
 * after, it comes as a message. A plain send owes nothing: an answer, if any,
 * is the recipient's own message. Its description lists who the worker can
 * message, read before each model call: the roster's workers that have a
 * conversation, by id and description.
 */
import { defineCapability, handler } from "@flow-state-dev/core";
import type { BlockContext } from "@flow-state-dev/core/types";
import { z } from "zod";
import type { WorkerInstallation } from "../workers/installation";
import { WORKER_ID_STATE_KEY } from "../workers/keys";
import { messageTurnStateSchema } from "./hop";
import { SEND_MESSAGE_TOOL, SENDS_MESSAGES_MARK } from "./keys";
import { MAX_MESSAGE_CHARS, workerMessagesResources } from "./message-log";
import { conversationLedgerResources } from "../conversation-board/ledger";
import { sendMessage } from "./send-message";
import { workerRecipients } from "./recipients";
import { sendAndWaitForReply, type WaitOutcome } from "./wait-for-reply";

/** The longest description the list quotes for one worker. */
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
      .describe("When this answers a message, that message's id (it starts msg_). Leave it out to start a new one."),
    replyRequested: z
      .boolean()
      .optional()
      .describe("true to ask for a reply and go on: the answer comes back to you later as a message, and always comes."),
    wait: z
      .boolean()
      .optional()
      .describe(
        "true to ask for a reply and wait for it: it comes back as this tool's result, in this turn, until the deadline. " +
          "After the deadline it comes back as a message instead. Needs no replyRequested."
      ),
    deadline: z
      .number()
      .int()
      .positive()
      .optional()
      .describe("With wait: how long to wait, in milliseconds. The host's default when left out.")
  })
  .strict();

/** A waited send's result (FIX-2318): the answer, or `running` at the deadline, or why it failed. */
const waitResultSchema = z.object({
  status: z.enum(["answered", "running", "failed"]),
  sent: z.string(),
  reply: z.string().optional(),
  /** The answer is the framework's "no answer": the recipient's turn gave none. */
  noAnswer: z.literal(true).optional(),
  error: z.string().optional(),
  /** Why the answer isn't in yet: the recipient waits on the user (epic D3). */
  recipient: z.literal("waiting_on_person").optional()
});

const sendMessageOutputSchema = z.union([
  waitResultSchema,
  z.object({ sent: z.string() }),
  z.object({ ok: z.literal(false), error: z.string() })
]);

/** What the tool answers for a waited send: a refusal reads as any send's. */
function waitAnswer(outcome: WaitOutcome) {
  return "ok" in outcome ? { ok: false as const, error: outcome.error } : outcome;
}

const BASE_DESCRIPTION =
  "Send a short message to another worker on your team: a question, an FYI, a heads-up. It lands in that worker's " +
  "conversation and wakes it. This is not a task: nothing is filed and no result is owed. If it answers, it sends " +
  "you a message of its own, which wakes you. To answer a message you were sent, pass its id as inReplyTo. " +
  "To ask and go on, pass replyRequested: true: the answer comes back to you later as a message from that worker, " +
  "and always comes, even if it is that it has no answer. Ask several workers this way in one step. " +
  "To get the answer in this turn, pass wait: true instead. It asks the same way, and the answer comes back as this tool's result " +
  "({ status: \"answered\", reply }, cut to 8,000 characters), in this turn. If the deadline passes first, you get { status: \"running\" } " +
  "and nothing is stopped: go on, and the answer comes back to you later as a message; never send the question " +
  "again. One wait per step, so to ask several workers, use replyRequested instead. For work someone owes you, file a task with createTask. " +
  "To ask about a task, send to { task: id }: it lands in the session working that task, after its current turn, " +
  "and doesn't change the task. To reach a conversation the user named, send to { session: id }. " +
  "If you have consultSessionHistory, a question about what a conversation already holds goes there instead: it " +
  "reads without waking anyone. A message is for asking a worker to act, decide, or use what it knows.";

/** Who the running worker can message, as the description's list: every roster worker the send would take. */
async function recipientsLine(ctx: BlockContext, installation: WorkerInstallation, self: string): Promise<string> {
  const { messageable } = await workerRecipients(ctx, installation, self);
  const listed = messageable.map((worker) => {
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
        const { to, text, inReplyTo, replyRequested, wait, deadline } = input;
        const message = { to, text, ...(inReplyTo === undefined ? {} : { inReplyTo }) };
        if (wait === true) {
          return waitAnswer(
            await sendAndWaitForReply(ctx as never, installation, flowKind, { ...message, ...(deadline === undefined ? {} : { deadline }) }, SEND_MESSAGE_TOOL)
          );
        }
        if (deadline !== undefined) {
          return { ok: false as const, error: "deadline_without_wait: a deadline goes with wait: true. Nothing was sent." };
        }
        const sent = await sendMessage(ctx as never, installation, flowKind, message, SEND_MESSAGE_TOOL, replyRequested === true ? { replyRequested: {} } : {});
        if (!sent.ok) return { ok: false as const, error: sent.error };
        return { sent: sent.id };
      }
    });
  // One tool per distinct list, so a roster that doesn't change keeps one block.
  const built = new Map<string, ReturnType<typeof toolWith>>();
  const capability = defineCapability({
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
  // The hire reads it: a flow that offers the tool must carry the pass that resends (FIX-2271).
  (capability as unknown as Record<symbol, true>)[SENDS_MESSAGES_MARK] = true;
  return capability;
}
