/**
 * A channel kind of this app's own. `fsdev gen` registers it under its
 * basename; `noticeboard` names that basename in `flow:`.
 *
 * `read` returns the tail, which is the only reason this file exists. The
 * binder's three keys are declared so they are not stripped at open. No
 * boards — a hand-rolled kind cannot hold them.
 */
import { defineFlow, handler } from "@flow-state-dev/core";
import { z } from "zod";

const TAIL = 5;

const digestState = z.object({
  members: z.array(z.string()),
  instructions: z.string(),
  transcript: z.array(z.unknown()).default([]),
});

function openDigest(state: unknown) {
  const parsed = digestState.safeParse(state);
  return parsed.success ? parsed.data : undefined;
}

const post = handler({
  name: "digest-post",
  inputSchema: z
    .object({ body: z.string().min(1), author: z.string().optional() })
    .strict(),
  execute: async (input, ctx) => {
    const channel = openDigest(ctx.session.state);
    if (channel === undefined) {
      throw new Error(
        `session "${ctx.session.identity.id}" is not an open digest channel.`,
      );
    }
    if (input.author !== undefined && !channel.members.includes(input.author)) {
      throw new Error(
        `"${input.author}" is not a member of channel "${ctx.session.identity.id}".`,
      );
    }
    const line = {
      id: crypto.randomUUID(),
      at: Date.now(),
      ...(input.author === undefined ? {} : { author: input.author }),
      authorVerified: false as const,
      body: input.body,
    };
    await ctx.session.pushState("transcript", line);
    return line;
  },
});

const read = handler({
  name: "digest-read",
  inputSchema: z.object({}).strict(),
  execute: async (_input, ctx) => {
    const channel = openDigest(ctx.session.state);
    if (channel === undefined) {
      throw new Error(`session "${ctx.session.identity.id}" is not an open digest channel.`);
    }
    return {
      id: ctx.session.identity.id,
      members: channel.members,
      notices: [...channel.transcript].reverse().slice(0, TAIL),
      total: channel.transcript.length,
    };
  },
});

export default defineFlow({
  kind: "digest",
  cardinality: "singleton",
  session: { stateSchema: digestState },
  actions: {
    post: { block: post, concurrency: "queue" },
    read: {
      block: read,
      description: `Read this channel's ${TAIL} most recent notices, newest first.`,
    },
  },
});
