import { useCallback, useEffect, useState } from "react";
import type { LabAdapter, NewProject, NewTeammate, ProjectRow, WorkerRow } from "./adapter";
import { Conversation } from "./components/Conversation";
import { Runs } from "./components/Runs";
import { TalkPanel } from "./components/TalkPanel";
import { WorkersList } from "./components/WorkersList";

/**
 * The screen: the workers on the left, the chosen worker's one conversation
 * in the center, and its talk with the other workers on the right. A worker
 * that takes tasks only has no conversation; the center shows its runs. The
 * app opens on the first worker on the roster.
 *
 * The roster is read again after a hire or a fire made here, and the projects
 * are watched, so one a worker created shows without a reload.
 */
export function App({ adapter }: { adapter: LabAdapter }) {
  const [workers, setWorkers] = useState<WorkerRow[]>([]);
  const [projects, setProjects] = useState<ProjectRow[]>([]);
  const [sessions, setSessions] = useState<Record<string, string>>({});
  const [selected, setSelected] = useState<string>();
  const [talkOpen, setTalkOpen] = useState(true);

  const loadRoster = useCallback(async () => {
    const roster = await adapter.listWorkers();
    const talking = roster.filter((w) => !w.takesTasks);
    const ids = await Promise.all(talking.map((w) => adapter.openConversation(w.id)));
    setWorkers(roster);
    setSessions(Object.fromEntries(talking.map((w, i) => [w.id, ids[i]])));
    return { roster, talking };
  }, [adapter]);

  useEffect(() => {
    let live = true;
    void loadRoster().then(({ roster, talking }) => {
      // Open on the first worker you can talk to: one that takes tasks only has no conversation.
      if (live) setSelected((current) => current ?? talking[0]?.id ?? roster[0]?.id);
    });
    const stopProjects = adapter.watchProjects(setProjects);
    return () => {
      live = false;
      stopProjects();
    };
  }, [adapter, loadRoster]);

  const createProject = async (project: NewProject) => {
    const created = await adapter.createProject(project);
    setProjects((rows) => (rows.some((p) => p.id === created.id) ? rows : [...rows, created]));
    return created;
  };
  const hire = async (teammate: NewTeammate) => {
    const hired = await adapter.hire(teammate);
    await loadRoster();
    setSelected(hired.id);
  };
  const fire = async (worker: string) => {
    await adapter.fire(worker);
    const { talking } = await loadRoster();
    setSelected(talking[0]?.id);
  };

  const nameOf = (id: string) => workers.find((w) => w.id === id)?.name ?? id;
  const worker = workers.find((w) => w.id === selected);
  const sessionId = selected ? sessions[selected] : undefined;
  return (
    <div
      className="grid h-full grid-rows-[minmax(0,1fr)] overflow-hidden"
      style={{ gridTemplateColumns: talkOpen ? "15rem minmax(0,1fr) 18rem" : "15rem minmax(0,1fr)" }}
    >
      <WorkersList adapter={adapter} workers={workers} sessions={sessions} selected={selected} nameOf={nameOf} onSelect={setSelected} onHire={hire} />
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
          onCreateProject={createProject}
          onFire={() => fire(worker.id)}
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
