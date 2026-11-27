/**
 * A request must not leave an `AsyncLocalStorage` behind.
 *
 * On Node 22 (the engine's floor), an `AsyncLocalStorage` that has run once
 * joins a process-wide list and never leaves it unless `disable()` is called.
 * Every later async operation in the process walks that list. So a storage
 * made per request is a leak that also slows the whole server: a long-running
 * `fsdev dev` server grew its list by about a thousand entries in ten minutes
 * of page reloads, and 5,000 of them make a simple await ~4,000x slower.
 *
 * The check counts storages constructed while requests run. The number that
 * matters is zero: a storage made at module load is made once per process,
 * one made per request is the leak.
 */
import { defineFlow, handler, DEFAULT_ORG_ID } from "@flow-state-dev/core";
import { describe, expect, it, vi } from "vitest";
import { z } from "zod";

const constructed = vi.hoisted(() => ({ count: 0 }));

vi.mock("node:async_hooks", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:async_hooks")>();
  class CountedAsyncLocalStorage<T> extends actual.AsyncLocalStorage<T> {
    constructor() {
      super();
      constructed.count += 1;
    }
  }
  return { ...actual, AsyncLocalStorage: CountedAsyncLocalStorage };
});

const { createExecutionContext, runAction } = await import("../src");
const { createInMemoryStores } = await import("../src/host");
const { createScopedAsyncStorage } = await import("../src/context/scoped-async-storage");

describe("requests and AsyncLocalStorage", () => {
  it("runs requests without constructing a storage per request", async () => {
    const flow = defineFlow({
      kind: "als-per-request",
      actions: {
        run: handler({ name: "echo", inputSchema: z.object({ n: z.number() }), execute: (input) => input.n + 1 }),
      },
    })();
    const stores = createInMemoryStores();
    const run = (i: number) =>
      runAction({
        orgId: DEFAULT_ORG_ID,
        flow,
        actionName: "run",
        requestId: `req_als_${i}`,
        sessionId: "sess_als",
        userId: "user_als",
        input: { n: i },
        stores,
        runtimeConfig: {},
      });

    // The first request loads whatever the engine creates once per process.
    await run(0);
    const before = constructed.count;
    for (let i = 1; i <= 5; i += 1) await run(i);
    await createExecutionContext({
      orgId: DEFAULT_ORG_ID,
      flow,
      actionName: "run",
      requestId: "req_als_ctx",
      sessionId: "sess_als",
      userId: "user_als",
      stores,
    });

    expect(constructed.count - before).toBe(0);
  });
});

describe("createScopedAsyncStorage", () => {
  it("keeps each owner's value apart, as one storage per owner would", async () => {
    const a = createScopedAsyncStorage<string>();
    const b = createScopedAsyncStorage<string>();

    await a.run("a1", async () => {
      expect(a.getStore()).toBe("a1");
      expect(b.getStore()).toBeUndefined();
      await b.run("b1", async () => {
        await null;
        expect(a.getStore()).toBe("a1");
        expect(b.getStore()).toBe("b1");
        // A nested run overrides only its own owner's value, and only inside it.
        await a.run("a2", async () => {
          expect(a.getStore()).toBe("a2");
          expect(b.getStore()).toBe("b1");
        });
        expect(a.getStore()).toBe("a1");
      });
      expect(b.getStore()).toBeUndefined();
    });
    expect(a.getStore()).toBeUndefined();
  });

  it("keeps concurrent runs of one owner apart", async () => {
    const s = createScopedAsyncStorage<string>();
    const seen = await Promise.all(
      ["x", "y", "z"].map((v) =>
        s.run(v, async () => {
          await new Promise((r) => setTimeout(r, 5));
          return s.getStore();
        }),
      ),
    );
    expect(seen).toEqual(["x", "y", "z"]);
  });

  it("enterWith sets its owner's value and leaves the others' in place", async () => {
    const s = createScopedAsyncStorage<string>();
    const other = createScopedAsyncStorage<string>();
    await other.run("o", async () => {
      s.enterWith("m");
      await null;
      expect(s.getStore()).toBe("m");
      expect(other.getStore()).toBe("o");
    });
  });
});
