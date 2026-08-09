/**
 * The chat-sdk session mint path fences its record (FIX-1000).
 *
 * `SessionRecord.storageGeneration` is optional, so a resolver that forgets to
 * mint one compiles, passes every existing test, and silently leaves its
 * sessions unfenced — a delete-then-recreate on the same thread id would let
 * the new session inherit the old one's resources. Nothing but a test per mint
 * path catches that. This is the chat-sdk one; its siblings are
 * `packages/engine/test/session-generation-mint-paths.test.ts` (HTTP route,
 * execution context, webhook resolver) and
 * `packages/cli/test/session-generation-mint.test.ts`.
 */
import { describe, expect, it } from "vitest";
import { createInMemoryStores, resolveSessionResourceScopeId } from "@flow-state-dev/engine";
import { ensureSessionForChat } from "../src/session-resolver";
import type { ChatInboundEvent } from "../src/types";

const SESSION_ID = "slack:C123:1234567890.123456";

const event = {
  kind: "mention",
  platform: "slack",
  thread: { id: SESSION_ID, isDM: false },
  message: null,
} as unknown as ChatInboundEvent;

describe("FIX-1000: ensureSessionForChat", () => {
  it("mints a storage generation that moves the resource address off the record key", async () => {
    const stores = createInMemoryStores();

    await ensureSessionForChat({
      stores,
      sessionId: SESSION_ID,
      flowKind: "chat-flow",
      principal: { userId: "u1" },
      event,
    });

    const record = await stores.session.get(SESSION_ID);
    expect(record).toBeDefined();
    expect(typeof record!.storageGeneration).toBe("string");
    expect(record!.storageGeneration!.length).toBeGreaterThan(0);
    // The clause that makes this more than a field-presence check: a generation
    // that resolved back to the bare id would fence nothing.
    expect(resolveSessionResourceScopeId(record!)).not.toBe(record!.id);
  });

  it("a second event on the same thread reuses the record, so the address is stable", async () => {
    // Re-minting per event would give every message in a thread its own scope
    // and orphan everything the previous ones wrote. The resolver's early
    // return prevents that.
    const stores = createInMemoryStores();
    const args = {
      stores,
      sessionId: SESSION_ID,
      flowKind: "chat-flow",
      principal: { userId: "u1" },
      event,
    };

    await ensureSessionForChat(args);
    const first = (await stores.session.get(SESSION_ID))!.storageGeneration;
    await ensureSessionForChat(args);
    const second = (await stores.session.get(SESSION_ID))!.storageGeneration;

    expect(first).toBeDefined();
    expect(second).toBe(first);
  });
});
