import { describe, expect, it } from "vitest";
import { createInMemoryStores } from "@flow-state-dev/engine";
import { createMockModelResolver, mockGenerator } from "@flow-state-dev/testing";
import { defineFlow, handler } from "@flow-state-dev/core";
import { z } from "zod";
import { executeTurn } from "../src/chat/turn";
import { createPlainTextRenderer } from "../src/chat/render";
import type { FlowActionTarget } from "../src/chat/targets";
import chatbotFlow from "./fixtures-chat/flows/chatbot/flow";

const MODEL_ID = "openai/gpt-5.4-mini";

function sink() {
  let buf = "";
  const stream = { write: (chunk: string) => ((buf += chunk), true) } as unknown as NodeJS.WritableStream;
  return { stream, text: () => buf };
}

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const chatbotTarget: FlowActionTarget = { flowKind: "chatbot", actionName: "chat" };

/** A flow whose action hangs until its abort signal fires. */
function slowFlow() {
  return defineFlow({
    kind: "slow",
    actions: {
      chat: {
        inputSchema: z.object({ message: z.string() }),
        block: handler({
          name: "slow-handler",
          inputSchema: z.object({ message: z.string() }),
          outputSchema: z.string(),
          execute: async (_input, ctx) => {
            await new Promise((_resolve, reject) => {
              ctx.signal.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")));
            });
            return "unreachable";
          },
        }),
      },
    },
  })();
}

describe("executeTurn", () => {
  it("streams assistant text through the renderer and threads session state across turns", async () => {
    const gen = mockGenerator({
      name: "chat-generator",
      script: Array.from({ length: 4 }, (_v, i) => ({ text: `reply ${i}` })),
    });
    const modelResolver = createMockModelResolver({
      generators: { "chat-generator": gen },
      models: { [MODEL_ID]: gen },
    });
    const stores = createInMemoryStores();
    const out = sink();
    const renderer = createPlainTextRenderer(out.stream);

    const base = {
      flow: chatbotFlow,
      target: chatbotTarget,
      sessionId: "sess_chatbot",
      userId: "cli-user",
      stores,
      runtimeConfig: { modelResolver },
      renderer,
    };

    const first = await executeTurn({ ...base, text: "hi" }).done;
    expect(first.aborted).toBe(false);
    expect(first.errored).toBe(false);
    expect(out.text()).toContain("reply 0");

    const second = await executeTurn({ ...base, text: "again" }).done;
    expect(second.errored).toBe(false);

    // Two turns under one session id → the counter advanced twice (history threaded).
    const session = await stores.session.get("sess_chatbot");
    expect(session?.state.messageCount).toBe(2);
  });

  it("settles a mid-turn abort as \"aborted\" (patch-then-signal), rendering the stop status", async () => {
    const stores = createInMemoryStores();
    const out = sink();
    const renderer = createPlainTextRenderer(out.stream);

    const turn = executeTurn({
      flow: slowFlow(),
      target: { flowKind: "slow", actionName: "chat" },
      text: "hang",
      sessionId: "sess_abort",
      userId: "cli-user",
      stores,
      runtimeConfig: {},
      renderer,
    });

    await delay(50); // let the run reach the hanging handler
    turn.requestAbort();
    const result = await turn.done;

    expect(result.aborted).toBe(true);
    expect(result.errored).toBe(false);
    expect(out.text()).toContain("· status: Request was stopped.");
    expect(out.text()).toContain("(interrupted)");

    const records = await stores.request.list();
    expect(records[0]?.status).toBe("aborted");
    expect(records[0]?.abortRequested).toBe(true);
  });

  it("settles \"aborted\" even when Ctrl-C lands before the request record exists", async () => {
    const stores = createInMemoryStores();
    const renderer = createPlainTextRenderer(sink().stream);

    const turn = executeTurn({
      flow: slowFlow(),
      target: { flowKind: "slow", actionName: "chat" },
      text: "hang",
      sessionId: "sess_race",
      userId: "cli-user",
      stores,
      runtimeConfig: {},
      renderer,
    });

    // Fire abort immediately — the record likely doesn't exist yet; the retry
    // loop must patch it once it materializes, then signal.
    turn.requestAbort();
    const result = await turn.done;

    expect(result.aborted).toBe(true);
    const records = await stores.request.list();
    expect(records[0]?.status).toBe("aborted");
  });

  it("keeps the session usable — a turn after an abort still succeeds", async () => {
    const gen = mockGenerator({ name: "chat-generator", script: [{ text: "recovered" }] });
    const modelResolver = createMockModelResolver({
      generators: { "chat-generator": gen },
      models: { [MODEL_ID]: gen },
    });
    const stores = createInMemoryStores();
    const out = sink();
    const renderer = createPlainTextRenderer(out.stream);

    // Abort a slow turn first.
    const slow = executeTurn({
      flow: slowFlow(),
      target: { flowKind: "slow", actionName: "chat" },
      text: "hang",
      sessionId: "sess_recover_slow",
      userId: "cli-user",
      stores,
      runtimeConfig: {},
      renderer,
    });
    await delay(30);
    slow.requestAbort();
    await slow.done;

    // A fresh chatbot turn on the same stores succeeds.
    const next = await executeTurn({
      flow: chatbotFlow,
      target: chatbotTarget,
      text: "hello",
      sessionId: "sess_recover_chat",
      userId: "cli-user",
      stores,
      runtimeConfig: { modelResolver },
      renderer,
    }).done;

    expect(next.aborted).toBe(false);
    expect(next.errored).toBe(false);
    expect(out.text()).toContain("recovered");
  });

  it("renders the validation error and a not-chat-shaped hint when the action rejects { message }", async () => {
    const stores = createInMemoryStores();
    const out = sink();
    const renderer = createPlainTextRenderer(out.stream);

    // An action whose schema requires a field { message } does not provide.
    const strictFlow = defineFlow({
      kind: "strict",
      actions: {
        run: {
          inputSchema: z.object({ ticket: z.string() }),
          block: handler({
            name: "strict-handler",
            inputSchema: z.object({ ticket: z.string() }),
            outputSchema: z.string(),
            execute: async (input) => input.ticket,
          }),
        },
      },
    })();

    const result = await executeTurn({
      flow: strictFlow,
      target: { flowKind: "strict", actionName: "run" },
      text: "hi",
      sessionId: "sess_strict",
      userId: "cli-user",
      stores,
      runtimeConfig: {},
      renderer,
    }).done;

    expect(result.errored).toBe(true);
    expect(result.aborted).toBe(false);
    expect(out.text()).toContain("isn't chat-shaped");
  });
});
