// BR-12, BR-18, BR-22 to BR-28, BR-38; BR-28; BR-18, BR-19; BR-38; BR-12; BR-18.
/**
 * The project level: one
 * project the user reads, shared or their own private one, in four tabs.
 *
 * - **Stream** is the user's conversation with their project coordinator:
 *   a session of the standard coordinator worker the Lab's project setup
 *   names, linked to this project, found when the tab opens and started by
 *   the user's first line there, so opening the tab starts nothing. It
 *   hands a line to the user's own workstreams in the project.
 * - **Board** draws the tasks of the user's own workstream sessions in the
 *   project, one panel per session, each read from that session alone. Another
 *   user's workstream sessions, and the Lab-wide inventory of boards, are
 *   never read here.
 * - **Workstreams** lists the project's workstreams as their entries say,
 *   with the progress worked out from them. It opens none: a
 *   workstream opens when the user asks their project coordinator in
 *   Stream for the work, and it names the lead.
 *   Each row counts its objectives met. An entry opens on its own view,
 *   under its objectives, each marked met or not: its owner talks with its
 *   lead in its workstream session; anyone else reads the entry.
 * - **Brief** is the row's brief, under the repository its code lives in, or
 *   a line saying it has none and its coding work runs on its files.
 *
 * **What a project view reads**: the row from the projects the page holds
 * (`directory.tsx`), and the entries by the project's one prefix while Board
 * or Workstreams is on screen, each kept current by its own notices; never a
 * read of the whole Lab.
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
import type { SessionSummary } from "@flow-state-dev/client";
import type { ProjectSetup } from "@flow-state-dev/workforce/browser";
import { workerStates, shiftCounts, teamsOf } from "../lib/shift";
import { useLab } from "../lib/lab-data";
import { useProjects, useSessions, useWorkers } from "../lib/directory";
import { useInbox } from "../lib/inbox";
import {
  useEntryReport,
  useProjectSetup,
  useProjectWorkstreams,
  type ProjectAddress,
  type ProjectWorkstreams,
  type ScreenRead,
  type WorkstreamEntry,
} from "../lib/projects";
import { describeFailure, type Failure } from "../lib/failure";
import type { RosterRead } from "../lib/roster";
import { workerOf, type Worker } from "../lib/workers";
import { navigate, PROJECT_TABS, type ProjectTab, type Route } from "../lib/routes";
import { RouteLink } from "../components/RouteLink";
import { useWorkforce } from "../lib/workforce";
import type { Gaps } from "../gaps";

type ProjectRoute = Extract<Route, { level: "project" }>;

/** A read in flight, landed, or failed. */
type Read<T> = { value: T } | { failure: Failure } | undefined;

/** A hook's read as one of those three: a value drawn wins over a later failure beside it. */
function readOf<T>(read: ScreenRead<T>): Read<T> {
  return read.value !== undefined ? { value: read.value } : read.failure !== undefined ? { failure: read.failure } : undefined;
}

/** No sessions, while the list is read. */
const NO_SESSIONS: readonly SessionSummary[] = [];

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

export function ProjectView({ route, gaps }: { route: ProjectRoute; gaps: Gaps }) {
  const { projectId, tab } = route;
  const { inventory, workers } = useWorkers();
  const inbox = useInbox().section;
  const teams = inventory?.ok === true ? teamsOf(inventory.value) : [];
  const states = workerStates(workers, inbox?.ok === true ? inbox.value : undefined);
  const { section: view, refresh } = useProjects();
  const address: ProjectAddress = { visibility: route.visibility ?? "shared", id: projectId };

  let title = projectId;
  let body: ReactNode;
  if (view === undefined) {
    body = <p className="p-4 text-sm text-muted-foreground" data-testid="project-reading">Reading the project…</p>;
  } else if (!view.ok) {
    body = (
      <div className="p-4">
        <SectionFailure what="Projects" failure={view.failure} onRetry={refresh} testId="project-failure" />
      </div>
    );
  } else {
    const found = view.value.find((row) => row.id === projectId && row.visibility === address.visibility);
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
        <p className="text-xs font-semibold tracking-wider text-muted-foreground">
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
        onSelect={(next) => /* in place: the project's tabs */ navigate(at(route, next))}
      />
      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto" role="tabpanel" data-tabpanel={tab}>
        {body}
      </div>
    </div>
  );
}

/** A project's tabs, once the projects read has it. */
function ProjectBody({
  route,
  address,
  gaps,
  repository,
  brief,
}: {
  route: ProjectRoute;
  address: ProjectAddress;
  gaps: Gaps;
  repository: string | null;
  brief: string | null;
}) {
  const setupRead = useProjectSetup();
  const setup = readOf(setupRead);
  const { workers, roster } = useWorkers();

  switch (route.tab) {
    case "stream":
      return <CoordinatorStream address={address} setup={setup} retrySetup={setupRead.refresh} workers={workers} gaps={gaps} />;
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
      // Only Board and Workstreams draw entries; Stream and Brief never pay for the read.
      return <Entries address={address}>{(read) => <OwnBoards entries={read.entries} roster={roster} workers={workers} />}</Entries>;
    case "workstreams":
      return (
        <Entries address={address}>
          {(read) => {
            if (route.entry !== undefined) {
              const entry = read.entries.find((e) => e.owner === route.entry!.owner && e.id === route.entry!.id);
              return (
                <EntryView
                  key={`${route.entry.owner}/${route.entry.id}`}
                  address={address}
                  route={route}
                  entry={entry}
                  roster={roster}
                  workers={workers}
                  gaps={gaps}
                />
              );
            }
            return (
              <div className="mx-auto flex w-full max-w-3xl flex-col gap-4 p-4">
                <Progress read={read} />
                <EntryList entries={read.entries} route={route} />
                <OpenHint route={route} setup={setup} />
              </div>
            );
          }}
        </Entries>
      );
  }
}

/** A project's workstreams, read while this is mounted, drawn by `children` once they land. */
function Entries({ address, children }: { address: ProjectAddress; children: (read: ProjectWorkstreams) => ReactNode }) {
  const { value, failure, refresh } = useProjectWorkstreams(address);
  if (value === undefined && failure !== undefined) {
    return (
      <div className="p-4">
        <SectionFailure what="The project" failure={failure} onRetry={refresh} testId="project-read-failure" />
      </div>
    );
  }
  if (value === undefined) return <p className="p-4 text-sm text-muted-foreground" data-testid="project-reading">Reading the project…</p>;
  return <>{children(value)}</>;
}

/**
 * The user's conversation with their project coordinator (S5): found for this
 * project when the tab opens, then the shared conversation component pinned to
 * it. Found none, the conversation is empty and its first line starts the
 * session, linked to the project: reading the tab starts no session.
 */
function CoordinatorStream({
  address,
  setup,
  retrySetup,
  workers,
  gaps,
}: {
  address: ProjectAddress;
  setup: Read<ProjectSetup | null>;
  retrySetup: () => void;
  workers: readonly Worker[];
  gaps: Gaps;
}) {
  const workforce = useWorkforce();
  const sessions = useSessions().list ?? NO_SESSIONS;
  const coordinatorId = setup !== undefined && "value" in setup ? (setup.value?.projectCoordinator ?? null) : undefined;
  // `null`: the user has no session with it for this project yet.
  const [session, setSession] = useState<Read<string | null>>(undefined);
  const [tries, setTries] = useState(0);
  useEffect(() => {
    if (coordinatorId == null) return;
    let closed = false;
    setSession(undefined);
    workforce
      .findWorkerSession({ worker: coordinatorId, projectId: address })
      .then((found) => !closed && setSession({ value: found?.id ?? null }))
      .catch((error: unknown) => !closed && setSession({ failure: describeFailure(error) }));
    return () => {
      closed = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workforce, coordinatorId, address.visibility, address.id, tries]);
  // Found none: look again whenever the Lab lists a new session of the coordinator, such as one
  // another tab started, so this tab follows it. Still a lookup only; nothing is started here.
  const unopened = session !== undefined && "value" in session && session.value === null;
  const listed = sessions
    .filter((s) => workerOf(s) === coordinatorId)
    .map((s) => s.id)
    .join("\n");
  useEffect(() => {
    if (coordinatorId == null || !unopened || listed === "") return;
    let closed = false;
    workforce
      .findWorkerSession({ worker: coordinatorId, projectId: address })
      .then((found) => !closed && found !== undefined && setSession({ value: found.id }))
      // A failed look again leaves the empty conversation on screen; the next listing tries again.
      .catch(() => undefined);
    return () => {
      closed = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workforce, coordinatorId, address.visibility, address.id, unopened, listed]);

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
      // One per project, not per session: the conversation a first line opened here carries on
      // as the found session, with its composer and any send in flight.
      key={`${address.visibility}/${address.id}`}
      testId="project-stream"
      worker={worker}
      session={session.value ?? undefined}
      project={address}
      sessions={sessions}
      gaps={gaps}
      name="Project coordinator"
      emptyText="Ask about this project, or hand work to one of your workstreams in it."
    />
  );
}

// BR-18, BR-19.
/** The project's progress, worked out from its entries. */
function Progress({ read }: { read: ProjectWorkstreams }) {
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
          <RouteLink
            className="flex w-full items-baseline justify-between gap-2 text-left text-sm hover:underline"
            to={at(route, "workstreams", { owner: entry.owner, id: entry.id })}
          >
            <span className="truncate">{entry.title}</span>
            <span className="shrink-0 text-xs text-muted-foreground">
              {entry.owner} · {entry.status}
              {entry.objectives.length === 0 ? "" : ` · ${entry.objectives.filter((o) => o.met).length} of ${entry.objectives.length} objectives met`}
              {entry.stale ? " · gone quiet" : ""}
            </span>
          </RouteLink>
        </li>
      ))}
    </ul>
  );
}

// BR-12.
/**
 * One entry's view. Its owner talks with its lead in its workstream session;
 * anyone else reads the entry and its latest report, and never its session.
 */
function EntryView({
  address,
  route,
  entry,
  roster,
  workers,
  gaps,
}: {
  address: ProjectAddress;
  route: ProjectRoute;
  entry: WorkstreamEntry | undefined;
  roster: RosterRead;
  workers: readonly Worker[];
  gaps: Gaps;
}) {
  const { client } = useLab();
  const sessions = useSessions().list ?? NO_SESSIONS;
  const back = (
    <RouteLink
      className="text-xs underline"
      data-testid="project-entry-back"
      to={at(route, "workstreams")}
    >
      All workstreams
    </RouteLink>
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
            sessions={sessions}
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
  return <EntryDetails address={address} entry={entry} leadName={leadName} back={back} />;
}

// BR-12.
/** Another user's entry, as anyone who reads the project reads it. */
function EntryDetails({
  address,
  entry,
  leadName,
  back,
}: {
  address: ProjectAddress;
  entry: WorkstreamEntry;
  leadName: string;
  back: ReactNode;
}) {
  const report = readOf(useEntryReport(address, entry));
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
function leadWorker(entry: WorkstreamEntry, roster: RosterRead, workers: readonly Worker[]): Worker | undefined {
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
}: {
  entries: readonly WorkstreamEntry[];
  roster: RosterRead;
  workers: readonly Worker[];
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
              <TasksPanel worker={worker} sessionId={entry.sessionId} />
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
      <RouteLink className="underline" to={at(route, "stream")}>
        Stream
      </RouteLink>
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
