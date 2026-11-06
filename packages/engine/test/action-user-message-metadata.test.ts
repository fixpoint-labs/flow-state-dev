/**
 * `ActionCore.userMessage` returning `{ text, metadata }`: the echo is still
 * the request's `user` line, and it carries the metadata, so a client can tell
 * a line the flow was handed (a task's brief, say) from one a person typed.
 */
import { DEFAULT_ORG_ID, defineFlow, handler } from "@flow-state-dev/core";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { createInMemoryStores, runAction } from "../src";

const input = z.object({ message: z.string() });
type Input = z.infer<typeof input>;

const quiet = handler({ name: "quiet", inputSchema: input, outputSchema: z.object({}), execute: async () => ({}) });

async function echoOf(userMessage: (i: Input) => string | { text: string; metadata?: Record<string, unknown> }) {
  const flow = defineFlow({ kind: "echo", actions: { respond: { block: quiet, userMessage } } })({ id: "echo" });
  const stores = createInMemoryStores();
  const result = await runAction({
    orgId: DEFAULT_ORG_ID,
    flow,
    actionName: "respond",
    input: { message: "hello" },
    userId: "u1",
    sessionId: "s1",
    stores,
    runtimeConfig: {}
  });
  expect(result.error).toBeUndefined();
  const items = (await stores.request.get(result.requestId!))?.items ?? [];
  return items.filter((item) => item.type === "message") as Array<{ role?: string; content?: Array<{ text?: string }>; metadata?: unknown }>;
}

describe("ActionCore.userMessage with metadata", () => {
  it("writes the text as the user line and carries the metadata on it", async () => {
    const [echo, ...rest] = await echoOf((i) => ({ text: i.message, metadata: { brief: { taskId: "t1" } } }));
    expect(rest).toEqual([]);
    expect(echo).toMatchObject({ role: "user", content: [{ text: "hello" }], metadata: { brief: { taskId: "t1" } } });
  });

  it("writes no metadata for a plain string", async () => {
    const [echo] = await echoOf((i) => i.message);
    expect(echo).toMatchObject({ role: "user", content: [{ text: "hello" }] });
    expect(echo).not.toHaveProperty("metadata");
  });
});
