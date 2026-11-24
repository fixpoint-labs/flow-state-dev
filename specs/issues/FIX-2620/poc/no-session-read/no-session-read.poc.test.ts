/**
 * POC for FIX-2620: retained design evidence, not production code.
 *
 * The question: can a view at user or org scope run its block with no session
 * at all (only userId and orgId), read the user's and the org's resources,
 * and still refuse every write? A throwaway session does not count (D1): the
 * engine already makes an ephemeral one when no session id is passed.
 *
 * One read block runs and reports four signals:
 *   1. it reads a user-scoped collection (and an org-scoped one) that an
 *      earlier action wrote, in another session;
 *   2. a write to that collection throws `read_only`;
 *   3. reaching for `ctx.session` throws a named error instead of a session;
 *   4. the session store holds no record it did not hold before the run
 *      (read from the store after the run, not inferred from the output).
 *
 * The control is today's `runRead` with no session id. It must fail signal 4
 * (it makes or refuses a session record). The POC path is `runView` below,
 * which runs on `createExecutionContext` with the `noSession` option the
 * run-time patch (`no-session.patch`) adds.
 *
 * Run: bash specs/issues/FIX-2620/poc/no-session-read/run.sh
 * Red control: POC_STRICT_CONTROL=1 bash specs/issues/FIX-2620/poc/no-session-read/run.sh
 */
import { defineFlow, defineResourceCollection, handler } from "@flow-state-dev/core";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { runAction } from "../src";
import { createInMemoryStores, createResponseEmitter } from "../src/host";
import { createExecutionContext } from "../src/context/createExecutionContext";
import { executeBlock } from "../src/execution/executeBlock";
// Exported only by the run-time patch: the read's store wrappers, reused.
import { readOnlyStores, runRead } from "../src/execution/runRead";
import { generateId } from "../src/utils/generate-id";
import type { StoreRegistry } from "../src/stores/types";

const USER = "user_poc";
const ORG = "org_poc";

const pins = defineResourceCollection({
  scope: "user",
  pattern: "pins/*",
  stateSchema: z.object({ label: z.string() })
});
const orgNotes = defineResourceCollection({
  scope: "org",
  pattern: "org-notes/*",
  stateSchema: z.object({ label: z.string() })
});

/** The setup action: writes two pins and one org note, in a real session. */
const seed = handler({
  name: "seed",
  inputSchema: z.object({}),
  resources: { pins, orgNotes },
  execute: async (_input, ctx) => {
    await ctx.resources.pins.create("a", { label: "first pin" });
    await ctx.resources.pins.create("b", { label: "second pin" });
    await ctx.resources.orgNotes.create("n", { label: "org note" });
    return { ok: true };
  }
});

type Signals = {
  pins: string[];
  orgNotes: string[];
  writeRefusal: string | null;
  sessionRefusal: string | null;
};

/** The view: reads, then tries a write and `ctx.session`, and reports each. */
const pinsView = handler({
  name: "pins-view",
  inputSchema: z.object({}),
  resources: { pins, orgNotes },
  execute: async (_input, ctx): Promise<Signals> => {
    const read = (await ctx.resources.pins.list()).map((p) => p.state.label).sort();
    const notes = (await ctx.resources.orgNotes.list()).map((n) => n.state.label).sort();
    let writeRefusal: string | null = null;
    try {
      await ctx.resources.pins.create("c", { label: "sneaky" });
    } catch (error) {
      writeRefusal = (error as { code?: string }).code ?? String(error);
    }
    let sessionRefusal: string | null = null;
    try {
      // Any use of the session handle: its identity is the cheapest.
      void ctx.session.identity.id;
    } catch (error) {
      sessionRefusal = (error as Error).name;
    }
    return { pins: read, orgNotes: notes, writeRefusal, sessionRefusal };
  }
});

const flow = defineFlow({
  kind: "poc-pins",
  actions: { seed: { block: seed } },
  reads: { pins: { block: pinsView } }
})();

async function seeded(): Promise<StoreRegistry> {
  const stores = createInMemoryStores();
  const result = await runAction({
    flow,
    actionName: "seed",
    input: {},
    userId: USER,
    orgId: ORG,
    sessionId: "sess_seed",
    stores,
    responseEmitter: createResponseEmitter({ requestId: "req_seed" }),
    runtimeConfig: {}
  });
  expect(result.error).toBeUndefined();
  return stores;
}

const sessionIds = async (stores: StoreRegistry) => (await stores.session.list({})).map((s) => s.id).sort();

/** The four signals, read from the block's output and from the stores after the run. */
async function measure(stores: StoreRegistry, run: () => Promise<unknown>) {
  const before = await sessionIds(stores);
  let output: Signals | undefined;
  let threw: string | undefined;
  let threwInSessionBirth = false;
  try {
    output = (await run()) as Signals;
  } catch (error) {
    threw = `${(error as Error).name} (${(error as { code?: string }).code ?? "no code"}): ${(error as Error).message}`;
    if (process.env.POC_STACK === "1") console.log((error as Error).stack);
    threwInSessionBirth = /ensureSessionRecord|session-birth/.test((error as Error).stack ?? "");
  }
  const after = await sessionIds(stores);
  const signals = {
    readsUserAndOrg:
      JSON.stringify(output?.pins) === JSON.stringify(["first pin", "second pin"]) &&
      JSON.stringify(output?.orgNotes) === JSON.stringify(["org note"]),
    writeRefusedReadOnly: output?.writeRefusal === "read_only",
    sessionRefusedNamed: output?.sessionRefusal === "NoSessionError",
    // A run that threw on the session write never reached the block: no pass.
    noNewSessionRecord: threw === undefined && JSON.stringify(after) === JSON.stringify(before)
  };
  return { signals, output, threw, threwInSessionBirth, before, after };
}

/** `store`, recording every method called on it in `calls`. */
function watched<T extends object>(store: T, calls: string[]): T {
  return new Proxy(store, {
    get(target, prop, receiver) {
      const value = Reflect.get(target, prop, receiver);
      if (typeof value !== "function" || typeof prop !== "string") return value;
      return (...args: unknown[]) => {
        calls.push(prop);
        return (value as (...a: unknown[]) => unknown).apply(target, args);
      };
    }
  });
}

/**
 * The POC path: `runRead` with the session taken out. Same read-only store
 * wrappers, same block execution; `createExecutionContext` gets `noSession`
 * instead of a session id.
 */
async function runView(stores: StoreRegistry, userId: string, orgId: string, sessionCalls: string[]): Promise<unknown> {
  const read = flow.reads!.pins!;
  const requestId = generateId("view");
  const ctx = await createExecutionContext({
    flow,
    actionName: "pins",
    requestId,
    userId,
    orgId,
    noSession: true,
    source: "read",
    input: {},
    // The session store, watched: the strict path must not even look one up.
    stores: readOnlyStores({ ...stores, session: watched(stores.session, sessionCalls) }, requestId),
    durabilityEnabled: false,
    requestHost: {
      dispatchOperation: () => {
        throw new Error("read_only");
      }
    }
  } as Parameters<typeof createExecutionContext>[0]);
  const result = await executeBlock({ block: read.block, input: {}, ctx, metadata: { scope: "request" } });
  if (result.error !== undefined) throw result.error;
  return result.output;
}

describe("FIX-2620 · a user-scoped view with no session", () => {
  it("control: today's runRead with no session id fails the no-session signal", async () => {
    const stores = await seeded();
    const measured = await measure(stores, () =>
      runRead({ flow, readName: "pins", input: {}, userId: USER, orgId: ORG, sessionId: undefined as never, stores })
    );
    console.log("CONTROL", JSON.stringify(measured, null, 2));
    if (process.env.POC_STRICT_CONTROL === "1") {
      // The bar the POC path must clear, held against the control: shows it red.
      expect(measured.signals).toEqual({
        readsUserAndOrg: true,
        writeRefusedReadOnly: true,
        sessionRefusedNamed: true,
        noNewSessionRecord: true
      });
    }
    // It makes or refuses a session record; either way it is not "no session".
    // Held to that reason: a control that fails for any other cause proves nothing.
    const madeOne = measured.after.length > measured.before.length;
    // Session birth's first write (purging the new session's tombstones) is
    // what the read-only stores refuse, ahead of the session record itself.
    const refusedOne = /read_only/.test(measured.threw ?? "") && measured.threwInSessionBirth;
    expect(madeOne || refusedOne, measured.threw).toBe(true);
    expect(measured.signals.noNewSessionRecord).toBe(false);
  });

  it("POC: runView with only userId and orgId holds all four signals", async () => {
    const stores = await seeded();
    const sessionCalls: string[] = [];
    const measured = await measure(stores, () => runView(stores, USER, ORG, sessionCalls));
    console.log("POC", JSON.stringify(measured, null, 2));
    expect(measured.signals).toEqual({
      readsUserAndOrg: true,
      writeRefusedReadOnly: true,
      sessionRefusedNamed: true,
      noNewSessionRecord: true
    });
    expect(measured.after).toEqual(["sess_seed"]);
    // Stronger than "nothing stored": the session store was never called at all.
    expect(sessionCalls).toEqual([]);
  });
});
