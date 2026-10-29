/**
 * Keep unchanged values unchanged. A watch rebuilds every entry on each
 * streamed chunk; handing React the same object for an entry that didn't
 * change lets a memoized row skip its render, so only the growing one draws.
 */

/** `next`, with each value equal to the one `prev` had at its id swapped for that old object. */
export function reuseById<T extends { id: string }>(prev: readonly T[], next: readonly T[]): T[] {
  const old = new Map(prev.map((value) => [value.id, value]));
  return next.map((value) => {
    const had = old.get(value.id);
    return had !== undefined && JSON.stringify(had) === JSON.stringify(value) ? had : value;
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
