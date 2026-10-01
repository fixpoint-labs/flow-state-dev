/**
 * shift-manager's frame (S4): three columns, the sidebar, the centre at the level
 * and tab the URL names, and the right panel's slot for that level.
 *
 * A Lab that refuses the first read for want of a verified organization, or
 * that names no organization for the person, gets the refusal screen and
 * nothing else (BR-3): the sidebar, the tree and every other read wait behind
 * it.
 */
import { useEffect, useState } from "react";
import { GAPS, type Gaps } from "./gaps";
import type { LabClients } from "./lib/connection";
import type { LoadedSnapshot } from "./lib/derive";
import { LabProvider, useLab } from "./lib/lab-data";
import type { Failure } from "./lib/reads";
import { ResourceView } from "./surfaces/Resource";
import { useRoute, type Route } from "./lib/routes";
import { EmptyState } from "./components/ui";
import { Inbox } from "./surfaces/Inbox";
import { JumpTo } from "./surfaces/JumpTo";
import { ProjectView } from "./surfaces/Project";
import { Sidebar } from "./surfaces/Sidebar";
import { TaskProvider } from "./lib/task";
import { TaskFrame } from "./surfaces/TaskFrame";
import { TaskInspector } from "./surfaces/TaskInspector";
import { Tasks } from "./surfaces/Tasks";
import { findWorkstream, WorkstreamPanel, WorkstreamView } from "./surfaces/Workstream";

/**
 * @param devtoolUrl The devtool a task's trace link opens: the one shift-manager
 *   serves, or `--devtool`. Absent: the link is off and says how to turn it on.
 */
export function App({ clients, gaps = GAPS, devtoolUrl }: { clients: LabClients; gaps?: Gaps; devtoolUrl?: string }) {
  return (
    <LabProvider clients={clients}>
      <Shell gaps={gaps} devtoolUrl={devtoolUrl} />
    </LabProvider>
  );
}

/**
 * The screen a Lab gets when shift-manager has no organization to open it under, and
 * the only one: the Lab refused the first read, or served nothing that names
 * the person's organization.
 */
function Refusal({ failure }: { failure: Failure }) {
  return (
    <main className="flex h-screen items-center justify-center p-6" data-testid="refusal">
      <div className="max-w-md">
        <h1 className="text-lg font-semibold">This Lab won't let shift-manager in</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          {failure.httpStatus === undefined
            ? "shift-manager opens a Lab only under an organization, and this Lab doesn't say which one you're in. shift-manager shows nothing from the Lab until it does."
            : "The Lab's server refused the first read because the request carried no verified organization. shift-manager shows nothing from the Lab until it does. Check that the Lab's config hands shift-manager a credential (its devtool block) and that shift-manager is opened on the address its start script printed."}
        </p>
        <p className="mt-3 rounded-md bg-muted px-3 py-2 font-mono text-xs" data-testid="refusal-message">
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
        <h1 className="text-lg font-semibold">shift-manager couldn't reach the Lab</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          The first read failed before the Lab said who you are. Check that the Lab's server is running, then retry.
        </p>
        <p className="mt-3 rounded-md bg-muted px-3 py-2 font-mono text-xs" data-testid="unreachable-message">
          {failure.httpStatus === undefined ? failure.message : `${failure.httpStatus} · ${failure.message}`}
        </p>
        <button type="button" onClick={onRetry} className="mt-3 rounded-md border px-3 py-1.5 text-sm" data-testid="unreachable-retry">
          Retry
        </button>
      </div>
    </main>
  );
}

function Shell({ gaps, devtoolUrl }: { gaps: Gaps; devtoolUrl: string | undefined }) {
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
        <Centre snapshot={snapshot} route={route} gaps={gaps} />
      </main>
      <Panel snapshot={snapshot} route={route} gaps={gaps} />
    </>
  );
  return (
    <div className="flex h-screen min-h-0" data-testid="shell">
      <Sidebar route={route} gaps={gaps} onJump={() => setJumping(true)} />
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

function Centre({ snapshot, route, gaps }: { snapshot: LoadedSnapshot; route: Route; gaps: Gaps }) {
  switch (route.level) {
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

/** The right panel's slot, per level: the workstream's panel, the task's slot, or nothing. */
function Panel({ snapshot, route, gaps }: { snapshot: LoadedSnapshot; route: Route; gaps: Gaps }) {
  let content = null;
  if (route.level === "workstream") {
    const workstream = findWorkstream(snapshot, route.channelId);
    if (workstream !== undefined) content = <WorkstreamPanel snapshot={snapshot} workstream={workstream} gaps={gaps} />;
  } else if (route.level === "task") {
    content = <TaskInspector snapshot={snapshot} gaps={gaps} />;
  }
  if (content === null) return null;
  return (
    <aside className="w-72 shrink-0 overflow-y-auto border-l bg-card" data-testid="right-panel" data-panel={route.level}>
      {content}
    </aside>
  );
}
