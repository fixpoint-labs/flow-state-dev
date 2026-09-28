/**
 * The goal check's control for a routed answer's landing (`GOAL_CONTROL=no-landing`).
 *
 * Swaps the built-in `agent` kind for one that hears posts and answers them
 * with the seat's instructions, the channel's recent lines and the catalog
 * tools its `tools:` names, and lands nothing: a text answer stays in the
 * seat's own conversation and never reaches the channel. The goal
 * `goals/kitchen-sink-talk/answers-a-clerk-note-or-files-it` must FAIL its
 * answer leg under it, and the line that says a case was filed, while the
 * filed row still lands.
 *
 * The same stand-in FIX-1610's own check uses, with the catalog added so
 * `escalate` still files. `post-to-channel` is not carried: a line that tool
 * posts would be a landing too.
 *
 * Honoured only under `KITCHEN_SINK_TEST_MODE=1` (`goalControl`), so a control
 * can never reach a deployed build. The published kind has no switch that
 * stops a routed answer landing, and must not.
 */
import { defineFlow, generator, type BlockDefinition } from "@flow-state-dev/core";
import { AGENT_KIND, channelNotifyInputSchema, workerConfigSchema, type ChannelNotifyInput } from "@flow-state-dev/workforce";
import { z } from "zod";

import { goalControl } from "./goal-control";

/** A seat's turn as a post is heard: `<writer> in <channel>: <body>`. */
const heard = (post: ChannelNotifyInput) => `${post.author ?? post.principal} in ${post.channelId}: ${post.body}`;

/**
 * The quiet `agent` kind when the control is on; `undefined` otherwise.
 *
 * @param catalog The tool catalog the real kind carries. A seat reaches the
 *   entries its `tools:` names, as on the real kind.
 */
export function channelLandingControl(catalog: Record<string, BlockDefinition<any, any>>) {
  if (goalControl() !== "no-landing") return undefined;
  const settings = workerConfigSchema().extend({ tools: z.array(z.string()).optional() });
  type Settings = z.infer<typeof settings>;
  const tools = (_input: unknown, ctx: { flow: { config: unknown } }): BlockDefinition<any, any>[] =>
    ((ctx.flow.config as Settings).tools ?? [])
      .filter((name) => catalog[name] !== undefined)
      .map((name) => catalog[name]!);
  const prompt = [
    (_input: unknown, ctx: { flow: { config: unknown } }) => (ctx.flow.config as Settings).teamInstructions,
    (_input: unknown, ctx: { flow: { config: unknown } }) => (ctx.flow.config as Settings).instructions,
  ];
  const answerPost = generator({
    name: "agent-answer",
    inputSchema: channelNotifyInputSchema,
    model: "intent/chat",
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
