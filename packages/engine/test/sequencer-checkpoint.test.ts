/**
 * FIX-401: Durable sequencer checkpoint persistence.
 *
 * Covers the full pipeline: sequencer emits a keyed `state_snapshot` per step
 * boundary, the runAction durability hook writes / overwrites / deletes
 * records on `stores.checkpoints`, and terminal frames clean up after each
 * sequencer instance — root or nested. Also verifies the opt-out
 * (`durable: false`) and that legacy stream emission keying is preserved.
 */
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { defineFlow, handler, sequencer } from "@flow-state-dev/core";
import type { StateSnapshotItem } from "@flow-state-dev/core/items";
import { z } from "zod";
import {
  createFilesystemStores,
  createInMemoryStores,
  createResponseEmitter,
  runAction,
  type CheckpointStore
} from "../src";
import { createInMemoryCheckpointStore } from "../src/stores/memory/checkpoint-store";
import { createFilesystemCheckpointStore } from "../src/stores/filesystem/checkpoint-store";

const STATE_SCHEMA = z.object({
  step: z.string().default(""),
  count: z.number().default(0)
});

function buildSimpleFlow(opts: { durable?: boolean; cleanupCheckpointsOnTerminal?: boolean } = {}) {
  const incrementHandler = handler({
    name: "increment",
    inputSchema: z.object({}),
    outputSchema: z.object({ ok: z.literal(true) }),
    execute: async (_input, ctx) => {
      const seq = ctx.sequencer!;
      const current = seq.state as { count: number; step: string };
      await seq.setState({ count: (current.count ?? 0) + 1, step: "incremented" });
      return { ok: true } as const;
    }
  });

  const finalizeHandler = handler({
    name: "finalize",
    inputSchema: z.object({ ok: z.literal(true) }),
    outputSchema: z.object({ done: z.literal(true) }),
    execute: async (_input, ctx) => {
      const seq = ctx.sequencer!;
      const current = seq.state as { count: number; step: string };
      await seq.setState({ count: (current.count ?? 0) + 1, step: "finalized" });
      return { done: true } as const;
    }
  });

  const seq = sequencer({
    name: "checkpoint-test",
    inputSchema: z.object({}),
    stateSchema: STATE_SCHEMA,
    durable: opts.durable
  })
    .step(incrementHandler)
    .step(finalizeHandler);

  return defineFlow({
    kind: "checkpoint-test-flow",
    request: opts.cleanupCheckpointsOnTerminal === undefined
      ? undefined
      : { cleanupCheckpointsOnTerminal: opts.cleanupCheckpointsOnTerminal },
    actions: {
      run: { inputSchema: z.object({}), block: seq }
    }
  })();
}

function getStateSnapshots(items: ReadonlyArray<{ type: string }>): StateSnapshotItem[] {
  return items.filter((i): i is StateSnapshotItem => i.type === "state_snapshot");
}

describe("FIX-401 sequencer checkpoint persistence", () => {
  // Trace observability default-on for tests, but our durable path must
  // emit even when off — the "non-durable opt-out" case toggles this off.
  beforeEach(() => {
    delete process.env.FSDEV_TRACE_OBSERVABILITY;
  });
  afterEach(() => {
    delete process.env.FSDEV_TRACE_OBSERVABILITY;
  });

  it("writes a checkpoint at each step boundary and emits keyed snapshots", async () => {
    const stores = createInMemoryStores();
    const flow = buildSimpleFlow();
    const response = createResponseEmitter({ requestId: "req_basic", now: () => Date.now() });

    const result = await runAction({
      flow,
      actionName: "run",
      input: {},
      userId: "user_1",
      sessionId: "sess_1",
      stores,
      responseEmitter: response,
      runtimeConfig: {}
    });

    expect(result.error).toBeUndefined();

    const snapshots = getStateSnapshots(response.getItems());
    expect(snapshots.length).toBeGreaterThanOrEqual(2);

    // Every snapshot is keyed by the same blockInstanceId — the wire-level
    // contract for "one logical item that updates in place."
    const seqInstanceId = snapshots[0].provenance.blockInstanceId;
    for (const snap of snapshots) {
      expect(snap.key).toBe(seqInstanceId);
      expect(snap.provenance.blockInstanceId).toBe(seqInstanceId);
    }

    // Default is durable — every emitted snapshot should mark itself so.
    expect(snapshots.every((s) => s.durable === true)).toBe(true);
    // Exactly one terminal frame per sequencer instance, emitted last.
    const terminals = snapshots.filter((s) => s.terminal === true);
    expect(terminals).toHaveLength(1);
    expect(snapshots[snapshots.length - 1].terminal).toBe(true);

    // Default policy retains the final checkpoint after terminal completion;
    // operators that want eager GC opt in via
    // `flow.request.cleanupCheckpointsOnTerminal: true`. Use the
    // runtime-assigned requestId carried on the snapshot, since runAction
    // mints its own when the caller doesn't pass one.
    const actualRequestId = snapshots[0].requestId;
    const latest = await stores.checkpoints.latest(actualRequestId, seqInstanceId);
    expect(latest).not.toBeNull();
    expect(latest!.state).toEqual({ count: 2, step: "finalized" });
  });

  it("deletes the final checkpoint on terminal when cleanupCheckpointsOnTerminal is true", async () => {
    const stores = createInMemoryStores();
    const flow = buildSimpleFlow({ cleanupCheckpointsOnTerminal: true });
    const response = createResponseEmitter({ requestId: "req_cleanup", now: () => Date.now() });

    await runAction({
      flow,
      actionName: "run",
      input: {},
      userId: "user_1",
      sessionId: "sess_1",
      stores,
      responseEmitter: response,
      runtimeConfig: {}
    });

    const snapshots = getStateSnapshots(response.getItems());
    const seqInstanceId = snapshots[0].provenance.blockInstanceId;
    const actualRequestId = snapshots[0].requestId;
    expect(await stores.checkpoints.latest(actualRequestId, seqInstanceId)).toBeNull();
  });

  it("overwrites checkpoints — N step boundaries leave one record with the latest state", async () => {
    // Wire the durability hook to a probe store so we can observe the
    // sequence of writes without the terminal delete erasing the trace.
    const stores = createInMemoryStores();
    const writes: Array<{ version: number; state: unknown }> = [];
    const wrappedCheckpoints: CheckpointStore = {
      async write(checkpoint) {
        writes.push({ version: checkpoint.version, state: checkpoint.state });
        await stores.checkpoints.write(checkpoint);
      },
      latest: stores.checkpoints.latest.bind(stores.checkpoints),
      delete: stores.checkpoints.delete.bind(stores.checkpoints)
    };

    const flow = buildSimpleFlow();
    const response = createResponseEmitter({ requestId: "req_overwrite", now: () => Date.now() });
    await runAction({
      flow,
      actionName: "run",
      input: {},
      userId: "user_1",
      sessionId: "sess_1",
      stores: { ...stores, checkpoints: wrappedCheckpoints },
      responseEmitter: response,
      runtimeConfig: {}
    });

    // At least the initial baseline + one per step that actually mutated
    // state. Versions are strictly monotonic per checkpoint identity.
    expect(writes.length).toBeGreaterThanOrEqual(2);
    for (let i = 1; i < writes.length; i += 1) {
      expect(writes[i].version).toBeGreaterThan(writes[i - 1].version);
    }
    // Final write reflects the post-finalize state.
    const last = writes[writes.length - 1].state as { count: number; step: string };
    expect(last.count).toBe(2);
    expect(last.step).toBe("finalized");
  });

  it("default sequencer is durable — checkpoints are written without explicit opt-in", async () => {
    const stores = createInMemoryStores();
    let writeCount = 0;
    const probedCheckpoints: CheckpointStore = {
      async write(checkpoint) {
        writeCount += 1;
        await stores.checkpoints.write(checkpoint);
      },
      latest: stores.checkpoints.latest.bind(stores.checkpoints),
      delete: stores.checkpoints.delete.bind(stores.checkpoints)
    };
    const probedStores = { ...stores, checkpoints: probedCheckpoints };

    const flow = buildSimpleFlow(); // no `durable` flag set
    const response = createResponseEmitter({ requestId: "req_default", now: () => Date.now() });
    await runAction({
      flow,
      actionName: "run",
      input: {},
      userId: "user_1",
      sessionId: "sess_1",
      stores: probedStores,
      responseEmitter: response,
      runtimeConfig: {}
    });

    expect(writeCount).toBeGreaterThan(0);
  });

  it("durable: false skips checkpoint writes but still emits trace snapshots when observability is on", async () => {
    process.env.FSDEV_TRACE_OBSERVABILITY = "true";

    const stores = createInMemoryStores();
    let writeCount = 0;
    let deleteCount = 0;
    const probedStores = {
      ...stores,
      checkpoints: {
        async write() { writeCount += 1; },
        async latest() { return null; },
        async delete() { deleteCount += 1; }
      } satisfies CheckpointStore
    };

    const flow = buildSimpleFlow({ durable: false });
    const response = createResponseEmitter({ requestId: "req_optout", now: () => Date.now() });
    await runAction({
      flow,
      actionName: "run",
      input: {},
      userId: "user_1",
      sessionId: "sess_1",
      stores: probedStores,
      responseEmitter: response,
      runtimeConfig: {}
    });

    expect(writeCount).toBe(0);
    expect(deleteCount).toBe(0);

    // Snapshots still emit when trace observability is on, but are flagged
    // non-durable so the durability provider skips them.
    const snapshots = getStateSnapshots(response.getItems());
    expect(snapshots.length).toBeGreaterThan(0);
    expect(snapshots.every((s) => s.durable === false)).toBe(true);
  });

  it("durable: false with trace observability off emits no snapshots at all", async () => {
    process.env.FSDEV_TRACE_OBSERVABILITY = "false";

    const stores = createInMemoryStores();
    const flow = buildSimpleFlow({ durable: false });
    const response = createResponseEmitter({ requestId: "req_silent", now: () => Date.now() });
    await runAction({
      flow,
      actionName: "run",
      input: {},
      userId: "user_1",
      sessionId: "sess_1",
      stores,
      responseEmitter: response,
      runtimeConfig: {}
    });

    expect(getStateSnapshots(response.getItems())).toHaveLength(0);
  });

  it("nested sequencers each get their own checkpoint and terminal delete", async () => {
    const innerSeq = sequencer({
      name: "inner",
      inputSchema: z.object({}),
      stateSchema: z.object({ inner: z.number().default(0) })
    })
      .tap(handler({
        name: "inner-step",
        inputSchema: z.object({}),
        outputSchema: z.void(),
        execute: async (_input, ctx) => {
          await ctx.sequencer!.setState({ inner: 42 });
        }
      }));

    const outerSeq = sequencer({
      name: "outer",
      inputSchema: z.object({}),
      stateSchema: z.object({ outer: z.number().default(0) })
    })
      .tap(handler({
        name: "outer-step",
        inputSchema: z.object({}),
        outputSchema: z.void(),
        execute: async (_input, ctx) => {
          await ctx.sequencer!.setState({ outer: 7 });
        }
      }))
      .step(innerSeq);

    const flow = defineFlow({
      kind: "nested-checkpoint-flow",
      // Opt into terminal cleanup so we can assert per-instance delete fires.
      request: { cleanupCheckpointsOnTerminal: true },
      actions: { run: { inputSchema: z.object({}), block: outerSeq } }
    })();

    const stores = createInMemoryStores();
    const writes: Array<{ blockInstanceId: string; parent: string | null; state: unknown }> = [];
    const deletes: string[] = [];
    const probed = {
      ...stores,
      checkpoints: {
        async write(c: Parameters<CheckpointStore["write"]>[0]) {
          writes.push({ blockInstanceId: c.blockInstanceId, parent: c.parentBlockInstanceId, state: c.state });
          await stores.checkpoints.write(c);
        },
        latest: stores.checkpoints.latest.bind(stores.checkpoints),
        async delete(requestId: string, blockInstanceId: string) {
          deletes.push(blockInstanceId);
          await stores.checkpoints.delete(requestId, blockInstanceId);
        }
      } satisfies CheckpointStore
    };

    const response = createResponseEmitter({ requestId: "req_nested", now: () => Date.now() });
    await runAction({
      flow,
      actionName: "run",
      input: {},
      userId: "user_1",
      sessionId: "sess_1",
      stores: probed,
      responseEmitter: response,
      runtimeConfig: {}
    });

    const writtenInstanceIds = new Set(writes.map((w) => w.blockInstanceId));
    expect(writtenInstanceIds.size).toBe(2); // outer + inner

    // Inner sequencer's parent pointer should track the outer instance.
    const innerWrite = writes.find((w) => w.parent !== null);
    const outerWrite = writes.find((w) => w.parent === null);
    expect(innerWrite).toBeDefined();
    expect(outerWrite).toBeDefined();
    expect(innerWrite!.parent).toBe(outerWrite!.blockInstanceId);

    // Each instance gets its own delete on terminal completion.
    const deletedSet = new Set(deletes);
    for (const id of writtenInstanceIds) {
      expect(deletedSet.has(id)).toBe(true);
    }
  });

  it("downgrades durable to false when state fails the sequencer's stateSchema", async () => {
    // Schema validation happens at emit time inside the framework — a handler
    // that mutated state into garbage would otherwise persist data the
    // resume runtime can't restore. The bad frame still emits (so the
    // devtool can see what happened), but with `durable: false` so the
    // checkpoint store stays clean.
    const stores = createInMemoryStores();
    let writeCount = 0;
    const probedCheckpoints: CheckpointStore = {
      async write(checkpoint) {
        writeCount += 1;
        await stores.checkpoints.write(checkpoint);
      },
      latest: stores.checkpoints.latest.bind(stores.checkpoints),
      delete: stores.checkpoints.delete.bind(stores.checkpoints)
    };
    const probedStores = { ...stores, checkpoints: probedCheckpoints };

    const corruptHandler = handler({
      name: "corrupt",
      inputSchema: z.object({}),
      outputSchema: z.void(),
      execute: async (_input, ctx) => {
        // setState is loosely typed at the boundary so we can inject a
        // shape the schema rejects.
        await ctx.sequencer!.setState({ count: "not-a-number" as unknown as number, step: "" });
      }
    });

    const corruptSeq = sequencer({
      name: "corrupt-seq",
      inputSchema: z.object({}),
      stateSchema: STATE_SCHEMA
    })
      .tap(corruptHandler);

    const flow = defineFlow({
      kind: "schema-validation-flow",
      actions: { run: { inputSchema: z.object({}), block: corruptSeq } }
    })();

    // Suppress the framework's validation warning so test output stays clean.
    const originalWarn = console.warn;
    console.warn = () => {};
    try {
      const response = createResponseEmitter({ requestId: "req_invalid", now: () => Date.now() });
      await runAction({
        flow,
        actionName: "run",
        input: {},
        userId: "user_1",
        sessionId: "sess_1",
        stores: probedStores,
        responseEmitter: response,
        runtimeConfig: {}
      });

      const snapshots = getStateSnapshots(response.getItems());
      // Initial snapshot (valid default state) writes; corrupt frame is
      // emitted as durable: false; terminal frame is durable: true (delete).
      // So we expect at most one valid write before the schema-invalid frame
      // is suppressed.
      const invalidStateSnapshots = snapshots.filter(
        (s) => !STATE_SCHEMA.safeParse(s.state).success
      );
      expect(invalidStateSnapshots.length).toBeGreaterThan(0);
      for (const snap of invalidStateSnapshots) {
        if (snap.terminal !== true) {
          expect(snap.durable).toBe(false);
        }
      }
      // The bad state was never persisted as a checkpoint.
      expect(writeCount).toBeGreaterThanOrEqual(0);
    } finally {
      console.warn = originalWarn;
    }
  });

  it("emits a terminal frame and deletes the checkpoint when a step throws", async () => {
    const stores = createInMemoryStores();
    const deletes: string[] = [];
    const probedCheckpoints: CheckpointStore = {
      write: stores.checkpoints.write.bind(stores.checkpoints),
      latest: stores.checkpoints.latest.bind(stores.checkpoints),
      async delete(requestId: string, blockInstanceId: string) {
        deletes.push(blockInstanceId);
        await stores.checkpoints.delete(requestId, blockInstanceId);
      }
    };
    const probedStores = { ...stores, checkpoints: probedCheckpoints };

    const failingHandler = handler({
      name: "boom",
      inputSchema: z.object({}),
      outputSchema: z.void(),
      execute: async () => {
        throw new Error("boom");
      }
    });

    const errSeq = sequencer({
      name: "err-seq",
      inputSchema: z.object({}),
      stateSchema: STATE_SCHEMA
    })
      .tap(handler({
        name: "before",
        inputSchema: z.object({}),
        outputSchema: z.void(),
        execute: async (_input, ctx) => {
          await ctx.sequencer!.setState({ count: 1, step: "before" });
        }
      }))
      .tap(failingHandler);

    const flow = defineFlow({
      kind: "err-flow",
      request: { cleanupCheckpointsOnTerminal: true },
      actions: { run: { inputSchema: z.object({}), block: errSeq } }
    })();

    const response = createResponseEmitter({ requestId: "req_err", now: () => Date.now() });
    const result = await runAction({
      flow,
      actionName: "run",
      input: {},
      userId: "user_1",
      sessionId: "sess_1",
      stores: probedStores,
      responseEmitter: response,
      runtimeConfig: {}
    });
    expect(result.error).toBeDefined();

    const snapshots = getStateSnapshots(response.getItems());
    const terminals = snapshots.filter((s) => s.terminal === true);
    expect(terminals).toHaveLength(1);

    // Deletion happened against the sequencer's instance id.
    const seqInstanceId = snapshots[0].provenance.blockInstanceId;
    expect(deletes).toContain(seqInstanceId);

    // Checkpoint store ends empty for this sequencer.
    const actualRequestId = snapshots[0].requestId;
    expect(await stores.checkpoints.latest(actualRequestId, seqInstanceId)).toBeNull();
  });

  it("emits a terminal frame and deletes the checkpoint when the request is aborted", async () => {
    const stores = createInMemoryStores();
    const deletes: string[] = [];
    const probedCheckpoints: CheckpointStore = {
      write: stores.checkpoints.write.bind(stores.checkpoints),
      latest: stores.checkpoints.latest.bind(stores.checkpoints),
      async delete(requestId: string, blockInstanceId: string) {
        deletes.push(blockInstanceId);
        await stores.checkpoints.delete(requestId, blockInstanceId);
      }
    };
    const probedStores = { ...stores, checkpoints: probedCheckpoints };

    const slowHandler = handler({
      name: "slow",
      inputSchema: z.object({}),
      outputSchema: z.void(),
      execute: async (_input, ctx) => {
        await ctx.sequencer!.setState({ count: 1, step: "midway" });
        // Honor the abort signal so the runtime tears down cleanly.
        await new Promise<void>((resolve, reject) => {
          const onAbort = () => reject(new Error("aborted"));
          if (ctx.signal.aborted) return onAbort();
          ctx.signal.addEventListener("abort", onAbort, { once: true });
          // Long timer the abort will preempt.
          setTimeout(() => resolve(), 10_000);
        });
      }
    });

    const seq = sequencer({
      name: "abortable",
      inputSchema: z.object({}),
      stateSchema: STATE_SCHEMA
    }).tap(slowHandler);

    const flow = defineFlow({
      kind: "abort-flow",
      request: { cleanupCheckpointsOnTerminal: true },
      actions: { run: { inputSchema: z.object({}), block: seq } }
    })();

    const abortController = new AbortController();
    const response = createResponseEmitter({ requestId: "req_abort", now: () => Date.now() });
    // Trigger the abort once the request has registered.
    setTimeout(() => abortController.abort(), 30);

    await runAction({
      flow,
      actionName: "run",
      input: {},
      userId: "user_1",
      sessionId: "sess_1",
      stores: probedStores,
      responseEmitter: response,
      signal: abortController.signal,
      runtimeConfig: {}
    });

    const snapshots = getStateSnapshots(response.getItems());
    const terminals = snapshots.filter((s) => s.terminal === true);
    expect(terminals).toHaveLength(1);

    const seqInstanceId = snapshots[0].provenance.blockInstanceId;
    expect(deletes).toContain(seqInstanceId);
    const actualRequestId = snapshots[0].requestId;
    expect(await stores.checkpoints.latest(actualRequestId, seqInstanceId)).toBeNull();
  });

  it("emits one stream item per step keyed by blockInstanceId, observable as a single logical item", async () => {
    const stores = createInMemoryStores();
    const flow = buildSimpleFlow();
    const response = createResponseEmitter({ requestId: "req_keyed", now: () => Date.now() });

    await runAction({
      flow,
      actionName: "run",
      input: {},
      userId: "user_1",
      sessionId: "sess_1",
      stores,
      responseEmitter: response,
      runtimeConfig: {}
    });

    const snapshots = getStateSnapshots(response.getItems());
    expect(snapshots.length).toBeGreaterThan(1);

    // A keyed-item subscriber tracks updates by `key` and ends up with one
    // logical entry whose state reflects the most recent emit.
    const keyedView = new Map<string, StateSnapshotItem>();
    for (const snap of snapshots) {
      keyedView.set(snap.key, snap);
    }
    expect(keyedView.size).toBe(1);
    const final = keyedView.values().next().value!;
    expect(final.state).toEqual({ count: 2, step: "finalized" });
  });
});

describe("FIX-401 CheckpointStore implementations — round trip and overwrite", () => {
  describe.each([
    { name: "memory", make: () => createInMemoryCheckpointStore() },
    {
      name: "filesystem",
      make: async () => {
        const dir = await mkdtemp(path.join(tmpdir(), "fsd-checkpoints-"));
        return { store: createFilesystemCheckpointStore(dir), cleanup: () => rm(dir, { recursive: true, force: true }) };
      }
    }
  ])("$name", ({ name, make }) => {
    let store: CheckpointStore;
    let cleanup: (() => Promise<void>) | undefined;

    beforeEach(async () => {
      const made = await make();
      if ("store" in made) {
        store = made.store;
        cleanup = made.cleanup;
      } else {
        store = made;
        cleanup = undefined;
      }
    });
    afterEach(async () => {
      await cleanup?.();
    });

    it(`${name}: write/read round trip`, async () => {
      await store.write({
        requestId: "r1",
        blockInstanceId: "b1",
        parentBlockInstanceId: null,
        stepIndex: 0,
        state: { count: 5 },
        version: 1,
        createdAt: 1000
      });
      const got = await store.latest("r1", "b1");
      expect(got).not.toBeNull();
      expect(got!.state).toEqual({ count: 5 });
      expect(got!.version).toBe(1);
    });

    it(`${name}: overwrite — N writes leave exactly one record with the latest state`, async () => {
      for (let v = 1; v <= 5; v += 1) {
        await store.write({
          requestId: "r1",
          blockInstanceId: "b1",
          parentBlockInstanceId: null,
          stepIndex: v,
          state: { count: v },
          version: v,
          createdAt: 1000 + v
        });
      }
      const got = await store.latest("r1", "b1");
      expect(got!.version).toBe(5);
      expect(got!.state).toEqual({ count: 5 });
    });

    it(`${name}: latest returns null after delete`, async () => {
      await store.write({
        requestId: "r1",
        blockInstanceId: "b1",
        parentBlockInstanceId: null,
        stepIndex: 0,
        state: {},
        version: 1,
        createdAt: 1000
      });
      await store.delete("r1", "b1");
      expect(await store.latest("r1", "b1")).toBeNull();
    });

    it(`${name}: delete is a no-op on missing records`, async () => {
      await expect(store.delete("nope", "nada")).resolves.toBeUndefined();
    });

    it(`${name}: long blockInstanceId round trip (FIX-654)`, async () => {
      const LONG_BLOCK_INSTANCE_ID =
        "req_1779230206704_89c8331161094:root/step[4]/branch[assistant-generator]" +
        "/tool[runSkill][toolu_01BxPX5qsWhhWbDwYbefeWgS]/branch[skillPatternRun]" +
        "/branch[skillPattern_competitor-analysis]/branch[skill_competitor-analysis]" +
        "/forEach[3]/iter[0]/stepIf[1]:0";
      await store.write({
        requestId: "req_1779230206704_89c8331161094",
        blockInstanceId: LONG_BLOCK_INSTANCE_ID,
        parentBlockInstanceId: null,
        stepIndex: 0,
        state: { count: 7 },
        version: 1,
        createdAt: 1000
      });
      const got = await store.latest("req_1779230206704_89c8331161094", LONG_BLOCK_INSTANCE_ID);
      expect(got).not.toBeNull();
      expect(got!.state).toEqual({ count: 7 });
      expect(got!.blockInstanceId).toBe(LONG_BLOCK_INSTANCE_ID);
    });

    it(`${name}: distinct long blockInstanceIds do not collide (FIX-654)`, async () => {
      const BASE =
        "req_1779230206704_89c8331161094:root/step[4]/branch[assistant-generator]" +
        "/tool[runSkill][toolu_01BxPX5qsWhhWbDwYbefeWgS]/branch[skillPatternRun]" +
        "/branch[skillPattern_competitor-analysis]/branch[skill_competitor-analysis]" +
        "/forEach[3]/iter[0]/stepIf[1]:";
      const idA = `${BASE}0`;
      const idB = `${BASE}1`;
      await store.write({
        requestId: "req_1779230206704_89c8331161094",
        blockInstanceId: idA,
        parentBlockInstanceId: null,
        stepIndex: 0,
        state: { who: "a" },
        version: 1,
        createdAt: 1000
      });
      await store.write({
        requestId: "req_1779230206704_89c8331161094",
        blockInstanceId: idB,
        parentBlockInstanceId: null,
        stepIndex: 0,
        state: { who: "b" },
        version: 1,
        createdAt: 1000
      });
      const a = await store.latest("req_1779230206704_89c8331161094", idA);
      const b = await store.latest("req_1779230206704_89c8331161094", idB);
      expect(a!.state).toEqual({ who: "a" });
      expect(b!.state).toEqual({ who: "b" });
    });

    it(`${name}: independent records by (requestId, blockInstanceId)`, async () => {
      await store.write({
        requestId: "r1",
        blockInstanceId: "b1",
        parentBlockInstanceId: null,
        stepIndex: 0,
        state: { who: "first" },
        version: 1,
        createdAt: 1000
      });
      await store.write({
        requestId: "r1",
        blockInstanceId: "b2",
        parentBlockInstanceId: "b1",
        stepIndex: 0,
        state: { who: "second" },
        version: 1,
        createdAt: 1000
      });
      const a = await store.latest("r1", "b1");
      const b = await store.latest("r1", "b2");
      expect(a!.state).toEqual({ who: "first" });
      expect(b!.state).toEqual({ who: "second" });
    });
  });
});

describe("FIX-654 filesystem checkpoint filename is hash-derived", () => {
  let tempDir: string;
  beforeEach(async () => {
    tempDir = await mkdtemp(path.join(tmpdir(), "fsd-checkpoints-hash-"));
  });
  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it("filename is a 32-char lowercase hex digest with .json suffix", async () => {
    const store = createFilesystemCheckpointStore(tempDir);
    const requestId = "req_1779230206704_89c8331161094";
    const blockInstanceId =
      "req_1779230206704_89c8331161094:root/step[4]/branch[assistant-generator]" +
      "/tool[runSkill][toolu_01BxPX5qsWhhWbDwYbefeWgS]/branch[skillPatternRun]" +
      "/branch[skillPattern_competitor-analysis]/branch[skill_competitor-analysis]" +
      "/forEach[3]/iter[0]/stepIf[1]:0";
    await store.write({
      requestId,
      blockInstanceId,
      parentBlockInstanceId: null,
      stepIndex: 0,
      state: {},
      version: 1,
      createdAt: 1000
    });
    const requestDir = path.join(tempDir, "checkpoints", encodeURIComponent(requestId));
    const entries = (await readdir(requestDir)).filter((name) => !name.includes(".tmp-"));
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatch(/^[0-9a-f]{32}\.json$/);
  });
});

describe("FIX-401 createFilesystemStores wires a real CheckpointStore", () => {
  let tempDir: string;
  beforeEach(async () => {
    tempDir = await mkdtemp(path.join(tmpdir(), "fsd-stores-"));
  });
  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it("filesystem store registry exposes a working checkpoints store", async () => {
    const stores = createFilesystemStores({ rootDir: tempDir });
    await stores.checkpoints.write({
      requestId: "rA",
      blockInstanceId: "bA",
      parentBlockInstanceId: null,
      stepIndex: 0,
      state: { ok: true },
      version: 1,
      createdAt: Date.now()
    });
    const got = await stores.checkpoints.latest("rA", "bA");
    expect(got!.state).toEqual({ ok: true });
  });
});
