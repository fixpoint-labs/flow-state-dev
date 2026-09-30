/**
 * App Lab's frame (S4): three columns, the sidebar, the centre at the level
 * and tab the URL names, and the right panel's slot for that level.
 *
 * A Lab that refuses the first read for want of a verified organization gets
 * the refusal screen and nothing else (BR-3): the sidebar, the tree and every
 * other read wait behind it.
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
import { TaskFrame, TaskPanel } from "./surfaces/TaskFrame";
import { Tasks } from "./surfaces/Tasks";
import { findWorkstream, WorkstreamPanel, WorkstreamView } from "./surfaces/Workstream";

export function App({ clients, gaps = GAPS }: { clients: LabClients; gaps?: Gaps }) {
  return (
    <LabProvider clients={clients}>
      <Shell gaps={gaps} />
    </LabProvider>
  );
}

/** The screen a refused first read gets, and the only one. */
function Refusal({ failure }: { failure: Failure }) {
  return (
    <main className="flex h-screen items-center justify-center p-6" data-testid="refusal">
      <div className="max-w-md">
        <h1 className="text-lg font-semibold">This Lab won't let App Lab in</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          The Lab's server refused the first read because the request carried no verified organization. App Lab shows
          nothing from the Lab until it does. Check that the Lab's config hands App Lab a credential (its devtool
          block) and that App Lab is opened on the address its start script printed.
        </p>
        <p className="mt-3 rounded-md bg-muted px-3 py-2 font-mono text-xs" data-testid="refusal-message">
          {failure.httpStatus ?? "?"} · {failure.message}
        </p>
      </div>
    </main>
  );
}

function Shell({ gaps }: { gaps: Gaps }) {
  const { snapshot } = useLab();
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

  return (
    <div className="flex h-screen min-h-0" data-testid="shell">
      <Sidebar route={route} gaps={gaps} onJump={() => setJumping(true)} />
      <main className="min-w-0 flex-1 overflow-hidden" data-testid="centre" data-level={route.level}>
        <Centre snapshot={snapshot} route={route} gaps={gaps} />
      </main>
      <Panel snapshot={snapshot} route={route} gaps={gaps} />
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
      return <TaskFrame snapshot={snapshot} boardRef={route.boardRef} taskId={route.taskId} tab={route.tab} gaps={gaps} />;
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
    content = <TaskPanel gaps={gaps} />;
  }
  if (content === null) return null;
  return (
    <aside className="w-72 shrink-0 overflow-y-auto border-l bg-card" data-testid="right-panel" data-panel={route.level}>
      {content}
    </aside>
  );
}
