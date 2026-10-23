import { useEffect, useState } from "react";
import type { LabAdapter, WorkerRow } from "./adapter";
import { Conversation } from "./components/Conversation";
import { TalkPanel } from "./components/TalkPanel";
import { WorkersList } from "./components/WorkersList";

/**
 * The screen: the workers on the left, the chosen worker's one conversation
 * in the center, and its talk with the other workers on the right. The app
 * opens on the first worker on the roster.
 */
export function App({ adapter }: { adapter: LabAdapter }) {
  const [workers, setWorkers] = useState<WorkerRow[]>([]);
  const [sessions, setSessions] = useState<Record<string, string>>({});
  const [selected, setSelected] = useState<string>();
  const [talkOpen, setTalkOpen] = useState(true);

  useEffect(() => {
    let live = true;
    void (async () => {
      const roster = await adapter.listWorkers();
      const ids = await Promise.all(roster.map((w) => adapter.openConversation(w.id)));
      if (!live) return;
      setWorkers(roster);
      setSessions(Object.fromEntries(roster.map((w, i) => [w.id, ids[i]])));
      setSelected((current) => current ?? roster[0]?.id);
    })();
    return () => {
      live = false;
    };
  }, [adapter]);

  const nameOf = (id: string) => workers.find((w) => w.id === id)?.name ?? id;
  const worker = workers.find((w) => w.id === selected);
  const sessionId = selected ? sessions[selected] : undefined;
  return (
    <div
      className="grid h-full grid-rows-[minmax(0,1fr)] overflow-hidden"
      style={{ gridTemplateColumns: talkOpen ? "15rem minmax(0,1fr) 18rem" : "15rem minmax(0,1fr)" }}
    >
      <WorkersList adapter={adapter} workers={workers} sessions={sessions} selected={selected} nameOf={nameOf} onSelect={setSelected} />
      {worker && sessionId ? (
        <Conversation
          adapter={adapter}
          worker={worker}
          sessionId={sessionId}
          nameOf={nameOf}
          talkOpen={talkOpen}
          onToggleTalk={() => setTalkOpen((open) => !open)}
        />
      ) : (
        <main aria-label="Conversation" />
      )}
      {talkOpen && worker ? <TalkPanel adapter={adapter} worker={worker} nameOf={nameOf} onClose={() => setTalkOpen(false)} /> : null}
    </div>
  );
}
