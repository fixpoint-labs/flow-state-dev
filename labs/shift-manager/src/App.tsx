/**
 * Shift Manager's frame (S4): three columns, the sidebar, the centre at the level
 * and tab the URL names, and the right panel's slot for that level. The frame
 * holds v2's 900px minimum width; below that the page scrolls.
 *
 * A Lab that refuses the first read for want of a verified organization, or
 * that names no organization for the person, gets the refusal screen and
 * nothing else (BR-3): the sidebar, the tree and every other read wait behind
 * it.
 */
import { useEffect, useState } from "react";
import { GAPS, type Gaps } from "./gaps";
import type { ShiftLook } from "./lib/color-scheme";
import type { LabClients } from "./lib/connection";
import type { LoadedSnapshot } from "./lib/derive";
import { LabProvider, useLab } from "./lib/lab-data";
import type { Failure } from "./lib/reads";
import { ResourceView } from "./surfaces/Resource";
import { useRoute, type Route } from "./lib/routes";
import { EmptyState } from "./components/ui";
import { ChiefOfStaffPanel, ChiefOfStaffView } from "./surfaces/ChiefOfStaff";
import { Inbox } from "./surfaces/Inbox";
import { JumpTo } from "./surfaces/JumpTo";
import { ProjectView } from "./surfaces/Project";
import { RosterView } from "./surfaces/Roster";
import { Sidebar } from "./surfaces/Sidebar";
import { TaskProvider } from "./lib/task";
import { TaskFrame } from "./surfaces/TaskFrame";
import { TaskInspector } from "./surfaces/TaskInspector";
import { Tasks } from "./surfaces/Tasks";
import { findWorkstream, WorkstreamPanel, WorkstreamView } from "./surfaces/Workstream";

/**
 * @param devtoolUrl The devtool a task's trace link opens: the one Shift Manager
 *   serves, or `--devtool`. Absent: the link is off and says how to turn it on.
 * @param look The page's light or dark look, which the sidebar's shift switch
 *   changes. Absent: the sidebar draws no switch.
 */
export function App({ clients, gaps = GAPS, devtoolUrl, look }: { clients: LabClients; gaps?: Gaps; devtoolUrl?: string; look?: ShiftLook }) {
  return (
    <LabProvider clients={clients}>
      <Shell gaps={gaps} devtoolUrl={devtoolUrl} look={look} />
    </LabProvider>
  );
}

/**
 * The screen a Lab gets when Shift Manager has no organization to open it under, and
 * the only one: the Lab refused the first read, or served nothing that names
 * the person's organization.
 */
function Refusal({ failure }: { failure: Failure }) {
  return (
    <main className="flex h-screen items-center justify-center p-6" data-testid="refusal">
      <div className="max-w-md">
        <h1 className="text-lg font-semibold">This Lab won't let Shift Manager in</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          {failure.httpStatus === undefined
            ? "Shift Manager opens a Lab only under an organization, and this Lab doesn't say which one you're in. Shift Manager shows nothing from the Lab until it does."
            : "The Lab's server refused the first read because the request carried no verified organization. Shift Manager shows nothing from the Lab until it does. Check that the Lab's config hands Shift Manager a credential (its devtool block) and that Shift Manager is opened on the address its start script printed."}
        </p>
        <p className="mt-3 bg-muted px-3 py-2 font-mono text-xs" data-testid="refusal-message">
          {failure.httpStatus === undefined ? failure.message : `${failure.httpStatus} · ${failure.message}`}
        </p>
      </div>
    </main>
  );
}

/** The screen a first read that failed for another reason gets: what the Lab answered, and Retry. */
function Unreachable({ failure, onRetry }: { failure: Failure; onRetry: () => void }) {
  return (
    <main className="flex h-screen items-center justify-center p-6" data-testid="unreachable">
      <div className="max-w-md">
        <h1 className="text-lg font-semibold">Shift Manager couldn't reach the Lab</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          The first read failed before the Lab said who you are. Check that the Lab's server is running, then retry.
        </p>
        <p className="mt-3 bg-muted px-3 py-2 font-mono text-xs" data-testid="unreachable-message">
          {failure.httpStatus === undefined ? failure.message : `${failure.httpStatus} · ${failure.message}`}
        </p>
        <button type="button" onClick={onRetry} className="mt-3 border px-3 py-1.5 text-sm" data-testid="unreachable-retry">
          Retry
        </button>
      </div>
    </main>
  );
}

function Shell({ gaps, devtoolUrl, look }: { gaps: Gaps; devtoolUrl: string | undefined; look: ShiftLook | undefined }) {
  const { snapshot, refresh } = useLab();
  const route = useRoute();
  const [jumping, setJumping] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setJumping((j) => !j);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  if (snapshot === undefined) {
    return <p className="p-6 text-sm text-muted-foreground" data-testid="loading">Reading the Lab…</p>;
  }
  if (snapshot.refused !== undefined) return <Refusal failure={snapshot.refused} />;
  if (snapshot.unreachable !== undefined) return <Unreachable failure={snapshot.unreachable} onRetry={() => void refresh()} />;

  const levels = (
    <>
      <main className="min-w-0 flex-1 overflow-hidden" data-testid="centre" data-level={route.level}>
        <Centre snapshot={snapshot} route={route} gaps={gaps} look={look} />
      </main>
      <Panel snapshot={snapshot} route={route} gaps={gaps} />
    </>
  );
  return (
    <div className="flex h-screen min-h-0 min-w-[900px]" data-testid="shell">
      <Sidebar route={route} gaps={gaps} onJump={() => setJumping(true)} look={look} />
      {route.level === "task" ? (
        // The task screen and its inspector read one row and one run.
        <TaskProvider
          key={`${route.boardRef}/${route.taskId}`}
          snapshot={snapshot}
          boardRef={route.boardRef}
          taskId={route.taskId}
          devtoolUrl={devtoolUrl}
        >
          {levels}
        </TaskProvider>
      ) : (
        levels
      )}
      {jumping ? <JumpTo snapshot={snapshot} gaps={gaps} onClose={() => setJumping(false)} /> : null}
    </div>
  );
}

function Centre({ snapshot, route, gaps, look }: { snapshot: LoadedSnapshot; route: Route; gaps: Gaps; look: ShiftLook | undefined }) {
  switch (route.level) {
    case "cos":
      return <ChiefOfStaffView snapshot={snapshot} gaps={gaps} />;
    case "roster":
      return <RosterView snapshot={snapshot} team={route.team} gaps={gaps} look={look} />;
    case "inbox":
      return <Inbox snapshot={snapshot} suspensionId={route.suspensionId} gaps={gaps} />;
    case "tasks":
      return <Tasks snapshot={snapshot} by={route.by} gaps={gaps} />;
    case "task":
      return <TaskFrame tab={route.tab} gaps={gaps} />;
    case "resource":
      return <ResourceView sessionId={route.sessionId} resourceRef={route.ref} />;
    case "project":
      return <ProjectView snapshot={snapshot} projectId={route.projectId} tab={route.tab} gaps={gaps} />;
    case "workstream": {
      const workstream = findWorkstream(snapshot, route.channelId);
      return workstream === undefined ? (
        <EmptyState title="No such workstream" testId="workstream-missing">
          This Lab's inventory registers no channel "{route.channelId}".
        </EmptyState>
      ) : (
        <WorkstreamView key={workstream.id} snapshot={snapshot} workstream={workstream} tab={route.tab} gaps={gaps} />
      );
    }
  }
}

/**
 * The right panel's slot, per level: Chief of Staff's rail, the workstream's
 * panel, the task's slot, or nothing. v2's rail: 340px on the inspector
 * surface, and not drawn on a window narrower than 1180px (v2:26, 1121, 1219).
 */
function Panel({ snapshot, route, gaps }: { snapshot: LoadedSnapshot; route: Route; gaps: Gaps }) {
  let content = null;
  if (route.level === "cos") {
    content = <ChiefOfStaffPanel snapshot={snapshot} gaps={gaps} />;
  } else if (route.level === "workstream") {
    const workstream = findWorkstream(snapshot, route.channelId);
    if (workstream !== undefined) content = <WorkstreamPanel snapshot={snapshot} workstream={workstream} gaps={gaps} />;
  } else if (route.level === "task") {
    content = <TaskInspector snapshot={snapshot} gaps={gaps} />;
  }
  if (content === null) return null;
  return (
    <aside className="hidden w-[340px] shrink-0 overflow-y-auto border-l bg-inspector min-[1180px]:block" data-testid="right-panel" data-panel={route.level}>
      {content}
    </aside>
  );
}
