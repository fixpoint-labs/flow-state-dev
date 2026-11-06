/**
 * Keep unchanged values unchanged. A watch rebuilds every entry on each
 * streamed chunk; handing React the same object for an entry that didn't
 * change lets a memoized row skip its render, so only the growing one draws.
 */
import { useState } from "react";
import { looseDeepEqual } from "@flow-state-dev/core/helpers";

/** `next`, with each value equal to the one `prev` had at its id swapped for that old object. */
export function reuseById<T extends { id: string }>(prev: readonly T[], next: readonly T[]): T[] {
  const old = new Map(prev.map((value) => [value.id, value]));
  return next.map((value) => {
    const had = old.get(value.id);
    return had !== undefined && looseDeepEqual(had, value) ? had : value;
  });
}

/** A watch's `onChange` that passes each value through {@link reuseById} against the last one it passed. */
export function stableList<T extends { id: string }>(onChange: (values: T[]) => void): (values: T[]) => void {
  let last: T[] = [];
  return (values) => {
    last = reuseById(last, values);
    onChange(last);
  };
}

/** `value`, kept as the same object for as long as it stays deep-equal, so an effect that depends on it runs only when it changes. */
export function useStable<T>(value: T): T {
  const [kept, setKept] = useState(value);
  const same = looseDeepEqual(kept, value);
  if (!same) setKept(value);
  return same ? kept : value;
}
