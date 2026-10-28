import { useEffect, useState } from "react";
import type { LabAdapter, ProjectRow, WorkerRow } from "./adapter";
import { Conversation } from "./components/Conversation";
import { Runs } from "./components/Runs";
import { TalkPanel } from "./components/TalkPanel";
import { WorkersList } from "./components/WorkersList";

/**
 * The screen: the workers on the left, the chosen worker's one conversation
 * in the center, and its talk with the other workers on the right. A worker
 * that takes tasks only has no conversation; the center shows its runs. The
 * app opens on the first worker on the roster.
 */
export function App({ adapter }: { adapter: LabAdapter }) {
  const [workers, setWorkers] = useState<WorkerRow[]>([]);
  const [projects, setProjects] = useState<ProjectRow[]>([]);
  const [sessions, setSessions] = useState<Record<string, string>>({});
  const [selected, setSelected] = useState<string>();
  const [talkOpen, setTalkOpen] = useState(true);

  useEffect(() => {
    let live = true;
    void (async () => {
      const [roster, projectRows] = await Promise.all([adapter.listWorkers(), adapter.listProjects()]);
      const talking = roster.filter((w) => !w.takesTasks);
      const ids = await Promise.all(talking.map((w) => adapter.openConversation(w.id)));
      if (!live) return;
      setWorkers(roster);
      setProjects(projectRows);
      setSessions(Object.fromEntries(talking.map((w, i) => [w.id, ids[i]])));
      // Open on the first worker you can talk to: one that takes tasks only has no conversation.
      setSelected((current) => current ?? talking[0]?.id ?? roster[0]?.id);
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
      {worker?.takesTasks ? (
        <Runs adapter={adapter} worker={worker} workers={workers} sessions={sessions} projects={projects} nameOf={nameOf} />
      ) : worker && sessionId ? (
        <Conversation
          // One conversation per session: a draft typed to one worker never carries over to another.
          key={sessionId}
          adapter={adapter}
          worker={worker}
          sessionId={sessionId}
          projects={projects}
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
