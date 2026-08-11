/**
 * An in-process dispatch reports acceptance, separately from completion
 * (FIX-982).
 *
 * `dispatchLocal` calls `runAction`, which is async — so it returns while the
 * run is still at its first await, with the `activeRequests` write issued and
 * not committed. The handle alone is therefore not evidence the request exists.
 *
 * For a caller holding `finished` that gap is invisible: a registration failure
 * arrives on the promise it is already awaiting. For a **fire-and-forget**
 * caller it is the whole problem. A detached spawn hands over a claimed task and
 * returns, holding nothing; the host swallows the child's rejection, and the
 * task's row sits `in_progress` until lease recovery notices minutes later. Work
 * that looked handed off was silently deferred.
 *
 * So the property under test is narrow and load-bearing: acceptance resolves
 * **while the run is still in flight**, and it *rejects* when the registration
 * it reports on fails. Acceptance that only settles with the run would be
 * indistinguishable from awaiting the work itself, which is what detachment
 * exists to avoid.
 */
import { describe, it, expect } from "vitest";
import { defineFlow, handler } from "@flow-state-dev/core";
import { z } from "zod";
import {
  createFlowRegistry,
  createInMemoryStores,
  createInboundTransportHost,
  defaultBodyUserIdPrincipalResolver
} from "../../src";
import type { ActiveRequestEntry } from "../../src/stores/types";

const wait = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/**
 * A host whose one action parks forever until released, so "the run has not
 * finished" is a fact rather than a timing hope.
 */
function buildHost(options?: {
  /** Replace the registry write, to hold or fail the registration. */
  onRegister?: (
    entry: ActiveRequestEntry,
    real: (entry: ActiveRequestEntry) => Promise<void>
  ) => Promise<void>;
}) {
  const registry = createFlowRegistry();
  const stores = createInMemoryStores();
  // Created up front, not when the block reaches it: acceptance lands long
  // before the block runs, so a gate minted on arrival would not exist yet when
  // the test releases it.
  let releaseRun: () => void = () => {};
  const runGate = new Promise<void>((resolve) => {
    releaseRun = resolve;
  });
  let ran = 0;

  registry.register(
    defineFlow({
      kind: "acceptance",
      actions: {
        run: {
          inputSchema: z.object({ value: z.string() }),
          block: handler<{ value: string }, { ok: true }>({
            name: "acceptance-run",
            execute: async () => {
              ran += 1;
              await runGate;
              return { ok: true };
            }
          })
        }
      }
    })({ id: "acceptance" })
  );

  if (options?.onRegister !== undefined) {
    const real = stores.activeRequests.register.bind(stores.activeRequests);
    stores.activeRequests.register = (entry: ActiveRequestEntry): Promise<void> =>
      options.onRegister!(entry, real);
  }

  const host = createInboundTransportHost({
    registry,
    stores,
    resolvePrincipal: defaultBodyUserIdPrincipalResolver,
    runtimeConfig: {}
  });

  return {
    host,
    stores,
    ranCount: () => ran,
    release: () => releaseRun(),
    envelope: {
      source: "http" as const,
      flowKind: "acceptance",
      action: "run",
      input: { value: "a" },
      sessionId: "s_accept",
      principal: { userId: "u_1" }
    }
  };
}

describe("in-process dispatch separates acceptance from completion", () => {
  it("accepts while the run is still in flight, with the request already discoverable", async () => {
    const h = buildHost();
    const handle = h.host.dispatch(h.envelope);

    expect(handle.accepted).toBeDefined();

    // The run cannot finish — it is parked — so acceptance winning this race is
    // the only way the assertion passes. An acceptance signal that settles with
    // the run would land on "neither" here, which is exactly the state a caller
    // that must not await the work is in.
    const first = await Promise.race([
      handle.accepted!.then(() => "accepted" as const),
      handle.finished.then(() => "finished" as const),
      wait(500).then(() => "neither" as const)
    ]);
    expect(first).toBe("accepted");

    // And "accepted" means the entry recovery and the stale sweeper key off is
    // committed — not that we intended to write it.
    const entry = await h.stores.activeRequests.get(handle.requestId);
    expect(entry?.requestId).toBe(handle.requestId);

    h.release();
    await handle.finished;
  });

  it("does not accept before the registration write commits", async () => {
    let releaseRegister: () => void = () => {};
    const held = new Promise<void>((resolve) => {
      releaseRegister = resolve;
    });
    const h = buildHost({
      onRegister: async (entry, real) => {
        await held;
        return real(entry);
      }
    });

    const handle = h.host.dispatch(h.envelope);

    // Held open: the request is not discoverable yet, so acceptance must not
    // have been reported.
    const early = await Promise.race([
      handle.accepted!.then(() => "accepted" as const),
      wait(50).then(() => "pending" as const)
    ]);
    expect(early).toBe("pending");
    expect(h.ranCount()).toBe(0);

    releaseRegister();
    await handle.accepted;
    expect(await h.stores.activeRequests.get(handle.requestId)).toBeDefined();

    h.release();
    await handle.finished;
  });

  it("rejects acceptance when the registration fails, instead of only failing the run", async () => {
    // The failure a fire-and-forget caller cannot see any other way: it is not
    // holding `finished`, and the host marks that rejection handled. Without
    // acceptance the dispatch reports success and the run quietly does not
    // exist.
    const h = buildHost({
      onRegister: async () => {
        throw new Error("registry write failed");
      }
    });

    const handle = h.host.dispatch(h.envelope);

    await expect(handle.accepted).rejects.toThrow(/registry write failed/);
    await expect(handle.finished).rejects.toThrow(/registry write failed/);
    expect(h.ranCount()).toBe(0);
  });
});
