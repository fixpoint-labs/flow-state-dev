/**
 * A client reads a collection item by topic, whatever `/` the topic holds,
 * against a real `serve()` host.
 *
 * The item routes share a `*topic` wildcard, and the content route is the
 * state route plus `/content`. A topic sent with its slashes exposed is read
 * back as route separators, so the topic `a/content`'s state read lands on
 * item `a`'s content route: the caller gets another item's content. Each read
 * has to reach its own item.
 */
import { afterEach, describe, expect, it } from "vitest";
import { createFlowState, inMemoryStores } from "@flow-state-dev/engine";
import { createMockModelResolver } from "@flow-state-dev/testing";
import { defineFlow, defineResourceCollection, handler } from "@flow-state-dev/core";
import { createClient } from "@flow-state-dev/client";
import { z } from "zod";
import { serve, type ServeHandle } from "../src/serve";

const files = defineResourceCollection({
  scope: "session",
  pattern: "files/**",
  stateSchema: z.object({ title: z.string().default("") }),
  client: { content: { read: true, create: true, update: true, delete: true }, state: { read: true } },
});

const filesFlow = defineFlow({
  kind: "files",
  actions: {
    run: {
      inputSchema: z.object({}),
      block: handler({ name: "noop", resources: { files }, execute: () => ({ ok: true }) }),
    },
  },
})();

const TOPICS = ["a", "a/content", "notes/2026"] as const;

const handles: ServeHandle[] = [];
afterEach(async () => {
  while (handles.length > 0) await handles.pop()!.close();
});

/** A host holding one item per topic, each with its own content. */
async function hostWithItems() {
  const flowState = createFlowState({
    flows: { files: filesFlow },
    modelResolver: createMockModelResolver({}),
    stores: { default: { primary: inMemoryStores() } },
  });
  const handle = await serve(flowState, { port: 0 });
  handles.push(handle);
  await flowState.ready();
  const client = createClient({ userId: "alice", baseUrl: `http://127.0.0.1:${handle.port}` });
  await client.flow("files").createSession({ sessionId: "s_1" });
  for (const topic of TOPICS) {
    await client.resources.createCollectionItem("s_1", "files", { topic, content: `body of ${topic}` });
  }
  return client;
}

describe("a client's collection item reads", () => {
  it("reads each topic's own state, including one ending in /content", async () => {
    const client = await hostWithItems();
    for (const topic of TOPICS) {
      const state = await client.resources.getCollectionItemState("s_1", "files", topic);
      expect(state).toMatchObject({ topic });
    }
  });

  it("reads each topic's own content", async () => {
    const client = await hostWithItems();
    for (const topic of TOPICS) {
      const read = await client.resources.getCollectionItemContent("s_1", "files", topic);
      expect(read).toMatchObject({ content: `body of ${topic}` });
    }
  });
});
