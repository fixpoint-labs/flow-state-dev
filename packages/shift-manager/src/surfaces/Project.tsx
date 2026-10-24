/**
 * The project level (BR-12, BR-18, BR-22 to BR-28, BR-38): one
 * project the user reads, shared or their own private one, in four tabs.
 *
 * - **Stream** is the user's conversation with their project coordinator:
 *   a session of the standard coordinator worker the Lab's project setup
 *   names, linked to this project, found or started when the tab opens. It
 *   hands a line to the user's own workstreams in the project. A finished
 *   turn reads the Lab again (BR-28), as every conversation does.
 * - **Board** draws the tasks of the user's own workstream sessions in the
 *   project, one panel per session, each read from that session alone. Another
 *   user's workstream sessions, and the Lab-wide inventory of boards, are
 *   never read here.
 * - **Workstreams** lists the project's workstreams as their entries say,
 *   with the progress worked out from them (BR-18, BR-19). It opens none: a
 *   workstream opens when the user asks their project coordinator in
 *   Stream for the work, and it names the lead (BR-38).
 *   Each row counts its objectives met. An entry opens on its own view,
 *   under its objectives, each marked met or not: its owner talks with its
 *   lead in its workstream session; anyone else reads the entry (BR-12).
 * - **Brief** is the row's brief, under the repository its code lives in, or
 *   a line saying it has none and its coding work runs on its files.
 *
 * **What a project view reads** (BR-18): the row and the entries, by one
 * prefix, when it opens, each time the Lab is read again, and every few
 * seconds while Board or Workstreams is on screen; never a read of
 * the whole Lab of its own. The title comes from the snapshot every level shares.
 *
 * Above the tabs, the team strip from the worker inventory, as design v2 draws
 * it (v2:513-519): each team's name in spaced mono caps and how many of its
 * workers are on shift.
 */
import { useCallback, useEffect, useState, type ReactNode } from "react";
import type { RosterEntry } from "@flow-state-dev/workforce/browser";
import { Conversation } from "../components/Conversation";
import { TasksPanel } from "../components/TasksPanel";
import { EmptyState, Meta, PartialMark, ScreenTitle, SectionFailure, Tabs } from "../components/ui";
import { projectsOf, workerStates, shiftCounts, teamsOf, type LoadedSnapshot } from "../lib/derive";
import { useLab } from "../lib/lab-data";
import {
  projectReaderOf,
  readEntryReport,
  readProjectSetup,
  useProjectRead,
  type ProjectAddress,
  type ProjectRead,
  type ProjectSetup,
  type WorkstreamEntry,
} from "../lib/projects";
import { describeFailure, type Failure, type Worker } from "../lib/reads";
import { useRoster, withRoster } from "../lib/roster";
import { navigate, PROJECT_TABS, type ProjectTab, type Route } from "../lib/routes";
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
  const teams = snapshot.inventory.ok ? teamsOf(snapshot.inventory.value.workers) : [];
  const states = workerStates(snapshot);
  const view = projectsOf(snapshot);
  const address: ProjectAddress = { visibility: route.visibility ?? "shared", id: projectId };

  let title = projectId;
  let body: ReactNode;
  if (!view.ok) {
    body = (
      <div className="p-4">
        <SectionFailure what="Projects" failure={view.failure} onRetry={() => void refresh()} testId="project-failure" />
      </div>
    );
  } else {
    const found = view.value.projects.find((row) => row.id === projectId && row.visibility === address.visibility);
    if (found === undefined) {
      body = (
        <EmptyState title="No such project" testId="project-missing">
          {address.visibility === "private" ? "You have no private project" : "This Lab has no project"} "{projectId}". Pick a
          project under PROJECTS.
        </EmptyState>
      );
    } else {
      title = found.title;
      body = (
        <ProjectBody
          key={`${address.visibility}/${address.id}`}
          snapshot={snapshot}
          route={route}
          address={address}
          gaps={gaps}
          repository={found.repository}
          brief={found.brief}
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
        {teams.map(({ team, name }) => {
          const counts = shiftCounts(states, team);
          return (
            <li key={team} className="flex items-center gap-2.5" data-testid="team-strip-team" data-team={team}>
              <Meta role="count" className="tracking-[0.12em] text-muted-foreground uppercase">
                {name}
              </Meta>
              <Meta>
                {counts["on shift"]} on shift
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

/** The Lab's project setup, read once per connection; `retry` reads it again after a failure. */
function useProjectSetup(): { setup: Read<ProjectSetup | null>; retry: () => void } {
  const { client } = useLab();
  const [read, setRead] = useState<Read<ProjectSetup | null>>(undefined);
  const [tries, setTries] = useState(0);
  useEffect(() => {
    let closed = false;
    readProjectSetup(client)
      .then((value) => !closed && setRead({ value }))
      .catch((error: unknown) => !closed && setRead({ failure: describeFailure(error) }));
    return () => {
      closed = true;
    };
  }, [client, tries]);
  const retry = useCallback(() => setTries((n) => n + 1), []);
  return { setup: read, retry };
}

/** A project's tabs, once the snapshot has it. */
function ProjectBody({
  snapshot,
  route,
  address,
  gaps,
  repository,
  brief,
}: {
  snapshot: LoadedSnapshot;
  route: ProjectRoute;
  address: ProjectAddress;
  gaps: Gaps;
  repository: string | null;
  brief: string | null;
}) {
  const { refresh } = useLab();
  const reader = projectReaderOf(snapshot.sessions);
  // Only Board and Workstreams draw entries; Stream and Brief never pay for the read.
  const needsEntries = route.tab === "board" || route.tab === "workstreams";
  const { read, reread } = useProjectRead(address, needsEntries ? reader : null, snapshot.readAt);
  const { setup, retry: retrySetup } = useProjectSetup();
  const roster = useRoster(snapshot.readAt);
  const { workers } = withRoster(snapshot, roster);
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
      return <CoordinatorStream snapshot={snapshot} address={address} setup={setup} retrySetup={retrySetup} workers={workers} gaps={gaps} />;
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
      return <OwnBoards entries={entries} roster={roster} workers={workers} readAt={snapshot.readAt} />;
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
            workers={workers}
            gaps={gaps}
          />
        );
      }
      return (
        <div className="mx-auto flex w-full max-w-3xl flex-col gap-4 p-4">
          <Progress read={read.value} />
          <EntryList entries={entries} route={route} />
          <OpenHint route={route} setup={setup} />
        </div>
      );
    }
  }
}

/**
 * The user's conversation with their project coordinator (S5): found or
 * started for this project when the tab opens, then the shared conversation
 * component pinned to it.
 */
function CoordinatorStream({
  snapshot,
  address,
  setup,
  retrySetup,
  workers,
  gaps,
}: {
  snapshot: LoadedSnapshot;
  address: ProjectAddress;
  setup: Read<ProjectSetup | null>;
  retrySetup: () => void;
  workers: readonly Worker[];
  gaps: Gaps;
}) {
  const workforce = useWorkforce();
  const coordinatorId = setup !== undefined && "value" in setup ? (setup.value?.projectCoordinator ?? null) : undefined;
  const [session, setSession] = useState<Read<string>>(undefined);
  const [tries, setTries] = useState(0);
  useEffect(() => {
    if (coordinatorId == null) return;
    let closed = false;
    setSession(undefined);
    workforce
      .ensureWorkerSession({ worker: coordinatorId, projectId: address })
      .then((found) => !closed && setSession({ value: found.id }))
      .catch((error: unknown) => !closed && setSession({ failure: describeFailure(error) }));
    return () => {
      closed = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workforce, coordinatorId, address.visibility, address.id, tries]);

  if (setup !== undefined && "failure" in setup) {
    return (
      <div className="p-4">
        <SectionFailure what="The Lab's project setup" failure={setup.failure} onRetry={retrySetup} testId="project-setup-failure" />
      </div>
    );
  }
  if (coordinatorId === null) {
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
  const worker = workers.find((s) => s.id === coordinatorId);
  if (coordinatorId === undefined || session === undefined || worker === undefined) {
    return <p className="p-4 text-sm text-muted-foreground" data-testid="project-stream-opening">Opening your project coordinator…</p>;
  }
  return (
    <Conversation
      key={session.value}
      testId="project-stream"
      worker={worker}
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
          data-stale={entry.stale ? "true" : undefined}
        >
          <button
            type="button"
            className="flex w-full items-baseline justify-between gap-2 text-left text-sm hover:underline"
            onClick={() => navigate(at(route, "workstreams", { owner: entry.owner, id: entry.id }))}
          >
            <span className="truncate">{entry.title}</span>
            <span className="shrink-0 text-xs text-muted-foreground">
              {entry.owner} · {entry.status}
              {entry.objectives.length === 0 ? "" : ` · ${entry.objectives.filter((o) => o.met).length} of ${entry.objectives.length} objectives met`}
              {entry.stale ? " · gone quiet" : ""}
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
  workers,
  gaps,
}: {
  snapshot: LoadedSnapshot;
  address: ProjectAddress;
  route: ProjectRoute;
  entry: WorkstreamEntry | undefined;
  readerSessionId: string;
  roster: ReturnType<typeof useRoster>;
  workers: readonly Worker[];
  gaps: Gaps;
}) {
  const { client } = useLab();
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
  if (entry.owner === client.userId) {
    const worker = leadWorker(entry, roster, workers);
    return (
      <div className="flex min-h-0 flex-1 flex-col" data-testid="project-entry-own" data-workstream-id={entry.id}>
        <div className="mx-auto w-full max-w-3xl px-4 pt-3">{back}</div>
        {entry.sessionId === null || worker === undefined ? (
          <div className="mx-auto w-full max-w-3xl px-4 text-sm">
            <Objectives objectives={entry.objectives} />
          </div>
        ) : null}
        {entry.sessionId === null ? (
          <EmptyState title="This workstream's session isn't open yet" testId="project-entry-no-session">
            Its open hasn't finished. Open it again from the project to finish it.
          </EmptyState>
        ) : worker === undefined ? (
          <EmptyState title="Its lead isn't on your roster" testId="project-entry-no-lead">
            "{entry.lead}" leads this workstream, and your roster doesn't list it, so there is no one to talk to here.
          </EmptyState>
        ) : (
          <Conversation
            key={entry.sessionId}
            testId="project-entry"
            worker={worker}
            session={entry.sessionId}
            sessions={snapshot.sessions}
            gaps={gaps}
            name={entry.title}
            lead={<Objectives objectives={entry.objectives} />}
            emptyText="Nothing has been said in this workstream yet."
          />
        )}
      </div>
    );
  }
  const leadName = workers.find((worker) => worker.id === entry.lead)?.displayName ?? entry.lead;
  return <EntryDetails address={address} entry={entry} leadName={leadName} readerSessionId={readerSessionId} back={back} />;
}

/** Another user's entry, as anyone who reads the project reads it (BR-12). */
function EntryDetails({
  address,
  entry,
  leadName,
  readerSessionId,
  back,
}: {
  address: ProjectAddress;
  entry: WorkstreamEntry;
  leadName: string;
  readerSessionId: string;
  back: ReactNode;
}) {
  const { client } = useLab();
  const [report, setReport] = useState<Read<string | null>>(undefined);
  useEffect(() => {
    let closed = false;
    readEntryReport(client, readerSessionId, address, entry)
      .then((value) => !closed && setReport({ value }))
      .catch((error: unknown) => !closed && setReport({ failure: describeFailure(error) }));
    return () => {
      closed = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [client, readerSessionId, entry.key]);
  return (
    <article className="mx-auto flex w-full max-w-3xl flex-col gap-2 p-4 text-sm" data-testid="project-entry-details" data-workstream-id={entry.id}>
      {back}
      <h3 className="text-base font-medium">{entry.title}</h3>
      <p className="text-muted-foreground">
        {entry.owner}'s · led by {leadName} · {entry.status}
        {entry.due === null ? "" : ` · due ${entry.due}`}
        {entry.stale ? " · gone quiet" : ""}
      </p>
      <Objectives objectives={entry.objectives} />
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

/** A workstream's objectives, each marked met or not; nothing when it has none. */
function Objectives({ objectives }: { objectives: WorkstreamEntry["objectives"] }) {
  if (objectives.length === 0) return null;
  return (
    <ul className="mt-2 space-y-0.5" aria-label="Objectives" data-testid="project-entry-objectives">
      {objectives.map((objective, i) => (
        <li key={i} data-testid="project-entry-objective" data-met={objective.met ? "true" : "false"}>
          <span aria-hidden="true">{objective.met ? "✓ " : "○ "}</span>
          {objective.text}
          <span className="sr-only">{objective.met ? " (met)" : " (not met)"}</span>
        </li>
      ))}
    </ul>
  );
}

/** The worker a workstream's lead talks through: its worker on the user's roster, on the flow the roster names. */
function leadWorker(entry: WorkstreamEntry, roster: ReturnType<typeof useRoster>, workers: readonly Worker[]): Worker | undefined {
  const onRoster = roster !== undefined && "entries" in roster ? roster.entries.find((r: RosterEntry) => r.id === entry.lead) : undefined;
  if (onRoster === undefined) return undefined;
  return workers.find((worker) => worker.id === entry.lead && worker.kind === onRoster.flow);
}

/**
 * The Board: the tasks of each of the user's own workstream sessions in the
 * project, read from that session alone. Nobody else's sessions are read.
 */
function OwnBoards({
  entries,
  roster,
  workers,
  readAt,
}: {
  entries: readonly WorkstreamEntry[];
  roster: ReturnType<typeof useRoster>;
  workers: readonly Worker[];
  readAt: number;
}) {
  const { client } = useLab();
  const own = entries.filter((entry) => entry.owner === client.userId && entry.sessionId !== null);
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
        const worker = leadWorker(entry, roster, workers);
        return (
          <section key={entry.id} data-testid="project-lane" data-workstream-id={entry.id} data-session-id={entry.sessionId}>
            <h3 className="pb-1 text-xs font-medium">{entry.title}</h3>
            {worker === undefined ? (
              <p className="text-xs text-muted-foreground">Its lead "{entry.lead}" isn't on your roster.</p>
            ) : (
              <TasksPanel worker={worker} sessionId={entry.sessionId} readAt={readAt} />
            )}
          </section>
        );
      })}
    </div>
  );
}

/**
 * Where a workstream comes from: the user asks their project coordinator, in
 * Stream. A Lab that names no project coordinator says it opens none; while
 * its setup is read, or when the read failed (Stream shows that), nothing.
 */
function OpenHint({ route, setup }: { route: ProjectRoute; setup: Read<ProjectSetup | null> }) {
  if (setup === undefined || "failure" in setup) return null;
  if (setup.value?.projectCoordinator == null) {
    return (
      <p className="border-t border-foreground/15 pt-3 text-xs text-muted-foreground" data-testid="project-open-none">
        This Lab has no project coordinator, so workstreams can't be opened here.
      </p>
    );
  }
  return (
    <p className="border-t border-foreground/15 pt-3 text-xs text-muted-foreground" data-testid="project-open-hint">
      To open a workstream, ask your project coordinator for the work in{" "}
      <button type="button" className="underline" onClick={() => navigate(at(route, "stream"))}>
        Stream
      </button>
      . It picks the lead from your workers.
    </p>
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
