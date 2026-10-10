/**
 * The goal check's control for an answer's landing (`GOAL_CONTROL=no-landing`).
 *
 * Swaps the built-in `agent` flow for one that takes a coordinator's delegated
 * post and answers it with the worker's instructions and the tools its
 * `tools:` names, in its own conversation, and hands nothing back: the answer
 * stays in the specialist's conversation and never reaches the person's
 * conversation with the coordinator. That is all it takes away. A check that
 * the specialist's answer lands under its name must FAIL under it.
 *
 * Everything else a check reads stays as the real flow has it: the
 * specialist's answers are drawn and kept in its own conversation, and a
 * person's direct conversation with a specialist still answers. With no answer
 * landing, best fit's hold stays on the specialist that took the person's
 * first post.
 *
 * Honoured only under `KITCHEN_SINK_TEST_MODE=1` (`goalControl`), so a control
 * can never reach a deployed build. The published flow has no switch that
 * stops an answer landing, and must not.
 */
import { defineFlow, generator, handler, type BlockDefinition } from "@flow-state-dev/core";
import {
  AGENT_KIND,
  delegatedPostSchema,
  workerConfigOf,
  workerConfigSchema,
  type DelegatedPost,
  type WorkerInstallation,
} from "@flow-state-dev/workforce";
import { z } from "zod";

import { goalControl } from "./goal-control";

/** A delegated post as the specialist's turn reads it, the way the real flow words it. */
const heard = (post: DelegatedPost) => `${post.from}, through ${post.coordinator}: ${post.body}`;

/**
 * The quiet `agent` flow when the control is on; `undefined` otherwise.
 *
 * @param catalog The tool catalog the real flow carries. A worker reaches the
 *   entries its `tools:` names, as on the real flow.
 * @param installation The installation the real flow runs its workers on:
 *   this one does too, loading the turn's worker before the answer reads it.
 */
export function landingControl(catalog: Record<string, BlockDefinition<any, any>>, installation: WorkerInstallation) {
  if (goalControl() !== "no-landing") return undefined;
  const settings = workerConfigSchema().extend({ tools: z.array(z.string()).optional() });
  type Settings = z.infer<typeof settings>;
  const config = (ctx: { session: object }) => workerConfigOf(ctx) as Settings;
  const tools = (_input: unknown, ctx: { session: object }): BlockDefinition<any, any>[] =>
    (config(ctx).tools ?? []).filter((name) => catalog[name] !== undefined).map((name) => catalog[name]!);
  const prompt = [
    (_input: unknown, ctx: { session: object }) => config(ctx).teamInstructions,
    (_input: unknown, ctx: { session: object }) => config(ctx).instructions,
  ];
  const answer = {
    name: "agent-answer" as const,
    model: "intent/chat" as const,
    itemVisibility: { client: true, history: true } as const,
    history: true as const,
    prompt,
    tools,
  };
  const turnInput = z.object({ message: z.string() });
  const loadWorker = handler({
    name: "agent-resolve-worker",
    inputSchema: z.unknown(),
    resources: { ...installation.resources },
    execute: async (_input, ctx) => {
      await installation.resolveWorker(ctx, AGENT_KIND);
    },
  });
  return defineFlow({
    kind: AGENT_KIND,
    cardinality: "collection",
    configSchema: settings,
    session: installation.session(),
    resources: { ...installation.resources },
    request: { onStarted: loadWorker },
    actions: {
      run: {
        inputSchema: turnInput.strict(),
        block: generator({ ...answer, inputSchema: turnInput, user: (input: { message: string }) => input.message }),
        userMessage: (input: { message: string }) => input.message,
      },
    },
    internal: {
      actions: {
        onDelegatedPost: {
          inputSchema: delegatedPostSchema,
          block: generator({ ...answer, inputSchema: delegatedPostSchema, user: heard }),
          userMessage: heard,
        },
      },
    },
  } as never);
}
