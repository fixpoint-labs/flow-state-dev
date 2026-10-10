/**
 * The project level (BR-12, BR-18, BR-22 to BR-28, BR-35 to BR-37): one
 * project the person reads, shared or their own private one, or No project,
 * in four tabs.
 *
 * - **Stream** is the person's conversation with their project coordinator:
 *   a session of the standard coordinator worker the Lab's project setup
 *   names, linked to this project, found or started when the tab opens. It
 *   hands a line to the person's own workstreams in the project. A finished
 *   turn reads the Lab again (BR-28), as every conversation does.
 * - **Board** draws the tasks of the person's own workstream sessions in the
 *   project, one panel per session, each read from that session alone. Another
 *   person's workstream sessions, and the Lab-wide inventory of boards, are
 *   never read here.
 * - **Workstreams** lists the project's workstreams as their entries say,
 *   with the progress worked out from them (BR-18, BR-19), and opens a new
 *   one led by a coordinator of its own (D2, `openWorkstreamWithCoordinator`).
 *   An entry opens on its own view: its owner talks with its lead in its
 *   workstream session; anyone else reads the entry (BR-12). Under them, the
 *   mailbox workstreams the row still lists, each linking to its own level.
 * - **Brief** is the row's brief, under the repository its code lives in, or
 *   a line saying it has none and its coding work runs on its files.
 *
 * **What a project view reads** (BR-18): the row and the entries, by one
 * prefix, when it opens and each time the Lab is read again; never a read of
 * the whole Lab of its own. The title and the mailbox list come from the
 * snapshot every level shares.
 *
 * No project holds the mailbox workstreams no project lists (D3): its Board
 * and Workstreams list them from the snapshot, and it has no coordinator and
 * no brief.
 *
 * Above the tabs, the team strip from the seat inventory, as design v2 draws
 * it (v2:513-519): each team's name in spaced mono caps and how many of its
 * seats are on shift and on call.
 */
import { useCallback, useEffect, useState, type FormEvent, type ReactNode } from "react";
import type { RosterEntry } from "@flow-state-dev/workforce/browser";
import { Board } from "../components/Board";
import { Conversation } from "../components/Conversation";
import { TasksPanel } from "../components/TasksPanel";
import { EmptyState, Meta, PartialMark, ScreenTitle, SectionFailure, Tabs } from "../components/ui";
import { ActionRefused } from "../lib/action";
import { projectsOf, seatStates, shiftCounts, teamsOf, type ListedWorkstream, type LoadedSnapshot } from "../lib/derive";
import { useLab } from "../lib/lab-data";
import {
  isStale,
  openWorkstreamWithCoordinator,
  projectReaderOf,
  readEntryReport,
  readProject,
  readProjectSetup,
  type ProjectAddress,
  type ProjectRead,
  type ProjectSetup,
  type WorkstreamEntry,
} from "../lib/projects";
import { describeFailure, type Failure, type Seat, type Workstream } from "../lib/reads";
import { useRoster, withRoster } from "../lib/roster";
import { navigate, NO_PROJECT, PROJECT_TABS, type ProjectTab, type Route } from "../lib/routes";
import { useWorkforce } from "../lib/workforce";
import type { Gaps } from "../gaps";

type ProjectRoute = Extract<Route, { level: "project" }>;

/** A read in flight, landed, or failed. */
type Read<T> = { value: T } | { failure: Failure } | undefined;

/** The same project at `tab`, on one of its workstreams or on none. */
function at(route: ProjectRoute, tab: ProjectTab, entry?: { owner: string; id: string }): ProjectRoute {
  return {
    level: "project",
    projectId: route.projectId,
    tab,
    ...(route.visibility === undefined ? {} : { visibility: route.visibility }),
    ...(entry === undefined ? {} : { entry }),
  };
}

export function ProjectView({ snapshot, route, gaps }: { snapshot: LoadedSnapshot; route: ProjectRoute; gaps: Gaps }) {
  const { refresh } = useLab();
  const { projectId, tab } = route;
  const teams = snapshot.inventory.ok ? teamsOf(snapshot.inventory.value.seats) : [];
  const states = seatStates(snapshot);
  const view = projectsOf(snapshot);
  const address: ProjectAddress = { visibility: route.visibility ?? "shared", id: projectId };

  let title = "No project";
  let body: ReactNode;
  if (!view.ok) {
    body = (
      <div className="p-4">
        <SectionFailure what="Projects" failure={view.failure} onRetry={() => void refresh()} testId="project-failure" />
      </div>
    );
  } else if (projectId === NO_PROJECT && route.visibility === undefined) {
    const listed = view.value.noProject.map((workstream) => ({ id: workstream.id, workstream }));
    body =
      tab === "stream" ? (
        <EmptyState title="No project has no coordinator" testId="project-stream-none">
          A project coordinator belongs to a project. These workstreams are in no project, so there is no one to talk to
          here. Each workstream has its own Stream.
        </EmptyState>
      ) : tab === "brief" ? (
        <EmptyState title="No project has no brief" testId="project-brief-none">
          A brief belongs to a project. These workstreams are in no project.
        </EmptyState>
      ) : tab === "board" ? (
        <Lanes snapshot={snapshot} listed={listed} gaps={gaps} />
      ) : (
        <WorkstreamList listed={listed} />
      );
  } else {
    const group = view.value.projects.find((g) => g.project.id === projectId && g.project.visibility === address.visibility);
    if (group === undefined) {
      title = projectId;
      body = (
        <EmptyState title="No such project" testId="project-missing">
          {address.visibility === "private" ? "You have no private project" : "This Lab has no project"} "{projectId}".{" "}
          <button
            type="button"
            className="underline"
            data-testid="project-missing-link"
            onClick={() => navigate({ level: "project", projectId: NO_PROJECT, tab: "workstreams" })}
          >
            See the Lab's workstreams
          </button>
          , or pick a project under PROJECTS.
        </EmptyState>
      );
    } else {
      title = group.project.title;
      body = (
        <ProjectBody
          key={`${address.visibility}/${address.id}`}
          snapshot={snapshot}
          route={route}
          address={address}
          listed={group.workstreams}
          gaps={gaps}
          repository={group.project.repository}
          brief={group.project.brief}
        />
      );
    }
  }

  return (
    <div className="flex h-full min-h-0 flex-col" data-testid="project" data-project-id={projectId} data-visibility={address.visibility}>
      <header className="px-4 pt-3">
        <p className="text-[11px] font-semibold tracking-wider text-muted-foreground">
          {address.visibility === "private" ? "PRIVATE PROJECT" : "PROJECT"}
        </p>
        <ScreenTitle testId="project-title">{title}</ScreenTitle>
      </header>
      <ul className="flex flex-wrap items-center gap-x-[26px] gap-y-1 border-b border-foreground/[0.12] px-[22px] py-2" data-testid="team-strip" aria-label="Teams">
        {teams.map(({ team }) => {
          const counts = shiftCounts(states, team);
          return (
            <li key={team} className="flex items-center gap-2.5" data-testid="team-strip-team" data-team={team}>
              <Meta role="count" className="tracking-[0.12em] text-muted-foreground uppercase">
                {team}
              </Meta>
              <Meta>
                {counts["on shift"]} on shift · {counts["on call"]} on call
                {states.partial ? <PartialMark title={gaps.roster.partial} /> : null}
              </Meta>
            </li>
          );
        })}
      </ul>
      <Tabs
        label="Project"
        tabs={PROJECT_TABS}
        selected={tab}
        onSelect={(next) => navigate(at(route, next))}
      />
      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto" role="tabpanel" data-tabpanel={tab}>
        {body}
      </div>
    </div>
  );
}

/**
 * The project's own read, row and entries (BR-18), when the view opens and
 * each time the Lab is read again (`readAt`); `reread` reads it now, as after
 * an open. A read again keeps the last one on screen until it lands.
 */
function useProjectRead(address: ProjectAddress, readerSessionId: string | null, readAt: number) {
  const { clients } = useLab();
  const [read, setRead] = useState<Read<ProjectRead | null>>(undefined);
  const [reads, setReads] = useState(0);
  useEffect(() => {
    if (readerSessionId === null) return;
    let closed = false;
    readProject(clients, readerSessionId, address)
      .then((value) => !closed && setRead({ value }))
      .catch((error: unknown) => !closed && setRead({ failure: describeFailure(error) }));
    return () => {
      closed = true;
    };
    // The address is the view's key; its parts are what the read depends on.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clients, readerSessionId, address.visibility, address.id, readAt, reads]);
  const reread = useCallback(() => setReads((n) => n + 1), []);
  return { read, reread };
}

/** The Lab's project setup, read once per connection; `retry` reads it again after a failure. */
function useProjectSetup(): { setup: Read<ProjectSetup | null>; retry: () => void } {
  const { clients } = useLab();
  const [read, setRead] = useState<Read<ProjectSetup | null>>(undefined);
  const [tries, setTries] = useState(0);
  useEffect(() => {
    let closed = false;
    readProjectSetup(clients)
      .then((value) => !closed && setRead({ value }))
      .catch((error: unknown) => !closed && setRead({ failure: describeFailure(error) }));
    return () => {
      closed = true;
    };
  }, [clients, tries]);
  const retry = useCallback(() => setTries((n) => n + 1), []);
  return { setup: read, retry };
}

/** A project's tabs, once the snapshot has it. */
function ProjectBody({
  snapshot,
  route,
  address,
  listed,
  gaps,
  repository,
  brief,
}: {
  snapshot: LoadedSnapshot;
  route: ProjectRoute;
  address: ProjectAddress;
  listed: readonly ListedWorkstream[];
  gaps: Gaps;
  repository: string | null;
  brief: string | null;
}) {
  const { refresh } = useLab();
  const reader = projectReaderOf(snapshot.sessions);
  const { read, reread } = useProjectRead(address, reader, snapshot.readAt);
  const { setup, retry: retrySetup } = useProjectSetup();
  const roster = useRoster(snapshot.readAt);
  const { seats } = withRoster(snapshot, roster);
  const entries = read !== undefined && "value" in read && read.value !== null ? read.value.entries : undefined;
  const readFailure =
    reader === null ? (
      <EmptyState title="Your project reads aren't open yet" testId="project-reader-none">
        Shift Manager reads a project through your own session on the roster, which opens with the Lab's next read.
      </EmptyState>
    ) : read !== undefined && "failure" in read ? (
      <div className="p-4">
        <SectionFailure what="The project" failure={read.failure} onRetry={reread} testId="project-read-failure" />
      </div>
    ) : read !== undefined && read.value === null ? (
      <EmptyState title="This project didn't read" testId="project-unread">
        The Lab has no project here you can read. It may have been removed since the Lab was last read.{" "}
        <button type="button" className="underline" onClick={() => void refresh()}>
          Read the Lab again
        </button>
      </EmptyState>
    ) : null;
  const reading = <p className="p-4 text-sm text-muted-foreground" data-testid="project-reading">Reading the project…</p>;

  switch (route.tab) {
    case "stream":
      return <CoordinatorStream snapshot={snapshot} address={address} setup={setup} retrySetup={retrySetup} seats={seats} gaps={gaps} />;
    case "brief":
      return (
        <div className="flex min-h-0 flex-1 flex-col">
          <Repository repository={repository} />
          {brief === null ? (
            <EmptyState title="No brief" testId="project-brief-none">
              This project was created without a brief.
            </EmptyState>
          ) : (
            <article className="mx-auto w-full max-w-3xl overflow-y-auto whitespace-pre-wrap p-6 text-sm" data-testid="project-brief">
              {brief}
            </article>
          )}
        </div>
      );
    case "board":
      if (readFailure !== null) return readFailure;
      if (entries === undefined) return reading;
      return <OwnBoards entries={entries} roster={roster} seats={seats} readAt={snapshot.readAt} />;
    case "workstreams": {
      if (readFailure !== null) return readFailure;
      if (entries === undefined || read === undefined || !("value" in read) || read.value === null) return reading;
      if (route.entry !== undefined) {
        const entry = entries.find((e) => e.owner === route.entry!.owner && e.id === route.entry!.id);
        return (
          <EntryView
            key={`${route.entry.owner}/${route.entry.id}`}
            snapshot={snapshot}
            address={address}
            route={route}
            entry={entry}
            readerSessionId={reader!}
            roster={roster}
            seats={seats}
            gaps={gaps}
          />
        );
      }
      return (
        <div className="mx-auto flex w-full max-w-3xl flex-col gap-4 p-4">
          <Progress read={read.value} />
          <EntryList entries={entries} route={route} />
          <OpenWorkstream address={address} setup={setup} readerSessionId={reader!} entries={entries} onOpened={reread} route={route} />
          {listed.length === 0 ? null : (
            <section aria-label="Mailbox workstreams">
              <p className="pb-1 text-[11px] font-semibold tracking-wider text-muted-foreground">MAILBOX WORKSTREAMS</p>
              <WorkstreamList listed={listed} />
            </section>
          )}
        </div>
      );
    }
  }
}

/**
 * The person's conversation with their project coordinator (S5): found or
 * started for this project when the tab opens, then the shared conversation
 * component pinned to it.
 */
function CoordinatorStream({
  snapshot,
  address,
  setup,
  retrySetup,
  seats,
  gaps,
}: {
  snapshot: LoadedSnapshot;
  address: ProjectAddress;
  setup: Read<ProjectSetup | null>;
  retrySetup: () => void;
  seats: readonly Seat[];
  gaps: Gaps;
}) {
  const workforce = useWorkforce();
  const worker = setup !== undefined && "value" in setup ? (setup.value?.projectCoordinator ?? null) : undefined;
  const [session, setSession] = useState<Read<string>>(undefined);
  const [tries, setTries] = useState(0);
  useEffect(() => {
    if (worker == null) return;
    let closed = false;
    setSession(undefined);
    workforce
      .ensureWorkerSession({ worker, projectId: address })
      .then((found) => !closed && setSession({ value: found.id }))
      .catch((error: unknown) => !closed && setSession({ failure: describeFailure(error) }));
    return () => {
      closed = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workforce, worker, address.visibility, address.id, tries]);

  if (setup !== undefined && "failure" in setup) {
    return (
      <div className="p-4">
        <SectionFailure what="The Lab's project setup" failure={setup.failure} onRetry={retrySetup} testId="project-setup-failure" />
      </div>
    );
  }
  if (worker === null) {
    return (
      <EmptyState title="This Lab has no project coordinator" testId="project-stream-no-coordinator">
        The Lab names no worker to talk to a project through. Its workstreams are on the Workstreams tab.
      </EmptyState>
    );
  }
  if (session !== undefined && "failure" in session) {
    return (
      <div className="p-4">
        <SectionFailure what="Your project coordinator" failure={session.failure} onRetry={() => setTries((n) => n + 1)} testId="project-stream-failure" />
      </div>
    );
  }
  const seat = seats.find((s) => s.id === worker);
  if (worker === undefined || session === undefined || seat === undefined) {
    return <p className="p-4 text-sm text-muted-foreground" data-testid="project-stream-opening">Opening your project coordinator…</p>;
  }
  return (
    <Conversation
      key={session.value}
      testId="project-stream"
      seat={seat}
      session={session.value}
      sessions={snapshot.sessions}
      gaps={gaps}
      name="Project coordinator"
      emptyText="Ask about this project, or hand work to one of your workstreams in it."
    />
  );
}

/** The project's progress, worked out from its entries (BR-18, BR-19). */
function Progress({ read }: { read: ProjectRead }) {
  const { progress } = read;
  const statuses = Object.entries(progress.byStatus);
  return (
    <section aria-label="Progress" className="text-sm" data-testid="project-progress" data-workstreams={progress.workstreams}>
      <p>
        {progress.workstreams} {progress.workstreams === 1 ? "workstream" : "workstreams"}
        {statuses.length === 0 ? null : <> · {statuses.map(([status, n]) => `${n} ${status}`).join(", ")}</>}
      </p>
      <p className="text-muted-foreground">
        <span data-testid="project-objectives">
          {progress.objectives.met} of {progress.objectives.total} objectives met
        </span>
        {progress.nextDue === null ? null : <span data-testid="project-next-due"> · next due {progress.nextDue}</span>}
        {progress.stale.length === 0 ? null : <span data-testid="project-stale"> · {progress.stale.length} gone quiet</span>}
      </p>
    </section>
  );
}

/** Each entry of the project, opening on its own view. */
function EntryList({ entries, route }: { entries: readonly WorkstreamEntry[]; route: ProjectRoute }) {
  if (entries.length === 0) {
    return (
      <EmptyState title="No workstreams" testId="project-entries-none">
        Nobody has opened a workstream in this project yet.
      </EmptyState>
    );
  }
  return (
    <ul className="space-y-1" data-testid="project-entries">
      {entries.map((entry) => (
        <li
          key={`${entry.owner}/${entry.id}`}
          data-testid="project-entry"
          data-owner={entry.owner}
          data-workstream-id={entry.id}
          data-stale={isStale(entry) ? "true" : undefined}
        >
          <button
            type="button"
            className="flex w-full items-baseline justify-between gap-2 text-left text-sm hover:underline"
            onClick={() => navigate(at(route, "workstreams", { owner: entry.owner, id: entry.id }))}
          >
            <span className="truncate">{entry.title}</span>
            <span className="shrink-0 text-xs text-muted-foreground">
              {entry.owner} · {entry.status}
              {isStale(entry) ? " · gone quiet" : ""}
            </span>
          </button>
        </li>
      ))}
    </ul>
  );
}

/**
 * One entry's view. Its owner talks with its lead in its workstream session;
 * anyone else reads the entry and its latest report, and never its session
 * (BR-12).
 */
function EntryView({
  snapshot,
  address,
  route,
  entry,
  readerSessionId,
  roster,
  seats,
  gaps,
}: {
  snapshot: LoadedSnapshot;
  address: ProjectAddress;
  route: ProjectRoute;
  entry: WorkstreamEntry | undefined;
  readerSessionId: string;
  roster: ReturnType<typeof useRoster>;
  seats: readonly Seat[];
  gaps: Gaps;
}) {
  const { clients } = useLab();
  const back = (
    <button
      type="button"
      className="text-xs underline"
      data-testid="project-entry-back"
      onClick={() => navigate(at(route, "workstreams"))}
    >
      All workstreams
    </button>
  );
  if (entry === undefined) {
    return (
      <div className="mx-auto w-full max-w-3xl p-4">
        {back}
        <EmptyState title="No such workstream" testId="project-entry-missing">
          This project has no workstream "{route.entry?.id}" of {route.entry?.owner}'s.
        </EmptyState>
      </div>
    );
  }
  if (entry.owner === clients.userId) {
    const seat = leadSeat(entry, roster, seats);
    return (
      <div className="flex min-h-0 flex-1 flex-col" data-testid="project-entry-own" data-workstream-id={entry.id}>
        <div className="mx-auto w-full max-w-3xl px-4 pt-3">{back}</div>
        {entry.sessionId === null ? (
          <EmptyState title="This workstream's session isn't open yet" testId="project-entry-no-session">
            Its open hasn't finished. Open it again from the project to finish it.
          </EmptyState>
        ) : seat === undefined ? (
          <EmptyState title="Its lead isn't on your roster" testId="project-entry-no-lead">
            "{entry.lead}" leads this workstream, and your roster doesn't list it, so there is no one to talk to here.
          </EmptyState>
        ) : (
          <Conversation
            key={entry.sessionId}
            testId="project-entry"
            seat={seat}
            session={entry.sessionId}
            sessions={snapshot.sessions}
            gaps={gaps}
            name={entry.title}
            emptyText="Nothing has been said in this workstream yet."
          />
        )}
      </div>
    );
  }
  return <EntryDetails address={address} entry={entry} readerSessionId={readerSessionId} back={back} />;
}

/** Another person's entry, as anyone who reads the project reads it (BR-12). */
function EntryDetails({
  address,
  entry,
  readerSessionId,
  back,
}: {
  address: ProjectAddress;
  entry: WorkstreamEntry;
  readerSessionId: string;
  back: ReactNode;
}) {
  const { clients } = useLab();
  const [report, setReport] = useState<Read<string | null>>(undefined);
  useEffect(() => {
    let closed = false;
    readEntryReport(clients, readerSessionId, address, entry)
      .then((value) => !closed && setReport({ value }))
      .catch((error: unknown) => !closed && setReport({ failure: describeFailure(error) }));
    return () => {
      closed = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clients, readerSessionId, entry.key]);
  return (
    <article className="mx-auto flex w-full max-w-3xl flex-col gap-2 p-4 text-sm" data-testid="project-entry-details" data-workstream-id={entry.id}>
      {back}
      <h3 className="text-base font-medium">{entry.title}</h3>
      <p className="text-muted-foreground">
        {entry.owner}'s · led by {entry.lead} · {entry.status}
        {entry.due === null ? "" : ` · due ${entry.due}`}
        {isStale(entry) ? " · gone quiet" : ""}
      </p>
      {entry.objectives.length === 0 ? null : (
        <ul className="list-inside list-disc" data-testid="project-entry-objectives">
          {entry.objectives.map((objective, i) => (
            <li key={i} data-met={objective.met ? "true" : undefined}>
              {objective.text}
              {objective.met ? " · met" : ""}
            </li>
          ))}
        </ul>
      )}
      <section aria-label="Latest report" data-testid="project-entry-report">
        {report === undefined ? (
          <p className="text-muted-foreground">Reading the latest report…</p>
        ) : "failure" in report ? (
          <p className="text-muted-foreground">The latest report didn't load: {report.failure.message}</p>
        ) : report.value === null ? (
          <p className="text-muted-foreground">No report yet.</p>
        ) : (
          <p className="whitespace-pre-wrap">{report.value}</p>
        )}
      </section>
    </article>
  );
}

/** The seat a workstream's lead talks through: its worker on the person's roster, on the flow the roster names. */
function leadSeat(entry: WorkstreamEntry, roster: ReturnType<typeof useRoster>, seats: readonly Seat[]): Seat | undefined {
  const onRoster = roster !== undefined && "entries" in roster ? roster.entries.find((r: RosterEntry) => r.id === entry.lead) : undefined;
  if (onRoster === undefined) return undefined;
  return seats.find((seat) => seat.id === entry.lead && seat.kind === onRoster.flow);
}

/**
 * The Board: the tasks of each of the person's own workstream sessions in the
 * project, read from that session alone. Nobody else's sessions are read.
 */
function OwnBoards({
  entries,
  roster,
  seats,
  readAt,
}: {
  entries: readonly WorkstreamEntry[];
  roster: ReturnType<typeof useRoster>;
  seats: readonly Seat[];
  readAt: number;
}) {
  const { clients } = useLab();
  const own = entries.filter((entry) => entry.owner === clients.userId && entry.sessionId !== null);
  if (own.length === 0) {
    return (
      <EmptyState title="No board" testId="project-board-none">
        You have no workstream in this project, so there are no tasks of yours to show.
      </EmptyState>
    );
  }
  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-4 p-4" data-testid="project-board">
      {own.map((entry) => {
        const seat = leadSeat(entry, roster, seats);
        return (
          <section key={entry.id} data-testid="project-lane" data-workstream-id={entry.id} data-session-id={entry.sessionId}>
            <h3 className="pb-1 text-xs font-medium">{entry.title}</h3>
            {seat === undefined ? (
              <p className="text-xs text-muted-foreground">Its lead "{entry.lead}" isn't on your roster.</p>
            ) : (
              <TasksPanel seat={seat} sessionId={entry.sessionId} readAt={readAt} />
            )}
          </section>
        );
      })}
    </div>
  );
}

/** A workstream id from its title: lower case, words joined by `-`. */
function idOf(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}

/**
 * Open a workstream in the project, led by a coordinator of its own (D2,
 * BR-35, BR-36). The view offers no choice of lead.
 */
function OpenWorkstream({
  address,
  setup,
  readerSessionId,
  entries,
  onOpened,
  route,
}: {
  address: ProjectAddress;
  setup: Read<ProjectSetup | null>;
  readerSessionId: string;
  entries: readonly WorkstreamEntry[];
  onOpened: () => void;
  route: ProjectRoute;
}) {
  const { clients } = useLab();
  const workforce = useWorkforce();
  const [title, setTitle] = useState("");
  const [state, setState] = useState<{ running: true } | { refused: string } | undefined>(undefined);
  const value = setup !== undefined && "value" in setup ? setup.value : undefined;
  if (value === undefined) return null;
  if (value === null || value.workstreamCoordinator === null) {
    return (
      <p className="text-xs text-muted-foreground" data-testid="project-open-none">
        This Lab names no workstream coordinator, so a workstream can't be opened here.
      </p>
    );
  }
  const id = idOf(title);
  const own = entries.some((entry) => entry.owner === clients.userId && entry.id === id);
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (id === "" || state !== undefined && "running" in state) return;
    setState({ running: true });
    try {
      await openWorkstreamWithCoordinator(clients, workforce, value, readerSessionId, { project: address, id, title: title.trim() });
      setState(undefined);
      setTitle("");
      onOpened();
      navigate(at(route, "workstreams", { owner: clients.userId, id }));
    } catch (error) {
      setState({ refused: error instanceof ActionRefused ? error.message : describeFailure(error).message });
    }
  };
  return (
    <form className="flex flex-col gap-1.5 border-t border-foreground/15 pt-3" data-testid="project-open" onSubmit={(event) => void submit(event)}>
      <label className="text-[11px] font-semibold tracking-wider text-muted-foreground" htmlFor="project-open-title">
        OPEN A WORKSTREAM
      </label>
      <div className="flex gap-2">
        <input
          id="project-open-title"
          className="min-w-0 flex-1 border bg-background px-2 py-1 text-sm"
          placeholder="What it's for"
          value={title}
          onChange={(event) => setTitle(event.target.value)}
          data-testid="project-open-title"
        />
        <button
          type="submit"
          className="border px-3 py-1 text-sm disabled:opacity-50"
          disabled={id === "" || (state !== undefined && "running" in state)}
          data-testid="project-open-submit"
        >
          {state !== undefined && "running" in state ? "Opening…" : own ? "Open again" : "Open"}
        </button>
      </div>
      <p className="text-xs text-muted-foreground">
        {id === "" ? "Its id comes from its title." : <>Its id is <span className="font-mono">{id}</span>. A coordinator of its own leads it.</>}
      </p>
      {state !== undefined && "refused" in state ? (
        <p role="alert" className="text-xs text-destructive" data-testid="project-open-refused">
          {state.refused}
        </p>
      ) : null}
    </form>
  );
}

/** The project's repository on its Brief, or that it has none and runs on its files. */
function Repository({ repository }: { repository: string | null }) {
  return (
    <p className="mx-auto w-full max-w-3xl px-6 pt-6 text-xs text-muted-foreground" data-testid="project-repository">
      {repository === null ? (
        "No repository · runs on project files"
      ) : (
        <>
          Repository <span className="font-mono text-foreground">{repository}</span>
        </>
      )}
    </p>
  );
}

/** Each listed mailbox workstream, linking to it; one that left the tree, as gone (BR-27). */
function WorkstreamList({ listed }: { listed: readonly ListedWorkstream[] }) {
  if (listed.length === 0) {
    return (
      <EmptyState title="No workstreams" testId="project-workstreams-none">
        No workstream is listed here yet.
      </EmptyState>
    );
  }
  return (
    <ul className="mx-auto w-full max-w-3xl space-y-1 p-4" data-testid="project-workstreams">
      {listed.map(({ id, workstream }) => (
        <li key={id} data-testid="project-workstream" data-mailbox-id={id} data-gone={workstream === undefined ? "true" : undefined}>
          {workstream === undefined ? (
            <span className="text-sm text-muted-foreground">
              {id} · no longer in the Lab
            </span>
          ) : (
            <button
              type="button"
              className="text-sm underline-offset-2 hover:underline"
              onClick={() => navigate({ level: "workstream", mailboxId: workstream.id, tab: "stream" })}
            >
              {workstream.id}
            </button>
          )}
        </li>
      ))}
    </ul>
  );
}

/** No project's Board: one lane per mailbox workstream that holds a board, in the workstream Board's columns (BR-26). */
function Lanes({ snapshot, listed, gaps }: { snapshot: LoadedSnapshot; listed: readonly ListedWorkstream[]; gaps: Gaps }) {
  const { refresh } = useLab();
  const lanes = listed.flatMap(({ workstream }): Workstream[] => {
    if (workstream === undefined) return [];
    const boards = snapshot.boards[workstream.id];
    return boards !== undefined && (!boards.ok || boards.value.refs.length > 0) ? [workstream] : [];
  });
  if (lanes.length === 0) {
    return (
      <EmptyState title="No board" testId="project-board-none">
        None of these workstreams holds a board, so there are no tasks to show.
      </EmptyState>
    );
  }
  return (
    <div className="flex flex-col gap-2" data-testid="project-board">
      {lanes.map((workstream) => {
        const boards = snapshot.boards[workstream.id]!;
        return (
          <section key={workstream.id} data-testid="project-lane" data-mailbox-id={workstream.id}>
            <h3 className="px-4 pt-3 text-xs font-medium">{workstream.id}</h3>
            {boards.ok ? (
              <Board rows={boards.value.rows} inReviewGap={gaps.inReview} />
            ) : (
              <div className="p-4">
                <SectionFailure what={`${workstream.id}'s boards`} failure={boards.failure} onRetry={() => void refresh()} />
              </div>
            )}
          </section>
        );
      })}
    </div>
  );
}
