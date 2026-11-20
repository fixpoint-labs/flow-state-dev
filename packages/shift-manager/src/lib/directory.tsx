// FIX-2775 D1.
/**
 * The worker directory, the user's sessions and the projects they read: one
 * read of each per page, held by {@link DirectoryProvider} and drawn by every
 * screen through {@link useWorkers}, {@link useSessions} and
 * {@link useProjects}. N screens drawing workers is still one inventory read
 * and one roster watch, so one org notice is one read, not N.
 *
 * The worker rows are the inventory joined with the roster (`workers.ts`);
 * who is on shift reads the Inbox view against them (`shift.ts`).
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import type { SessionSummary } from "@flow-state-dev/client";
import { useDirectoryReads, type CollectionRead } from "./directory-reads";
import type { Failure, Section } from "./failure";
import type { Project } from "./projects";
import type { RosterRead } from "./roster";
import { joinWorkers, type Worker } from "./workers";

/** The organization's worker inventory, by its published key pattern: named in the no-inventory failure. */
const WORKER_INVENTORY_PATTERN = "inventory/workers/*";

/** What a read the Lab answered with no inventory says: none of its flows declares one, or none holds a worker. */
const NO_INVENTORY: Failure = {
  message: `No inventory to read: none of this Lab's flows declares the organization's worker inventory (${WORKER_INVENTORY_PATTERN}) with a worker in it. Either the Lab booted without opening its inventory, or these pages are an older build than the Lab and look for keys it no longer uses: rebuild them (pnpm --filter @flow-state-dev/shift-manager build) and reload.`,
};

/** The worker directory, as a screen draws it. */
export type Workers = {
  /**
   * The inventory's workers, or why there are none: a Lab whose flows declare
   * no inventory, or one with no worker in it, is a failure that says which.
   * `undefined` until the first read lands or fails.
   */
  inventory: Section<Worker[]> | undefined;
  /** Every worker: the inventory's, joined with the roster, the user's own after them. */
  workers: Worker[];
  /** The user's own workers, among {@link Workers.workers}. */
  own: Worker[];
  /** The roster read the join drew on. */
  roster: RosterRead;
  /** When the directory's reads last landed, epoch ms; `undefined` before. */
  readAt: number | undefined;
  /** Read the inventory and the sessions again: a section's Retry, R. */
  refresh: () => void;
};

/** The directory: the worker rows, the sessions and the projects. */
type Directory = {
  workers: Workers;
  sessions: { list: readonly SessionSummary[] | undefined; refresh: () => void };
  projects: { section: Section<Project[]> | undefined; refresh: () => void };
};

const nothing = () => {};

/**
 * The directory with nothing read: what a component drawn outside a
 * {@link DirectoryProvider} sees (a component under test on its own), the
 * same as a page whose reads haven't landed.
 */
const UNREAD: Directory = {
  workers: { inventory: undefined, workers: [], own: [], roster: undefined, readAt: undefined, refresh: nothing },
  sessions: { list: undefined, refresh: nothing },
  projects: { section: undefined, refresh: nothing },
};

const DirectoryContext = createContext<Directory>(UNREAD);

/** The inventory's section: its workers, or why there are none. */
function inventorySection(read: CollectionRead<Worker>): Section<Worker[]> | undefined {
  if (read.rows !== undefined && read.rows.length > 0) return { ok: true, value: read.rows };
  if (read.rows !== undefined || read.failure?.httpStatus === 404) return { ok: false, failure: NO_INVENTORY };
  return read.failure === undefined ? undefined : { ok: false, failure: read.failure };
}

/**
 * The projects the user reads: the shared ones in the collection's order,
 * then their private ones. A scope no flow declares (a 404) has none, which is
 * not a failure; any other failure says why, and is never drawn as an empty
 * list. A read that fails after one landed keeps the rows it read.
 */
function projectsSection(shared: CollectionRead<Project>, own: CollectionRead<Project>): Section<Project[]> | undefined {
  const rowsOf = (read: CollectionRead<Project>): Section<Project[]> | undefined =>
    read.rows !== undefined
      ? { ok: true, value: read.rows }
      : read.failure === undefined
        ? undefined
        : read.failure.httpStatus === 404
          ? { ok: true, value: [] }
          : { ok: false, failure: read.failure };
  const [a, b] = [rowsOf(shared), rowsOf(own)];
  if (a?.ok === false) return a;
  if (b?.ok === false) return b;
  return a === undefined || b === undefined ? undefined : { ok: true, value: [...a.value, ...b.value] };
}

/** Hold the page's one read of each directory read, for every screen under it. */
export function DirectoryProvider({ children }: { children: ReactNode }) {
  const { inventory, roster, sessions, projects } = useDirectoryReads();
  const section = useMemo(() => inventorySection(inventory), [inventory]);
  const entries = roster !== undefined && "entries" in roster ? roster.entries : undefined;
  const joined = useMemo(() => joinWorkers(section?.ok === true ? section.value : undefined, entries ?? []), [section, entries]);
  // When the directory's reads last landed: what Roster's *read* line says.
  const [readAt, setReadAt] = useState<number | undefined>(undefined);
  useEffect(() => {
    if (inventory.rows !== undefined || entries !== undefined) setReadAt(Date.now());
  }, [inventory.rows, entries]);
  const refreshInventory = inventory.refresh;
  const refreshSessions = sessions.refresh;
  const refresh = useCallback(() => {
    refreshInventory();
    refreshSessions();
  }, [refreshInventory, refreshSessions]);
  const workers = useMemo<Workers>(
    () => ({ inventory: section, workers: joined.workers, own: joined.own, roster, readAt, refresh }),
    [section, joined, roster, readAt, refresh],
  );
  const projectRows = useMemo(() => projectsSection(projects.shared, projects.own), [projects]);
  const refreshShared = projects.shared.refresh;
  const refreshOwn = projects.own.refresh;
  const refreshProjects = useCallback(() => {
    refreshShared();
    refreshOwn();
  }, [refreshShared, refreshOwn]);
  const value = useMemo<Directory>(
    () => ({ workers, sessions, projects: { section: projectRows, refresh: refreshProjects } }),
    [workers, sessions, projectRows, refreshProjects],
  );
  return <DirectoryContext.Provider value={value}>{children}</DirectoryContext.Provider>;
}

function useDirectory(): Directory {
  return useContext(DirectoryContext);
}

/** The worker directory every screen that draws a worker reads. */
export function useWorkers(): Workers {
  return useDirectory().workers;
}

/** The user's listed sessions, dispatch runs included: `list` is `undefined` until listed. */
export function useSessions(): Directory["sessions"] {
  return useDirectory().sessions;
}

/** The projects the user reads, shared then private: `undefined` until both reads land. */
export function useProjects(): Directory["projects"] {
  return useDirectory().projects;
}

/**
 * Whether the directory's first reads have landed, or failed: the inventory,
 * the session list and the projects. The frame waits for it, as it waited for
 * the whole-Lab read before, so no screen draws half a directory. The roster
 * isn't waited for: a screen says when it hasn't loaded.
 */
export function useDirectoryLanded(): boolean {
  const { workers, sessions, projects } = useDirectory();
  return workers.inventory !== undefined && sessions.list !== undefined && projects.section !== undefined;
}
