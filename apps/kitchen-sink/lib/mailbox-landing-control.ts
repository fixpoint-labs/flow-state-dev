/**
 * The goal check's control for a routed answer's landing (`GOAL_CONTROL=no-landing`).
 *
 * Swaps the built-in `agent` kind for one that hears posts and answers them
 * with the seat's instructions, the mailbox's recent lines and the tools its
 * `tools:` names, and lands no text answer: a text answer stays in the seat's
 * own conversation and never reaches the mailbox. That is all it takes away. The
 * goal `goals/kitchen-sink-talk/answers-a-clerk-note-or-files-it` must FAIL
 * its answer leg under it, and the line that says a case was filed, while the
 * filed row still lands.
 *
 * Everything else a check reads stays as the real kind has it. The seat's
 * answers are drawn and kept in its own conversation. `post-to-mailbox` is
 * carried, from the same capability: a line the seat posts with the tool is
 * not a landing, and still reaches the mailbox under the seat's name, so the
 * route stops holding the person's next post for that seat. Nothing here marks
 * a turn as routed, so the tool posts the line as the seat's own post, not as
 * the answer the mailbox keeps for the post.
 *
 * The same stand-in FIX-1610's own check uses, with the kind's tools added so
 * `escalate` still files and `post-to-mailbox` still posts.
 *
 * Honoured only under `KITCHEN_SINK_TEST_MODE=1` (`goalControl`), so a control
 * can never reach a deployed build. The published kind has no switch that
 * stops a routed answer landing, and must not.
 */
import { defineFlow, generator, handler, sequencer, type BlockDefinition, type DefinedCapability } from "@flow-state-dev/core";
import { resolveActivePresets } from "@flow-state-dev/core/capability";
import {
  AGENT_KIND,
  mailboxNotifyInputSchema,
  workerConfigOf,
  workerConfigSchema,
  type MailboxNotifyInput,
  type WorkerInstallation,
} from "@flow-state-dev/workforce";
import { z } from "zod";

import { goalControl } from "./goal-control";

/** A seat's turn as a post is heard: `<writer> in <mailbox>: <body>`. */
const heard = (post: MailboxNotifyInput) => `${post.author ?? post.principal} in ${post.mailboxId}: ${post.body}`;

/**
 * The tools a capability's active presets grant, by name: what the real kind
 * adds to its catalog from its `uses`, so a seat's `tools:` can name them.
 */
function grantedTools(capability: DefinedCapability): Record<string, BlockDefinition<any, any>> {
  return Object.fromEntries(
    resolveActivePresets(capability)
      .flatMap(({ preset }) => (Array.isArray(preset.tools) ? preset.tools : []))
      .map((tool) => [tool.name, tool]),
  );
}

/**
 * The quiet `agent` kind when the control is on; `undefined` otherwise.
 *
 * @param catalog The tool catalog the real kind carries.
 * @param mailboxPost The mailbox-post capability the real kind is built with. Its
 *   tool joins the catalog, and a seat reaches the entries its `tools:` names,
 *   as on the real kind.
 * @param installation The installation the real kind runs its workers on:
 *   this one does too, loading each turn's worker first, as the real kind does.
 */
export function mailboxLandingControl(
  catalog: Record<string, BlockDefinition<any, any>>,
  mailboxPost: DefinedCapability,
  installation: WorkerInstallation,
) {
  if (goalControl() !== "no-landing") return undefined;
  const kindCatalog = { ...grantedTools(mailboxPost), ...catalog };
  const settings = workerConfigSchema().extend({ tools: z.array(z.string()).optional() });
  type Settings = z.infer<typeof settings>;
  const config = (ctx: { session: object }) => workerConfigOf(ctx) as Settings;
  const tools = (_input: unknown, ctx: { session: object }): BlockDefinition<any, any>[] =>
    (config(ctx).tools ?? [])
      .filter((name) => kindCatalog[name] !== undefined)
      .map((name) => kindCatalog[name]!);
  const prompt = [
    (_input: unknown, ctx: { session: object }) => config(ctx).teamInstructions,
    (_input: unknown, ctx: { session: object }) => config(ctx).instructions,
  ];
  const answerPost = generator({
    name: "agent-answer",
    inputSchema: mailboxNotifyInputSchema,
    model: "intent/chat",
    itemVisibility: { client: true, history: true },
    history: true,
    prompt,
    context: [
      (post: MailboxNotifyInput) =>
        post.recent === undefined || post.recent.length === 0
          ? undefined
          : ["Recent lines in the mailbox, oldest first:", ...post.recent.map((l) => `- ${l.author ?? l.principal}: ${l.body}`)].join("\n"),
    ],
    user: heard,
    tools,
  });
  const answerTurn = generator({
    name: "agent-answer",
    inputSchema: z.object({ message: z.string() }),
    model: "intent/chat",
    itemVisibility: { client: true, history: true },
    history: true,
    prompt,
    user: (input: { message: string }) => input.message,
    tools,
  });
  // The turn's worker, loaded before the answer reads its settings.
  const resolve = <T extends z.ZodTypeAny>(inputSchema: T) =>
    handler({
      name: "agent-resolve-worker",
      inputSchema,
      resources: { ...installation.resources },
      execute: async (_input, ctx) => {
        await installation.resolveWorker(ctx, AGENT_KIND);
      },
    });
  const turnInput = z.object({ message: z.string() });
  return defineFlow({
    kind: AGENT_KIND,
    cardinality: "collection",
    configSchema: settings,
    session: installation.session(),
    resources: { ...installation.resources },
    actions: {
      run: {
        inputSchema: turnInput.strict(),
        block: sequencer({ name: "agent-run", inputSchema: turnInput }).tap(resolve(turnInput)).step(answerTurn),
        userMessage: (input: { message: string }) => input.message,
      },
    },
    internal: {
      actions: {
        onMailboxPost: {
          inputSchema: mailboxNotifyInputSchema,
          block: sequencer({ name: "agent-heard-post", inputSchema: mailboxNotifyInputSchema })
            .tap(resolve(mailboxNotifyInputSchema))
            .step(answerPost),
          userMessage: heard,
        },
      },
    },
  } as never);
}
