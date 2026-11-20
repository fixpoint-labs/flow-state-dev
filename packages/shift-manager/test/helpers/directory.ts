/**
 * The directory's reads for a fixture snapshot, for screen tests that draw a
 * fixed Lab: the inventory's workers, the listed sessions and the projects the
 * snapshot holds, as `useDirectoryReads` would hand them over. A screen test
 * mocks `src/lib/directory-reads` with {@link useFixtureReads}, keeping the
 * real roster watch (`useRoster`), so the directory's join, the gate and
 * every screen run as they do over the Lab.
 *
 * Each fixture reads as the same objects every render, as the real hooks
 * hold their values; a refresh draws whatever the fixture holds by then.
 */
import { useReducer } from "react";
import type { DirectoryReads } from "../../src/lib/directory-reads";
import type { RosterRead } from "../../src/lib/roster";
import type { LabSnapshot } from "../../src/lib/reads";
import { useRoster } from "../../src/lib/roster";

type Fixed = Omit<DirectoryReads, "roster">;

const held = new WeakMap<object, Fixed>();

/** The reads `snapshot` stands for; `undefined` (not yet read), a refusal or an unreachable Lab read as nothing landed. */
function readsOfSnapshot(snapshot: LabSnapshot | undefined, refresh: () => void): Fixed {
  const key = snapshot ?? held;
  const found = held.get(key);
  if (found !== undefined) return found;
  const loaded = snapshot === undefined || snapshot.refused !== undefined || snapshot.unreachable !== undefined ? undefined : snapshot;
  const read = <T,>(section: { ok: true; value: T[] } | { ok: false; failure: { message: string; httpStatus?: number } } | undefined) =>
    section === undefined
      ? { values: undefined, failure: undefined, refresh }
      : section.ok
        ? { values: section.value, failure: undefined, refresh }
        : { values: undefined, failure: section.failure, refresh };
  // A partial fixture with no projects section reads as a Lab with none.
  const projects = loaded?.projects ?? { ok: true as const, value: { rows: [] } };
  const fixed: Fixed = {
    inventory: loaded === undefined ? read(undefined) : read(loaded.inventory.ok ? { ok: true, value: loaded.inventory.value.workers } : loaded.inventory),
    sessions: { list: loaded?.sessions, refresh },
    projects: {
      shared: loaded === undefined ? read(undefined) : read(projects!.ok ? { ok: true, value: projects!.value.rows.filter((p) => p.visibility === "shared") } : projects!),
      own: loaded === undefined ? read(undefined) : read(projects!.ok ? { ok: true, value: projects!.value.rows.filter((p) => p.visibility === "private") } : { ok: true, value: [] }),
    },
  };
  held.set(key, fixed);
  return fixed;
}

/**
 * `useDirectoryReads` over the fixture `current()` returns: its reads, beside
 * the real roster watch. A refresh redraws, so a test that changed the
 * fixture sees it after the screen's Retry or R, as it would after a read.
 */
export function useFixtureReads(current: () => LabSnapshot | undefined): DirectoryReads {
  const [, redraw] = useReducer((n: number) => n + 1, 0);
  const roster = useRoster();
  return { ...readsOfSnapshot(current(), redraw), roster };
}

/** A roster with nobody on it: one object, as a read that landed holds one. */
const NOBODY: RosterRead = { entries: [] };

/**
 * `useDirectoryReads` over the fixture `current()` returns, with a fixed
 * roster read in place of the watch: for a component test whose workforce
 * stand-in follows no roster.
 */
export function useFixedReads(current: () => LabSnapshot | undefined, roster: RosterRead = NOBODY): DirectoryReads {
  const [, redraw] = useReducer((n: number) => n + 1, 0);
  return { ...readsOfSnapshot(current(), redraw), roster };
}
