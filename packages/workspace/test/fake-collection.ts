/**
 * A resource collection that lives in a `Map`.
 *
 * Only the six members the projection actually touches are real; everything
 * else on `ResourceCollectionRef` throws if reached, so a test that starts
 * depending on a seventh fails loudly instead of quietly exercising a stub.
 */
import type { ResourceCollectionRef } from "@flow-state-dev/core/types";
import type { ProjectedEntryState } from "../src/types";

export interface FakeCollection extends ResourceCollectionRef<ProjectedEntryState> {
  /** Content by key, for assertions and for seeding another writer's work. */
  contents(): Record<string, string>;
  /** Write as somebody who is not the projection — a concurrent run, an action block. */
  setExternal(key: string, content: string): void;
  /** Remove as somebody who is not the projection. */
  removeExternal(key: string): void;
  /**
   * Drop the `path` field from an entry's state.
   *
   * What a collection written by anything other than a projection looks like:
   * `path` is application state, not the framework's key, and nothing
   * obliges another writer to set it.
   */
  forgetStatePath(key: string): void;
  /** Make every content write reject, the way a store that is down does. */
  breakWrites(reason?: string): void;
}

const unsupported = (name: string) => () => {
  throw new Error(`FakeCollection.${name} is not implemented — the projection should not need it`);
};

export function createFakeCollection(
  pattern: string,
  seed: Record<string, string> = {},
): FakeCollection {
  const content = new Map<string, string>(Object.entries(seed));
  const state = new Map<string, ProjectedEntryState>(
    Object.keys(seed).map((key) => [
      key,
      { path: key, hash: "seed", updatedAt: new Date(0).toISOString() },
    ]),
  );

  const prefix = pattern.replace(/\/\*+$/, "");

  let writeFailure: string | undefined;

  const refFor = (key: string) => ({
    // A real `ResourceRef.path` is the canonical storage key, prefix
    // included — the projection strips the mount prefix back off it.
    path: prefix ? `${prefix}/${key}` : key,
    get state() {
      return state.get(key)!;
    },
    async readContent() {
      return content.get(key) ?? null;
    },
    async writeContent(next: string) {
      if (writeFailure !== undefined) throw new Error(writeFailure);
      content.set(key, next);
    },
    async patchState(patch: Partial<ProjectedEntryState>) {
      state.set(key, { ...state.get(key)!, ...patch } as ProjectedEntryState);
    },
  });

  const collection = {
    pattern,
    scope: "session",
    async getOptional(key: string | Record<string, string>) {
      const k = String(key);
      return content.has(k) || state.has(k) ? (refFor(k) as never) : undefined;
    },
    async getOrCreate(key: string | Record<string, string>, initial?: Partial<ProjectedEntryState>) {
      const k = String(key);
      if (!state.has(k)) {
        state.set(k, {
          path: k,
          hash: "",
          updatedAt: new Date(0).toISOString(),
          ...initial,
        } as ProjectedEntryState);
      }
      return refFor(k) as never;
    },
    async list() {
      return [...state.keys()].map((k) => refFor(k)) as never;
    },
    async delete(key: string | Record<string, string>) {
      const k = String(key);
      content.delete(k);
      state.delete(k);
    },
    contents: () => Object.fromEntries(content),
    setExternal: (key: string, next: string) => {
      content.set(key, next);
      state.set(key, {
        path: key,
        hash: "external",
        updatedAt: new Date().toISOString(),
      });
    },
    removeExternal: (key: string) => {
      content.delete(key);
      state.delete(key);
    },
    breakWrites: (reason = "the store is unavailable") => {
      writeFailure = reason;
    },
    forgetStatePath: (key: string) => {
      const current = state.get(key);
      if (current === undefined) return;
      const { path: _dropped, ...rest } = current;
      state.set(key, rest as ProjectedEntryState);
    },
    get: unsupported("get"),
    create: unsupported("create"),
    upsert: unsupported("upsert"),
    count: unsupported("count"),
    config: {} as never,
  };

  return collection as unknown as FakeCollection;
}
