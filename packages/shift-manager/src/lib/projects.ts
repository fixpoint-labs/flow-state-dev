// BR-18; BR-38.
/**
 * A project's own reads, beside the snapshot: its workstreams and the Lab's
 * project setup.
 *
 * **What a project view reads**: the project's entry and its workstream
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
 * their roster.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { topic, type LiveRead, type SessionSummary } from "@flow-state-dev/client";
import {
  DONE_STATUS,
  parseWorkstreamEntry,
  projectProgress,
  STALE_AFTER_MS,
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

// BR-12.
/** One workstream of a project: its entry, as everyone who reads the project reads it. */
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

/** The accessor a project's entry is declared under on the roster flow, at its visibility. */
const projectsAccessor = (visibility: ProjectVisibility) => (visibility === "private" ? "privateProjects" : "projects");

/**
 * Read a project as its view opens: its row, and its entries by the
 * project's one prefix, through the user's reader session. `null` when the
 * user can't read a row at that address: none there, or another user's
 * private project.
 */
export async function readProject(client: Client, readerSessionId: string, address: ProjectAddress, now = Date.now()): Promise<ProjectRead | null> {
  const [row, entries] = await Promise.all([
    client.resources.getCollectionResourceState(readerSessionId, projectsAccessor(address.visibility), address.id),
    (async () => {
      const found: Omit<WorkstreamEntry, "stale">[] = [];
      let cursor: string | undefined;
      for (let page = 0; page < MAX_PAGES; page += 1) {
        const listed = await client.resources.listCollectionResources(readerSessionId, workstreamsAccessor(address.visibility), {
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
  return withProgress(project, entries, now);
}

/**
 * A project read as of `now`: its progress, worked out from its entries by
 * Workforce's own `projectProgress`, and each entry marked gone quiet by that
 * same clock. Pure, so a view can work it out again as time passes, with no read.
 */
function withProgress(project: Project, entries: readonly Omit<WorkstreamEntry, "stale">[], now: number): ProjectRead {
  const progress = projectProgress(entries, now);
  const quiet = new Set(progress.stale.map((entry) => `${entry.owner}/${entry.id}`));
  return { project, entries: entries.map((entry) => ({ ...entry, stale: quiet.has(`${entry.owner}/${entry.id}`) })), progress };
}

// BR-19.
/**
 * When the next of `read`'s entries goes quiet, by `projectProgress`'s rule (an
 * unfinished entry unchanged for {@link STALE_AFTER_MS}), or `undefined` when
 * none will: a quiet entry is one nobody writes, so no notice says so.
 */
function nextQuietAt(read: ProjectRead): number | undefined {
  let next: number | undefined;
  for (const entry of read.entries) {
    if (entry.stale || entry.status === DONE_STATUS) continue;
    const updated = Date.parse(entry.updatedAt);
    if (!Number.isFinite(updated)) continue;
    const at = updated + STALE_AFTER_MS;
    if (next === undefined || at < next) next = at;
  }
  return next;
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
  const read = await client.resources.getCollectionResourceContent(readerSessionId, workstreamsAccessor(project.visibility), entry.key);
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

/** The pace a project's entries are read at while they are on screen, wherever push can miss a change. */
const PROJECT_POLL_MS = 5_000;

// BR-18.
/**
 * The project's own read, row and entries, when the view opens, each
 * time the Lab is read again (`readAt`), and on each notice of the project or
 * one of its entries under the project's scope (the org's for a shared
 * project, its owner's for a private one) while its entries are on screen, on
 * a tab that draws them or open under the project in the sidebar: a
 * workstream is opened by someone else's turn (the Shift Coordinator's, or a
 * coordinator's in another window), so the list shows it without a reload.
 * Wherever push can miss a change it reads every {@link PROJECT_POLL_MS}
 * instead (`client.live`). `reread` reads it now, as after an open. A read
 * again keeps the last one on screen until it lands, and keeps it if it
 * fails; the live read tries a failed one again on its own.
 * No read while `readerSessionId` is `null`: the user holds no reader session
 * yet, or nothing on screen draws the entries.
 */
export function useProjectRead(address: ProjectAddress, readerSessionId: string | null, readAt: number) {
  const { client } = useLab();
  const [read, setRead] = useState<ProjectReadState>(undefined);
  const live = useRef<LiveRead | null>(null);
  useEffect(() => {
    if (readerSessionId === null) return;
    const where = { visibility: address.visibility, id: address.id };
    const watching = client.live([where.visibility === "private" ? topic.user() : topic.org()], {
      read: () => readProject(client, readerSessionId, where),
      onValue: (value) => setRead({ value }),
      // A failed read again keeps the last good one on screen: one dropped
      // read shouldn't blank the list. Only a failed first read shows.
      onError: (error) => setRead((prev) => (prev !== undefined && "value" in prev ? prev : { failure: describeFailure(error) })),
      hear: (notice) => notice.kind === "resource",
      paths: [`projects/${where.id}`, `workstreams/${where.id}`],
      pollIntervalMs: PROJECT_POLL_MS,
    });
    live.current = watching;
    return () => {
      watching.close();
      if (live.current === watching) live.current = null;
    };
    // The address is the view's key; its parts are what the read depends on.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [client, readerSessionId, address.visibility, address.id]);
  // A Lab read reads it again too; the live read's own first read covers the one it opened on.
  const readAtSeen = useRef(readAt);
  useEffect(() => {
    if (readAtSeen.current === readAt) return;
    readAtSeen.current = readAt;
    live.current?.refresh();
  }, [readAt]);
  // Going quiet is the absence of writes, so the page's own clock says when:
  // one recompute at the next entry's threshold, with no read, then the next.
  const landed = read !== undefined && "value" in read ? read.value : null;
  useEffect(() => {
    if (landed === null) return;
    const at = nextQuietAt(landed);
    if (at === undefined) return;
    const timer = setTimeout(
      () => setRead((held) => (held !== undefined && "value" in held && held.value === landed ? { value: withProgress(landed.project, landed.entries, Date.now()) } : held)),
      Math.max(0, at - Date.now()),
    );
    return () => clearTimeout(timer);
  }, [landed]);
  const reread = useCallback(() => live.current?.refresh(), []);
  return { read, reread };
}
