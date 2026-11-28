/**
 * The directory's reads for a fixed Lab, for screen tests that draw one: the
 * inventory's workers, the listed sessions and the projects, as
 * `useDirectoryReads` would hand them over. A screen test mocks
 * `src/lib/directory-reads` with {@link useFixtureReads}, keeping the real
 * roster watch (`useRoster`), so the directory's join, the gate and every
 * screen run as they do over the Lab.
 *
 * Each fixture reads as the same objects every render, as the real hooks
 * hold their values; a refresh draws whatever the fixture holds by then.
 */
import { useReducer } from "react";
import type { SessionSummary } from "@flow-state-dev/client";
import type { DirectoryReads } from "../../src/lib/directory-reads";
import type { Section } from "../../src/lib/failure";
import type { Project } from "../../src/lib/project";
import type { RosterRead } from "../../src/lib/roster";
import { useRoster } from "../../src/lib/roster";
import type { Worker } from "../../src/lib/workers";

/**
 * What the directory's reads hold for a fixed Lab. A read left out landed
 * empty (no projects) or, for the inventory and the sessions, has not landed.
 */
export type DirectoryFixture = {
  /** The worker inventory's read: its workers, or why it failed. */
  inventory?: Section<{ workers: Worker[] }>;
  /** The user's listed sessions. */
  sessions?: SessionSummary[];
  /** Both projects collections' reads: every project, each by its visibility, or why they failed. */
  projects?: Section<Project[]>;
};

type Fixed = Omit<DirectoryReads, "roster">;

const held = new WeakMap<object, Fixed>();

/** The reads `fixture` stands for; `undefined` reads as nothing landed. */
function readsOf(fixture: DirectoryFixture | undefined, refresh: () => void): Fixed {
  const key = fixture ?? held;
  const found = held.get(key);
  if (found !== undefined) return found;
  const read = <T,>(section: Section<T[]> | undefined) =>
    section === undefined
      ? { values: undefined, failure: undefined, refresh }
      : section.ok
        ? { values: section.value, failure: undefined, refresh }
        : { values: undefined, failure: section.failure, refresh };
  // A fixture with no projects reads as a Lab with none.
  const projects: Section<Project[]> = fixture?.projects ?? { ok: true, value: [] };
  const inventory = fixture?.inventory;
  const fixed: Fixed = {
    inventory: read(inventory === undefined ? undefined : inventory.ok ? { ok: true, value: inventory.value.workers } : inventory),
    sessions: { list: fixture?.sessions, failure: undefined, refresh },
    projects: {
      shared: fixture === undefined ? read(undefined) : read(projects.ok ? { ok: true, value: projects.value.filter((p) => p.visibility === "shared") } : projects),
      own: fixture === undefined ? read(undefined) : read(projects.ok ? { ok: true, value: projects.value.filter((p) => p.visibility === "private") } : { ok: true, value: [] }),
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
export function useFixtureReads(current: () => DirectoryFixture | undefined): DirectoryReads {
  const [, redraw] = useReducer((n: number) => n + 1, 0);
  const roster = useRoster();
  return { ...readsOf(current(), redraw), roster };
}

/** A roster with nobody on it: one object, as a read that landed holds one. */
const NOBODY: RosterRead = { entries: [] };

/**
 * `useDirectoryReads` over the fixture `current()` returns, with a fixed
 * roster read in place of the watch: for a component test whose workforce
 * stand-in follows no roster.
 */
export function useFixedReads(current: () => DirectoryFixture | undefined, roster: RosterRead = NOBODY): DirectoryReads {
  const [, redraw] = useReducer((n: number) => n + 1, 0);
  return { ...readsOf(current(), redraw), roster };
}
