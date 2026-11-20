/**
 * The reads the directory holds, one of each per page (`directory.tsx`):
 * the organization's worker inventory and the user's two projects
 * collections, each read whole and kept current by `react`'s `useResource`;
 * the user's roster, followed through workforce's client (`roster.ts`); and
 * the user's sessions, dispatch runs included, by `react`'s `useSessionList`.
 * Every one is kept current by its own notices, so nothing here re-reads on
 * a whole-Lab clock.
 */
import { useMemo, useRef } from "react";
import type { SessionSummary } from "@flow-state-dev/client";
import { useResource, useSessionList } from "@flow-state-dev/react";
import { privateProjectsResource, projectsResource, workerInventoryResource } from "@flow-state-dev/workforce/browser";
import { useLab } from "./lab-data";
import type { Failure } from "./failure";
import { toProject, type Project } from "./project";
import { useRoster, type RosterRead } from "./roster";
import { toWorker, type Worker } from "./workers";

/** One whole-collection read: its entries' parsed values once read (`undefined` before), why the last read failed, and a read on demand. */
export type CollectionRead<T> = { values: T[] | undefined; failure: Failure | undefined; refresh: () => void };

/** What the directory reads. */
export type DirectoryReads = {
  /** The inventory's workers, as its rows publish them. */
  inventory: CollectionRead<Worker>;
  /** The user's roster. */
  roster: RosterRead;
  /** The user's listed sessions, dispatch runs included: `undefined` until listed. */
  sessions: { list: readonly SessionSummary[] | undefined; refresh: () => void };
  /** The organization's projects, then the user's private ones. */
  projects: { shared: CollectionRead<Project>; own: CollectionRead<Project> };
};

/** A failure, held by what it says: a hook words a failure afresh each render. */
function useSameFailure(failure: Failure | undefined): Failure | undefined {
  const message = failure?.message;
  const status = failure?.httpStatus;
  return useMemo(
    () => (message === undefined ? undefined : { message, ...(status === undefined ? {} : { httpStatus: status }) }),
    [message, status],
  );
}

/** A whole-collection read's entries, each parsed by `parse` (one that doesn't parse is left out), held while the read's value is. */
function useParsed<T>(
  read: { value: readonly { value: unknown }[] | null; failure?: Failure; refresh(): void },
  parse: (value: unknown) => T | undefined,
): CollectionRead<T> {
  const value = read.value;
  // `parse` is a module-level function per call site.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const values = useMemo(() => value?.map((entry) => parse(entry.value)).filter((parsed): parsed is T => parsed !== undefined), [value]);
  const failure = useSameFailure(read.failure);
  const refresh = read.refresh;
  return useMemo(() => ({ values, failure, refresh }), [values, failure, refresh]);
}

const sharedProject = (value: unknown) => toProject(value, "shared");
const privateProject = (value: unknown) => toProject(value, "private");

/** The directory's reads, once per page: only the directory provider calls this. */
export function useDirectoryReads(): DirectoryReads {
  const { client } = useLab();
  const inventory = useParsed(useResource(workerInventoryResource, { client, all: true }), toWorker);
  const shared = useParsed(useResource(projectsResource, { client, all: true }), sharedProject);
  const own = useParsed(useResource(privateProjectsResource, { client, all: true }), privateProject);
  const roster = useRoster();
  const listing = useSessionList({ client, includeDispatchRuns: true, includeStatus: false });
  // Undefined only before the first list lands: a later read of an empty list is still a list.
  const landed = useRef(false);
  if (!listing.isLoading || listing.sessions.length > 0 || listing.error !== null) landed.current = true;
  const listed = landed.current ? listing.sessions : undefined;
  const sessions = useMemo(() => ({ list: listed, refresh: listing.refresh }), [listed, listing.refresh]);
  const projects = useMemo(() => ({ shared, own }), [shared, own]);
  return { inventory, roster, sessions, projects };
}
