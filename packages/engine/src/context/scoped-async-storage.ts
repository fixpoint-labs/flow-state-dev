/**
 * Async-context values for things made per request, without an
 * `AsyncLocalStorage` per request.
 *
 * On Node 22 an `AsyncLocalStorage` that has run once joins a process-wide
 * list that only `disable()` takes it off, and every later async operation in
 * the process walks that list. One made per request is therefore never
 * collected and makes every await slower, request after request.
 *
 * Every scoped storage shares the one `AsyncLocalStorage` below, which holds a
 * map from each storage to its value. A run copies the map with its own entry
 * replaced, so each storage reads and nests exactly as its own
 * `AsyncLocalStorage` would, and drops with its owner.
 */
import { AsyncLocalStorage } from "node:async_hooks";

/** The one process-wide storage. Keys are the scoped storages that set a value. */
const shared = new AsyncLocalStorage<ReadonlyMap<object, unknown>>();

/** The part of `AsyncLocalStorage` a scoped storage offers. */
export interface ScopedAsyncStorage<T> {
  /** The value the current async context holds for this storage, if any. */
  getStore(): T | undefined;
  /** Run `fn` with `value` as this storage's value; other storages' values carry through. */
  run<R>(value: T, fn: () => R): R;
  /** Set `value` for the rest of the current async context, as `AsyncLocalStorage#enterWith` does. */
  enterWith(value: T): void;
}

/** A storage that behaves like its own `AsyncLocalStorage<T>` but is safe to make per request. */
export function createScopedAsyncStorage<T>(): ScopedAsyncStorage<T> {
  const owner = {};
  const withValue = (value: T): ReadonlyMap<object, unknown> => new Map(shared.getStore()).set(owner, value);
  return {
    getStore: () => shared.getStore()?.get(owner) as T | undefined,
    run: (value, fn) => shared.run(withValue(value), fn),
    enterWith: (value) => shared.enterWith(withValue(value)),
  };
}
