/**
 * Tests for declaration-scoped resource-content loading (FIX-685 Slice B).
 *
 * The per-request execution context must load only the content a flow
 * declares — fixed resources by exact key (`content.get`), collections by
 * their pattern prefix (`content.getByPrefix`) — instead of blanket
 * `content.getAll` reads per scope. Scopes with no declared resources issue
 * no content read at all.
 */
import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import {
  defineFlow,
  defineResource,
  defineResourceCollection,
  handler
} from "@flow-state-dev/core";
import { createExecutionContext, createInMemoryStores } from "../src";
import { seedLegacySession } from "./session-fixtures";

const noopHandler = handler({ name: "noop", execute: () => "ok" });

describe("content load scoped to declared resources (Slice B)", () => {
  it("delivers declared content without a full-scope getAll", async () => {
    const stores = createInMemoryStores();
    await seedLegacySession(stores.session, "sess_b", "user_b");
    await stores.content.set("session", "sess_b", "notes", "NOTES BODY");
    await stores.content.set("session", "sess_b", "secret", "SECRET BODY"); // undeclared
    await stores.content.set("user", "user_b", "profile", "PROFILE BODY");

    const flow = defineFlow({
      kind: "scoping-flow",
      actions: { run: { inputSchema: z.string(), block: noopHandler } },
      resources: {
        notes: defineResource({ scope: "session", stateSchema: z.object({}) }),
        profile: defineResource({ scope: "user", stateSchema: z.object({}) })
      }
    })();

    const getAllSpy = vi.spyOn(stores.content, "getAll");
    const getSpy = vi.spyOn(stores.content, "get");

    const ctx = await createExecutionContext({
      flow,
      actionName: "run",
      requestId: "req_b",
      sessionId: "sess_b",
      userId: "user_b",
      stores
    });

    // Declared content is still delivered to the block.
    await expect(ctx.resources.notes.readContent()).resolves.toBe("NOTES BODY");
    await expect(ctx.resources.profile.readContent()).resolves.toBe("PROFILE BODY");

    // The blanket over-fetch is gone — no full-scope read during context build.
    expect(getAllSpy).not.toHaveBeenCalled();

    // Declared fixed resources fetched by exact key; the undeclared key is
    // never read.
    expect(getSpy).toHaveBeenCalledWith("session", "sess_b", "notes");
    expect(getSpy).toHaveBeenCalledWith("user", "user_b", "profile");
    expect(getSpy).not.toHaveBeenCalledWith("session", "sess_b", "secret");
  });

  it("issues no content read for a scope with no declared resources", async () => {
    const stores = createInMemoryStores();
    await stores.content.set("user", "user_c", "leftover", "X");

    const flow = defineFlow({
      kind: "session-only-flow",
      actions: { run: { inputSchema: z.string(), block: noopHandler } },
      resources: {
        notes: defineResource({ scope: "session", stateSchema: z.object({}) })
      }
    })();

    const getAllSpy = vi.spyOn(stores.content, "getAll");
    const getSpy = vi.spyOn(stores.content, "get");
    const getByPrefixSpy = vi.spyOn(stores.content, "getByPrefix");

    await createExecutionContext({
      flow,
      actionName: "run",
      requestId: "req_c",
      sessionId: "sess_c",
      userId: "user_c",
      stores
    });

    const touchedUser = (spy: typeof getSpy | typeof getByPrefixSpy | typeof getAllSpy) =>
      spy.mock.calls.some((args) => args[0] === "user");
    expect(touchedUser(getAllSpy)).toBe(false);
    expect(touchedUser(getSpy)).toBe(false);
    expect(touchedUser(getByPrefixSpy)).toBe(false);
  });

  it("loads collection content by pattern prefix", async () => {
    const stores = createInMemoryStores();
    await seedLegacySession(stores.session, "sess_d", "user_d");
    await stores.content.set("session", "sess_d", "files/a.ts", "A");
    await stores.content.set("session", "sess_d", "files/b.ts", "B");
    await stores.content.set("session", "sess_d", "elsewhere", "E"); // undeclared

    const flow = defineFlow({
      kind: "collection-flow",
      actions: { run: { inputSchema: z.string(), block: noopHandler } },
      resources: {
        files: defineResourceCollection({
          scope: "session",
          pattern: "files/**",
          stateSchema: z.object({ language: z.string() })
        })
      }
    })();

    const getAllSpy = vi.spyOn(stores.content, "getAll");
    const getByPrefixSpy = vi.spyOn(stores.content, "getByPrefix");

    await createExecutionContext({
      flow,
      actionName: "run",
      requestId: "req_d",
      sessionId: "sess_d",
      userId: "user_d",
      stores
    });

    expect(getAllSpy).not.toHaveBeenCalled();
    expect(getByPrefixSpy).toHaveBeenCalledWith("session", "sess_d", "files/");
  });

  it("loads all instances for a collection whose pattern has no static prefix", async () => {
    const stores = createInMemoryStores();
    await seedLegacySession(stores.session, "sess_e", "user_e");
    await stores.content.set("session", "sess_e", "react/observations", "R");

    const flow = defineFlow({
      kind: "param-collection-flow",
      actions: { run: { inputSchema: z.string(), block: noopHandler } },
      resources: {
        obs: defineResourceCollection({
          scope: "session",
          pattern: "[topic]/observations",
          stateSchema: z.object({ entries: z.array(z.string()).default([]) })
        })
      }
    })();

    const getAllSpy = vi.spyOn(stores.content, "getAll");
    const getByPrefixSpy = vi.spyOn(stores.content, "getByPrefix");

    await createExecutionContext({
      flow,
      actionName: "run",
      requestId: "req_e",
      sessionId: "sess_e",
      userId: "user_e",
      stores
    });

    // Empty static prefix ⇒ load all keys in the scope, via a direct
    // getByPrefix("") rather than the full-scope getAll over-fetch.
    expect(getAllSpy).not.toHaveBeenCalled();
    expect(getByPrefixSpy).toHaveBeenCalledWith("session", "sess_e", "");
  });
});
