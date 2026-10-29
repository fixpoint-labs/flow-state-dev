import { useCallback, useEffect, useState } from "react";
import type { LabAdapter, NewTeammate, WorkerRow } from "./adapter";
import { Conversation } from "./components/Conversation";
import { PopupView, type Popup } from "./components/Popups";
import { TalkPanel } from "./components/TalkPanel";
import { WorkersList } from "./components/WorkersList";

/**
 * The screen: the teammates on the left, the chosen teammate's one
 * conversation in the center, and its talk with the other teammates on the
 * right. Coding is a background task, not a teammate: the worker coding tasks
 * run on is off the list, and each coding task is a background item under it.
 * A task or a message between workers, and a coding task, opens in a popup
 * over the thread, read only and live. The app opens on the first teammate.
 *
 * The roster is read again after a hire or a fire made here.
 */
export function App({ adapter }: { adapter: LabAdapter }) {
  const [workers, setWorkers] = useState<WorkerRow[]>([]);
  const [sessions, setSessions] = useState<Record<string, string>>({});
  const [selected, setSelected] = useState<string>();
  // A task or a message, open in a popup over the thread.
  const [popup, setPopup] = useState<Popup>();
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
    return () => {
      live = false;
    };
  }, [adapter, loadRoster]);

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

  // Stable between roster reads, so a memoized entry doesn't redraw for a new function.
  const nameOf = useCallback((id: string) => workers.find((w) => w.id === id)?.name ?? id, [workers]);
  const isCoding = useCallback((id: string) => workers.some((w) => w.id === id && w.takesTasks), [workers]);
  const teammates = workers.filter((w) => !w.takesTasks);
  const worker = teammates.find((w) => w.id === selected);
  // No worker chosen, no Talk column held for one.
  const talkShown = talkOpen && worker !== undefined;
  const closePopup = useCallback(() => setPopup(undefined), []);
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
        openTask={popup?.kind === "task" ? popup.taskId : undefined}
        nameOf={nameOf}
        isCoding={isCoding}
        onSelect={setSelected}
        onOpen={setPopup}
        onHire={hire}
      />
      {worker && sessionId ? (
        <Conversation
          // One conversation per session: a draft typed to one worker never carries over to another.
          key={sessionId}
          adapter={adapter}
          worker={worker}
          sessionId={sessionId}
          nameOf={nameOf}
          isCoding={isCoding}
          onFire={() => fire(worker.id)}
          onOpen={setPopup}
          talkOpen={talkOpen}
          onToggleTalk={() => setTalkOpen((open) => !open)}
        />
      ) : (
        <main aria-label="Conversation" />
      )}
      {talkShown ? <TalkPanel adapter={adapter} worker={worker} nameOf={nameOf} onClose={() => setTalkOpen(false)} /> : null}
      {popup ? <PopupView adapter={adapter} popup={popup} nameOf={nameOf} isCoding={isCoding} onClose={closePopup} /> : null}
    </div>
  );
}
