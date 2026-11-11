/**
 * The server the `read-on-request` goal crashes and starts again: a local
 * server on an on-disk SQLite store, over HTTP, hosting one chat twice.
 * `with-capability` taps `recordAttachments` and installs
 * `attachmentsCapability` on its generator; `without-capability` is the same
 * chat with neither. Both read a history window of three turns.
 *
 * The model is scripted, and it is the provider seam: it records each call's
 * messages, as the model call prepared them, to `GOAL_CALLS` (one JSON line
 * per call). It plays a person's request as a model would:
 *
 * - `ASK <file name>`: find the file's id in what it was shown (the history
 *   line or the list of documents) and read it by that id; with no id in
 *   sight, read it by its name.
 * - `READ <id>`: read that id.
 * - anything else, or once a read's result is in: answer.
 *
 * Who is asking comes from an `x-user` header, standing in for sign-in.
 *
 * Env: `GOAL_DB` (SQLite file), `GOAL_CALLS` (the calls file), `PORT`.
 */
import { appendFileSync } from "node:fs";
import { defineFlow, generator, sequencer } from "@flow-state-dev/core";
import { attachmentsCapability, recordAttachments } from "@flow-state-dev/core/attachments";
import type { GeneratorModel, LLMMessage } from "@flow-state-dev/core/types";
import { createFlowState } from "@flow-state-dev/engine";
import { serve } from "@flow-state-dev/node";
import { sqliteStores } from "@flow-state-dev/store-sqlite";
import { z } from "zod";

const input = z.object({ message: z.string() });

const textOf = (message: LLMMessage | undefined): string =>
  typeof message?.content === "string"
    ? message.content
    : (message?.content as Array<{ type: string; text?: string }> | undefined)?.map((part) => part.text ?? "").join("") ?? "";

/** What the model does next, from the messages it was shown. */
function play(messages: LLMMessage[]): { toolCalls: unknown[]; finishReason: string } | { text: string; finishReason: string } {
  const lastUser = messages.map((m) => m.role).lastIndexOf("user");
  const answered = messages.slice(lastUser + 1).some((m) => m.role === "tool");
  const said = textOf(messages[lastUser]);
  const call = (args: Record<string, string>) => ({
    toolCalls: [{ toolCallId: `read-${Date.now()}`, toolName: "readAttachment", args }],
    finishReason: "tool-calls",
  });
  if (!answered && said.startsWith("READ ")) return call({ id: said.slice("READ ".length).trim() });
  if (!answered && said.startsWith("ASK ")) {
    const name = said.slice("ASK ".length).trim();
    const shown = messages.slice(0, lastUser).map((m) => JSON.stringify(m.content)).join("\n");
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const id =
      new RegExp(`\\[document: ${escaped}, id (b_[0-9a-f]+)`).exec(shown)?.[1] ??
      new RegExp(`- ${escaped} · [^·]+ · id (b_[0-9a-f]+)`).exec(shown)?.[1];
    return call(id !== undefined ? { id } : { name });
  }
  return { text: "ok", finishReason: "stop" };
}

const scripted = ((modelId: string) =>
  ({
    modelId,
    async generate() {
      throw new Error("the owned loop calls generateStep");
    },
    async generateStep(options: { messages: LLMMessage[] }) {
      appendFileSync(process.env.GOAL_CALLS!, `${JSON.stringify(options.messages)}\n`);
      return play(options.messages);
    },
  }) as unknown as GeneratorModel) as ((modelId: string) => GeneratorModel) & { resolveId: (id: string) => string };
scripted.resolveId = (id) => id;

const chat = (kind: string, withCapability: boolean) => {
  const answer = generator({
    name: "answer",
    model: "anthropic/scripted",
    prompt: "You answer questions about the person's documents.",
    history: { limit: { turns: 3 } },
    ...(withCapability ? { uses: [attachmentsCapability] } : {}),
    user: (value: { message: string }) => value.message,
  });
  return defineFlow({
    kind,
    actions: {
      send: {
        inputSchema: input,
        userMessage: (i: { message: string }) => i.message,
        block: withCapability
          ? sequencer({ name: "chat", inputSchema: input }).tap(recordAttachments).step(answer)
          : sequencer({ name: "chat", inputSchema: input }).step(answer),
      },
    },
  })();
};

const flowState = createFlowState({
  flows: [chat("with-capability", true), chat("without-capability", false)],
  stores: { default: { primary: sqliteStores({ filename: process.env.GOAL_DB! }) } },
  modelResolver: scripted,
  resolvePrincipal: (context: { request?: Request }) => {
    const user = context.request?.headers.get("x-user");
    return typeof user === "string" && user.length > 0 ? { userId: user, orgId: "goal-org" } : null;
  },
} as never);

await serve(flowState, { port: Number(process.env.PORT), host: "127.0.0.1" });
console.log("host: listening");
