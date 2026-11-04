import { ClientHttpError } from "@flow-state-dev/client";
import { useCallback, useEffect, useRef, useState } from "react";
import type { LabAdapter, NewTeammate, WorkerRow } from "./adapter";
import { Conversation } from "./components/Conversation";
import { KeysSheet } from "./components/KeysSheet";
import { PopupView, type Popup } from "./components/Popups";
import { Switcher } from "./components/Switcher";
import { TalkPanel } from "./components/TalkPanel";
import { WorkersList } from "./components/WorkersList";
import { ConnectionScreen, type ConnectionFailure } from "./components/flow-state/connection-screen";
import { readAddress, writeAddress, type Address, type AddressWrite } from "./lib/address";
import { harnessName } from "./lib/harness";
import { focusComposer, focusWhenDrawn, useLabKeys } from "./lib/keys";
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
 * The roster is read again after a hire or a fire made here. A first read
 * that fails draws the registry's `connection-screen`, which reads again on
 * its own until one lands. Once the screen is up, a conversation's feed that
 * loses the server draws `connection-banner` over it and greys the status
 * lines drawn from that feed.
 *
 * Keys (`useLabKeys`): ⌘K switches to any teammate or hires one, Alt+↑/↓
 * steps through the teammates, `/` puts the cursor in the composer, `?` lists
 * the keys. Opening a teammate, however it is opened, puts the cursor in its
 * composer.
 */

/** What `?` lists: every key the lab has. */
const KEYS = [
  ["⌘K / Ctrl+K", "Switch to any teammate, or hire one"],
  ["Alt+↑ / Alt+↓", "The previous or next teammate"],
  ["/", "Put the cursor in the composer"],
  ["?", "This list"],
  ["Enter", "Send, in the composer"],
  ["Esc", "Close a dialog"],
] as const;
export function App({ adapter }: { adapter: LabAdapter }) {
  const [workers, setWorkers] = useState<WorkerRow[]>([]);
  const [sessions, setSessions] = useState<Record<string, string>>({});
  const [selected, setSelected] = useState<string>();
  // A task or a message, open in a popup over the thread.
  const [popup, setPopup] = useState<Popup>();
  const [talkOpen, setTalkOpen] = useState(true);
  const [switching, setSwitching] = useState(false);
  const [keysOpen, setKeysOpen] = useState(false);
  const [hiring, setHiring] = useState(false);
  // What the address named when the page loaded, until the roster is read.
  const start = useRef<Address | null>(null);
  if (start.current === null) start.current = readAddress();
  const [ready, setReady] = useState(false);
  // The first roster read's failure, until a read lands: the page has nothing yet to keep on screen.
  const [unreachable, setUnreachable] = useState<ConnectionFailure>();
  const live = useRef(true);
  // Bumped by each boot read; only the newest read's answer lands, so a slow read a Retry overtook can't redraw the failure.
  const boots = useRef(0);
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

  // The first read: the roster, then the address's teammate and task, when they are still here; the first teammate otherwise.
  const boot = useCallback(async () => {
    const mine = ++boots.current;
    try {
      const { talking } = await loadRoster();
      if (!live.current || mine !== boots.current) return;
      setUnreachable(undefined);
      const named = start.current ?? {};
      setSelected((current) => current ?? (talking.some((w) => w.id === named.worker) ? named.worker : talking[0]?.id));
      setPopup((current) => current ?? fromAddress(named));
      setReady(true);
    } catch (error) {
      if (live.current && mine === boots.current) setUnreachable(error instanceof ClientHttpError ? { httpStatus: error.status, message: error.message } : { message: error instanceof Error ? error.message : String(error) });
    }
  }, [loadRoster]);
  useEffect(() => {
    live.current = true;
    void boot();
    return () => {
      live.current = false;
    };
  }, [boot]);

  const hire = async (teammate: NewTeammate) => {
    const hired = await adapter.hire(teammate);
    await loadRoster();
    selectWorker(hired.id);
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
  // A user's pick: a step Back returns from, and the teammate opens with the cursor in its composer.
  const selectWorker = useCallback((id: string) => {
    how.current = "push";
    setSelected(id);
    const sessionId = conversations.current[id];
    if (sessionId !== undefined) focusComposer(sessionId);
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
  useLabKeys({
    palette: () => setSwitching((open) => !open),
    step: (by) => {
      // The teammates in the order the list draws them; the ends hold.
      const at = teammates.findIndex((w) => w.id === selected);
      const next = teammates[at === -1 ? (by === 1 ? 0 : teammates.length - 1) : at + by];
      if (next !== undefined) selectWorker(next.id);
    },
    help: () => setKeysOpen(true),
  });

  if (unreachable !== undefined) {
    return (
      <ConnectionScreen kind="unreachable" title="Can't reach the lab" failure={unreachable} onRetry={boot}>
        The roster read failed. Check that the lab's server is running; this page tries again on its own.
      </ConnectionScreen>
    );
  }
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
        hiring={hiring}
        onHiring={setHiring}
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
      <Switcher
        open={switching}
        onOpenChange={setSwitching}
        teammates={teammates}
        onPick={(id) => {
          // A pick goes somewhere: the key list or a popup, if one was open under the switcher, closes too.
          setSwitching(false);
          setKeysOpen(false);
          setPopup(undefined);
          selectWorker(id);
        }}
        onHire={() => {
          setSwitching(false);
          setKeysOpen(false);
          setPopup(undefined);
          setHiring(true);
          focusWhenDrawn('input[aria-label="Teammate name"]');
        }}
      />
      <KeysSheet open={keysOpen} onOpenChange={setKeysOpen} keys={KEYS} />
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
