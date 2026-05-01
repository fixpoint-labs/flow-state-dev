/**
 * End-to-end test for FIX-480 §3.2: a streaming-text generator at the
 * root, and inside a sequencer, emits its `block_output` as a ref to
 * its just-emitted `MessageItem` rather than inlining a duplicate copy
 * of the streamed text.
 *
 * Goes through `runAction` so the executeBlock-spread-context bug
 * (where my hint write went to a copy and got lost) cannot mask. The
 * unit-level `generator-block-output-ref.test.ts` in core asserts the
 * hint write itself; this file asserts the production wiring.
 */
import {
  defineFlow,
  generator,
  handler,
  sequencer,
} from "@flow-state-dev/core";
import type { GeneratorModel } from "@flow-state-dev/core/types";
import type {
  BlockOutputItem,
  BlockValue,
  MessageItem,
  OutputItem,
} from "@flow-state-dev/core/items";
import { resolveBlockValue, buildItemLookup } from "@flow-state-dev/core/items";
import { z } from "zod";
import { describe, expect, it } from "vitest";
import {
  createInMemoryStores,
  createResponseEmitter,
  runAction,
} from "../src";

function streamingModelResolver(chunks: string[]) {
  const resolver = ((modelId: string) => {
    return {
      modelId,
      async generate() {
        return { text: chunks.join("") };
      },
      async *stream() {
        for (const chunk of chunks) {
          yield { type: "text_delta" as const, textDelta: chunk };
        }
        yield {
          type: "finish" as const,
          fullResult: { text: chunks.join("") },
        };
      },
    } as unknown as GeneratorModel;
  }) as ((modelId: string) => GeneratorModel) & { resolveId: (id: string) => string };
  resolver.resolveId = (id) => id;
  return resolver;
}

async function runFlow(args: {
  flow: ReturnType<ReturnType<typeof defineFlow>>;
  input: unknown;
  chunks: string[];
}): Promise<{ items: OutputItem[] }> {
  const stores = createInMemoryStores();
  const response = createResponseEmitter({
    requestId: "req_fix480",
    now: () => Date.now(),
  });
  await runAction({
    flow: args.flow,
    actionName: "run",
    input: args.input,
    userId: "u",
    sessionId: "s",
    stores,
    responseEmitter: response,
    modelResolver: streamingModelResolver(args.chunks),
  });
  return { items: response.getItems() };
}

describe("FIX-480 streaming-text generator emits block_output as ref-to-message", () => {
  it("root streaming generator: block_output is a ref pointing at the emitted MessageItem", async () => {
    const gen = generator({
      name: "stream-gen",
      agentType: "primary",
      model: "mock-stream",
      prompt: "hi",
    });

    const flow = defineFlow({
      kind: "fix480-root",
      actions: {
        run: { inputSchema: z.unknown(), block: gen },
      },
    })();

    const { items } = await runFlow({
      flow,
      input: {},
      chunks: ["hello", " world"],
    });

    const blockOutput = items.find(
      (i) => i.type === "block_output" && i.blockName === "stream-gen",
    ) as BlockOutputItem | undefined;
    expect(blockOutput).toBeDefined();

    const value = blockOutput!.output as BlockValue<unknown>;
    expect(value.kind).toBe("ref");

    const message = items.find((i) => i.type === "message") as MessageItem | undefined;
    expect(message).toBeDefined();
    expect((value as { sourceItemId: string }).sourceItemId).toBe(message!.id);

    // Resolution returns the joined text.
    const lookup = buildItemLookup(items);
    const resolved = resolveBlockValue<string>(value, lookup);
    expect(resolved).toBe("hello world");
  });

  it("nested streaming generator inside a sequencer: block_output is still a ref", async () => {
    const gen = generator({
      name: "nested-stream-gen",
      agentType: "sub",
      model: "mock-stream",
      prompt: "hi",
    });

    const passThrough = handler({
      name: "pass-through",
      inputSchema: z.string(),
      outputSchema: z.string(),
      execute: (s) => s,
    });

    const seq = sequencer({
      name: "outer-seq",
      inputSchema: z.unknown(),
    })
      .then(gen)
      .then(passThrough);

    const flow = defineFlow({
      kind: "fix480-nested",
      actions: {
        run: { inputSchema: z.unknown(), block: seq },
      },
    })();

    const { items } = await runFlow({
      flow,
      input: {},
      chunks: ["nested"],
    });

    const genOutput = items.find(
      (i) => i.type === "block_output" && i.blockName === "nested-stream-gen",
    ) as BlockOutputItem | undefined;
    expect(genOutput).toBeDefined();

    const value = genOutput!.output as BlockValue<unknown>;
    expect(value.kind).toBe("ref");

    const message = items.find(
      (i) => i.type === "message" && i.provenance.blockName === "nested-stream-gen",
    ) as MessageItem | undefined;
    expect(message).toBeDefined();
    expect((value as { sourceItemId: string }).sourceItemId).toBe(message!.id);

    // Pass-through handler returned the same string — its block_output
    // refs the generator's, which refs the message. Flatten-at-emit
    // collapses to a single hop pointing at the message.
    const passOutput = items.find(
      (i) => i.type === "block_output" && i.blockName === "pass-through",
    ) as BlockOutputItem | undefined;
    expect(passOutput).toBeDefined();
    const lookup = buildItemLookup(items);
    expect(resolveBlockValue<string>(passOutput!.output, lookup)).toBe("nested");
  });

  it("downstream block reading the worker output gets the resolved string (task-board recordSuccess shape)", async () => {
    // Mirrors the supervisor pattern's worker → recordSuccess flow:
    // a handler downstream of a streaming-text generator receives the
    // worker's actual return value (the string), not a BlockValue.
    // This is the regression coverage for "task never completes" —
    // recordSuccess depends on the worker output flowing through as a
    // plain string regardless of the block_output emission shape.
    const gen = generator({
      name: "worker-gen",
      agentType: "sub",
      model: "mock-stream",
      prompt: "hi",
    });

    let recordedOutput: unknown = undefined;
    const recordHandler = handler({
      name: "record-handler",
      inputSchema: z.unknown(),
      outputSchema: z.unknown(),
      execute: (output) => {
        recordedOutput = output;
        return output;
      },
    });

    const seq = sequencer({ name: "worker-then-record", inputSchema: z.unknown() })
      .then(gen)
      .tap(recordHandler);

    const flow = defineFlow({
      kind: "fix480-recordsuccess",
      actions: { run: { inputSchema: z.unknown(), block: seq } },
    })();

    await runFlow({ flow, input: {}, chunks: ["task complete"] });

    expect(recordedOutput).toBe("task complete");
  });
});
