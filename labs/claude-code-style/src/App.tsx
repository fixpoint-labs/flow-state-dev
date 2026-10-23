import { useEffect, useState } from "react";
import type { LabAdapter, SessionRow } from "./adapter";
import { SessionsList } from "./components/SessionsList";
import { TasksPane } from "./components/TasksPane";
import { Thread } from "./components/Thread";
import { useWatch } from "./lib/use-watch";
import { modeOfWorker, type ModeId } from "./modes";

/**
 * The screen: sessions on the left, the open session's main thread in the
 * center, and its mode's right pane. The app opens on a new session-mode
 * session, as the original opens on a new chat.
 */
export function App({ adapter }: { adapter: LabAdapter }) {
  const sessions = useWatch((emit: (rows: SessionRow[]) => void) => adapter.watchSessions(emit), [adapter]) ?? [];
  const [selectedId, setSelectedId] = useState<string>();

  const openNew = (mode: ModeId) => {
    void adapter.openSession(mode).then((row) => setSelectedId(row.id));
  };
  useEffect(() => {
    openNew("session");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [adapter]);

  const selected = sessions.find((s) => s.id === selectedId);
  const pane = selected ? modeOfWorker(selected.worker)?.pane : undefined;
  return (
    <div className="grid h-full grid-cols-[15rem_minmax(0,1fr)_19rem] grid-rows-[minmax(0,1fr)] overflow-hidden">
      <SessionsList sessions={sessions} selectedId={selectedId} onSelect={setSelectedId} onNew={openNew} />
      {selected ? <Thread adapter={adapter} session={selected} /> : <main aria-label="Main thread" />}
      {selected && pane === "tasks" ? <TasksPane adapter={adapter} sessionId={selected.id} /> : <aside className="bg-inspector" />}
    </div>
  );
}
