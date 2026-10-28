/**
 * A flow's lifecycle observer (`request.onStarted`, `request.onFinished`,
 * `action.onCompleted`, …) is its own block, not a run of the action's block:
 * it runs on its own path, and what the action's block emits stays in the
 * session's items.
 */
import { defineFlow, handler, parseBlockInstanceId } from "@flow-state-dev/core";
import { z } from "zod";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createFlowApiRouter, createFlowRegistry, createInMemoryStores } from "../src";

type Hook = "request.onStarted" | "request.onCompleted" | "request.onFinished" | "action.onCompleted";
type Item = { type: string; role?: string; content?: Array<{ text?: string }>; blockName?: string; provenance?: { blockInstanceId?: string } };

/** A flow whose action's block emits one message, with one observer on `hook`. */
function observedFlow(hook: Hook) {
  const [owner, name] = hook.split(".") as ["request" | "action", string];
  const observer = handler({ name: "observed-observer", execute: () => ({ seen: true }) });
  return defineFlow({
    kind: "observed",
    ...(owner === "request" ? { request: { [name]: observer } } : {}),
    actions: {
      run: {
        inputSchema: z.object({ value: z.string() }),
        ...(owner === "action" ? { [name]: observer } : {}),
        block: handler({
          name: "observed-run",
          execute: (input: { value: string }, ctx) => {
            ctx.emit.message(`answer ${input.value}`);
            return { ok: true };
          }
        })
      }
    }
  } as never)({ id: "observed" });
}

describe("a lifecycle observer beside the action's block", () => {
  afterEach(() => vi.unstubAllEnvs());

  // Lean traces (production's default) take their index when the block completes,
  // after what it emitted, so a second trace on the root's id reads as a re-run.
  const hooks: Hook[] = ["request.onStarted", "request.onCompleted", "request.onFinished", "action.onCompleted"];
  it.each(hooks.flatMap((hook) => [[hook, "true"], [hook, "false"]] as const))(
    "runs %s on its own path and keeps the action's message in the session's items (trace observability %s)",
    async (hook, observability) => {
      vi.stubEnv("FSDEV_TRACE_OBSERVABILITY", observability);
      const registry = createFlowRegistry();
      registry.register(observedFlow(hook));
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
        new Request("http://localhost/api/flows/sessions/sess_observed/state?include_items=true&item_types=message,block_trace"),
        { params: { path: ["sessions", "sess_observed", "state"] } }
      );
      const { items } = (await state.json()) as { items: Item[] };
      const pathOf = (item: Item | undefined) => parseBlockInstanceId(item?.provenance?.blockInstanceId ?? "")?.path;

      const answers = items.filter((item) => item.type === "message" && item.role === "assistant");
      expect(answers.map((item) => item.content?.[0]?.text)).toEqual(["answer v1"]);
      expect(pathOf(answers[0])).toBe("root");
      const observerTraces = items.filter((item) => item.type === "block_trace" && item.blockName === "observed-observer");
      expect(observerTraces.map(pathOf)).toEqual([`observer[${hook}]`]);
    }
  );
});
