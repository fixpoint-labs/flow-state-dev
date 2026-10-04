/**
 * The goal check's control for a routed answer's landing (`GOAL_CONTROL=no-landing`).
 *
 * Swaps the built-in `agent` kind for one that hears posts and answers them
 * with the seat's instructions, the channel's recent lines and the tools its
 * `tools:` names, and lands no text answer: a text answer stays in the seat's
 * own conversation and never reaches the channel. That is all it takes away. The
 * goal `goals/kitchen-sink-talk/answers-a-clerk-note-or-files-it` must FAIL
 * its answer leg under it, and the line that says a case was filed, while the
 * filed row still lands.
 *
 * Everything else a check reads stays as the real kind has it. The seat's
 * answers are drawn and kept in its own conversation. `post-to-channel` is
 * carried, from the same capability: a line the seat posts with the tool is
 * not a landing, and still reaches the channel under the seat's name, so the
 * route stops holding the person's next post for that seat. Nothing here marks
 * a turn as routed, so the tool posts the line as the seat's own post, not as
 * the answer the channel keeps for the post.
 *
 * The same stand-in FIX-1610's own check uses, with the kind's tools added so
 * `escalate` still files and `post-to-channel` still posts.
 *
 * Honoured only under `KITCHEN_SINK_TEST_MODE=1` (`goalControl`), so a control
 * can never reach a deployed build. The published kind has no switch that
 * stops a routed answer landing, and must not.
 */
import { defineFlow, generator, type BlockDefinition, type DefinedCapability } from "@flow-state-dev/core";
import { resolveActivePresets } from "@flow-state-dev/core/capability";
import { AGENT_KIND, channelNotifyInputSchema, workerConfigSchema, type ChannelNotifyInput } from "@flow-state-dev/workforce";
import { z } from "zod";

import { goalControl } from "./goal-control";

/** A seat's turn as a post is heard: `<writer> in <channel>: <body>`. */
const heard = (post: ChannelNotifyInput) => `${post.author ?? post.principal} in ${post.channelId}: ${post.body}`;

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
 * @param channelPost The channel-post capability the real kind is built with. Its
 *   tool joins the catalog, and a seat reaches the entries its `tools:` names,
 *   as on the real kind.
 */
export function channelLandingControl(catalog: Record<string, BlockDefinition<any, any>>, channelPost: DefinedCapability) {
  if (goalControl() !== "no-landing") return undefined;
  const kindCatalog = { ...grantedTools(channelPost), ...catalog };
  const settings = workerConfigSchema().extend({ tools: z.array(z.string()).optional() });
  type Settings = z.infer<typeof settings>;
  const tools = (_input: unknown, ctx: { flow: { config: unknown } }): BlockDefinition<any, any>[] =>
    ((ctx.flow.config as Settings).tools ?? [])
      .filter((name) => kindCatalog[name] !== undefined)
      .map((name) => kindCatalog[name]!);
  const prompt = [
    (_input: unknown, ctx: { flow: { config: unknown } }) => (ctx.flow.config as Settings).teamInstructions,
    (_input: unknown, ctx: { flow: { config: unknown } }) => (ctx.flow.config as Settings).instructions,
  ];
  const answerPost = generator({
    name: "agent-answer",
    inputSchema: channelNotifyInputSchema,
    model: "intent/chat",
    itemVisibility: { client: true, history: true },
    history: true,
    prompt,
    context: [
      (post: ChannelNotifyInput) =>
        post.recent === undefined || post.recent.length === 0
          ? undefined
          : ["Recent lines in the channel, oldest first:", ...post.recent.map((l) => `- ${l.author ?? l.principal}: ${l.body}`)].join("\n"),
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
  return defineFlow({
    kind: AGENT_KIND,
    cardinality: "collection",
    configSchema: settings,
    actions: {
      run: {
        inputSchema: z.object({ message: z.string() }),
        block: answerTurn,
        userMessage: (input: { message: string }) => input.message,
      },
    },
    internal: {
      actions: { onChannelPost: { inputSchema: channelNotifyInputSchema, block: answerPost, userMessage: heard } },
    },
  } as never);
}
