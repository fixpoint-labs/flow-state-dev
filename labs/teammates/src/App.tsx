import { useCallback, useEffect, useRef, useState } from "react";
import type { LabAdapter, NewTeammate, WorkerRow } from "./adapter";
import { Conversation } from "./components/Conversation";
import { PopupView, type Popup } from "./components/Popups";
import { TalkPanel } from "./components/TalkPanel";
import { WorkersList } from "./components/WorkersList";
import { readAddress, writeAddress, type Address, type AddressWrite } from "./lib/address";
import { harnessName } from "./lib/harness";
import { lookOf as lookOfRow } from "./lib/looks";

/**
 * The screen: the teammates on the left, the chosen teammate's one
 * conversation in the center, and its talk with the other teammates on the
 * right. Coding is a background task, not a teammate: the worker coding tasks
 * run on is off the list, and each coding task is a background item under it.
 * A task or a message between workers, and a coding task, opens in a popup
 * over the thread, read only and live. The app opens on the first teammate,
 * unless the page's address names what was open (`lib/address`): a reload, a
 * link and Back reopen the teammate and the task popup.
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
  // What the address named when the page loaded, until the roster is read.
  const start = useRef<Address | null>(null);
  if (start.current === null) start.current = readAddress();
  const [ready, setReady] = useState(false);
  // How the next address write lands: a pick adds a Back step, anything else replaces.
  const how = useRef<AddressWrite>("replace");
  const conversations = useRef<Record<string, string>>({});
  // The popup the address opened. Only it is dropped when its task is gone: a
  // task filed a moment ago can be opened before its row arrives.
  const addressed = useRef<Popup | undefined>(undefined);
  const fromAddress = (named: Address) => {
    addressed.current = taskIn(named, conversations.current);
    return addressed.current;
  };

  const loadRoster = useCallback(async () => {
    const roster = await adapter.listWorkers();
    const talking = roster.filter((w) => !w.takesTasks);
    const ids = await Promise.all(talking.map((w) => adapter.openConversation(w.id)));
    const byWorker = Object.fromEntries(talking.map((w, i) => [w.id, ids[i]]));
    conversations.current = byWorker;
    setWorkers(roster);
    setSessions(byWorker);
    return { roster, talking };
  }, [adapter]);

  useEffect(() => {
    let live = true;
    void loadRoster().then(({ talking }) => {
      if (!live) return;
      // The address's teammate and task, when they are still here; the first teammate otherwise.
      const named = start.current ?? {};
      setSelected((current) => current ?? (talking.some((w) => w.id === named.worker) ? named.worker : talking[0]?.id));
      setPopup((current) => current ?? fromAddress(named));
      setReady(true);
    });
    return () => {
      live = false;
    };
  }, [adapter, loadRoster]);

  const hire = async (teammate: NewTeammate) => {
    const hired = await adapter.hire(teammate);
    await loadRoster();
    how.current = "push";
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
  // A coding worker's harness, for a task line drawn before its row arrives.
  const harnessOf = useCallback((id: string) => {
    const harness = workers.find((w) => w.id === id)?.harness;
    return harness === undefined ? undefined : harnessName(harness);
  }, [workers]);
  const lookOf = useCallback((id: string) => lookOfRow(workers.find((w) => w.id === id) ?? { id, name: id }), [workers]);
  const teammates = workers.filter((w) => !w.takesTasks);
  const worker = teammates.find((w) => w.id === selected);
  // No worker chosen, no Talk column held for one.
  const talkShown = talkOpen && worker !== undefined;
  // A user's pick: a step Back returns from.
  const selectWorker = useCallback((id: string) => {
    how.current = "push";
    setSelected(id);
  }, []);
  const openPopup = useCallback((next: Popup) => {
    how.current = "push";
    setPopup(next);
  }, []);
  const closePopup = useCallback(() => {
    how.current = "push";
    setPopup(undefined);
  }, []);
  // A task the address named that its conversation doesn't hold: dropped, not a step.
  const dropPopup = useCallback(() => {
    how.current = "replace";
    setPopup(undefined);
  }, []);

  // Keep the address on what is open, once the roster is read.
  useEffect(() => {
    if (!ready) return;
    const task = popup?.kind === "task" ? popup : undefined;
    writeAddress({ worker: selected, session: task?.sessionId, task: task?.taskId }, how.current);
    how.current = "replace";
  }, [ready, selected, popup]);
  // Back and Forward: draw what the address names now.
  useEffect(() => {
    const onPop = () => {
      const named = readAddress();
      how.current = "replace";
      const talking = Object.keys(conversations.current);
      // Before the roster is read: the load opens this address instead of the one the page loaded on.
      if (talking.length === 0) {
        start.current = named;
        return;
      }
      setSelected(named.worker !== undefined && talking.includes(named.worker) ? named.worker : talking[0]);
      setPopup(fromAddress(named));
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);
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
        lookOf={lookOf}
        isCoding={isCoding}
        onSelect={selectWorker}
        onOpen={openPopup}
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
          lookOf={lookOf}
          isCoding={isCoding}
          harnessOf={harnessOf}
          onFire={() => fire(worker.id)}
          onOpen={openPopup}
          talkOpen={talkOpen}
          onToggleTalk={() => setTalkOpen((open) => !open)}
        />
      ) : (
        <main aria-label="Conversation" />
      )}
      {talkShown ? <TalkPanel adapter={adapter} worker={worker} nameOf={nameOf} onClose={() => setTalkOpen(false)} /> : null}
      {popup ? <PopupView adapter={adapter} popup={popup} nameOf={nameOf} lookOf={lookOf} isCoding={isCoding} onClose={closePopup} onMissing={popup === addressed.current ? dropPopup : undefined} /> : null}
    </div>
  );
}

/** The task popup an address names, when the conversation it names is one of the teammates'. */
function taskIn(address: Address, conversations: Record<string, string>): Popup | undefined {
  if (address.session === undefined || address.task === undefined) return undefined;
  if (!Object.values(conversations).includes(address.session)) return undefined;
  return { kind: "task", sessionId: address.session, taskId: address.task };
}
