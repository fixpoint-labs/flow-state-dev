/**
 * A flow's request observer (`request.onStarted`, `request.onFinished`, …) is
 * its own block, not a run of the action's block: what the action's block
 * emits stays in the session's items.
 */
import { defineFlow, handler } from "@flow-state-dev/core";
import { z } from "zod";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createFlowApiRouter, createFlowRegistry, createInMemoryStores } from "../src";

describe("a request observer beside the action's block", () => {
  afterEach(() => vi.unstubAllEnvs());

  // Lean traces (production's default) take their index when the block completes,
  // after what it emitted, so a second trace on the root's id reads as a re-run.
  it.each([
    ["onStarted", "true"],
    ["onStarted", "false"],
    ["onFinished", "true"],
    ["onFinished", "false"]
  ] as const)("keeps the message the action's block emitted in the session's items (request.%s, trace observability %s)", async (hook, observability) => {
    vi.stubEnv("FSDEV_TRACE_OBSERVABILITY", observability);
    const flow = defineFlow({
      kind: "observed",
      request: { [hook]: handler({ name: `observed-${hook}`, execute: () => ({ seen: true }) }) },
      actions: {
        run: {
          inputSchema: z.object({ value: z.string() }),
          block: handler({
            name: "observed-run",
            execute: (input: { value: string }, ctx) => {
              ctx.emit.message(`answer ${input.value}`);
              return { ok: true };
            }
          })
        }
      }
    })({ id: "observed" });
    const registry = createFlowRegistry();
    registry.register(flow);
    const router = createFlowApiRouter({ registry, stores: createInMemoryStores() });

    await router.POST(
      new Request("http://localhost/api/flows/observed/sess_observed/actions/run", {
        method: "POST",
        body: JSON.stringify({ userId: "user_observed", input: { value: "v1" } })
      }),
      { params: { path: ["observed", "sess_observed", "actions", "run"] } }
    );
    await new Promise((resolve) => setTimeout(resolve, 50));

    const state = await router.GET(
      new Request("http://localhost/api/flows/sessions/sess_observed/state?include_items=true&item_types=message"),
      { params: { path: ["sessions", "sess_observed", "state"] } }
    );
    const body = (await state.json()) as { items: Array<{ role?: string; content?: Array<{ text?: string }> }> };
    const texts = body.items.filter((item) => item.role === "assistant").map((item) => item.content?.[0]?.text);
    expect(texts).toEqual(["answer v1"]);
  });
});
