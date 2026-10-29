import { useCallback, useEffect, useState } from "react";
import type { LabAdapter, NewProject, NewTeammate, ProjectRow, WorkerRow } from "./adapter";
import { Conversation } from "./components/Conversation";
import { Runs } from "./components/Runs";
import { TalkPanel } from "./components/TalkPanel";
import { WorkersList } from "./components/WorkersList";

/**
 * The screen: the teammates on the left, the chosen teammate's one
 * conversation in the center, and its talk with the other teammates on the
 * right. Coding is a background task, not a teammate: the worker coding tasks
 * run on is off the list, and each coding task is a background item under it
 * that opens the center to the runs, read only. The app opens on the first
 * teammate.
 *
 * The roster is read again after a hire or a fire made here, and the projects
 * are watched, so one a worker created shows without a reload.
 */
export function App({ adapter }: { adapter: LabAdapter }) {
  const [workers, setWorkers] = useState<WorkerRow[]>([]);
  const [projects, setProjects] = useState<ProjectRow[]>([]);
  const [sessions, setSessions] = useState<Record<string, string>>({});
  const [selected, setSelected] = useState<string>();
  // A background item chosen on the left: the coding task whose run the center opens to.
  const [openRun, setOpenRun] = useState<string>();
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
    void loadRoster().then(({ talking }) => {
      if (live) setSelected((current) => current ?? talking[0]?.id);
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
    setOpenRun(undefined);
    setSelected(hired.id);
  };
  const fire = async (worker: string) => {
    await adapter.fire(worker);
    const { talking } = await loadRoster();
    setSelected(talking[0]?.id);
  };

  const nameOf = (id: string) => workers.find((w) => w.id === id)?.name ?? id;
  const isCoding = (id: string) => workers.some((w) => w.id === id && w.takesTasks);
  const teammates = workers.filter((w) => !w.takesTasks);
  const worker = openRun === undefined ? teammates.find((w) => w.id === selected) : undefined;
  // A run has no Talk panel, so it gets no Talk column either.
  const talkShown = talkOpen && worker !== undefined;
  const choose = (id: string) => {
    setOpenRun(undefined);
    setSelected(id);
  };
  const sessionId = selected ? sessions[selected] : undefined;
  return (
    <div
      className="grid h-full grid-rows-[minmax(0,1fr)] overflow-hidden"
      style={{ gridTemplateColumns: talkShown ? "15rem minmax(0,1fr) 18rem" : "15rem minmax(0,1fr)" }}
    >
      <WorkersList
        adapter={adapter}
        workers={teammates}
        sessions={sessions}
        selected={worker?.id}
        openRun={openRun}
        nameOf={nameOf}
        isCoding={isCoding}
        onSelect={choose}
        onOpenRun={setOpenRun}
        onHire={hire}
      />
      {openRun !== undefined ? (
        <Runs key={openRun} adapter={adapter} workers={teammates} sessions={sessions} projects={projects} nameOf={nameOf} isCoding={isCoding} openRun={openRun} />
      ) : worker && sessionId ? (
        <Conversation
          // One conversation per session: a draft typed to one worker never carries over to another.
          key={sessionId}
          adapter={adapter}
          worker={worker}
          sessionId={sessionId}
          projects={projects}
          nameOf={nameOf}
          isCoding={isCoding}
          onCreateProject={createProject}
          onFire={() => fire(worker.id)}
          talkOpen={talkOpen}
          onToggleTalk={() => setTalkOpen((open) => !open)}
        />
      ) : (
        <main aria-label="Conversation" />
      )}
      {talkShown ? <TalkPanel adapter={adapter} worker={worker} nameOf={nameOf} onClose={() => setTalkOpen(false)} /> : null}
    </div>
  );
}
