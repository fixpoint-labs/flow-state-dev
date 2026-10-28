/**
 * The live inventory's writer, on the real path: `openInventory` for the worker
 * rows, run through a flow that spreads `inventoryWriterActions()`.
 *
 * `inventory-collections.test.ts` covers the floor these rows land on — org
 * boundary, cross-flow sharing, key shape. This file covers who writes them and
 * what they say, so every case here goes through a registered flow and a real
 * action run.
 *
 * **Every assertion is paired with a control that would break it.** A row that
 * exists is only evidence of a writer if the same roster, in the same process,
 * produces no row when the writer is absent — so the off-state case runs the
 * identical roster through a flow that omits the writer. The reader is a flow
 * that is not the writer and declares its own collection instance, so nothing
 * here is green merely because the writer read back its own objects.
 */
import { describe, expect, it } from "vitest";
import { DEFAULT_ORG_ID } from "@flow-state-dev/core";
import { defineFlow, handler } from "@flow-state-dev/core";
import { createFlowState, inMemoryStores, runAction } from "@flow-state-dev/engine";
import { z } from "zod";
import {
  INVENTORY_REGISTER_WORKERS,
  INVENTORY_WORKER_WRITER_SESSION,
  defineWorkerInventoryCollection,
  inventoryWriterActions,
  openInventory,
  type InventoryBinding,
  type InventoryWorker
} from "../src/index";

const USER_ID = "u_boot";
const ORG_ID = DEFAULT_ORG_ID;
const OTHER_ORG = "org_other";

/** The flow carrying the worker writer. */
const WRITER_KIND = "inventory-writer";
/** A flow that deliberately does NOT carry the inventory writer. */
const SILENT_FLOW = "silent";

/** A public action, so each is a flow a session can be opened on. */
const ping = {
  block: handler({
    name: "ping",
    inputSchema: z.object({}),
    outputSchema: z.object({ ok: z.boolean() }),
    execute: async () => ({ ok: true })
  })
};

/** The writer: one public no-op, and the worker write in `internal.actions`. */
const writerFlow = defineFlow({
  kind: WRITER_KIND,
  actions: { ping },
  internal: { actions: { ...inventoryWriterActions() } }
} as never);

/**
 * The control flow: identical to {@link writerFlow} but for the one line that
 * carries the registration.
 *
 * It is a flow like any other — it simply has nowhere for the binder's run to
 * land. That is what makes "the row is there" an assertion about the writer
 * rather than about the roster.
 */
const silentFlow = defineFlow({ kind: SILENT_FLOW, actions: { ping } } as never);

/**
 * The reader: a flow that is **not** the writer, declaring its own instance of
 * the worker collection.
 *
 * Its own instance on purpose. A collection is addressed by its pattern and
 * scope, and if that were not true this reader would come back empty — so
 * calling the factory again here is what turns "the rows are shared" from a
 * claim into a measurement.
 */
const readInventory = handler({
  name: "read-inventory",
  inputSchema: z.object({}),
  outputSchema: z.object({ workers: z.array(z.unknown()) }),
  resources: { workers: defineWorkerInventoryCollection() },
  execute: async (_input: any, ctx: any) => ({
    workers: (await ctx.resources.workers.list()).map((ref: any): unknown => ref.state)
  })
});

const readerFlow = defineFlow({
  kind: "inventory-reader",
  actions: { read: { block: readInventory } }
} as never);

/**
 * Register the writer, the silent control and the reader, and hand back the
 * doors a case needs.
 *
 * `openInventory` is NOT called here, so the binder stays the case's to invoke.
 *
 * @param adapter Shared storage, so a second boot reads what the first wrote.
 */
async function host(adapter: unknown = inMemoryStores()) {
  const byFlow: Record<string, any> = {
    [WRITER_KIND]: (writerFlow as any)(),
    [SILENT_FLOW]: (silentFlow as any)()
  };
  const reader = (readerFlow as any)();
  const state = createFlowState({
    flows: { ...byFlow, [reader.kind]: reader },
    stores: { default: { primary: adapter } }
  } as never);
  const runtime = await state.getRuntime();

  /**
   * The binder's action door, over this process's own runtime.
   *
   * It REJECTS on a failed run, which is the contract `openInventory`'s
   * `run` states: the engine hands a refusal back as `{ error }` rather than
   * throwing, and a door that passed that through as an ordinary value would
   * report every worker registered while writing nothing.
   */
  const run = async (request: {
    action: string;
    input: unknown;
    userId: string;
    orgId: string;
    flowKind: string;
    sessionId: string;
    source?: string;
  }): Promise<unknown> => {
    const flow = byFlow[request.flowKind];
    if (flow === undefined) {
      throw new Error(`no flow registered under flow kind "${request.flowKind}"`);
    }
    const result: any = await runAction({
      flow,
      actionName: request.action,
      input: request.input,
      userId: request.userId,
      orgId: request.orgId,
      sessionId: request.sessionId,
      source: request.source,
      stores: runtime.stores,
      runtimeConfig: { ...runtime.runtimeConfig }
    } as never);
    if (result?.error !== undefined) {
      throw result.error instanceof Error ? result.error : new Error(String(result.error));
    }
    return result;
  };

  return {
    runtime,
    run,
    /** Read the inventory back through a flow that is not the writer. */
    read: async (opts: { orgId?: string } = {}) => {
      const result: any = await runAction({
        flow: reader,
        actionName: "read",
        input: {},
        userId: USER_ID,
        orgId: ORG_ID,
        stores: runtime.stores,
        runtimeConfig: { ...runtime.runtimeConfig },
        ...opts
      } as never);
      return (result.output ?? result) as { workers: any[] };
    },
    /** Every inventory key physically present in an org's storage. */
    keys: async (orgId: string = ORG_ID) =>
      Object.keys(
        await runtime.stores.resourceState.getByPrefix("org", orgId, "inventory/")
      ).sort(),
    /** One stored row, straight out of org storage — never through the reader. */
    row: async (key: string) =>
      (await runtime.stores.resourceState.get("org", ORG_ID, key))?.state as
        | Record<string, unknown>
        | undefined,
    /** Run an action on the writer flow the way a caller-addressed request would. */
    act: async (sessionId: string, actionName: string, input: unknown) => {
      try {
        return (await runAction({
          flow: byFlow[WRITER_KIND],
          actionName,
          input,
          userId: USER_ID,
          orgId: ORG_ID,
          sessionId,
          stores: runtime.stores,
          runtimeConfig: { ...runtime.runtimeConfig }
        } as never)) as { output?: unknown; error?: unknown };
      } catch (error) {
        return { error };
      }
    },
    dispose: () => state.dispose()
  };
}

const WORKERS: InventoryWorker[] = [
  { id: "eng.lead", kind: "agent", actions: {} },
  { id: "eng.coder", kind: "coder", actions: {} }
];

/** The usual call: workers through the writer flow. */
function bind(
  lab: Awaited<ReturnType<typeof host>>,
  options: {
    workers?: InventoryWorker[];
    orgId?: string | undefined;
    workerWriterFlow?: string;
  } = {}
): Promise<InventoryBinding> {
  return openInventory(
    { workers: options.workers ?? WORKERS },
    {
      run: lab.run as never,
      userId: USER_ID,
      orgId: "orgId" in options ? options.orgId : ORG_ID,
      workerWriter: { flowKind: options.workerWriterKind ?? WRITER_KIND }
    }
  );
}

describe("what one boot writes", () => {
  it("gives every worker a row, read back from a flow that is not the writer (BR-8, BR-14, BR-21)", async () => {
    const lab = await host();
    try {
      const result = await bind(lab);
      expect(result.problems).toEqual([]);
      expect(result).toMatchObject({ workers: 2 });

      const rows = await lab.read();

      expect(rows.workers.map((row) => row.id).sort()).toEqual(["eng.coder", "eng.lead"]);
      // A worker whose actions declare no door is registered with none.
      expect(rows.workers.find((row) => row.id === "eng.coder")).toEqual({
        id: "eng.coder",
        kind: "coder",
        door: null,
        rules: false,
        hired: false,
        incarnation: null,
        name: null,
        teamName: null
      });
    } finally {
      await lab.dispose();
    }
  });

  it("puts the rows under the pinned storage keys (BR-16)", async () => {
    const lab = await host();
    try {
      await bind(lab, { workers: [{ id: "eng.lead", kind: "agent", actions: {} }] });

      // Read out of storage rather than through the collection, because what is
      // being pinned is the key an already-persisted org would have to keep.
      expect(await lab.keys()).toEqual(["inventory/workers/eng.lead"]);
      expect(await lab.row("inventory/workers/eng.lead")).toEqual({
        id: "eng.lead",
        kind: "agent",
        door: null,
        rules: false,
        hired: false,
        incarnation: null,
        name: null,
        teamName: null
      });
    } finally {
      await lab.dispose();
    }
  });
});

describe("what the binder refuses to carry", () => {
  it("refuses a run that names no org, rather than guessing one (BR-4)", async () => {
    // An app that authenticates has a verified org and is expected to pass it.
    // Silently substituting the development default writes that app's whole
    // inventory into a namespace none of its sessions read back, and the only
    // symptom is an inventory that reads empty everywhere — which points at
    // nothing. The refusal names the wiring mistake at boot instead.
    const lab = await host();
    try {
      await expect(bind(lab, { orgId: undefined })).rejects.toThrow(/orgId/);
      expect(await lab.keys()).toEqual([]);
    } finally {
      await lab.dispose();
    }
  });

  it("accepts the development default when a caller names it deliberately (D3)", async () => {
    // The refusal above is about an ABSENT org, not about this value. A
    // development app with no resolver binds its sessions to the framework
    // default, and naming it here is how its inventory lands where those
    // sessions read it — so the explicit choice goes through, and still lands
    // in exactly one organization.
    const lab = await host();
    try {
      await bind(lab, { orgId: DEFAULT_ORG_ID });

      expect((await lab.keys(DEFAULT_ORG_ID)).length).toBeGreaterThan(0);
      expect(await lab.keys(OTHER_ORG)).toEqual([]);
    } finally {
      await lab.dispose();
    }
  });

  it("refuses workers with no workerWriter, naming what to pass", async () => {
    const lab = await host();
    try {
      await expect(
        openInventory({ workers: WORKERS }, { run: lab.run as never, userId: USER_ID, orgId: ORG_ID })
      ).rejects.toThrow(/workerWriter/);
      expect(await lab.keys()).toEqual([]);
    } finally {
      await lab.dispose();
    }
  });
});

describe("running it twice", () => {
  it("is a no-op over an unchanged roster, and keeps the rows a shrunken one drops (BR-9, BR-23)", async () => {
    const adapter = inMemoryStores();

    const first = await host(adapter);
    try {
      await bind(first);
      const keys = await first.keys();
      expect(keys).toEqual(["inventory/workers/eng.coder", "inventory/workers/eng.lead"]);

      // Second run, same process, same roster: the red state is rows doubling.
      await bind(first);
      expect(await first.keys()).toEqual(keys);
    } finally {
      await first.dispose();
    }

    // A second boot over the SAME storage, from a roster that lost a worker.
    // Nothing is reconciled: a binder that dropped what its roster no longer
    // names would take a live worker's row with it.
    const second = await host(adapter);
    try {
      const result = await bind(second, { workers: [{ id: "eng.lead", kind: "agent", actions: {} }] });
      expect(result.problems).toEqual([]);

      const rows = await second.read();
      expect(rows.workers.map((row) => row.id).sort()).toEqual(["eng.coder", "eng.lead"]);
    } finally {
      await second.dispose();
    }
  });
});

describe("a worker writer flow that does not carry the writer", () => {
  it("writes nothing and is named, where the flow that carries it writes (BR-13)", async () => {
    // The control and the case are the same roster and the same code, one flow
    // apart. Without the writer, there is no action to run, so the binder
    // reports the failure and no row exists anywhere.
    const off = await host();
    try {
      const result = await bind(off, { workerWriterKind: SILENT_FLOW });
      expect(result.workers).toBe(0);
      expect(result.problems).toHaveLength(1);
      expect(result.problems[0]).toContain("the worker rows could not be written");
      expect(await off.keys()).toEqual([]);
    } finally {
      await off.dispose();
    }

    const on = await host();
    try {
      const result = await bind(on);
      expect(result.problems).toEqual([]);
      expect(await on.keys()).not.toEqual([]);
    } finally {
      await on.dispose();
    }
  });
});

describe("the registration action itself", () => {
  it("registerWorkersInInventory cannot be reached through the public door", async () => {
    const lab = await host();
    try {
      // `lab.act` dispatches exactly the way a caller-addressed HTTP/MCP
      // request would — no `source`, which resolves as `"http"` (public).
      // This action's whole input is the row data, so a public hit on it would
      // let a caller write any worker it chose.
      const attempt = await lab.act(INVENTORY_WORKER_WRITER_SESSION, INVENTORY_REGISTER_WORKERS, {
        workers: [{ id: "attacker.fake", kind: "agent" }]
      });
      expect(attempt.error).toBeDefined();
      expect(String((attempt.error as Error).message)).toContain(
        `does not define action "${INVENTORY_REGISTER_WORKERS}"`
      );
      expect(await lab.row("inventory/workers/attacker.fake")).toBeUndefined();
    } finally {
      await lab.dispose();
    }
  });
});
