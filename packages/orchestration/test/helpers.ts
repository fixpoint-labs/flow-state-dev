/**
 * Test helpers — fake StateRef and ResourceCollectionRef so the
 * collection backings can be exercised without a full execution
 * context. The fakes implement just enough of the runtime contracts
 * for the substrate to operate.
 */
import type {
  ResourceCollectionRef,
  ResourceRef,
  StateRef,
} from "@flow-state-dev/core/types";
import type { JsonObject } from "@flow-state-dev/core";
import type { TaskChangeEvent } from "../src/tasks";

/** Captured `onChange` events for assertions in tests. */
export interface CapturedChanges {
  events: TaskChangeEvent[];
  onChange: (event: TaskChangeEvent) => void;
}

/** Build a capturing `onChange` callback for tests. */
export function createCapturedChanges(): CapturedChanges {
  const events: TaskChangeEvent[] = [];
  return {
    events,
    onChange: (event) => {
      events.push(event);
    },
  };
}

/**
 * In-memory `StateRef` that exposes the same surface as core's
 * sequencer state ref (read state, atomicState with retry).
 *
 * `atomicState` is single-threaded inside this fake — JS is single-
 * threaded — but each call re-runs the mutator under a Promise tick
 * boundary, mirroring the production behavior where contention forces
 * a retry. Tests that want to simulate concurrent writers fire two
 * `atomicState` invocations in quick succession; the implementation
 * serializes them through an internal queue so the second sees the
 * first's commit.
 */
export function createFakeSequencerState<TState extends Record<string, unknown>>(
  initial: TState
): StateRef<TState> & { __raw: () => TState } {
  let state = { ...initial };
  let version = 0;
  let busy = Promise.resolve();

  const ref: StateRef<TState> & { __raw: () => TState } = {
    name: "fake-sequencer",
    instanceId: "fake-sequencer#0",
    input: undefined,
    get state() {
      return state as Readonly<TState>;
    },
    __raw: () => state,
    async patchState(updates: Partial<TState>) {
      await busy;
      state = { ...state, ...updates };
      version += 1;
    },
    async setState(next: TState) {
      await busy;
      state = { ...next };
      version += 1;
    },
    async incState(_increments: Record<string, number>) {
      // not exercised in these tests
    },
    async pushState(_field: string, _value: unknown) {
      // not exercised in these tests
    },
    async setStateRecord(_field: string, _key: string, _value: unknown) {
      // not exercised
    },
    async deleteStateRecord(_field: string, _key: string) {
      // not exercised
    },
    async atomicState(mutator) {
      const prev = busy;
      const next = (async () => {
        await prev;
        const update = mutator(state as Readonly<TState>);
        state = { ...state, ...update };
        version += 1;
      })();
      busy = next.catch(() => undefined);
      return next;
    },
  };

  return ref;
}

/**
 * In-memory `ResourceCollectionRef` that mimics core's per-instance
 * `updateState` semantics. Stores instances in a Map; `updateState`
 * serializes per-instance through an in-flight chain so concurrent
 * `updateState` calls on the same key see each other's writes (matches
 * the production scope-state CAS behavior in spirit).
 */
export function createFakeResourceCollection<TState extends JsonObject>(
  pattern = "tasks/{id}"
): ResourceCollectionRef<TState> {
  const instances = new Map<string, TState>();
  const inFlight = new Map<string, Promise<void>>();

  function instanceRef(key: string): ResourceRef<TState> {
    return {
      path: key,
      scope: "session",
      uri: `session/${key}`,
      config: { scope: "session" } as ResourceRef<TState>["config"],
      get state() {
        return (instances.get(key) ?? ({} as TState)) as Readonly<TState>;
      },
      async patchState(updates: Partial<TState>) {
        const prev = instances.get(key) ?? ({} as TState);
        instances.set(key, { ...prev, ...updates } as TState);
      },
      async setState(next: TState) {
        instances.set(key, next);
      },
      async updateState(updater) {
        const queue = inFlight.get(key) ?? Promise.resolve();
        const next = (async () => {
          await queue;
          const prev = instances.get(key) ?? ({} as TState);
          const updated = await updater(prev);
          instances.set(key, updated);
        })();
        inFlight.set(
          key,
          next.catch(() => undefined)
        );
        return next;
      },
      async readContentRaw() {
        return null;
      },
      async readContent() {
        return null;
      },
      async writeContent(_content: string) {
        // not exercised
      },
    };
  }

  const ref: ResourceCollectionRef<TState> = {
    pattern,
    scope: "session",
    config: { pattern, scope: "session" } as ResourceCollectionRef<TState>["config"],
    async get(key) {
      const k = typeof key === "string" ? key : Object.values(key).join("/");
      if (!instances.has(k)) {
        throw new Error(`Resource instance "${k}" not found`);
      }
      return instanceRef(k);
    },
    async getOptional(key) {
      const k = typeof key === "string" ? key : Object.values(key).join("/");
      return instances.has(k) ? instanceRef(k) : undefined;
    },
    async create(key, initial) {
      const k = typeof key === "string" ? key : Object.values(key).join("/");
      if (instances.has(k)) {
        throw new Error(`Resource instance "${k}" already exists`);
      }
      instances.set(k, (initial ?? {}) as TState);
      return instanceRef(k);
    },
    async getOrCreate(key, initial) {
      const k = typeof key === "string" ? key : Object.values(key).join("/");
      if (!instances.has(k)) {
        instances.set(k, (initial ?? {}) as TState);
      }
      return instanceRef(k);
    },
    async list(prefix) {
      const refs: ResourceRef<TState>[] = [];
      for (const k of instances.keys()) {
        if (prefix === undefined || k.startsWith(prefix)) {
          refs.push(instanceRef(k));
        }
      }
      return refs;
    },
    async delete(key) {
      const k = typeof key === "string" ? key : Object.values(key).join("/");
      instances.delete(k);
    },
    async count() {
      return instances.size;
    },
  };

  return ref;
}
