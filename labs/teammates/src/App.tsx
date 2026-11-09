import { ClientHttpError } from "@flow-state-dev/client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { LabHarness, LabAdapter, LabContext, NewTeammate, LabWorker } from "./adapter";
import { Conversation } from "./components/Conversation";
import { KeysSheet } from "./components/KeysSheet";
import { PopupView, type FollowUp, type Popup } from "./components/Popups";
import { Switcher } from "./components/Switcher";
import { TeammatePanel } from "./components/TeammatePanel";
import { WorkersList } from "./components/WorkersList";
import { ConnectionScreen, type ConnectionFailure } from "./components/flow-state/connection-screen";
import { readAddress, writeAddress, type Address, type AddressWrite } from "./lib/address";
import { harnessName } from "./lib/harness";
import { focusComposer, focusWhenDrawn, useLabKeys } from "./lib/keys";
import { lookOf as lookOfRow } from "./lib/looks";

/**
 * The screen: the teammates on the left, the chosen teammate's one
 * conversation in the center, and its panel on the right: who it is, and the
 * tasks its conversation filed. Coding is a background task, not a teammate:
 * the worker coding tasks run on is off the list, and each coding task is a
 * row in the panel of the teammate that started it.
 * A task or a message between workers, and a coding task, opens in a popup
 * over the thread, read only and live. The app opens on the first teammate,
 * unless the page's address names what was open (`lib/address`): a reload, a
 * link and Back reopen the teammate and the task popup.
 *
 * The list follows the roster (`watchWorkers`): a hire, an edit or a fire,
 * made here, in another tab or by a worker's turn, shows without a reload. A
 * first read that fails draws the registry's `connection-screen`, which
 * watches again on its own until a read lands. Once the screen is up, a conversation's feed that
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
/** A failed roster read as the connection screen shows it: a status the server answered with, apart from a dead socket. */
function failureOf(error: unknown): ConnectionFailure {
  if (error instanceof ClientHttpError) return { httpStatus: error.status, message: error.message };
  return { message: error instanceof Error ? error.message : String(error) };
}

export function App({ adapter }: { adapter: LabAdapter }) {
  const [workers, setWorkers] = useState<LabWorker[]>([]);
  const [sessions, setSessions] = useState<Record<string, string>>({});
  const [selected, setSelected] = useState<string>();
  // A task or a message, open in a popup over the thread.
  const [popup, setPopup] = useState<Popup>();
  const [switching, setSwitching] = useState(false);
  const [keysOpen, setKeysOpen] = useState(false);
  const [hiring, setHiring] = useState(false);
  // What the address named when the page loaded, until the roster is read.
  const start = useRef<Address | null>(null);
  if (start.current === null) start.current = readAddress();
  const [ready, setReady] = useState(false);
  // The first roster read's failure, until a read lands: the page has nothing yet to keep on screen.
  const [unreachable, setUnreachable] = useState<ConnectionFailure>();
  // Bumped by each Retry: a new watch, which reads at once. Only the current watch's answers land,
  // so a slow read a Retry overtook can't redraw the failure.
  const [attempt, setAttempt] = useState(0);
  // How the next address write lands: a pick adds a Back step, anything else replaces.
  const how = useRef<AddressWrite>("replace");
  const conversations = useRef<Record<string, string>>({});
  // The popup the address opened. Only it is dropped when its task is gone: a
  // task filed a moment ago can be opened before its row arrives.
  const addressed = useRef<Popup | undefined>(undefined);
  // The teammates the last landed roster drew, and a pick waiting for a roster: a hire picks its
  // teammate once its row lands; a fire picks from the roster that no longer has the fired one.
  const landedTalking = useRef<LabWorker[]>([]);
  const waitingPick = useRef<((talking: LabWorker[]) => boolean) | null>(null);
  const pickWhenLanded = (pick: (talking: LabWorker[]) => boolean) => {
    waitingPick.current = pick(landedTalking.current) ? null : pick;
  };
  const fromAddress = (named: Address) => {
    addressed.current = taskIn(named, conversations.current);
    return addressed.current;
  };

  // The roster, followed: each roster the watch reports opens the teammates' conversations and
  // redraws the list. The first lands the page on the address's teammate and task, when they are
  // still here, or the first teammate.
  useEffect(() => {
    let current = true;
    let landed = false;
    let latest = 0;
    const failed = (error: unknown) => {
      if (current && !landed) setUnreachable(failureOf(error));
    };
    const stop = adapter.watchWorkers((roster) => {
      const mine = ++latest;
      const talking = roster.filter((w) => !w.takesTasks);
      Promise.allSettled(talking.map((w) => adapter.openConversation(w.id))).then((opened) => {
        if (!current || mine !== latest) return;
        // Before the page lands, a conversation that won't open is the lab being unreachable.
        const refused = opened.find((o): o is PromiseRejectedResult => o.status === "rejected");
        if (!landed && refused) return failed(refused.reason);
        // After, one conversation that won't open never holds back the roster: that teammate keeps
        // the conversation it had, or opens when picked.
        const byWorker: Record<string, string> = {};
        talking.forEach((w, i) => {
          const o = opened[i]!;
          const id = o.status === "fulfilled" ? o.value : conversations.current[w.id];
          if (id !== undefined) byWorker[w.id] = id;
        });
        conversations.current = byWorker;
        landedTalking.current = talking;
        setWorkers(roster);
        setSessions(byWorker);
        if (waitingPick.current?.(talking)) waitingPick.current = null;
        if (landed) return;
        landed = true;
        setUnreachable(undefined);
        const named = start.current ?? {};
        setSelected((open) => open ?? (talking.some((w) => w.id === named.worker) ? named.worker : talking[0]?.id));
        setPopup((open) => open ?? fromAddress(named));
        setReady(true);
      }, failed);
    }, failed);
    return () => {
      current = false;
      stop();
    };
  }, [adapter, attempt]);

  // The watch brings the new row and its conversation; the pick waits for them.
  // What the lab works on and with, and which harnesses can run: read once, the chips again on Re-check.
  const [context, setContext] = useState<LabContext>();
  const [harnesses, setHarnesses] = useState<LabHarness[]>();
  useEffect(() => {
    let on = true;
    void adapter.readContext().then((read) => on && setContext(read), () => undefined);
    // A failed read draws no chips rather than "checking" forever.
    void adapter.readHarnesses().then((rows) => on && setHarnesses(rows), () => on && setHarnesses([]));
    return () => {
      on = false;
    };
  }, [adapter]);
  const recheck = async () => setHarnesses(await adapter.readHarnesses(true));

  const hire = async (teammate: NewTeammate) => {
    const hired = await adapter.hire(teammate);
    pickWhenLanded((talking) => {
      if (!talking.some((w) => w.id === hired.id)) return false;
      selectWorker(hired.id);
      return true;
    });
  };
  const fire = async (worker: string) => {
    await adapter.fire(worker);
    pickWhenLanded((talking) => {
      if (talking.some((w) => w.id === worker)) return false;
      setSelected(talking[0]?.id);
      return true;
    });
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
  const coders = useMemo(() => workers.filter((w) => w.takesTasks), [workers]);
  const worker = teammates.find((w) => w.id === selected);
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
  // Words a task popup's follow-up hands the composer of the conversation that filed the task.
  const [prefill, setPrefill] = useState<{ sessionId: string; text: string; n: number }>();
  // Counts every ask, so a composer that stayed open never mistakes a new one for the one it took.
  const asks = useRef(0);
  // Who filed the open task: the worker whose conversation it is, when that conversation is on the roster.
  const filer = popup?.kind === "task" ? Object.entries(sessions).find(([, session]) => session === popup.sessionId)?.[0] : undefined;
  const followUp = useMemo<FollowUp | undefined>(() => {
    if (filer === undefined || popup?.kind !== "task") return undefined;
    const session = popup.sessionId;
    return {
      name: nameOf(filer),
      ask: (text) => {
        how.current = "push";
        setPopup(undefined);
        setSelected(filer);
        asks.current += 1;
        setPrefill({ sessionId: session, text, n: asks.current });
      },
    };
  }, [filer, popup, nameOf]);
  // Taken once: a composer that remounts (a switch away and back) doesn't add the words again.
  const consumePrefill = useCallback(() => setPrefill(undefined), []);
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
  // A teammate whose conversation didn't open with its roster opens when picked.
  const unopened = ready && worker !== undefined && sessionId === undefined ? worker.id : undefined;
  useEffect(() => {
    if (unopened === undefined) return;
    let current = true;
    adapter.openConversation(unopened).then((id) => {
      if (!current || conversations.current[unopened] !== undefined) return;
      conversations.current = { ...conversations.current, [unopened]: id };
      setSessions(conversations.current);
    }, () => {});
    return () => {
      current = false;
    };
  }, [adapter, unopened]);
  // No teammate open, no panel column held for one.
  const panelShown = worker !== undefined && sessionId !== undefined;
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
      <ConnectionScreen kind="unreachable" title="Can't reach the lab" failure={unreachable} onRetry={() => setAttempt((n) => n + 1)}>
        The roster read failed. Check that the lab's server is running; this page tries again on its own.
      </ConnectionScreen>
    );
  }
  return (
    <div
      className="grid h-full grid-rows-[minmax(0,1fr)] overflow-hidden"
      style={{ gridTemplateColumns: panelShown ? "15rem minmax(0,1fr) 18rem" : "15rem minmax(0,1fr)" }}
    >
      <WorkersList
        adapter={adapter}
        workers={teammates}
        sessions={sessions}
        selected={worker?.id}
        nameOf={nameOf}
        lookOf={lookOf}
        isCoding={isCoding}
        onSelect={selectWorker}
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
          prefill={prefill?.sessionId === sessionId ? prefill : undefined}
          onPrefilled={consumePrefill}
          workers={workers}
          context={context}
          harnesses={harnesses}
          onRecheck={recheck}
          // The panel beside the conversation lists its tasks: View brings that list into sight.
          onViewTasks={() => document.getElementById("tasks-heading")?.scrollIntoView({ block: "start" })}
        />
      ) : (
        <main aria-label="Conversation" />
      )}
      {panelShown ? (
        <TeammatePanel
          // One panel per teammate: an opened group or an edit doesn't carry over to another.
          key={worker.id}
          adapter={adapter}
          worker={worker}
          sessionId={sessionId}
          openTask={popup?.kind === "task" ? popup.taskId : undefined}
          nameOf={nameOf}
          lookOf={lookOf}
          isCoding={isCoding}
          onOpen={openPopup}
        />
      ) : null}
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
      {popup ? <PopupView adapter={adapter} popup={popup} nameOf={nameOf} lookOf={lookOf} isCoding={isCoding} coders={coders} followUp={followUp} onClose={closePopup} onMissing={popup === addressed.current ? dropPopup : undefined} /> : null}
    </div>
  );
}

/** The task popup an address names, when the conversation it names is one of the teammates'. */
function taskIn(address: Address, conversations: Record<string, string>): Popup | undefined {
  if (address.session === undefined || address.task === undefined) return undefined;
  if (!Object.values(conversations).includes(address.session)) return undefined;
  return { kind: "task", sessionId: address.session, taskId: address.task };
}
