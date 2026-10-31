import { useEffect, useState } from "react";
import type { LabAdapter, ProjectRow, SessionRow } from "./adapter";
import { PaneResizer } from "./components/PaneResizer";
import { ProjectPicker } from "./components/ProjectPicker";
import { SheetArea, SheetProvider } from "./components/Sheet";
import { SessionsList } from "./components/SessionsList";
import { TasksPane } from "./components/TasksPane";
import { ThreadsBoard } from "./components/ThreadsBoard";
import { Thread } from "./components/Thread";
import { paneColumn, usePaneWidth } from "./lib/pane-width";
import { useWatch } from "./lib/use-watch";
import { modeOfWorker, type ModeId } from "./modes";

/**
 * The screen: the view's sessions on the left, the open session's main thread
 * in the center, and its mode's right pane: background tasks in session mode,
 * the threads board in threads mode. A pane opens a task's work in a sheet
 * over the main thread (`SheetArea`). The right pane's width is yours to drag,
 * and stays across reloads (`usePaneWidth`). The app opens in the Sessions view on
 * *New session*, which asks for a project before the composer opens.
 */
export function App({ adapter }: { adapter: LabAdapter }) {
  const sessions = useWatch((emit: (rows: SessionRow[]) => void) => adapter.watchSessions(emit), [adapter]) ?? [];
  const [view, setView] = useState<ModeId>("session");
  // Each view keeps its own open session when you switch away and back.
  const [openByView, setOpenByView] = useState<Partial<Record<ModeId, string>>>({});
  const selectedId = openByView[view];
  // A view with no open session is on *New session*: the center asks for a project.
  const select = (mode: ModeId, id: string | undefined) => setOpenByView((open) => ({ ...open, [mode]: id }));
  // The thread open in the board, by session: a card's *View thread* opens it there too.
  const [openThread, setOpenThread] = useState<Partial<Record<string, string>>>({});
  const [projects, setProjects] = useState<ProjectRow[]>([]);
  const [paneWidth, setPaneWidth] = usePaneWidth();
  useEffect(() => {
    let live = true;
    void adapter.listProjects().then((rows) => live && setProjects(rows));
    return () => {
      live = false;
    };
  }, [adapter]);

  // ProjectPicker holds its buttons while this runs and shows a refusal.
  const openNew = (mode: ModeId, project: ProjectRow) =>
    adapter.openSession(mode, project.id).then((row) => select(mode, row.id));
  const inView = sessions.filter((s) => modeOfWorker(s.worker)?.id === view);

  const selected = inView.find((s) => s.id === selectedId);
  const pane = selected ? modeOfWorker(selected.worker)?.pane : undefined;
  return (
    <SheetProvider>
      <div
        className="grid h-full grid-rows-[minmax(0,1fr)] overflow-hidden"
        style={{ gridTemplateColumns: `15rem minmax(0,1fr) ${paneColumn(paneWidth)}` }}
      >
        <SessionsList
          view={view}
          modes={adapter.modes}
          sessions={inView}
          selectedId={selectedId}
          onView={setView}
          onSelect={(id) => select(view, id)}
          onNew={() => select(view, undefined)}
        />
        <SheetArea>
          {selected ? (
            <Thread
              key={selected.id}
              adapter={adapter}
              session={selected}
              project={projects.find((p) => p.id === selected.projectId)}
              onOpenThread={(taskId) => setOpenThread((open) => ({ ...open, [selected.id]: taskId }))}
            />
          ) : (
            <ProjectPicker
              projects={projects}
              onPick={(project) => openNew(view, project)}
              onCreate={async (name, repository) => {
                const created = await adapter.createProject(name, repository);
                setProjects((rows) => [...rows, created]);
              }}
            />
          )}
        </SheetArea>
        <div className="relative min-h-0 min-w-0">
          <PaneResizer width={paneWidth} onResize={setPaneWidth} />
          {selected && pane === "tasks" ? (
            <TasksPane adapter={adapter} sessionId={selected.id} />
          ) : selected && pane === "board" ? (
            <ThreadsBoard
              adapter={adapter}
              sessionId={selected.id}
              openId={openThread[selected.id]}
              onOpen={(taskId) => setOpenThread((open) => ({ ...open, [selected.id]: taskId }))}
            />
          ) : (
            <aside className="h-full bg-inspector" />
          )}
        </div>
      </div>
    </SheetProvider>
  );
}
