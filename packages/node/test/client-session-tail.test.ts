/**
 * A client reads a long session from its newest end, against a real `serve()`
 * host.
 *
 * A session's items come back oldest first. A reader that starts at offset 0
 * and stops after a few pages (the Shift Manager's stopped at 1,000) shows a
 * long conversation's beginning and never its newest reply. The session
 * window reads the last page first and earlier pages only when asked, so the
 * newest reply is in the first read however long the session is.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { createFlowState, inMemoryStores } from "@flow-state-dev/engine";
import { createMockModelResolver } from "@flow-state-dev/testing";
import { defineFlow, handler } from "@flow-state-dev/core";
import { createClient, readSessionEarlier, readSessionTail, type FlowHandle, type UntypedFlow } from "@flow-state-dev/client";
import { z } from "zod";
import { serve, type ServeHandle } from "../src/serve";

const lines = z.object({ count: z.number(), label: z.string() });

/** A flow whose one action stores `count` messages, `label 0` first. */
const chatFlow = defineFlow({
  kind: "chat",
  actions: {
    say: {
      inputSchema: lines,
      block: handler({
        name: "say",
        inputSchema: lines,
        execute: ({ count, label }, ctx) => {
          for (let i = 0; i < count; i += 1) ctx.emit.message(`${label} ${i}`);
          return { ok: true };
        },
      }),
    },
  },
})();

const handles: ServeHandle[] = [];
afterEach(async () => {
  while (handles.length > 0) await handles.pop()!.close();
});

/** Run `say` in the long session and wait for the server to report it finished. */
async function say(chat: FlowHandle<UntypedFlow>, count: number, label: string): Promise<void> {
  const sent = await chat.send("say", { count, label }, { sessionId: "s_long" });
  await vi.waitFor(async () => expect((await sent.status()).status).toBe("completed"), { timeout: 10_000 });
}

const text = (item: unknown) => ((item as { content?: Array<{ text?: string }> }).content ?? []).map((part) => part.text).join("");

describe("a client's tail read of a long session", () => {
  it("holds the newest reply of a session with more than 1,000 items, and pages back on request", async () => {
    const flowState = createFlowState({
      flows: { chat: chatFlow },
      modelResolver: createMockModelResolver({}),
      stores: { default: { primary: inMemoryStores() } },
    });
    const handle = await serve(flowState, { port: 0 });
    handles.push(handle);
    await flowState.ready();
    const client = createClient({ userId: "alice", baseUrl: `http://127.0.0.1:${handle.port}` });
    const chat = client.flow("chat");
    await chat.createSession({ sessionId: "s_long" });

    // Days of history, then the reply someone opened the conversation for.
    await say(chat, 1_050, "old");
    await say(chat, 1, "newest reply");

    const window = await readSessionTail(client.sessions, "s_long", { itemTypes: ["message"] });

    expect(window.total).toBe(1_051);
    expect(window.hasEarlier).toBe(true);
    expect(text(window.items.at(-1))).toBe("newest reply 0");
    expect(window.items).toHaveLength(200);

    const earlier = await readSessionEarlier(client.sessions, window, { limit: 1_000 });
    expect(earlier.hasEarlier).toBe(false);
    expect(text(earlier.items[0])).toBe("old 0");
    expect(text(earlier.items.at(-1))).toBe("newest reply 0");
    expect(earlier.items).toHaveLength(1_051);
  });
});
