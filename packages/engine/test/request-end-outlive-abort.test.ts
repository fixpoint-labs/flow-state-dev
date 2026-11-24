// FIX-2795.
/**
 * A request-end hook added with `writesOutliveAbort` keeps its resource
 * writes when a person stopped the request; a hook added without it is
 * stopped, as the request's own writes are.
 *
 * Why it matters: the claim gate settles a task in its hook. Stopped on the
 * abort, that write left the task running until its lease lapsed.
 */
import { defineFlow, defineResource, handler, sequencer } from "@flow-state-dev/core";
import { DEFAULT_ORG_ID } from "@flow-state-dev/core";
import type { ResourceRef } from "@flow-state-dev/core/types";
import { onRequestEnded } from "@flow-state-dev/core/internal";
import { z } from "zod";
import { describe, expect, it } from "vitest";
import { runAction, toBareStates } from "../src";
import { abortRequest, createInMemoryStores } from "../src/host";
import { createRequestEndRegistry } from "../src/execution/request-end-hooks";

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const note = () => defineResource({ scope: "session", stateSchema: z.object({ ending: z.string().default("") }), writable: true });

describe("a request-end hook's writes after the request was stopped", () => {
  it("land for a hook added with writesOutliveAbort, and stop for one added without it", async () => {
    const stores = createInMemoryStores();
    const failures: string[] = [];
    const register = handler({
      name: "register",
      inputSchema: z.any(),
      resources: { kept: note(), stopped: note() },
      execute: (_input, ctx) => {
        const write = (key: "kept" | "stopped", status: string) =>
          (ctx.resources[key] as ResourceRef<{ ending: string }>).setState({ ending: status }).catch((error: Error) => {
            failures.push(`${key}: ${error.message}`);
          });
        onRequestEnded(ctx, (ending) => write("kept", ending.status), { writesOutliveAbort: true });
        onRequestEnded(ctx, (ending) => write("stopped", ending.status));
      }
    });
    // The abort route's two halves: the durable intent, then the controller.
    const stop = handler({
      name: "stop",
      inputSchema: z.any(),
      execute: async (_input, ctx) => {
        const id = ctx.request.identity.id;
        await stores.request.setFieldsIfStatus(id, { abortRequested: true }, ["in_progress"], Date.now());
        abortRequest(id);
        await sleep(5);
        return "stopped";
      }
    });
    const flow = defineFlow({
      kind: "outlive-abort",
      actions: { run: { inputSchema: z.any(), block: sequencer({ name: "run" }).tap(register).step(stop) } }
    })();

    const result = await runAction({
      orgId: DEFAULT_ORG_ID,
      flow,
      actionName: "run",
      input: {},
      userId: "u1",
      sessionId: "s1",
      stores,
      runtimeConfig: {}
    } as never);

    expect((await stores.request.get(result.requestId!))?.status).toBe("aborted");
    const persisted = toBareStates(await stores.resourceState.getAll("session", "s1")) as Record<string, { ending?: string }>;
    expect(persisted.kept?.ending).toBe("aborted");
    // The unflagged hook ran, and its write was stopped on the abort.
    expect(persisted.stopped?.ending ?? "").toBe("");
    expect(failures).toHaveLength(1);
    expect(failures[0]).toMatch(/^stopped: /);
  });

  it("is refused when it is added to a registry with no way to run it so, rather than run as any other hook", () => {
    const registry = createRequestEndRegistry();
    expect(() => registry.seam.add(() => undefined, { writesOutliveAbort: true })).toThrow(/writesOutliveAbort/);
    // A hook without the option is added as before.
    registry.seam.add(() => undefined);
    expect(registry.owes()).toBe(true);
    registry.release();
  });
});
