import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { harnessReadinessViewRef } from "@flow-state-dev/harness-manager/browser";
import { useView } from "@flow-state-dev/react";
import type { HireWorkerInput, RosterEntry } from "@flow-state-dev/workforce/browser";
import { appContextView } from "../../flows/lab-context-ref.mts";
import { ConversationFollower, useAppClient, useConversationCalls } from "../app";
import { Conversation } from "./Conversation";
import { KeysSheet } from "./KeysSheet";
import { PopupView, type FollowUp, type Popup } from "./Popups";
import { Switcher } from "./Switcher";
import { TeammatePanel } from "./TeammatePanel";
import { WorkersList } from "./WorkersList";
import { ConnectionScreen, type ConnectionFailure } from "./flow-state/connection-screen";
import type { HarnessReadinessChipRow } from "./flow-state/harness-readiness";
import { readAddress, writeAddress, type Address, type AddressWrite } from "../lib/address";
import { focusComposer, focusWhenDrawn, useAppKeys } from "../lib/keys";
import { lookOf as lookOfRow } from "../lib/looks";
import { displayName, settingOf, takesTasks, useWorkforce } from "../lib/roster";

/**
 * The screen: the teammates on the left, the chosen teammate's one
 * conversation in the center, and its panel on the right: who it is, and the
 * tasks its conversation filed. Coding is a background task, not a teammate:
 * the worker coding tasks run on is off the list, and each coding task is a
 * row in the panel of the teammate that started it.
 * A task or a message between workers, and a coding task, opens in a popup
 * over the conversation, read only and live. The app opens on the first teammate,
 * unless the page's address names what was open (`lib/address`): a reload, a
 * link and Back reopen the teammate and the task popup.
 *
 * The list follows the roster (workforce's `watchRoster`, over its roster
 * view): a hire, an edit or a fire,
 * made here, in another tab or by a worker's turn, shows without a reload. A
 * first read that fails draws the registry's `connection-screen`, which
 * watches again on its own until a read lands. Once the screen is up, a conversation's feed that
 * loses the server draws `connection-banner` over it and greys the status
 * lines drawn from that feed.
 *
 * Keys (`useAppKeys`): ⌘K switches to any teammate or hires one, Alt+↑/↓
 * steps through the teammates, `/` puts the cursor in the composer, `?` lists
 * the keys. Opening a teammate, however it is opened, puts the cursor in its
 * composer.
 */

// FIX-2624.
/** The harness kit's readiness view, on the flow it serves it on, read by scope with no session. */
const READINESS_VIEW = harnessReadinessViewRef("harnesses");

/** What `?` lists: every key the lab has. */
const KEYS = [
  ["⌘K / Ctrl+K", "Switch to any teammate, or hire one"],
  ["Alt+↑ / Alt+↓", "The previous or next teammate"],
  ["/", "Put the cursor in the composer"],
  ["?", "This list"],
  ["Enter", "Send, in the composer"],
  ["Esc", "Close a dialog"],
] as const;
/**
 * A failed roster read as the connection screen shows it: a status the server answered with, read off the error
 * itself, apart from a dead socket, which has none.
 */
function failureOf(error: unknown): ConnectionFailure {
  const message = error instanceof Error ? error.message : String(error);
  const status = (error as { status?: unknown } | null)?.status;
  return typeof status === "number" ? { httpStatus: status, message } : { message };
}

export function App() {
  const calls = useConversationCalls();
  const { client, pollIntervalMs } = useAppClient();
  const workforce = useWorkforce();
  const [workers, setWorkers] = useState<RosterEntry[]>([]);
  const [sessions, setSessions] = useState<Record<string, string>>({});
  const [selected, setSelected] = useState<string>();
  // A task or a message, open in a popup over the conversation.
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
  const landedTalking = useRef<RosterEntry[]>([]);
  const waitingPick = useRef<((talking: RosterEntry[]) => boolean) | null>(null);
  const pickWhenLanded = (pick: (talking: RosterEntry[]) => boolean) => {
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
    const stop = workforce.watchRoster((roster) => {
      const mine = ++latest;
      const talking = roster.filter((w) => !takesTasks(w));
      Promise.allSettled(talking.map((w) => calls.open(w.id))).then((opened) => {
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
    }, { onError: failed });
    return () => {
      current = false;
      stop();
    };
  }, [calls, workforce, attempt]);

  // The watch brings the new row and its conversation; the pick waits for them.
  // What the lab works on and with (its context view), and which harnesses can run (the harness kit's readiness view);
  // Re-check reads readiness again, checked anew.
  const context = useView(appContextView, {}, { client, pollIntervalMs }).value;
  const readiness = useView(READINESS_VIEW, {}, { client, pollIntervalMs });
  const [rechecked, setRechecked] = useState<HarnessReadinessChipRow[]>();
  // A failed read draws no chips rather than "checking" forever.
  const harnesses = rechecked ?? readiness.value ?? (readiness.stale ? [] : undefined);
  const recheck = async () => setRechecked((await client.view(READINESS_VIEW, { refresh: true })).value);

  const hire = async (teammate: HireWorkerInput) => {
    const hired = await workforce.hire(teammate);
    pickWhenLanded((talking) => {
      if (!talking.some((w) => w.id === hired.id)) return false;
      selectWorker(hired.id);
      return true;
    });
  };
  const fire = async (worker: string) => {
    await workforce.fire(worker);
    pickWhenLanded((talking) => {
      if (talking.some((w) => w.id === worker)) return false;
      setSelected(talking[0]?.id);
      return true;
    });
  };

  // Stable between roster reads, so a memoized entry doesn't redraw for a new function.
  const nameOf = useCallback((id: string) => {
    const found = workers.find((w) => w.id === id);
    return found === undefined ? id : displayName(found);
  }, [workers]);
  const isCoding = useCallback((id: string) => workers.some((w) => w.id === id && takesTasks(w)), [workers]);
  const lookOf = useCallback((id: string) => {
    const found = workers.find((w) => w.id === id);
    return lookOfRow(found === undefined ? { id, name: id } : { id, name: displayName(found), icon: settingOf(found, "icon"), color: settingOf(found, "color") });
  }, [workers]);
  const teammates = workers.filter((w) => !takesTasks(w));
  const coders = useMemo(() => workers.filter(takesTasks), [workers]);
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
  // Counts every follow-up, so a composer that stayed open never mistakes a new one for the one it took.
  const followUps = useRef(0);
  // Who filed the open task: the worker whose conversation it is, when that conversation is on the roster.
  const filer = popup?.kind === "task" ? Object.entries(sessions).find(([, session]) => session === popup.sessionId)?.[0] : undefined;
  const followUp = useMemo<FollowUp | undefined>(() => {
    if (filer === undefined || popup?.kind !== "task") return undefined;
    const session = popup.sessionId;
    return {
      name: nameOf(filer),
      start: (text) => {
        how.current = "push";
        setPopup(undefined);
        setSelected(filer);
        followUps.current += 1;
        setPrefill({ sessionId: session, text, n: followUps.current });
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
    calls.open(unopened).then((id) => {
      if (!current || conversations.current[unopened] !== undefined) return;
      conversations.current = { ...conversations.current, [unopened]: id };
      setSessions(conversations.current);
    }, () => {});
    return () => {
      current = false;
    };
  }, [calls, unopened]);
  // No teammate open, no panel column held for one.
  const panelShown = worker !== undefined && sessionId !== undefined;
  useAppKeys({
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
      {/* One follower per conversation: every screen on it reads what it read. */}
      {Object.values(sessions).map((id) => (
        <ConversationFollower key={id} sessionId={id} />
      ))}
      <WorkersList
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
          worker={worker}
          sessionId={sessionId}
          nameOf={nameOf}
          lookOf={lookOf}
          isCoding={isCoding}
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
      {popup ? <PopupView popup={popup} nameOf={nameOf} lookOf={lookOf} isCoding={isCoding} coders={coders} followUp={followUp} onClose={closePopup} onMissing={popup === addressed.current ? dropPopup : undefined} /> : null}
    </div>
  );
}

/** The task popup an address names, when the conversation it names is one of the teammates'. */
function taskIn(address: Address, conversations: Record<string, string>): Popup | undefined {
  if (address.session === undefined || address.task === undefined) return undefined;
  if (!Object.values(conversations).includes(address.session)) return undefined;
  return { kind: "task", sessionId: address.session, taskId: address.task };
}
