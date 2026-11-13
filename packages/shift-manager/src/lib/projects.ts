// BR-18; BR-38.
/**
 * A project's own reads, beside the snapshot: its workstreams and the Lab's
 * project setup.
 *
 * **What a project view reads**: the project's entry and its workstream
 * entries by one prefix, by scope with no session (the roster flow declares
 * both), and an entry's report through the roster flow's `workstreamReport`
 * view, since a report is content. Never a Lab read. Progress is worked out from the
 * entries here, by Workforce's own `projectProgress`, so the view and the
 * project coordinator count the same way; nothing is stored.
 *
 * **The project setup.** Which flow writes workstreams, and the standard
 * worker each user talks to a project through, their project coordinator.
 * Shift Manager doesn't name it: the Lab's projects flow answers its
 * `projectSetup` view with it, read with no session, once per connection.
 *
 * Shift Manager opens no workstream itself. The user asks their project
 * coordinator for the work, and the coordinator opens one with a lead from
 * their roster.
 */
import { useCallback, useEffect, useState } from "react";
import {
  parseWorkstreamEntry,
  projectProgress,
  PROJECTS_PATTERN,
  WORKSTREAMS_PATTERN,
  workstreamReportView,
  type ParsedWorkstreamEntry,
  type ProjectProgress,
} from "@flow-state-dev/workforce/browser";
import { viewRef, type Client } from "@flow-state-dev/client";
import { useLab } from "./lab-data";
import { describeFailure, readEveryScopeEntry, toProject, type Failure, type Project, type ProjectVisibility } from "./reads";

/** A project's address: where it lives, and its id. */
export type ProjectAddress = { visibility: ProjectVisibility; id: string };

/** One objective of a workstream, met or not. */
export type WorkstreamObjective = { text: string; met: boolean };

// BR-12.
/** One workstream of a project: its entry, as everyone who reads the project reads it. */
export type WorkstreamEntry = {
  /** Its storage key in the project's workstreams. */
  key: string;
  owner: string;
  id: string;
  title: string;
  /** The worker that leads it, on its owner's roster. */
  lead: string;
  /** The lead's workstream session, its owner's. `null` until its open has made it. */
  sessionId: string | null;
  status: string;
  due: string | null;
  objectives: WorkstreamObjective[];
  updatedAt: string;
  // BR-19.
  /** Whether it has gone quiet, as the project's progress counts it: one clock, `progress.stale`. */
  stale: boolean;
};

/** A project as its view opens: the row, its workstreams, and the progress worked out from them. */
export type ProjectRead = {
  project: Project;
  entries: WorkstreamEntry[];
  progress: ProjectProgress;
};

/** What the Lab's projects flow says about its project setup. */
export type ProjectSetup = {
  /** The flow `openWorkstream` and `updateWorkstream` are actions of, and the setup a view of. */
  flow: string;
  /** The standard worker each user's project coordinator runs as, or `null`. */
  projectCoordinator: string | null;
};

/** The view the Lab's projects flow names its setup on. */
export const PROJECT_SETUP_VIEW = "projectSetup";


/**
 * An entry, from what the entries' browser read publishes, parsed by
 * Workforce's own entry parser so this view and `readProject` read one shape.
 * A row that doesn't parse as an entry is left out of the view.
 */
function toEntry(storageKey: string, data: unknown): Omit<WorkstreamEntry, "stale"> | undefined {
  let parsed: ParsedWorkstreamEntry | undefined;
  try {
    parsed = parseWorkstreamEntry(storageKey, data);
  } catch {
    return undefined;
  }
  if (parsed === undefined) return undefined;
  return {
    key: storageKey,
    owner: parsed.owner,
    id: parsed.id,
    title: parsed.title,
    lead: parsed.lead,
    sessionId: parsed.sessionId,
    status: parsed.status,
    due: parsed.due,
    objectives: parsed.objectives.map((objective) => ({ text: objective.text, met: objective.met })),
    updatedAt: parsed.updatedAt,
  };
}

/** Where a project at `visibility` lives: a shared one in the organization, a private one in the user's own scope. */
const scopeOf = (visibility: ProjectVisibility) => (visibility === "private" ? "user" : "org");

// FIX-2624.
/**
 * Read a project as its view opens: its row, and its entries by the
 * project's one prefix, by scope with no session. `null` when the user can't
 * read a row at that address: none there, or another user's private project.
 */
export async function readProject(client: Client, address: ProjectAddress, now = Date.now()): Promise<ProjectRead | null> {
  const scope = scopeOf(address.visibility);
  const [row, entries] = await Promise.all([
    client.resource({ scope, pattern: PROJECTS_PATTERN }).entry(`projects/${address.id}`).read(),
    // The project's one prefix, through the snapshot's pager: its page ceiling and repeated-cursor check.
    readEveryScopeEntry(client, scope, WORKSTREAMS_PATTERN, `workstreams/${address.id}/`).then((rows) =>
      rows.map((row) => toEntry((row as { storageKey?: string }).storageKey ?? `workstreams/${row.topic}`, row.clientData)).filter((entry): entry is Omit<WorkstreamEntry, "stale"> => entry !== undefined),
    ),
  ]);
  if (row.value === null) return null;
  const project = toProject(row.value, address.visibility);
  if (project === undefined) return null;
  const progress = projectProgress(entries, now);
  const quiet = new Set(progress.stale.map((entry) => `${entry.owner}/${entry.id}`));
  return { project, entries: entries.map((entry) => ({ ...entry, stale: quiet.has(`${entry.owner}/${entry.id}`) })), progress };
}

// FIX-2624.
/**
 * An entry's latest report, read when its view opens through the roster
 * flow's `workstreamReport` view, with no session: `null` when its owner has
 * written none.
 */
export async function readEntryReport(
  client: Client,
  project: ProjectAddress,
  entry: Pick<WorkstreamEntry, "owner" | "id">,
): Promise<string | null> {
  return (await client.view(workstreamReportView, { project, owner: entry.owner, id: entry.id })).value.report;
}

/** Project setups read, per connection: one read per page load. */
const setups = new WeakMap<Client, Promise<ProjectSetup | null>>();

/**
 * The Lab's project setup, from its projects flow: the flow among the Lab's
 * that opens workstreams, and its `projectSetup` view, read with no session.
 * `null` for a Lab with no such flow. Read once per connection; a failed read
 * is read again next time.
 */
export function readProjectSetup(client: Client): Promise<ProjectSetup | null> {
  let read = setups.get(client);
  if (read === undefined) {
    read = (async () => {
      const flows = await client.flows();
      const flow = flows.find((entry) => entry.actions.includes("openWorkstream"));
      if (flow === undefined) return null;
      const { value } = await client.view(viewRef(flow.id, PROJECT_SETUP_VIEW), {});
      const answer = (value ?? {}) as { projectCoordinator?: unknown };
      return {
        flow: flow.id,
        projectCoordinator: typeof answer.projectCoordinator === "string" ? answer.projectCoordinator : null,
      };
    })();
    read.catch(() => setups.delete(client));
    setups.set(client, read);
  }
  return read;
}

/** A read in flight, landed, or failed. */
type ProjectReadState = { value: ProjectRead | null } | { failure: Failure } | undefined;

/** How often a project's entries are read again while they are on screen. */
const PROJECT_POLL_MS = 5_000;

// BR-18.
/**
 * The project's own read, row and entries, when the view opens, each
 * time the Lab is read again (`readAt`), and every {@link PROJECT_POLL_MS}
 * while its entries are on screen, on a tab that draws them or open under
 * the project in the sidebar: a workstream is opened by
 * someone else's turn (the Shift Coordinator's, or a coordinator's in another
 * window), so the list shows it without a reload. `reread` reads it now, as
 * after an open. A read again keeps the last one on screen until it lands,
 * and keeps it if it fails.
 * No read while `enabled` is false: nothing on screen draws the entries.
 */
export function useProjectRead(address: ProjectAddress, enabled: boolean, readAt: number) {
  const { client } = useLab();
  const [read, setRead] = useState<ProjectReadState>(undefined);
  const [reads, setReads] = useState(0);
  useEffect(() => {
    if (!enabled) return;
    let closed = false;
    let next: ReturnType<typeof setTimeout> | undefined;
    readProject(client, address)
      .then((value) => !closed && setRead({ value }))
      // A failed read again keeps the last good one on screen: one dropped
      // poll shouldn't blank the list. Only a failed first read shows.
      .catch(
        (error: unknown) =>
          !closed && setRead((prev) => (prev !== undefined && "value" in prev ? prev : { failure: describeFailure(error) })),
      )
      // After a failed read too: a dropped request recovers without Retry.
      .finally(() => {
        if (!closed) next = setTimeout(() => setReads((n) => n + 1), PROJECT_POLL_MS);
      });
    return () => {
      closed = true;
      if (next !== undefined) clearTimeout(next);
    };
    // The address is the view's key; its parts are what the read depends on.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [client, enabled, address.visibility, address.id, readAt, reads]);
  const reread = useCallback(() => setReads((n) => n + 1), []);
  return { read, reread };
}
