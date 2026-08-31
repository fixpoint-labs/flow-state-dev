/**
 * The model-facing surface for sending a message to another session (FIX-1230).
 *
 * `RequestHost.sendMessage` is programmatic and request-wide, so it scopes
 * nothing: a generator either has it or the flow does not use it. This factory is
 * the declaration point — an author puts it in **one generator's** `tools`, and
 * that is what makes "this agent may message other sessions, and no other agent
 * in this flow may" a fact about the declaration rather than a hope.
 *
 * ## It is a thin surface over the verb, deliberately
 *
 * Every guard — the recipient's identity, the flow boundary, the two-axis door,
 * the sender's own addressability — lives at `sendMessage` and not here. A guard
 * added at the tool is a guard the verb's other callers skip, so this file adds
 * none, and the model reads the same result union a programmatic caller does. A
 * refusal comes back as a value the model can act on, not as a thrown tool error
 * it can only retry blindly.
 *
 * That is also why the input schema types `timeoutMs` as a plain number and does
 * **not** range-check it: a tool's schema failure throws before the handler runs
 * and reaches the model as a parse error, while the verb returns a readable
 * `invalid-timeout` the model can correct. One contract for both callers.
 *
 * ## What it does add: safe composition with the flow's tool defaults
 *
 * `flow.tools.defaults` wraps every tool run in a retry around a timeout, and the
 * timeout rejects on its timer **without cancelling the underlying promise**. So
 * a default shorter than a send's acceptance lets the retry start a second send
 * while the first is still live, and the recipient gets the message twice —
 * silently, under a configuration nobody set on purpose. One message, one
 * recipient is the whole point of the feature, so the factory declares its own
 * timeout and retry to close that, and every other tool in the generator keeps
 * the flow defaults.
 */
import { z } from "zod";
import { handler } from "../blocks/handler";
import { requireRequestHost } from "../types/request-host";
import type { SendMessageResult } from "../types/relay-results";

/**
 * Descriptions the model reads. Kept here rather than inline so the shape of the
 * tool and the words it is understood by are edited together.
 */
const sendMessageToolDescription =
  "Send a message to another session by its id. Use this to ask a question of, " +
  "or report progress to, a session you were given the address of. The message " +
  "arrives there as a new request; this call returns as soon as the system has " +
  "accepted it, not when it has been handled. If the result has ok: false, read " +
  "`refused` — it names why, and retrying without changing anything will be " +
  "refused the same way.";

export type RelaySendToolOptions = {
  /**
   * The tool's name as the model sees it. Defaults to `sendMessage`.
   *
   * Worth setting when the flow's vocabulary calls it something else — a
   * coordinator's agent may read `notifyWorker` more naturally — since a model
   * picks tools by name and description before it reads any schema.
   */
  name?: string;
  /** Overrides the default description. */
  description?: string;
};

/**
 * Build the tool an author adds to a generator's `tools` so its model can send
 * messages to other sessions.
 *
 * @param options Optional name and description overrides.
 *
 * @example
 * ```ts
 * const coordinator = generator({
 *   name: "coordinator",
 *   model: "openai/gpt-5.4-mini",
 *   tools: [relaySendTool()]
 * })
 * ```
 */
export function relaySendTool(options: RelaySendToolOptions = {}) {
  return handler({
    name: options.name ?? "sendMessage",
    description: options.description ?? sendMessageToolDescription,
    inputSchema: z.object({
      to: z.string().describe("The recipient session's id."),
      kind: z
        .string()
        .describe(
          "Which message this is. The recipient decides what it accepts; an " +
            "unrecognized kind is refused rather than delivered."
        ),
      payload: z
        .unknown()
        .optional()
        .describe("The message body. Shape it the way the recipient expects."),
      timeoutMs: z
        .number()
        .optional()
        .describe(
          "Ignored today — this tool sends and returns without waiting for a reply."
        )
    }),
    // "This tool's own clock governs." `withTimeout` returns the promise
    // untouched at 0, so the flow's default cannot fire mid-send. Without it a
    // short default rejects while the send is still live — see the file header
    // for why that is a duplicate rather than a slow call.
    timeoutMs: 0,
    // And "never retry", which is the other half. A retry around a send with a
    // side effect is a second delivery, and the flow default is exactly where one
    // arrives without anyone choosing it.
    retry: { maxAttempts: 1 },
    execute: async (input, ctx): Promise<SendMessageResult> =>
      requireRequestHost(ctx).sendMessage({
        to: input.to,
        kind: input.kind,
        payload: input.payload,
        // The tool exposes fire-and-forget only. A blocking send parks the whole
        // generator turn, which is a different contract for the model to reason
        // about, and it is refused by the verb today in any case.
        mode: "fireAndForget"
      })
  });
}
