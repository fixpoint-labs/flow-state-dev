/**
 * Shared resources name who wrote each entry (FIX-1789 V5: BR-20 to BR-24),
 * the worker taken from the session's worker (FIX-1788 BR-25a).
 *
 * Every leg runs on the real engine — in-memory stores, `runAction` for two
 * users of one org — and reads what the store holds after the run, never what
 * the helper returned. A worker's legs run on the worker model: a session
 * created with its worker, which the turn resolves before it writes.
 */
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { DEFAULT_ORG_ID, defineFlow, handler } from "@flow-state-dev/core";
import type { FlowInstance } from "@flow-state-dev/core/types";
import {
  createFlowState,
  createInMemoryStores,
  inMemoryStores,
  runAction,
  type StoreRegistry
} from "@flow-state-dev/engine";
import { sharedResource, writeShared } from "../src/shared-resource";
import { workerConfigSchema } from "../src/worker-config";
import { bootHost, FIXTURE, ORG as HARNESS_ORG } from "./worker-model-harness";

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

/** A worker's turn writing through the helper, on the worker model's fixture flow. */
async function workerShares(
  host: ReturnType<typeof bootHost>,
  stores: StoreRegistry,
  userId: string,
  workerId: string,
  key: string
): Promise<unknown> {
  const created = await host.create(userId, FIXTURE, { state: { workerId } });
  expect(created.status).toBe(201);
  expect((await host.turn(userId, created.body.session!.id, `share:${key}`)).error).toBeUndefined();
  return ((await stores.resourceState.get("org", HARNESS_ORG, `team-notes/${key}`)) as { state?: unknown } | undefined)
    ?.state;
}

describe("a shared resource", () => {
  it("BR-20 · an entry a worker writes through the helper names the session's user and the worker", async () => {
    const stores = createInMemoryStores();
    const host = bootHost(stores);
    expect(await workerShares(host, stores, "alice", "researcher", "launch")).toEqual({
      text: "share:launch",
      writtenBy: { userId: "alice", workerId: "researcher" }
    });
  });

  it("FIX-1788 BR-25a · two of a user's workers on one flow sign as two workers, each from its session", async () => {
    const stores = createInMemoryStores();
    const host = bootHost(stores);
    await host.rosterAction("alice", "hire", { id: "scribe", flow: FIXTURE });
    expect(await workerShares(host, stores, "alice", "scribe", "one")).toEqual({
      text: "share:one",
      writtenBy: { userId: "alice", workerId: "scribe" }
    });
    expect(await workerShares(host, stores, "alice", "researcher", "two")).toEqual({
      text: "share:two",
      writtenBy: { userId: "alice", workerId: "researcher" }
    });
  });

  it("FIX-1788 · a flow that isn't a worker flow names no worker, whatever its settings or a caller's state say", async () => {
    // A `seatId` setting and a `workerId` the caller seeded: neither is a
    // worker the turn resolved, so neither signs the entry.
    const seatIdFlow = defineFlow({
      kind: "seat-id-app",
      configSchema: z.object({ seatId: z.string() }),
      session: { stateSchema: z.object({ workerId: z.string().optional() }) },
      actions: { share: { inputSchema: writeInput, block: share } }
    })({ id: "seat-id-app", config: { seatId: "research.scout" } });
    const state = createFlowState({
      flows: { "seat-id-app": seatIdFlow },
      stores: { default: { primary: inMemoryStores() } }
    });
    try {
      const runtime = await state.getRuntime();
      const router = await state.getRouter();
      const created = await router.POST(
        new Request("http://localhost/api/flows/seat-id-app/sessions", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ userId: "alice", sessionId: "seeded", state: { workerId: "research.scout" } })
        }),
        { params: { path: ["seat-id-app", "sessions"] } }
      );
      expect(created.status).toBe(201);
      expect((await runtime.stores.session.get("seeded"))?.state).toEqual({ workerId: "research.scout" });
      const ran = await runAction({
        orgId: DEFAULT_ORG_ID,
        flow: seatIdFlow,
        actionName: "share",
        input: { message: "no worker", key: "nw" },
        userId: "alice",
        sessionId: "seeded",
        stores: runtime.stores,
        runtimeConfig: { ...runtime.runtimeConfig }
      });
      expect(ran.error).toBeUndefined();
      const stored = (await runtime.stores.resourceState.get("org", DEFAULT_ORG_ID, "team-notes/nw")) as { state?: unknown } | undefined;
      expect(stored?.state).toEqual({ text: "no worker", writtenBy: { userId: "alice" } });
    } finally {
      await state.dispose();
    }
  });

  it("BR-22 · a `writtenBy` in the caller's input is ignored: the name comes from the session", async () => {
    const seat = sharerFlow({ id: "sharer", config: {} });
    await withRuntime([seat], async (run, read) => {
      await run(seat, "run", "alice", { message: "forged", key: "forged", writtenBy: { userId: "mallory", workerId: "x" } });
      expect(await read("forged")).toEqual({ text: "forged", writtenBy: { userId: "alice" } });
    });
  });

  it("BR-21 · an entry written without `writtenBy` is refused by the resource's own schema", async () => {
    const seat = sharerFlow({ id: "sharer", config: {} });
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
    const seat = sharerFlow({ id: "sharer", config: {} });
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
        writtenBy: { userId: "alice" }
      });
    });
  });

  it("K3 · flow code that writes the resource directly can set its own `writtenBy`, which is why it is only as trustworthy as the flow", async () => {
    const seat = sharerFlow({ id: "sharer", config: {} });
    await withRuntime([seat], async (run, read) => {
      await run(seat, "selfSigned", "alice", { message: "signed as bob", key: "k3" });
      expect(await read("k3")).toEqual({ text: "signed as bob", writtenBy: { userId: "bob" } });
    });
  });
});
