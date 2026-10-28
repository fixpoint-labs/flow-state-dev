import { useEffect, useState } from "react";
import type { LabAdapter, ProjectRow, SessionRow } from "./adapter";
import { ProjectPicker } from "./components/ProjectPicker";
import { SessionsList } from "./components/SessionsList";
import { TasksPane } from "./components/TasksPane";
import { ThreadsBoard } from "./components/ThreadsBoard";
import { Thread } from "./components/Thread";
import { useWatch } from "./lib/use-watch";
import { modeOfWorker, type ModeId } from "./modes";

/**
 * The screen: the view's sessions on the left, the open session's main thread
 * in the center, and its mode's right pane: background tasks in session mode,
 * the threads board in threads mode. The app opens in the Sessions view on
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
  useEffect(() => {
    let live = true;
    void adapter.listProjects().then((rows) => live && setProjects(rows));
    return () => {
      live = false;
    };
  }, [adapter]);

  const openNew = (mode: ModeId, project: ProjectRow) => {
    void adapter.openSession(mode, project.id).then((row) => select(mode, row.id));
  };
  const inView = sessions.filter((s) => modeOfWorker(s.worker)?.id === view);

  const selected = inView.find((s) => s.id === selectedId);
  const pane = selected ? modeOfWorker(selected.worker)?.pane : undefined;
  return (
    <div className="grid h-full grid-cols-[15rem_minmax(0,1fr)_19rem] grid-rows-[minmax(0,1fr)] overflow-hidden">
      <SessionsList
        view={view}
        modes={adapter.modes}
        sessions={inView}
        selectedId={selectedId}
        onView={setView}
        onSelect={(id) => select(view, id)}
        onNew={() => select(view, undefined)}
      />
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
        <aside className="bg-inspector" />
      )}
    </div>
  );
}
