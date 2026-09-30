/**
 * The request record carries what its action came to (FIX-1661, D1).
 *
 * A client that dispatched an action over HTTP gets a request id back and
 * nothing else. The record is where it reads the answer, so every assertion
 * below reads the STORED record, not only the value `runAction` returns: a
 * result that reached the in-process caller but never the record is the defect
 * this field exists to remove.
 */
import { DEFAULT_ORG_ID, defineFlow, generator, handler, sequencer } from "@flow-state-dev/core";
import type { FlowInstance, SuspensionRecord } from "@flow-state-dev/core/types";
import { z } from "zod";
import { describe, expect, it } from "vitest";
import { continueRequest, createFlowRegistry, createInMemoryStores, runAction } from "../src";
import { createCheckpointDurabilityProvider } from "../src/durability/checkpoint-durability-provider";
import { buildRequestActionResult } from "../src/execution/request-action-result";

const answer = { ok: false, error: "task is cancelled, which is terminal" };

function oneAction(options: {
  execute: (input: unknown) => unknown;
  transient?: boolean;
  onCompleted?: () => unknown;
  flowOnCompleted?: () => unknown;
}) {
  return defineFlow({
    kind: `result-${Math.random().toString(16).slice(2)}`,
    ...(options.flowOnCompleted !== undefined
      ? {
          request: {
            onCompleted: handler({ name: "flow-on-completed", execute: options.flowOnCompleted })
          }
        }
      : {}),
    actions: {
      run: {
        inputSchema: z.object({}),
        block: handler({
          name: "run",
          ...(options.transient === true ? { transient: true } : {}),
          inputSchema: z.object({}),
          execute: (input) => options.execute(input)
        }),
        ...(options.onCompleted !== undefined
          ? { onCompleted: handler({ name: "action-on-completed", execute: options.onCompleted }) }
          : {})
      }
    }
  } as never)() as FlowInstance;
}

async function run(flow: FlowInstance, requestId: string, runtimeConfig: Record<string, unknown> = {}) {
  const stores = createInMemoryStores();
  const returned = await runAction({
    orgId: DEFAULT_ORG_ID,
    flow,
    actionName: "run",
    input: {},
    requestId,
    userId: "u_result",
    sessionId: "s_result",
    stores,
    runtimeConfig
  } as never);
  const record = await stores.request.get(requestId);
  return { returned, record };
}

describe("the request record's action result", () => {
  it("stores the action's own return value on completion, in the final write (BR-1)", async () => {
    const { record } = await run(
      oneAction({ execute: () => answer, flowOnCompleted: () => ({ hook: "not the answer" }) }),
      "req_completed"
    );
    expect(record?.status).toBe("completed");
    expect(record?.result).toEqual({ output: answer });
  });

  it("records an action that returned nothing as an empty result, not an absent one (BR-1)", async () => {
    const { record } = await run(oneAction({ execute: () => undefined }), "req_nothing");
    expect(record?.status).toBe("completed");
    expect(record?.result).toEqual({});
  });

  it("stores the output on a request that ends incomplete (BR-2)", async () => {
    const stores = createInMemoryStores();
    const flow = defineFlow({
      kind: "result-budget-stop",
      actions: {
        run: {
          inputSchema: z.object({}),
          block: generator({
            name: "budget-generator",
            model: "openai/gpt-5-mini",
            prompt: () => "prompt",
            user: () => "hello"
          }),
          tokenBudget: { maxTotalTokens: 5, onExceeded: "stop" }
        }
      }
    })();
    const returned = await runAction({
      orgId: DEFAULT_ORG_ID,
      flow,
      actionName: "run",
      input: {},
      requestId: "req_incomplete",
      userId: "u_result",
      sessionId: "s_result",
      stores,
      runtimeConfig: {
        modelResolver: () => ({
          modelId: "openai/gpt-5-mini",
          async generate() {
            return { text: "the answer", usage: { promptTokens: 4, completionTokens: 4, totalTokens: 8 } };
          }
        })
      }
    });
    const record = await stores.request.get("req_incomplete");
    expect(record?.status).toBe("incomplete");
    expect(record?.result).toEqual({ output: returned.output });
    expect(record?.result?.output).toBeDefined();
  });

  it("stores the normalized error, and no output, when the action throws (BR-3)", async () => {
    const { record, returned } = await run(
      oneAction({
        execute: () => {
          throw new Error("the ledger is gone");
        }
      }),
      "req_throws"
    );
    expect(record?.status).toBe("failed");
    expect(record?.result?.error?.message).toContain("the ledger is gone");
    expect(typeof record?.result?.error?.code).toBe("string");
    expect(record?.result).not.toHaveProperty("output");
    // BR-10: the in-process caller and the record agree.
    expect(record?.result?.error).toEqual({ code: returned.error?.code, message: returned.error?.message });
  });

  it("keeps the action's answer beside the hook's error when a completion hook fails the request (BR-4)", async () => {
    const { record, returned } = await run(
      oneAction({
        execute: () => answer,
        onCompleted: () => {
          throw new Error("notification hook failed");
        }
      }),
      "req_hook_fails"
    );
    expect(record?.status).toBe("failed");
    expect(record?.result?.error?.message).toContain("notification hook failed");
    expect(record?.result?.output).toEqual(answer);
    // BR-10: the in-process caller gets the same pair.
    expect(returned.output).toEqual(answer);
    expect(record?.result?.error).toEqual({ code: returned.error?.code, message: returned.error?.message });
  });

  it("stores the result even when the action's block is transient (BR-8)", async () => {
    const { record } = await run(oneAction({ execute: () => answer, transient: true }), "req_transient");
    expect(record?.result).toEqual({ output: answer });
  });

  it("stores the result when trace observability is off (BR-8)", async () => {
    const { record } = await run(oneAction({ execute: () => answer }), "req_traces_off", {
      tracingLevel: "minimal"
    });
    expect(record?.result).toEqual({ output: answer });
  });

  it("lands the final status with a marker, not the value, when the output cannot be stored as JSON (BR-9, BR-10)", async () => {
    const { record, returned } = await run(oneAction({ execute: () => ({ big: BigInt(1) }) }), "req_bigint");
    expect(record?.status).toBe("completed");
    expect(record?.result).toEqual({ outputNotRecorded: true });
    // The in-process caller keeps the live value.
    expect(returned.output).toEqual({ big: BigInt(1) });
    expect(returned.error).toBeUndefined();

    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    const cycle = await run(oneAction({ execute: () => cyclic }), "req_cycle");
    expect(cycle.record?.status).toBe("completed");
    expect(cycle.record?.result).toEqual({ outputNotRecorded: true });
  });

  it("lands the final status with a marker when the output's toJSON throws (BR-9)", async () => {
    const hostile = {
      toJSON() {
        throw new Error("not serializable");
      }
    };
    expect(buildRequestActionResult({ status: "completed", output: hostile })).toEqual({ outputNotRecorded: true });
    expect(buildRequestActionResult({ status: "failed", answered: { output: hostile } })).toEqual({
      outputNotRecorded: true
    });
    // A toJSON that returns undefined stringifies to `undefined` rather than throwing.
    expect(buildRequestActionResult({ status: "completed", output: { toJSON: () => undefined } })).toEqual({
      outputNotRecorded: true
    });
  });

  // Storing a value JSON would change is storing a different answer: a reader
  // would see `null` where the action returned `NaN`, or a missing handler
  // where it returned one. The record says so instead.
  it("stores a marker, not a changed value, for an output JSON would alter", () => {
    const lossy: Array<[string, unknown]> = [
      ["NaN", { score: Number.NaN }],
      ["Infinity", { limit: Number.POSITIVE_INFINITY }],
      ["-Infinity", [Number.NEGATIVE_INFINITY]],
      ["a nested function", { ok: true, retry: () => 1 }],
      ["a bare function", () => 1],
      ["a nested symbol", { tag: Symbol("t") }],
      ["an undefined array slot", [1, undefined, 3]],
      // Built-in containers stringify as `{}` or index keys without JSON
      // visiting their contents, so they would store a different answer.
      ["a Map", new Map([["a", 1]])],
      ["a nested Set", { ids: new Set([1, 2]) }],
      ["an Error", new Error("nope")],
      ["a RegExp", { pattern: /x/ }],
      ["a typed array", new Uint8Array([1, 2])]
    ];
    for (const [label, output] of lossy) {
      expect(buildRequestActionResult({ status: "completed", output }), label).toEqual({ outputNotRecorded: true });
    }
    // What JSON keeps faithfully is stored as JSON: a Date as its ISO string,
    // an undefined-valued key left out (it reads back undefined either way).
    const at = new Date("2026-09-30T00:00:00.000Z");
    expect(
      buildRequestActionResult({ status: "completed", output: { at, ok: false, detail: undefined } })
    ).toEqual({ output: { at: "2026-09-30T00:00:00.000Z", ok: false } });
    // A class instance's own fields and a boxed primitive survive JSON.
    class Verdict {
      constructor(readonly ok: boolean) {}
    }
    expect(
      buildRequestActionResult({ status: "completed", output: { v: new Verdict(true), n: Object(3) } })
    ).toEqual({ output: { v: { ok: true }, n: 3 } });
  });

  // Storage is uncapped by design (D1): a large answer is still the answer,
  // and only a listing that opts into outputs pays to carry it.
  it("stores a large output whole", async () => {
    const blob = "é".repeat(256 * 1024);
    const { record, returned } = await run(oneAction({ execute: () => ({ blob }) }), "req_large");
    expect(record?.status).toBe("completed");
    expect(record?.result).toEqual({ output: { blob } });
    expect(returned.output).toEqual({ blob });
  });

  it("gives the in-process caller the same answer the record stores (BR-10)", async () => {
    const { record, returned } = await run(oneAction({ execute: () => answer }), "req_same");
    expect(record?.result?.output).toEqual(returned.output);
    expect(returned.error).toBeUndefined();
    expect(record?.result).not.toHaveProperty("error");
  });

  it("writes no result on an aborted or interrupted request (BR-7)", async () => {
    for (const intentional of [true, false]) {
      const stores = createInMemoryStores();
      const controller = new AbortController();
      const requestId = intentional ? "req_aborted" : "req_interrupted";
      const flow = oneAction({
        execute: () =>
          new Promise((_resolve, reject) => {
            controller.signal.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")));
          })
      });
      const pending = runAction({
        orgId: DEFAULT_ORG_ID,
        flow,
        actionName: "run",
        input: {},
        requestId,
        userId: "u_result",
        sessionId: "s_result",
        signal: controller.signal,
        stores,
        runtimeConfig: {}
      } as never);
      await new Promise((resolve) => setTimeout(resolve, 50));
      if (intentional) {
        await stores.request.setFieldsIfStatus(requestId, { abortRequested: true }, ["in_progress"], Date.now());
      }
      controller.abort();
      await pending;
      const record = await stores.request.get(requestId);
      expect(record?.status).toBe(intentional ? "aborted" : "interrupted");
      expect(record?.result).toBeUndefined();
    }
  });

  it("writes no result while suspended, then writes it once when the same request resumes (BR-6)", async () => {
    const gate = handler({
      name: "gate",
      inputSchema: z.unknown(),
      outputSchema: z.unknown(),
      execute: async (_input, ctx) => {
        const decision = (await ctx.suspend!({ reason: "human_approval", message: "Approve?" })) as {
          note?: string;
        };
        return { ok: true, note: decision?.note ?? null };
      }
    });
    const flow = defineFlow({
      kind: "result-suspend",
      actions: {
        ask: { block: sequencer({ name: "ask-seq", durable: true }).step(gate), inputSchema: z.object({}), durable: true }
      }
    })() as FlowInstance;
    const stores = createInMemoryStores();
    const provider = createCheckpointDurabilityProvider({
      checkpoints: stores.checkpoints,
      suspensions: stores.suspensions,
      leases: stores.leases
    });
    const first = await runAction({
      orgId: DEFAULT_ORG_ID,
      flow,
      actionName: "ask",
      input: {},
      userId: "u_result",
      sessionId: "s_result",
      stores,
      runtimeConfig: { durabilityProvider: provider }
    } as never);
    const requestId = first.requestId!;
    const suspended = await stores.request.get(requestId);
    expect(suspended?.status).toBe("suspended");
    expect(suspended?.result).toBeUndefined();

    const [suspension] = (await provider.listSuspended({ status: "pending" })) as SuspensionRecord[];
    await provider.suspend({ ...suspension!, status: "approved", resolvedAt: Date.now(), resumeData: { note: "yes" } });
    const registry = createFlowRegistry();
    registry.register(flow as never);
    const { finished } = await continueRequest({
      requestId,
      stores,
      flowRegistry: registry,
      resumeContext: { suspensionId: suspension!.suspensionId, action: "approve", data: { note: "yes" }, resumedBy: "r" },
      runtimeConfig: { durabilityProvider: provider }
    });
    await finished;
    const done = await stores.request.get(requestId);
    expect(done?.status).toBe("completed");
    expect(done?.result).toEqual({ output: { ok: true, note: "yes" } });
    expect((await stores.request.list()).length).toBe(1);
  });
});
