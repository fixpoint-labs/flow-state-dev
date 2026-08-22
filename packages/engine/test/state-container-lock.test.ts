import { defineFlow, handler } from "@flow-state-dev/core";
import type { StateContainer } from "@flow-state-dev/core/types";
import { z } from "zod";
import { describe, expect, it } from "vitest";
import {
  ConcurrentModificationError,
  createExecutionContext,
  createInMemoryStores,
  createScopeStateOps,
  createStateContainer,
  ScopeMutationTimeoutError
} from "../src";
import type { CASPersist } from "../src/stores/cas";
import { withScopeLock } from "../src/stores/scope-lock";

describe("applyMutation — in-memory (lock) branch", () => {
  it("preserves FIFO ordering across N=10 concurrent mutators", async () => {
    type State = { values: number[] };
    const container: StateContainer<State> = createStateContainer<State>({
      values: []
    });
    const ops = createScopeStateOps<State>(container);

    const N = 10;
    const promises = Array.from({ length: N }, (_, i) =>
      ops.atomicState((state) => ({ values: [...state.values, i] }))
    );
    const results = await Promise.all(promises);

    expect(results.every((r) => r === true)).toBe(true);
    expect(container.read().values).toEqual(Array.from({ length: N }, (_, i) => i));
    expect(container.getVersion()).toBe(N);
  });

  it("never throws ConcurrentModificationError with N=20 concurrent mutators", async () => {
    type State = { count: number };
    const container = createStateContainer<State>({ count: 0 });
    const ops = createScopeStateOps<State>(container);

    const N = 20;
    const promises = Array.from({ length: N }, () =>
      ops.atomicState((state) => ({ count: state.count + 1 }))
    );

    // No rejections, no ConcurrentModificationError.
    await expect(Promise.all(promises)).resolves.toEqual(
      Array.from({ length: N }, () => true)
    );
    expect(container.read().count).toBe(N);
  });

  it("skips commit and version bump on no-op writes (deep-equal short-circuit)", async () => {
    type State = { count: number; mode: string };
    const container = createStateContainer<State>({ count: 5, mode: "idle" });
    const ops = createScopeStateOps<State>(container);

    expect(await ops.patchState({ count: 5 })).toBe(false);
    expect(await ops.patchState({ mode: "idle" })).toBe(false);
    expect(await ops.atomicState(() => ({}))).toBe(false);
    expect(container.getVersion()).toBe(0);

    expect(await ops.patchState({ count: 6 })).toBe(true);
    expect(container.getVersion()).toBe(1);
  });

  it("throws ScopeMutationTimeoutError when an earlier mutator holds the lock past the budget", async () => {
    // The public `ScopeStateOps` API has only sync mutators, so a slow
    // path can't be created from the outside. Hold the lock with
    // `withScopeLock` directly to simulate head-of-line blocking and
    // verify the option plumbs through `applyMutation`.
    type State = { count: number };
    const container = createStateContainer<State>({ count: 0 });
    const ops = createScopeStateOps<State>(container, {
      mutationTimeoutMs: 30
    });

    let blockerResolve: (() => void) | undefined;
    const blockerStarted = new Promise<void>((startResolve) => {
      void withScopeLock(container, async () => {
        startResolve();
        await new Promise<void>((resolve) => {
          blockerResolve = resolve;
        });
      });
    });
    await blockerStarted;

    // Body would be near-instant; the timeout fires from queue wait alone.
    const queued = ops.atomicState((state) => ({ count: state.count + 1 }));
    await expect(queued).rejects.toBeInstanceOf(ScopeMutationTimeoutError);

    // Release so the test process exits cleanly.
    blockerResolve?.();
  });

  it("preserves all canonical scope state operations under the lock", async () => {
    type DemoState = {
      count: number;
      list: string[];
      bag: Record<string, number>;
      mode: string;
      score?: number;
    };

    const container = createStateContainer<DemoState>({
      count: 0,
      list: [],
      bag: { a: 1 },
      mode: "idle"
    });

    const ops = createScopeStateOps<DemoState>(container);

    await ops.patchState({ mode: "running" });
    await ops.patchState("count", (current) => current + 2);
    await ops.incState({ count: 3, score: 1 });
    await ops.pushState("list", "first");
    await ops.setStateRecord("bag", "b", 2);
    await ops.deleteStateRecord("bag", "a");
    await ops.atomicState((state) => ({ count: state.count + 1 }));

    expect(container.read()).toEqual({
      count: 6,
      list: ["first"],
      bag: { b: 2 },
      mode: "running",
      score: 1
    });
    expect(container.getVersion()).toBe(7);
  });
});

describe("applyMutation — external-store (CAS) branch", () => {
  it("retains CAS retry behavior when persist is provided", async () => {
    type State = { count: number };
    const container = createStateContainer<State>({ count: 0 }, 0);

    let storeValue: State = { count: 0 };
    let storeVersion = 0;
    let conflictInjected = false;

    const persist: CASPersist<State> = async (state, expectedVersion) => {
      if (!conflictInjected) {
        conflictInjected = true;
        storeValue = { count: 99 };
        storeVersion = 1;
      }
      if (expectedVersion !== storeVersion) {
        return {
          ok: false,
          currentState: storeValue,
          currentVersion: storeVersion
        };
      }
      storeVersion += 1;
      storeValue = state;
      return { ok: true, version: storeVersion };
    };

    const ops = createScopeStateOps<State>(container, {
      persist,
      cas: { maxRetries: 3, baseDelayMs: 0 }
    });

    await ops.atomicState((state) => ({ count: state.count + 1 }));
    expect(container.read()).toEqual({ count: 100 });
    expect(container.getVersion()).toBe(2);
  });

  it("throws ConcurrentModificationError when external-store retries exhaust", async () => {
    type State = { count: number };
    const container = createStateContainer<State>({ count: 0 }, 0);
    const alwaysConflict: CASPersist<State> = async () => ({
      ok: false,
      currentState: { count: 0 },
      currentVersion: 999
    });

    const ops = createScopeStateOps<State>(container, {
      persist: alwaysConflict,
      cas: { maxRetries: 1, baseDelayMs: 0 }
    });

    await expect(
      ops.atomicState((state) => ({ count: state.count + 1 }))
    ).rejects.toBeInstanceOf(ConcurrentModificationError);
  });

  it("does not invoke withScopeLock when persist is provided", async () => {
    // Verify two concurrent writers go through CAS (with version conflicts)
    // rather than serializing through the lock. With the lock they would
    // never produce conflicts; with CAS they can.
    type State = { count: number };
    const container = createStateContainer<State>({ count: 0 }, 0);

    let store: State = { count: 0 };
    let storeVersion = 0;
    let conflictsObserved = 0;

    const persist: CASPersist<State> = async (state, expectedVersion) => {
      if (expectedVersion !== storeVersion) {
        conflictsObserved += 1;
        return {
          ok: false,
          currentState: store,
          currentVersion: storeVersion
        };
      }
      storeVersion += 1;
      store = state;
      return { ok: true, version: storeVersion };
    };

    const ops = createScopeStateOps<State>(container, {
      persist,
      cas: { maxRetries: 5, baseDelayMs: 0 }
    });

    await Promise.all([
      ops.atomicState((s) => ({ count: s.count + 1 })),
      ops.atomicState((s) => ({ count: s.count + 1 })),
      ops.atomicState((s) => ({ count: s.count + 1 }))
    ]);

    // Conflicts only happen on the CAS path. The lock path serializes
    // strictly so persist always sees expectedVersion === storeVersion.
    expect(conflictsObserved).toBeGreaterThan(0);
    expect(container.read().count).toBe(3);
  });
});

describe("applyMutation — persist + serialize (request-scope) branch", () => {
  function versionedPersist<TState extends { count: number }>(): {
    persist: CASPersist<TState>;
    persistCount: () => number;
  } {
    let store: TState = { count: 0 } as TState;
    let storeVersion = 0;
    let persistCount = 0;
    const persist: CASPersist<TState> = async (state, expectedVersion) => {
      persistCount += 1;
      if (expectedVersion !== storeVersion) {
        return {
          ok: false,
          currentState: store,
          currentVersion: storeVersion
        };
      }
      storeVersion += 1;
      store = state;
      return { ok: true, version: storeVersion };
    };
    return { persist, persistCount: () => persistCount };
  }

  it("throws ConcurrentModificationError on a wide persist fan-out without serialize", async () => {
    type State = { count: number };
    const container = createStateContainer<State>({ count: 0 }, 0);
    const { persist } = versionedPersist<State>();
    const ops = createScopeStateOps<State>(container, {
      persist,
      cas: { maxRetries: 3, baseDelayMs: 0 }
    });

    const N = 8;
    const results = await Promise.allSettled(
      Array.from({ length: N }, () =>
        ops.atomicState((state) => ({ count: state.count + 1 }))
      )
    );

    expect(
      results.some(
        (r) =>
          r.status === "rejected" &&
          r.reason instanceof ConcurrentModificationError
      )
    ).toBe(true);
  });

  it("commits every write on a wide persist fan-out when serialize is set", async () => {
    type State = { count: number };
    const container = createStateContainer<State>({ count: 0 }, 0);
    const { persist, persistCount } = versionedPersist<State>();
    const ops = createScopeStateOps<State>(container, {
      persist,
      serialize: true
    });

    const N = 8;
    await expect(
      Promise.all(
        Array.from({ length: N }, () =>
          ops.atomicState((state) => ({ count: state.count + 1 }))
        )
      )
    ).resolves.toEqual(Array.from({ length: N }, () => true));

    expect(container.read().count).toBe(N);
    expect(container.getVersion()).toBe(N);
    expect(persistCount()).toBe(N);
  });

  it("preserves FIFO order and skips persist on no-op writes when serialize is set", async () => {
    type State = { values: number[] };
    const container = createStateContainer<State>({ values: [] }, 0);
    let persistCount = 0;
    let storeVersion = 0;
    const persist: CASPersist<State> = async (state, expectedVersion) => {
      persistCount += 1;
      if (expectedVersion !== storeVersion) {
        return {
          ok: false,
          currentState: container.read() as State,
          currentVersion: storeVersion
        };
      }
      storeVersion += 1;
      return { ok: true, version: storeVersion };
    };
    const ops = createScopeStateOps<State>(container, {
      persist,
      serialize: true
    });

    const N = 8;
    await Promise.all(
      Array.from({ length: N }, (_, i) =>
        ops.atomicState((state) => ({ values: [...state.values, i] }))
      )
    );
    expect(container.read().values).toEqual(Array.from({ length: N }, (_, i) => i));
    expect(await ops.atomicState((state) => ({ values: state.values }))).toBe(
      false
    );
    expect(persistCount).toBe(N);
    expect(container.getVersion()).toBe(N);
  });
});

describe("scope write-path wiring — createExecutionContext", () => {
  // The blocks above prove the `serialize` branch behaves correctly once it is
  // asked for. They do not prove the runtime asks for it: they hand
  // `serialize: true` to `createScopeStateOps` by hand. Without the two cases
  // below, deleting `serialize: true` from `createExecutionContext`'s
  // `requestOps` leaves every other test in this file green and puts FIX-1155
  // straight back.
  //
  // N is wider than any CAS retry budget in play. A lockstep fan-out lands at
  // most `maxRetries + 1` writes on the CAS path, because a single attempt
  // round only advances the store version once — so the count below is the
  // whole assertion, not a timing coincidence.
  const N = 12;

  function fanOutBlock() {
    return handler<{ value: string }, { ok: boolean }>({
      name: "fanout-handler",
      execute: () => ({ ok: true })
    });
  }

  it("request scope commits a fan-out wider than the CAS retry budget", async () => {
    const flow = defineFlow({
      kind: "fanout-request-flow",
      actions: {
        run: {
          inputSchema: z.object({ value: z.string() }),
          block: fanOutBlock()
        }
      }
    })();
    const stores = createInMemoryStores();

    const ctx = await createExecutionContext({
      flow,
      actionName: "run",
      requestId: "req_fanout",
      sessionId: "sess_fanout",
      userId: "user_fanout",
      stores,
      requestState: { count: 0 }
    });

    // Pre-fix this rejects: request scope drove `runWithCAS` on the default
    // budget of 3 retries, so 8 of these 12 writers exhausted it and threw
    // ConcurrentModificationError.
    await expect(
      Promise.all(
        Array.from({ length: N }, () =>
          ctx.request.atomicState((state) => ({
            count: ((state as { count?: number }).count ?? 0) + 1
          }))
        )
      )
    ).resolves.toEqual(Array.from({ length: N }, () => true));

    expect(ctx.request.state).toEqual({ count: N });

    // Serializing must not cost per-write durability. The store — not just the
    // in-request container — has to carry the result, because a resumed
    // request reads its state back from there.
    const saved = await stores.request.get("req_fanout");
    expect(saved?.state).toEqual({ count: N });
  });

  it("session scope stays on CAS and still surfaces ConcurrentModificationError", async () => {
    const flow = defineFlow({
      kind: "fanout-session-flow",
      // Pinned rather than defaulted so this case cannot be quietly rewritten
      // by a change to DEFAULT_MAX_RETRIES. That `session.cas` reaches the
      // scope at all is itself part of the point — request scope has no `cas`
      // option to configure.
      session: { cas: { maxRetries: 2, baseDelayMs: 0 } },
      actions: {
        run: {
          inputSchema: z.object({ value: z.string() }),
          block: fanOutBlock()
        }
      }
    })();
    const stores = createInMemoryStores();

    const ctx = await createExecutionContext({
      flow,
      actionName: "run",
      requestId: "req_session_fanout",
      sessionId: "sess_session_fanout",
      userId: "user_session_fanout",
      stores,
      sessionState: { count: 0 }
    });

    const results = await Promise.allSettled(
      Array.from({ length: N }, () =>
        ctx.session.atomicState((state) => ({
          count: ((state as { count?: number }).count ?? 0) + 1
        }))
      )
    );

    // Deliberate, not a leftover: a remote authority can advance the session
    // version underneath the local cache, so session/user/org keep the
    // optimistic loop and keep surfacing conflicts at the durable boundary.
    // If this ever comes back clean, someone handed session scope
    // `serialize: true` as well and collapsed two postures that must differ.
    const rejections = results.filter((r) => r.status === "rejected");
    expect(rejections.length).toBeGreaterThan(0);
    expect(
      rejections.every(
        (r) =>
          (r as PromiseRejectedResult).reason instanceof
          ConcurrentModificationError
      )
    ).toBe(true);
  });
});
