/**
 * A goal control's change to an app's source: planted for the run, put back
 * after. A control proves its check can fail by breaking the property the
 * check claims, in the source the page is built from.
 */
import { readFileSync, writeFileSync } from "node:fs";

/** A control's change to the source: in which file, the text it replaces, and with what. */
export interface Plant {
  file: string;
  from: string;
  to: string;
}

/** Plant `control`'s changes from `plants` (none for ""), and hand back what puts the files back. */
export function plant(plants: Record<string, Plant[]>, control: string): () => void {
  if (control !== "" && plants[control] === undefined) throw new Error(`setup: no control named ${control}`);
  const undo: (() => void)[] = [];
  for (const change of plants[control] ?? []) {
    const before = readFileSync(change.file, "utf8");
    if (before.split(change.from).length !== 2) throw new Error(`setup: ${change.file} doesn't hold the text the ${control} control replaces exactly once`);
    writeFileSync(change.file, before.replace(change.from, change.to));
    undo.push(() => writeFileSync(change.file, before));
  }
  return () => undo.forEach((put) => put());
}
