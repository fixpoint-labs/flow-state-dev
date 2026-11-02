/**
 * `ctx.emit.message(text, { metadata })`: structured data a handler attaches
 * to a message so a client reads it instead of parsing the text. The item
 * carries it as given, stored and streamed alike, and a model reading the
 * conversation sees only the text.
 */
import { defineFlow, handler } from "@flow-state-dev/core";
import { DEFAULT_ORG_ID } from "@flow-state-dev/core";
import type { MessageItem } from "@flow-state-dev/core/items";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { createInMemoryStores, runAction } from "../src";
import { itemToLLMMessages } from "../src/context/history";

const DATA = { taskNotice: { taskId: "task_1", ending: "completed" } };

function flow() {
  return defineFlow({
    kind: "message-metadata",
    actions: {
      say: {
        inputSchema: z.object({}),
        block: handler({
          name: "say",
          inputSchema: z.object({}),
          execute: async (_input, ctx) => {
            ctx.emit.message("Task done.", { metadata: DATA });
            await ctx._emitMessageAwaited?.("Awaited, task done.", { metadata: DATA });
            ctx.emit.message("Plain words.");
            return {};
          }
        })
      }
    }
  })();
}

describe("a message's metadata", () => {
  it("rides the item streamed and the item stored, and is absent when none was given", async () => {
    const stores = createInMemoryStores();
    const streamed: MessageItem[] = [];
    const result = await runAction({
      orgId: DEFAULT_ORG_ID,
      flow: flow(),
      actionName: "say",
      input: {},
      userId: "user_1",
      stores,
      runtimeConfig: {},
      onItem: (item, kind) => {
        if (kind === "done" && item.type === "message") streamed.push(item as MessageItem);
      }
    });
    expect(result.error).toBeUndefined();

    const requests = await stores.request.list({ withItems: true });
    const stored = requests
      .flatMap((request) => (request as unknown as { items?: MessageItem[] }).items ?? [])
      .filter((item) => item.type === "message");
    for (const items of [streamed, stored]) {
      expect(items.map((item) => [(item.content[0] as { text?: string } | undefined)?.text, item.metadata])).toEqual([
        ["Task done.", DATA],
        ["Awaited, task done.", DATA],
        ["Plain words.", undefined]
      ]);
      expect("metadata" in items[2]!).toBe(false);
    }
  });

  it("never reaches a model: the conversation's history holds the text alone", () => {
    const item = {
      id: "m1",
      type: "message",
      status: "completed",
      requestId: "r1",
      itemIndex: 0,
      provenance: { blockName: "say", blockInstanceId: "b1", phase: "main" },
      ts: 0,
      role: "assistant",
      content: [{ type: "output_text", text: "Task done." }],
      metadata: DATA
    } as const;
    expect(itemToLLMMessages(item as never, [item as never])).toEqual([{ role: "assistant", content: "Task done." }]);
  });
});
