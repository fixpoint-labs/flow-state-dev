/**
 * The server the `survive-a-restart-by-reference` goal kills and starts
 * again: a local server on an on-disk SQLite store, over HTTP, that names no
 * `blobs` slot, so its attachments go where the engine's default puts them
 * (`.fsdev/blobs` in this process's working directory, which the goal sets to
 * a scratch folder).
 *
 * Who is asking comes from an `x-user` header, standing in for sign-in, so a
 * second user can be refused. The one action, `send`, records the files its
 * message names in session state, as an app's conversation would: that is
 * what the goal's session read sees.
 *
 * Env: `GOAL_DB` (SQLite file), `PORT`.
 */
import { defineFlow, handler } from "@flow-state-dev/core";
import { createFlowState } from "@flow-state-dev/engine";
import { serve } from "@flow-state-dev/node";
import { sqliteStores } from "@flow-state-dev/store-sqlite";
import { z } from "zod";

const file = z.object({ type: z.literal("file"), mediaType: z.string(), filename: z.string().optional(), data: z.string() });
const input = z.object({ message: z.string(), files: z.array(file) });

const send = handler({
  name: "send",
  inputSchema: input,
  outputSchema: z.object({ kept: z.number() }),
  sessionStateSchema: z.object({ files: z.array(file).default([]) }),
  execute: async ({ files }, ctx) => {
    await ctx.session.patchState({ files: [...(ctx.session.state.files ?? []), ...files] });
    return { kept: files.length };
  },
});

const chat = defineFlow({
  kind: "chat",
  // Files ride on the user line, so the action that takes them writes one.
  actions: { send: { inputSchema: input, block: send, userMessage: (i: { message: string }) => i.message } },
  session: { stateSchema: z.object({ files: z.array(file).default([]) }), client: { expose: ["files"] } },
} as never)();

const flowState = createFlowState({
  flows: [chat],
  stores: { default: { primary: sqliteStores({ filename: process.env.GOAL_DB! }) } },
  resolvePrincipal: (context: { request?: Request }) => {
    const user = context.request?.headers.get("x-user");
    return typeof user === "string" && user.length > 0 ? { userId: user, orgId: "goal-org" } : null;
  },
} as never);

await serve(flowState, { port: Number(process.env.PORT), host: "127.0.0.1" });
console.log("host: listening");
