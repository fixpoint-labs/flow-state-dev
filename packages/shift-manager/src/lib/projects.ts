/**
 * A project's own reads, beside the snapshot: its workstreams and the Lab's
 * project setup.
 *
 * **What a project view reads** (BR-18): the project's row and its workstream
 * entries by one prefix, through the user's own session on the roster flow,
 * which declares both. Never a Lab read. Progress is worked out from the
 * entries here, by Workforce's own `projectProgress`, so the view and the
 * project coordinator count the same way; nothing is stored.
 *
 * **The project setup.** Which flow writes workstreams, and the standard
 * worker each user talks to a project through, their project coordinator.
 * Shift Manager doesn't name it: the Lab's projects flow answers
 * `projectSetup` with it, read once per connection.
 *
 * Shift Manager opens no workstream itself. The user asks their project
 * coordinator for the work, and the coordinator opens one with a lead from
 * their roster (BR-38).
 */
import { useCallback, useEffect, useState } from "react";
import type { SessionSummary } from "@flow-state-dev/client";
import {
  parseWorkstreamEntry,
  projectProgress,
  workstreamsAccessor,
  type ParsedWorkstreamEntry,
  type ProjectProgress,
} from "@flow-state-dev/workforce/browser";
import { runAction } from "./action";
import type { Client } from "@flow-state-dev/client";
import { useLab } from "./lab-data";
import { describeFailure, PROJECT_READER_FLOW, readerSessionId, toProject, type Failure, type Project, type ProjectVisibility } from "./reads";

/** A project's address: where it lives, and its id. */
export type ProjectAddress = { visibility: ProjectVisibility; id: string };

/** One objective of a workstream, met or not. */
export type WorkstreamObjective = { text: string; met: boolean };

/** One workstream of a project: its entry, as everyone who reads the project reads it (BR-12). */
export type WorkstreamEntry = {
  /** Its storage key in the project's workstreams: where its report is read. */
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
  /** Whether it has gone quiet, as the project's progress counts it (BR-19): one clock, `progress.stale`. */
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
  /** The flow `openWorkstream`, `updateWorkstream` and `projectSetup` are actions of. */
  flow: string;
  /** The standard worker each user's project coordinator runs as, or `null`. */
  projectCoordinator: string | null;
};

/** The action the Lab's projects flow names its setup on. */
export const PROJECT_SETUP_ACTION = "projectSetup";

/** Rows per page: the collection route's maximum. */
const PAGE_SIZE = 200;
const MAX_PAGES = 50;

/** The user's own session on the roster flow, which reads projects and entries, or `null` while they hold none. */
export function projectReaderOf(sessions: readonly SessionSummary[]): string | null {
  return sessions.find((session) => session.parentSessionId == null && session.flowKind === PROJECT_READER_FLOW)?.id ?? null;
}

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

/** The accessor a project's row is declared under on the roster flow, at its visibility. */
const projectsAccessor = (visibility: ProjectVisibility) => (visibility === "private" ? "privateProjects" : "projects");

/**
 * Read a project as its view opens: its row, and its entries by the
 * project's one prefix, through the user's reader session. `null` when the
 * user can't read a row at that address: none there, or another user's
 * private project.
 */
export async function readProject(client: Client, readerSessionId: string, address: ProjectAddress, now = Date.now()): Promise<ProjectRead | null> {
  const [row, entries] = await Promise.all([
    client.resources.getCollectionItemState(readerSessionId, projectsAccessor(address.visibility), address.id),
    (async () => {
      const found: Omit<WorkstreamEntry, "stale">[] = [];
      let cursor: string | undefined;
      for (let page = 0; page < MAX_PAGES; page += 1) {
        const listed = await client.resources.listCollectionItems(readerSessionId, workstreamsAccessor(address.visibility), {
          limit: PAGE_SIZE,
          topicPrefix: `workstreams/${address.id}/`,
          ...(cursor === undefined ? {} : { cursor }),
        });
        for (const item of listed.items) {
          const key = (item as { storageKey?: string }).storageKey ?? `workstreams/${item.topic}`;
          const entry = toEntry(key, item.clientData);
          if (entry !== undefined) found.push(entry);
        }
        if (listed.nextCursor === undefined || listed.nextCursor === cursor) break;
        cursor = listed.nextCursor;
      }
      return found;
    })(),
  ]);
  if (row === null) return null;
  const project = toProject(row.clientData, address.visibility);
  if (project === undefined) return null;
  const progress = projectProgress(entries, now);
  const quiet = new Set(progress.stale.map((entry) => `${entry.owner}/${entry.id}`));
  return { project, entries: entries.map((entry) => ({ ...entry, stale: quiet.has(`${entry.owner}/${entry.id}`) })), progress };
}

/**
 * An entry's latest report, read when its view opens: `null` when its owner
 * has written none.
 */
export async function readEntryReport(
  client: Client,
  readerSessionId: string,
  project: ProjectAddress,
  entry: Pick<WorkstreamEntry, "key">,
): Promise<string | null> {
  const read = await client.resources.getCollectionItemContent(readerSessionId, workstreamsAccessor(project.visibility), entry.key);
  return typeof read.content === "string" && read.content.length > 0 ? read.content : null;
}

/** Project setups read, per connection: one read per page load. */
const setups = new WeakMap<Client, Promise<ProjectSetup | null>>();

/**
 * The Lab's project setup, from its projects flow: the flow among the Lab's
 * that answers `projectSetup` and opens workstreams. `null` for a Lab with no
 * such flow. Read once per connection; a failed read is read again next time.
 */
export function readProjectSetup(client: Client): Promise<ProjectSetup | null> {
  let read = setups.get(client);
  if (read === undefined) {
    read = (async () => {
      const flows = await client.flows();
      const flow = flows.find((entry) => entry.actions.includes(PROJECT_SETUP_ACTION) && entry.actions.includes("openWorkstream"));
      if (flow === undefined) return null;
      const { output } = await runAction(client, flow.id, readerSessionId(client.userId, flow.id), PROJECT_SETUP_ACTION, {});
      const answer = (output ?? {}) as { projectCoordinator?: unknown };
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
export type ProjectReadState = { value: ProjectRead | null } | { failure: Failure } | undefined;

/** How often a project's entries are read again while they are on screen. */
const PROJECT_POLL_MS = 5_000;

/**
 * The project's own read, row and entries (BR-18), when the view opens, each
 * time the Lab is read again (`readAt`), and every {@link PROJECT_POLL_MS}
 * while its entries are on screen, on a tab that draws them or open under
 * the project in the sidebar: a workstream is opened by
 * someone else's turn (the chief of staff's, or a coordinator's in another
 * window), so the list shows it without a reload. `reread` reads it now, as
 * after an open. A read again keeps the last one on screen until it lands,
 * and keeps it if it fails.
 * No read while `readerSessionId` is `null`: the user holds no reader session
 * yet, or nothing on screen draws the entries.
 */
export function useProjectRead(address: ProjectAddress, readerSessionId: string | null, readAt: number) {
  const { client } = useLab();
  const [read, setRead] = useState<ProjectReadState>(undefined);
  const [reads, setReads] = useState(0);
  useEffect(() => {
    if (readerSessionId === null) return;
    let closed = false;
    let next: ReturnType<typeof setTimeout> | undefined;
    readProject(client, readerSessionId, address)
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
  }, [client, readerSessionId, address.visibility, address.id, readAt, reads]);
  const reread = useCallback(() => setReads((n) => n + 1), []);
  return { read, reread };
}
