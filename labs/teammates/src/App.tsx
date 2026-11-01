import { useCallback, useEffect, useState } from "react";
import type { LabAdapter, NewTeammate, WorkerRow } from "./adapter";
import { Conversation } from "./components/Conversation";
import { KeysSheet } from "./components/KeysSheet";
import { PopupView, type Popup } from "./components/Popups";
import { Switcher } from "./components/Switcher";
import { TalkPanel } from "./components/TalkPanel";
import { WorkersList } from "./components/WorkersList";
import { harnessName } from "./lib/harness";
import { focusComposer, focusWhenDrawn, useLabKeys } from "./lib/keys";
import { lookOf as lookOfRow } from "./lib/looks";

/**
 * The screen: the teammates on the left, the chosen teammate's one
 * conversation in the center, and its talk with the other teammates on the
 * right. Coding is a background task, not a teammate: the worker coding tasks
 * run on is off the list, and each coding task is a background item under it.
 * A task or a message between workers, and a coding task, opens in a popup
 * over the thread, read only and live. The app opens on the first teammate.
 *
 * The roster is read again after a hire or a fire made here.
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
  // A person's pick: the teammate opens with the cursor in its composer.
  const pick = useCallback((worker: string | undefined, sessionIds: Record<string, string>) => {
    setSelected(worker);
    const sessionId = worker === undefined ? undefined : sessionIds[worker];
    if (sessionId !== undefined) focusComposer(sessionId);
  }, []);

  const loadRoster = useCallback(async () => {
    const roster = await adapter.listWorkers();
    const talking = roster.filter((w) => !w.takesTasks);
    const ids = await Promise.all(talking.map((w) => adapter.openConversation(w.id)));
    setWorkers(roster);
    const byWorker: Record<string, string> = Object.fromEntries(talking.map((w, i) => [w.id, ids[i]]));
    setSessions(byWorker);
    return { roster, talking, ids: byWorker };
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
    const { ids } = await loadRoster();
    pick(hired.id, ids);
  };
  const fire = async (worker: string) => {
    await adapter.fire(worker);
    const { talking, ids } = await loadRoster();
    pick(talking[0]?.id, ids);
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
  const closePopup = useCallback(() => setPopup(undefined), []);
  const sessionId = selected ? sessions[selected] : undefined;
  useLabKeys({
    palette: () => setSwitching((open) => !open),
    step: (by) => {
      // The teammates in the order the list draws them; the ends hold.
      const at = teammates.findIndex((w) => w.id === selected);
      const next = teammates[at === -1 ? (by === 1 ? 0 : teammates.length - 1) : at + by];
      if (next !== undefined) pick(next.id, sessions);
    },
    help: () => setKeysOpen(true),
  });
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
        onSelect={(id) => pick(id, sessions)}
        onOpen={setPopup}
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
          onOpen={setPopup}
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
          pick(id, sessions);
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
      {popup ? <PopupView adapter={adapter} popup={popup} nameOf={nameOf} lookOf={lookOf} isCoding={isCoding} onClose={closePopup} /> : null}
    </div>
  );
}
