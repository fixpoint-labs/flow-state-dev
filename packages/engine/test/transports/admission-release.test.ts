/**
 * A dispatch that fails between taking its concurrency place and handing that
 * place to the run must give the place back. On the in-memory default a place
 * nobody gives back holds its key until the process restarts: every later
 * `reject` on the session is refused and every `queue` run times out.
 *
 * The failure is forced in live-stream setup, the first thing `dispatch` does
 * after admission, through a module mock that throws only while armed.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { defineFlow, handler } from "@flow-state-dev/core";
import { z } from "zod";

const streamSetup = vi.hoisted(() => ({ fail: false }));

vi.mock("../../src/streaming/live-stream", async (importOriginal) => {
  const original = await importOriginal<typeof import("../../src/streaming/live-stream")>();
  return {
    ...original,
    createLiveRequestStream: (...args: Parameters<typeof original.createLiveRequestStream>) => {
      if (streamSetup.fail) throw new Error("live stream setup failed");
      return original.createLiveRequestStream(...args);
    }
  };
});

import { createFlowApiRouter, createFlowRegistry, createInMemoryStores } from "../../src";

afterEach(() => {
  streamSetup.fail = false;
});

function routerFor(policy: "reject" | "queue") {
  const registry = createFlowRegistry();
  registry.register(
    defineFlow({
      kind: "leak",
      actions: {
        run: {
          concurrency: policy,
          inputSchema: z.object({ value: z.string() }),
          block: handler<{ value: string }, { ok: true }>({
            name: "leak-run",
            execute: () => ({ ok: true })
          })
        }
      }
    })({ id: "leak" })
  );
  const stores = createInMemoryStores();
  const router = createFlowApiRouter({ registry, stores });
  const post = () =>
    router.POST(
      new Request("http://localhost/api/flows/leak/sess_leak/actions/run", {
        method: "POST",
        body: JSON.stringify({ userId: "u_leak", input: { value: "hi" } })
      }),
      { params: { path: ["leak", "sess_leak", "actions", "run"] } }
    );
  return { post, stores };
}

describe("a dispatch that fails after taking its concurrency place", () => {
  it.each(["reject", "queue"] as const)(
    "gives the place back, so the next %s dispatch on the session is admitted",
    async (policy) => {
      const { post, stores } = routerFor(policy);

      streamSetup.fail = true;
      const failed = await post();
      expect(failed.status).toBeGreaterThanOrEqual(500);
      streamSetup.fail = false;

      const next = await post();
      expect(next.status).toBe(202);
      // Admitted is not enough for `queue`, which is acked while it waits:
      // the run has to reach the front and finish.
      const { request } = (await next.json()) as { request: { id: string } };
      await vi.waitFor(
        async () => expect((await stores.request.get(request.id))?.status).toBe("completed"),
        { timeout: 2_000 }
      );
    },
    // A leaked `queue` place makes the next run wait out the 30s budget;
    // fail well before that rather than hang.
    5_000
  );
});
