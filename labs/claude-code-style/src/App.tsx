import { useEffect, useRef, useState } from "react";
import type { LabAdapter, SessionRow } from "./adapter";
import { SessionsList } from "./components/SessionsList";
import { TasksPane } from "./components/TasksPane";
import { Thread } from "./components/Thread";
import { useWatch } from "./lib/use-watch";
import { modeOfWorker, type ModeId } from "./modes";

/**
 * The screen: the view's sessions on the left, the open session's main thread
 * in the center, and its mode's right pane. The app opens in the Sessions view
 * on a new session, as the original opens on a new chat.
 */
export function App({ adapter }: { adapter: LabAdapter }) {
  const sessions = useWatch((emit: (rows: SessionRow[]) => void) => adapter.watchSessions(emit), [adapter]) ?? [];
  const [view, setView] = useState<ModeId>("session");
  const [selectedId, setSelectedId] = useState<string>();

  const openNew = (mode: ModeId) => {
    void adapter.openSession(mode).then((row) => setSelectedId(row.id));
  };
  const inView = sessions.filter((s) => modeOfWorker(s.worker)?.id === view);
  // StrictMode replays this effect on mount; the ref keeps it to one new session per adapter.
  const openedFor = useRef<LabAdapter>(undefined);
  useEffect(() => {
    if (openedFor.current === adapter) return;
    openedFor.current = adapter;
    openNew("session");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [adapter]);

  const selected = inView.find((s) => s.id === selectedId);
  const pane = selected ? modeOfWorker(selected.worker)?.pane : undefined;
  return (
    <div className="grid h-full grid-cols-[15rem_minmax(0,1fr)_19rem] grid-rows-[minmax(0,1fr)] overflow-hidden">
      <SessionsList
        view={view}
        sessions={inView}
        selectedId={selectedId}
        onView={setView}
        onSelect={setSelectedId}
        onNew={() => openNew(view)}
      />
      {selected ? <Thread adapter={adapter} session={selected} /> : <main aria-label="Main thread" />}
      {selected && pane === "tasks" ? <TasksPane adapter={adapter} sessionId={selected.id} /> : <aside className="bg-inspector" />}
    </div>
  );
}
