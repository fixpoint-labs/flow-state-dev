/**
 * A project's own reads and writes, beside the snapshot: its workstreams, the
 * Lab's project setup, and opening a workstream with a coordinator of its own.
 *
 * **What a project view reads** (BR-18): the project's row and its workstream
 * entries by one prefix, through the person's own session on the roster flow,
 * which declares both. Never a Lab read. Progress is worked out from the
 * entries here, by Workforce's own `projectProgress`, so the view and the
 * project coordinator count the same way; nothing is stored.
 *
 * **The project setup.** Which flow writes workstreams, and which two standard
 * workers stand behind a project: the coordinator each person talks to it
 * through, and the coordinator Shift Manager forks to lead each workstream a
 * person opens. Shift Manager names neither: the Lab's projects flow answers
 * `projectSetup` with them, read once per connection.
 *
 * **Opening a workstream** (D2, BR-35, BR-36): Shift Manager forks the standard
 * workstream coordinator onto the person's roster, under an id derived from
 * the workstream's address, and opens the workstream naming it as the lead. A
 * worker already at that id, forked from the standard workstream coordinator,
 * is used, not forked again; any other worker there refuses the open, naming
 * it, before anything is written. A refused open fires the coordinator that
 * open forked, so the roster is as it was. Workforce's `openWorkstream` runs
 * every rule it runs for any app: the roster check on the lead, the
 * workstream session, the delegate record.
 */
import type { SessionSummary } from "@flow-state-dev/client";
import {
  parseWorkstreamEntry,
  projectProgress,
  workstreamsAccessor,
  type ParsedWorkstreamEntry,
  type ProjectProgress,
  type WorkforceClient,
} from "@flow-state-dev/workforce/browser";
import { ActionRefused, runAction } from "./action";
import type { LabClients } from "./connection";
import { PROJECT_READER_FLOW, readerSessionId, toProject, type Project, type ProjectVisibility } from "./reads";

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
  /** The standard worker each person's project coordinator runs as, or `null`. */
  projectCoordinator: string | null;
  /** The standard worker Shift Manager forks to lead a workstream, or `null`. */
  workstreamCoordinator: string | null;
};

/** The action the Lab's projects flow names its setup on. */
export const PROJECT_SETUP_ACTION = "projectSetup";

/** Rows per page: the collection route's maximum. */
const PAGE_SIZE = 200;
const MAX_PAGES = 50;

/** The person's own session on the roster flow, which reads projects and entries, or `null` while they hold none. */
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
 * project's one prefix, through the person's reader session. `null` when the
 * person can't read a row at that address: none there, or another person's
 * private project.
 */
export async function readProject(clients: LabClients, readerSessionId: string, address: ProjectAddress, now = Date.now()): Promise<ProjectRead | null> {
  const [row, entries] = await Promise.all([
    clients.resources.getCollectionItemState(readerSessionId, projectsAccessor(address.visibility), address.id),
    (async () => {
      const found: Omit<WorkstreamEntry, "stale">[] = [];
      let cursor: string | undefined;
      for (let page = 0; page < MAX_PAGES; page += 1) {
        const listed = await clients.resources.listCollectionItems(readerSessionId, workstreamsAccessor(address.visibility), {
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
  clients: LabClients,
  readerSessionId: string,
  project: ProjectAddress,
  entry: Pick<WorkstreamEntry, "key">,
): Promise<string | null> {
  const read = await clients.resources.getCollectionItemContent(readerSessionId, workstreamsAccessor(project.visibility), entry.key);
  return typeof read.content === "string" && read.content.length > 0 ? read.content : null;
}

/** Project setups read, per connection: one read per page load. */
const setups = new WeakMap<LabClients, Promise<ProjectSetup | null>>();

/**
 * The Lab's project setup, from its projects flow: the flow among the Lab's
 * that answers `projectSetup` and opens workstreams. `null` for a Lab with no
 * such flow. Read once per connection; a failed read is read again next time.
 */
export function readProjectSetup(clients: LabClients): Promise<ProjectSetup | null> {
  let read = setups.get(clients);
  if (read === undefined) {
    read = (async () => {
      const flows = await clients.actions(PROJECT_READER_FLOW).listFlows();
      const flow = flows.find((entry) => entry.actions.includes(PROJECT_SETUP_ACTION) && entry.actions.includes("openWorkstream"));
      if (flow === undefined) return null;
      const { output } = await runAction(clients, flow.id, readerSessionId(clients.userId, flow.id), PROJECT_SETUP_ACTION, {});
      const answer = (output ?? {}) as { projectCoordinator?: unknown; workstreamCoordinator?: unknown };
      return {
        flow: flow.id,
        projectCoordinator: typeof answer.projectCoordinator === "string" ? answer.projectCoordinator : null,
        workstreamCoordinator: typeof answer.workstreamCoordinator === "string" ? answer.workstreamCoordinator : null,
      };
    })();
    read.catch(() => setups.delete(clients));
    setups.set(clients, read);
  }
  return read;
}

/**
 * The id a workstream's own coordinator takes on its owner's roster: one per
 * workstream address, so a repeated or concurrent open finds the one it
 * forked. Each part is URI-encoded, so `:` never appears inside one and no two
 * addresses share an id.
 */
export function workstreamCoordinatorId(project: ProjectAddress, workstream: string): string {
  const e = encodeURIComponent;
  return `ws:${project.visibility}:${e(project.id)}:${e(workstream)}`;
}

/** What opening a workstream from a project takes. */
export type OpenWorkstreamInput = {
  project: ProjectAddress;
  id: string;
  title: string;
  due?: string | null;
  objectives?: string[];
};

/**
 * Open a workstream for the person, led by a coordinator of its own (D2,
 * BR-35, BR-36). See the file's header for the rules.
 *
 * @param readerSessionId The person's roster session, which forks and fires.
 * @returns The opened entry as `openWorkstream` answered it, and whether this call forked its coordinator.
 * @throws ActionRefused naming why, with nothing left written by this call.
 */
export async function openWorkstreamWithCoordinator(
  clients: LabClients,
  workforce: Pick<WorkforceClient, "roster">,
  setup: ProjectSetup,
  readerSessionId: string,
  input: OpenWorkstreamInput,
): Promise<{ output: unknown; forked: boolean }> {
  const template = setup.workstreamCoordinator;
  if (template === null) throw new ActionRefused("This Lab names no workstream coordinator to lead a workstream.");
  const lead = workstreamCoordinatorId(input.project, input.id);

  /** Whether `lead` is on the roster: one forked from the workstream coordinator, or another worker. */
  const held = async (): Promise<"ours" | "other" | "none"> => {
    const found = (await workforce.roster()).find((entry) => entry.id === lead && !entry.standard);
    if (found === undefined) return "none";
    return found.forkedFrom === template ? "ours" : "other";
  };
  const refuseOther = () =>
    new ActionRefused(
      `"${lead}" is already a worker of yours, and it isn't a coordinator forked from "${template}", so it can't lead this workstream. Nothing was opened.`,
    );

  let forked = false;
  const before = await held();
  if (before === "other") throw refuseOther();
  if (before === "none") {
    try {
      await runAction(clients, PROJECT_READER_FLOW, readerSessionId, "fork", { from: template, id: lead });
      forked = true;
    } catch (error) {
      // Two opens at once: the other one forked it first, and it is the one to use.
      if (!(error instanceof ActionRefused)) throw error;
      const after = await held();
      if (after === "other") throw refuseOther();
      if (after === "none") throw error;
    }
  }
  try {
    const { output } = await runAction(clients, setup.flow, projectsSessionOf(clients, setup), "openWorkstream", {
      project: input.project,
      id: input.id,
      title: input.title,
      lead,
      ...(input.due == null ? {} : { due: input.due }),
      ...(input.objectives === undefined || input.objectives.length === 0 ? {} : { objectives: input.objectives }),
    });
    return { output, forked };
  } catch (error) {
    // A refused open leaves the roster as it was: the coordinator this call forked goes.
    if (forked && error instanceof ActionRefused) {
      await runAction(clients, PROJECT_READER_FLOW, readerSessionId, "fire", { id: lead });
    }
    throw error;
  }
}

/** The person's own session on the projects flow, which their workstream writes run in. */
function projectsSessionOf(clients: LabClients, setup: ProjectSetup): string {
  return readerSessionId(clients.userId, setup.flow);
}
