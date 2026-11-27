/**
 * The server the `session-file-list` goal kills and starts again: a local
 * server on an on-disk SQLite store, over HTTP, hosting the same chat twice.
 * `with-block` taps the attachments block before its reply; `without-block`
 * is the same flow without it. Neither names its `attachments` list: that the
 * block's own declaration installs it is what the goal checks.
 *
 * Who is asking comes from an `x-user` header, standing in for sign-in.
 *
 * Env: `GOAL_DB` (SQLite file), `PORT`.
 */
import { defineFlow, handler, sequencer } from "@flow-state-dev/core";
import { recordAttachments } from "@flow-state-dev/core/attachments";
import { createFlowState } from "@flow-state-dev/engine";
import { serve } from "@flow-state-dev/node";
import { sqliteStores } from "@flow-state-dev/store-sqlite";
import { z } from "zod";

const input = z.object({ message: z.string() });
const reply = handler({ name: "reply", inputSchema: input, outputSchema: input, execute: (value) => ({ message: value.message }) });

const chat = (kind: string, withBlock: boolean) =>
  defineFlow({
    kind,
    actions: {
      send: {
        inputSchema: input,
        // Files ride on the user line, so the action that takes them writes one.
        userMessage: (i: { message: string }) => i.message,
        block: withBlock
          ? sequencer({ name: "chat", inputSchema: input }).tap(recordAttachments).step(reply)
          : sequencer({ name: "chat", inputSchema: input }).step(reply),
      },
    },
  })();

const flowState = createFlowState({
  flows: [chat("with-block", true), chat("without-block", false)],
  stores: { default: { primary: sqliteStores({ filename: process.env.GOAL_DB! }) } },
  resolvePrincipal: (context: { request?: Request }) => {
    const user = context.request?.headers.get("x-user");
    return typeof user === "string" && user.length > 0 ? { userId: user, orgId: "goal-org" } : null;
  },
} as never);

await serve(flowState, { port: Number(process.env.PORT), host: "127.0.0.1" });
console.log("host: listening");
