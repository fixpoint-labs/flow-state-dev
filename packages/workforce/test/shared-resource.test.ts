/**
 * Shared resources name who wrote each entry (FIX-1789 V5: BR-20 to BR-24).
 *
 * Every leg runs on the real engine — `createFlowState`, in-memory stores,
 * `runAction` for two users of one org — and reads what the store holds after
 * the run, never what the helper returned.
 */
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { defineFlow, handler } from "@flow-state-dev/core";
import type { FlowInstance } from "@flow-state-dev/core/types";
import { createFlowState, inMemoryStores, runAction } from "@flow-state-dev/engine";
import { hireWorkforce } from "../src/hire";
import { sharedResource, writeShared } from "../src/shared-resource";
import { workerConfigSchema } from "../src/worker-config";

const ORG = "acme";
const notes = sharedResource("team-notes/*", { text: z.string() });
const resources = { notes };

const writeInput = z.object({
  message: z.string(),
  key: z.string().default("note"),
  // What a caller might try: sign the entry as someone else.
  writtenBy: z.unknown().optional()
});

/** Writes through the helper, passing along whatever the caller sent. */
const share = handler({
  name: "share-note",
  inputSchema: writeInput,
  outputSchema: z.object({ message: z.string() }),
  resources,
  execute: async (input, ctx) => {
    await writeShared(ctx as never, "notes", input.key, { text: input.message, writtenBy: input.writtenBy });
    return { message: "shared" };
  }
});

/** Writes the resource directly, with no `writtenBy`. */
const unsigned = handler({
  name: "unsigned-note",
  inputSchema: writeInput,
  outputSchema: z.object({ message: z.string() }),
  resources,
  execute: async (input, ctx) => {
    await (ctx.resources.notes as never as { create: (k: string, v: unknown) => Promise<unknown> }).create(input.key, {
      text: input.message
    });
    return { message: "written" };
  }
});

/** Flow code setting its own `writtenBy` (K3): the helper's stamp is not the store's. */
const selfSigned = handler({
  name: "self-signed-note",
  inputSchema: writeInput,
  outputSchema: z.object({ message: z.string() }),
  resources,
  execute: async (input, ctx) => {
    await (ctx.resources.notes as never as { create: (k: string, v: unknown) => Promise<unknown> }).create(input.key, {
      text: input.message,
      writtenBy: { userId: "bob" }
    });
    return { message: "written" };
  }
});

const sharerFlow = defineFlow({
  kind: "sharer",
  cardinality: "collection",
  configSchema: workerConfigSchema(),
  actions: {
    run: { inputSchema: writeInput, block: share, userMessage: (i: { message: string }) => i.message },
    unsigned: { inputSchema: writeInput, block: unsigned },
    selfSigned: { inputSchema: writeInput, block: selfSigned }
  }
});

/** An app flow no worker runs on: a person writing through the app. */
const appFlow = defineFlow({ kind: "app", actions: { share: { inputSchema: writeInput, block: share } } });

async function withRuntime(
  flows: FlowInstance[],
  body: (
    run: (
      flow: FlowInstance,
      action: string,
      user: string,
      input: z.infer<typeof writeInput>
    ) => Promise<{ error?: unknown; output?: unknown }>,
    read: (key: string) => Promise<unknown>
  ) => Promise<void>
) {
  const state = createFlowState({
    flows: Object.fromEntries(flows.map((flow) => [flow.id, flow])),
    stores: { default: { primary: inMemoryStores() } }
  });
  try {
    const runtime = await state.getRuntime();
    const run = async (flow: FlowInstance, actionName: string, userId: string, input: z.infer<typeof writeInput>) =>
      runAction({
        orgId: ORG,
        flow,
        actionName,
        input,
        userId,
        sessionId: `${userId}-${actionName}-${input.key}`,
        stores: runtime.stores,
        runtimeConfig: { ...runtime.runtimeConfig }
      });
    const read = async (key: string) =>
      ((await runtime.stores.resourceState.get("org", ORG, `team-notes/${key}`)) as { state?: unknown } | undefined)
        ?.state;
    await body(run, read);
  } finally {
    await state.dispose();
  }
}

function hireSharer(): FlowInstance {
  return hireWorkforce([{ id: "research.scout", declared: { flow: "sharer" }, body: "" }], {
    workerFlows: { sharer: sharerFlow }
  })[0]!;
}

describe("a shared resource", () => {
  it("BR-20 · an entry a worker writes through the helper names the session's user and the worker", async () => {
    const seat = hireSharer();
    await withRuntime([seat], async (run, read) => {
      expect((await run(seat, "run", "alice", { message: "Launch moved to Friday.", key: "launch" })).error).toBeUndefined();
      expect(await read("launch")).toEqual({
        text: "Launch moved to Friday.",
        writtenBy: { userId: "alice", workerId: "research.scout" }
      });
    });
  });

  it("BR-22 · a `writtenBy` in the caller's input is ignored: the name comes from the session", async () => {
    const seat = hireSharer();
    await withRuntime([seat], async (run, read) => {
      await run(seat, "run", "alice", { message: "forged", key: "forged", writtenBy: { userId: "mallory", workerId: "x" } });
      expect(await read("forged")).toEqual({ text: "forged", writtenBy: { userId: "alice", workerId: "research.scout" } });
    });
  });

  it("BR-21 · an entry written without `writtenBy` is refused by the resource's own schema", async () => {
    const seat = hireSharer();
    await withRuntime([seat], async (run, read) => {
      const { error } = await run(seat, "unsigned", "alice", { message: "anonymous", key: "anonymous" });
      expect(error).toBeDefined();
      expect(await read("anonymous")).toBeUndefined();
    });
  });

  it("BR-23 · a person writing through the app, with no worker, is named alone", async () => {
    const app = appFlow();
    await withRuntime([app], async (run, read) => {
      await run(app, "share", "alice", { message: "from the app", key: "app" });
      expect(await read("app")).toEqual({ text: "from the app", writtenBy: { userId: "alice" } });
    });
  });

  it("BR-24 · another user of the org reads the entry, with who wrote it", async () => {
    const seat = hireSharer();
    const reader = handler({
      name: "read-note",
      inputSchema: writeInput,
      outputSchema: z.object({ message: z.string() }),
      resources,
      execute: async (input, ctx) => {
        const entry = await (ctx.resources.notes as never as { get: (k: string) => Promise<{ state: unknown }> }).get(
          input.key
        );
        return { message: JSON.stringify(entry.state) };
      }
    });
    const readerFlow = defineFlow({ kind: "reader", actions: { read: { inputSchema: writeInput, block: reader } } })();
    await withRuntime([seat, readerFlow], async (run) => {
      await run(seat, "run", "alice", { message: "for everyone", key: "everyone" });
      const read = await run(readerFlow, "read", "bob", { message: "", key: "everyone" });
      expect(read.error).toBeUndefined();
      expect(JSON.parse((read.output as { message: string }).message)).toEqual({
        text: "for everyone",
        writtenBy: { userId: "alice", workerId: "research.scout" }
      });
    });
  });

  it("K3 · flow code that writes the resource directly can set its own `writtenBy`, which is why it is only as trustworthy as the flow", async () => {
    const seat = hireSharer();
    await withRuntime([seat], async (run, read) => {
      await run(seat, "selfSigned", "alice", { message: "signed as bob", key: "k3" });
      expect(await read("k3")).toEqual({ text: "signed as bob", writtenBy: { userId: "bob" } });
    });
  });
});
