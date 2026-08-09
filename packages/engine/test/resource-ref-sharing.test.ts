/**
 * FIX-591: two blocks declaring the same `DefinedResource` ref under
 * different accessor names share a single storage slot. The accessor name
 * in a block's `resources:` map is purely a typed read handle — ref
 * identity owns persistence.
 */
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { defineFlow, defineResource, handler } from "@flow-state-dev/core";
import { createExecutionContext, createInMemoryStores, toBareStates } from "../src";
import { seedLegacySession } from "./session-fixtures";

describe("FIX-591: resource state keyed by ref, not accessor name", () => {
  it("two accessors of the same DefinedResource see shared state", async () => {
    const sharedRef = defineResource({
      scope: "session",
      stateSchema: z.object({ count: z.number().default(0) }),
      writable: true
    });

    // Writer declares the resource under accessor "a".
    const writer = handler({
      name: "writer",
      resources: { a: sharedRef },
      execute: async (_input, ctx) => {
        await ctx.resources.a.setState({ count: 7 });
        return { wrote: true };
      }
    });

    // Reader declares the SAME ref under accessor "b".
    const reader = handler({
      name: "reader",
      resources: { b: sharedRef },
      execute: async (_input, ctx) => {
        return { seen: (ctx.resources.b.state as { count: number }).count };
      }
    });

    const flow = defineFlow({
      kind: "fix591-flow",
      actions: {
        write: { inputSchema: z.object({}), block: writer },
        read: { inputSchema: z.object({}), block: reader }
      }
    })();

    const stores = createInMemoryStores();
    const sessionId = "sess_fix591";

    const writeCtx = await createExecutionContext({
      flow,
      actionName: "write",
      requestId: "req_write",
      sessionId,
      userId: "user_fix591",
      stores
    });
    await writeCtx.resources.a.setState({ count: 7 });

    const readCtx = await createExecutionContext({
      flow,
      actionName: "read",
      requestId: "req_read",
      sessionId,
      userId: "user_fix591",
      stores
    });

    expect((readCtx.resources.b.state as { count: number }).count).toBe(7);
  });

  it("aliases on different accessors converge on one persisted slot", async () => {
    const ref = defineResource({
      scope: "session",
      stateSchema: z.object({ value: z.string().default("") }),
      writable: true
    });

    const flow = defineFlow({
      kind: "fix591-aliases",
      actions: {
        run: {
          inputSchema: z.object({}),
          block: handler({
            name: "noop",
            resources: { primary: ref, alias: ref },
            execute: () => ({ ok: true })
          })
        }
      }
    })();

    const stores = createInMemoryStores();
    await seedLegacySession(stores.session, "sess_aliases", "user_aliases");
    const ctx = await createExecutionContext({
      flow,
      actionName: "run",
      requestId: "req_aliases",
      sessionId: "sess_aliases",
      userId: "user_aliases",
      stores
    });

    await ctx.resources.primary.setState({ value: "hello" });
    expect((ctx.resources.alias.state as { value: string }).value).toBe("hello");

    await ctx.resources.alias.setState({ value: "world" });
    expect((ctx.resources.primary.state as { value: string }).value).toBe("world");

    // Resource state lives in the ResourceStateStore (FIX-689); aliases dedup
    // to exactly one storage slot holding the latest written value.
    const persisted = toBareStates(await stores.resourceState.getAll("session", "sess_aliases"));
    const matching = Object.keys(persisted).filter(
      (k) => k === "primary" || k === "alias"
    );
    expect(matching).toHaveLength(1);
    expect((persisted[matching[0]!] as { value: string }).value).toBe("world");
  });
});
