/**
 * A test double for the screen tests: an in-memory `AppCalls` that plays the
 * script on a timer. It proves the UI only, including the divider G1 will
 * place; the goal check (`goals/teammates-lab/`) proves the package. Nothing
 * in `src/` imports it.
 *
 * Three teammates, each with one conversation, and three hidden coding
 * workers, one per harness (Claude Code, Codex, Cursor). Your first ask to Lead makes it message researcher;
 * researcher looks the fact up and replies. The double files no tasks: a
 * conversation's tasks are read through the coding board view, which a test
 * serves from `stub-server.ts` or the lab's own host. Ask writer to
 * publish and it waits for your yes first. A line you send starts its own
 * turn at once, beside any the worker is answering, as the worker's door
 * (`respond`, `hold`) starts it on the server. A message from another worker
 * waits until the worker has no turn running, as the server defers it, then runs.
 * Lead's conversation starts past the 50-turn history window.
 * `failTurn` leaves a failed turn in a conversation, as an engine `error` item
 * would; Retry runs that turn's line again.
 *
 * The reads that are package views (FIX-2771: the roster, the lab's context,
 * harness readiness, busy status, the worker messages view, and a message
 * popup's session feed) and workforce's roster writes are answered by the
 * double's `client`, which the screen reads through `AppProvider`.
 */
import type { Client, SessionConnectionStatus } from "@flow-state-dev/client";
import { createElement, type ReactNode } from "react";
import { CODER_FLOW } from "@flow-state-dev/harness-manager/browser";
import { isOpenMessage, RECEIVED_MESSAGE_DATA_TYPE, SEND_MESSAGE_TOOL, type RosterEntry, type WorkerMessageResourceState } from "@flow-state-dev/workforce/browser";
import {
  AppProvider,
  type ConversationEntry,
  type AppCalls,
  type Unsubscribe,
  type WindowMark,
} from "../src/app";

/** A worker as the double keeps it: what its roster row says, flattened. */
type FixtureTeammate = { id: string; name: string; role: string; takesTasks?: boolean; own?: boolean; edited?: boolean; harness?: string; icon?: string; color?: string };

/** A message in the double's log: what the screen reads of a log row. */
type AppTalk = { id: string; from: string; to: string; text: string; inReplyTo?: string; replyRequested?: boolean; at: number };

/** How the double keeps time, and what it plays. */
export interface FixtureOptions {
  /** Multiplies every delay. 1 is real time; tests pass a small number. */
  speed?: number;
  /** The clock, in ms. */
  now?: () => number;
  /** Turns past the window are summarized for the worker, not dropped. */
  summary?: boolean;
  /** How many roster view reads fail as an unreachable server would, before one lands. */
  unreachableReads?: number;
}

/** The fixture, plus what a test does to its server. */
export interface FixtureApp extends AppCalls {
  /**
   * The client the screen's package hooks read through: it answers the roster,
   * lab-context, readiness, worker sessions, session turns and worker messages
   * views, workforce's roster writes, and a session's items for a message popup.
   */
  client: Client;
  /** Another tab's hire: a teammate of the user's own on the roster. */
  hire(teammate: { name: string; role: string; instructions: string }): Promise<{ id: string }>;
  /** Another tab's fire of one of the user's own teammates. */
  fire(worker: string): Promise<void>;
  /** The roster as a client's roster view reads it now. */
  roster(): RosterEntry[];
  /** Each roster write the screen sent through workforce's client, in order: its action and input. */
  readonly rosterWrites: { action: string; input: Record<string, unknown> }[];
  /** Every conversation's feed reports `state` from now on. */
  setConnection(state: SessionConnectionStatus): void;
  /** The newest turn of conversation `sessionId` failed with `reason`: a reply under way is left incomplete. */
  failTurn(sessionId: string, reason: string): void;
  /** Each `retry` the screen made, in order. */
  readonly retries: { sessionId: string; requestId: string }[];
  /** The next line's turn fails at its model call with `reason`, before any reply: the contract tests' failed turn. */
  failNextTurn(reason: string): void;
  /** The next Stop is refused while its turn runs on, as a server that resumed the turn first refuses it. */
  refuseNextStop(): void;
}

/** How many turns a worker reads word for word: the agent flow's default. */
const WINDOW_TURNS = 50;
const MINUTE = 60_000;

const ROSTER: FixtureTeammate[] = [
  { id: "teammates.chief-of-staff", name: "Lead", icon: "★", color: "amber", role: "Plans the launch with you, and asks the other workers when it needs a fact or a draft." },
  { id: "teammates.researcher", name: "researcher", icon: "🔎", color: "teal", role: "Finds facts for the team, and replies to whoever asked." },
  { id: "teammates.writer", name: "writer", icon: "✎", color: "violet", role: "Drafts and tightens copy when you or another worker asks." },
  { id: "teammates.claude-code", name: "Claude Code", role: "Runs coding tasks on Claude Code.", takesTasks: true, harness: "claude-code" },
  { id: "teammates.codex", name: "Codex", role: "Runs coding tasks on Codex.", takesTasks: true, harness: "codex" },
  { id: "teammates.cursor", name: "Cursor", role: "Runs coding tasks on Cursor.", takesTasks: true, harness: "cursor" },
];
const LEAD = "teammates.chief-of-staff";
const RESEARCHER = "teammates.researcher";
const WRITER = "teammates.writer";

type Job = { kind: "user"; entryId: string; text: string } | { kind: "receive"; message: AppTalk };

/** One running turn: its last entry so far, and whether it still runs (a stopped one's steps do nothing). */
interface FixtureTurn {
  live: boolean;
  /** Its latest entry's id: a stopped line goes after it, as the real adapter places one. */
  last?: string;
}

interface FixtureWorker {
  row: FixtureTeammate;
  sessionId: string;
  entries: ConversationEntry[];
  /** The turns running now: a line you send starts one beside the others. */
  turns: FixtureTurn[];
  lastActiveAt: number;
  /** Messages and results the server defers: each waits until no turn runs. */
  deferred: Job[];
  /** A Stop is under way: from the press until the turn has ended, as the real adapter reads it. */
  stopping?: boolean;
}

/** A scripted step: wait, then run. */
type Step = [delayMs: number, run: () => void];

/** Planning chatter for Lead's older turns. */
const OLDER_TURNS: [string, string][] = [
  ["Who is the post for?", "Teams that sync files across offices. I'd write for whoever sets it up."],
  ["List the launch channels.", "The blog, the changelog, and the newsletter a day later."],
  ["What's the one line pitch?", "Relay keeps every office's files in step, without a server to run."],
  ["Remind me of the beta numbers.", "212 teams, and setup took a median of 4 minutes."],
  ["Which customer quote should we use?", "Dana at Northwind: \"We stopped emailing files the first week.\""],
  ["Do we need a demo video?", "A 40-second clip of the setup. Writer can script it later."],
];

/** The double. */
export function createFixtureApp(options: FixtureOptions = {}): FixtureApp {
  const speed = options.speed ?? 1;
  const now = options.now ?? (() => Date.now());
  const listeners = new Set<() => void>();
  const log: AppTalk[] = [];
  let seq = 0;
  const nextId = (prefix: string) => `${prefix}-${++seq}`;
  /** Files the composer uploaded, by id: what `readFile` serves. */
  const uploads = new Map<string, Blob>();

  const workers = new Map<string, FixtureWorker>(
    ROSTER.map((row) => [row.id, { row, sessionId: `conversation:${row.id}`, entries: [], turns: [], lastActiveAt: now(), deferred: [] }]),
  );
  const worker = (id: string): FixtureWorker => {
    const found = workers.get(id);
    if (!found) throw new Error(`no worker ${id}`);
    return found;
  };
  const bySession = (sessionId: string) => [...workers.values()].find((w) => w.sessionId === sessionId);
  const fired = new Set<string>();
  let unreachable = options.unreachableReads ?? 0;
  let connection: SessionConnectionStatus = "live";
  let failNext: string | undefined;
  let refuseStop = false;
  /** The worker each open approval belongs to, by suspension id. */
  const approvals = new Map<string, FixtureWorker>();

  const notify = () => {
    for (const listener of [...listeners]) listener();
  };
  const watch = (emit: () => void): Unsubscribe => {
    listeners.add(emit);
    emit();
    return () => listeners.delete(emit);
  };

  /** The turn whose step is running now, so an entry it pushes is counted as its. */
  let active: FixtureTurn | undefined;

  const push = (w: FixtureWorker, entry: ConversationEntry) => {
    w.entries = [...w.entries, entry];
    if (active !== undefined) active.last = entry.id;
    notify();
  };

  const say = (w: FixtureWorker, text: string): Step[1] => () => push(w, { kind: "assistant", id: nextId("a"), text });

  /** An answer written word by word, as a streamed send draws it: the same entry, growing, then finished. */
  const sayStreamed = (w: FixtureWorker, text: string): Step[1] => () => {
    const id = nextId("a");
    const words = text.split(" ");
    const draw = (count: number) => {
      const entry: ConversationEntry = { kind: "assistant", id, text: words.slice(0, count).join(" "), ...(count < words.length ? { streaming: true } : {}) };
      const at = w.entries.findIndex((e) => e.id === id);
      w.entries = at < 0 ? [...w.entries, entry] : w.entries.map((e, i) => (i === at ? entry : e));
      notify();
      if (count < words.length) setTimeout(() => draw(count + 1), 60 * speed);
    };
    draw(1);
  };

  /**
   * `sendMessage`: a card in the sender's conversation, a row in the log, and a
   * `receive` deferred for the recipient. A send that isn't an answer asks for one.
   */
  const sendMessage = (w: FixtureWorker, to: string, text: string, inReplyTo?: string): Step[1] => () => {
    const message: AppTalk = { id: nextId("m"), from: w.row.id, to, text, inReplyTo, ...(inReplyTo ? {} : { replyRequested: true }), at: now() };
    push(w, { kind: "sent", id: nextId("s"), messageId: message.id, to, text });
    log.push(message);
    const recipient = worker(to);
    recipient.deferred.push({ kind: "receive", message });
    notify();
    startDeferred(recipient);
  };

  const script = (w: FixtureWorker, job: Job): Step[] => {
    if (job.kind === "receive") {
      const { message } = job;
      const from = worker(message.from).row.name;
      if (message.inReplyTo) return [[900, say(w, `${from} answered: "${message.text}" I've worked it into the plan.`)]];
      if (w.row.id === RESEARCHER) {
        return [[700, say(w, "Looking it up in the plan doc.")], [4000, sendMessage(w, message.from, "Nov 12, per the plan doc.", message.id)]];
      }
      return [[700, say(w, "On it.")], [2000, sendMessage(w, message.from, "Done. It's in the doc.", message.id)]];
    }
    // writer waits for your yes before it publishes: `suspendForUser` with an approval.
    if (w.row.id === WRITER && /\bpublish\b/i.test(job.text)) {
      const suspensionId = nextId("sus");
      approvals.set(suspensionId, w);
      return [[600, () => push(w, { kind: "approval", id: nextId("ap"), requestId: nextId("req"), suspensionId, text: "Publish the draft to the team page?" })]];
    }
    // A long turn, as the contract's stop scenarios ask: work that runs until it is stopped.
    if (w.row.id === LEAD && /\bboth modules\b/i.test(job.text)) return [[30_000, say(w, "Written up.")]];
    if (w.row.id === LEAD && /\bmeanwhile\b/i.test(job.text)) return [[30_000, say(w, "Drafted.")]];
    // A long answer, written word by word, as a streamed send draws it.
    if (w.row.id === LEAD && /\bwalk me through\b/i.test(job.text)) {
      return [[800, sayStreamed(w, "Here is the plan for the post, part by part, so each part has one job. That is the whole plan.")]];
    }
    if (w.row.id === LEAD && !log.some((m) => m.from === LEAD && m.to === RESEARCHER)) {
      return [
        [800, say(w, "Asking researcher now. An outline:\n1 · the problem\n2 · what ships\n3 · how to try it")],
        [600, sendMessage(w, RESEARCHER, "What's our launch date?")],
      ];
    }
    // Lead thinks longer than researcher looks a fact up, so a reply can arrive while you talk to Lead.
    return [[w.row.id === LEAD ? 6000 : 900, say(w, `Noted: "${job.text}" I've folded it into the plan.`)]];
  };

  /** A turn for `job`, started now, beside any already running. */
  const startTurn = (w: FixtureWorker, job: Job) => {
    const t: FixtureTurn = { live: true };
    w.turns = [...w.turns, t];
    w.lastActiveAt = now();
    if (job.kind === "user") {
      t.last = job.entryId;
    } else {
      const { message } = job;
      t.last = nextId("r");
      w.entries = [...w.entries, { kind: "received", id: t.last, messageId: message.id, from: message.from, text: message.text, inReplyTo: message.inReplyTo }];
    }
    notify();
    let at = 0;
    // The next line's turn fails before any reply: its failed line, then the turn ends.
    const failed = failNext !== undefined && job.kind === "user" ? failNext : undefined;
    if (failed !== undefined) failNext = undefined;
    const steps: Step[] = failed !== undefined ? [[0, () => fake.failTurn(w.sessionId, failed)]] : script(w, job);
    for (const [delay, run] of [...steps, [200, () => endTurn(w, t)] as Step]) {
      at += delay;
      setTimeout(() => {
        if (!t.live) return;
        active = t;
        try {
          run();
        } finally {
          active = undefined;
        }
      }, at * speed);
    }
  };

  /** The next deferred message or result, once the worker has no turn running. */
  const startDeferred = (w: FixtureWorker) => {
    if (w.turns.length > 0) return;
    const job = w.deferred.shift();
    if (job) startTurn(w, job);
  };

  const endTurn = (w: FixtureWorker, t: FixtureTurn) => {
    t.live = false;
    w.turns = w.turns.filter((other) => other !== t);
    w.lastActiveAt = now();
    notify();
    startDeferred(w);
  };

  // Seed: Lead's conversation runs two turns past the window, with an exchange with writer near its end.
  const seed = (w: FixtureWorker, entries: ConversationEntry[], lastActiveAt: number) => {
    w.entries = entries;
    w.lastActiveAt = lastActiveAt;
  };
  const exchange = (from: string, to: string, text: string, ago: number, inReplyTo?: string): AppTalk => {
    const message = { id: nextId("m"), from, to, text, inReplyTo, at: now() - ago };
    log.push(message);
    return message;
  };
  const user = (text: string): ConversationEntry => ({ kind: "user", id: nextId("u"), text });
  const assistant = (text: string): ConversationEntry => ({ kind: "assistant", id: nextId("a"), text });
  const sent = (m: AppTalk): ConversationEntry => ({ kind: "sent", id: nextId("s"), messageId: m.id, to: m.to, text: m.text });
  const received = (m: AppTalk): ConversationEntry => ({
    kind: "received",
    id: nextId("r"),
    messageId: m.id,
    from: m.from,
    text: m.text,
    inReplyTo: m.inReplyTo,
  });

  const older: ConversationEntry[] = [
    user("I'm planning the launch of Relay, our sync tool. The post goes on our blog first, never social first."),
    assistant("Got it: Relay, blog first. I'll hold every plan to that."),
  ];
  for (let turn = 2; turn <= 48; turn++) {
    const [ask, answer] = OLDER_TURNS[(turn - 2) % OLDER_TURNS.length];
    older.push(user(ask), assistant(answer));
  }
  const w1 = exchange(LEAD, WRITER, "Can you draft the changelog intro? About 120 words.", 3 * 60 * MINUTE);
  const w2 = exchange(WRITER, LEAD, "Draft is in the doc: 120 words.", 2.5 * 60 * MINUTE, w1.id);
  const w3 = exchange(LEAD, WRITER, "Tighten it to 80 words?", 2.4 * 60 * MINUTE, w2.id);
  const w4 = exchange(WRITER, LEAD, "Done: 78 words.", 2 * 60 * MINUTE, w3.id);
  seed(
    worker(LEAD),
    [
      ...older,
      user("Get writer started on the changelog intro."),
      assistant("Asking writer."),
      sent(w1),
      received(w2),
      assistant("Writer's draft is in. I asked for a tighter one."),
      sent(w3),
      received(w4),
      assistant("The changelog intro is ready at 78 words."),
      user("Good. What's left before launch?"),
      assistant("The launch post, and the date. Researcher can confirm the date."),
    ],
    now() - 90 * MINUTE,
  );
  seed(
    worker(RESEARCHER),
    [user("What did the beta survey say about setup time?"), assistant("A median of 4 minutes, from the March survey.")],
    now() - 40 * MINUTE,
  );
  seed(
    worker(WRITER),
    [received(w1), assistant("Drafting it now."), sent(w2), received(w3), assistant("Tightening."), sent(w4)],
    now() - 2 * 60 * MINUTE,
  );

  const retries: { sessionId: string; requestId: string }[] = [];

  // Workforce's roster writes and reads, as its roster flow answers them.
  const rosterEntries = (): RosterEntry[] =>
    [...workers.values()].filter((w) => !fired.has(w.row.id)).map(({ row }) => ({
      id: row.id,
      flow: row.takesTasks ? CODER_FLOW : "agent",
      standard: row.own !== true,
      description: row.role,
      name: row.name,
      teamName: null,
      forkedFrom: null,
      edited: row.edited === true,
      settings: { ...(row.harness === undefined ? {} : { harness: row.harness }), ...(row.icon === undefined ? {} : { icon: row.icon }), ...(row.color === undefined ? {} : { color: row.color }) },
    }));
  const hire = ({ id, description }: { id: string; description?: string }) => {
    if (workers.has(id) && !fired.has(id)) throw new Error(`"${id}" is already on your roster`);
    workers.set(id, { row: { id, name: id, role: description ?? "", own: true }, sessionId: `conversation:${id}`, entries: [], turns: [], lastActiveAt: now(), deferred: [] });
    fired.delete(id);
    notify();
    return { id, flow: "agent" };
  };
  // As the workforce's edit: a file's teammate becomes the user's copy, under the same id; a null name clears it.
  const edit = ({ id, name }: { id: string; name?: string | null }) => {
    const w = worker(id);
    if (name !== undefined) w.row = { ...w.row, name: name === null ? id.slice(id.lastIndexOf(".") + 1) : name };
    if (!w.row.own) w.row = { ...w.row, edited: true };
    notify();
    return { id, flow: "agent" };
  };
  const reset = (id: string) => {
    const w = worker(id);
    const file = ROSTER.find((row) => row.id === id);
    if (file === undefined) throw new Error(`"${id}" isn't a standard worker`);
    if (!w.row.edited) throw new Error(`You haven't edited "${id}"`);
    w.row = file;
    notify();
    return { id };
  };
  const fire = (id: string) => {
    if (!worker(id).row.own) throw new Error(`"${id}" is a standard worker`);
    // Its conversation stays readable, so it keeps its place here and leaves the roster.
    fired.add(id);
    notify();
    return { id };
  };
  /** A log row as the worker messages view answers it: delivered once its recipient's conversation read it, answered once a reply names it. */
  const logEntry = (m: AppTalk): WorkerMessageResourceState => {
    const answer = log.find((r) => r.inReplyTo === m.id);
    const read = worker(m.to).entries.some((e) => e.kind === "received" && e.messageId === m.id);
    return {
      id: m.id, from: m.from, to: m.to, text: m.text, exchange: m.id, at: m.at, hop: 1, status: read ? "delivered" : "unconfirmed",
      fromSession: worker(m.from).sessionId, fromFlow: "agent", toSession: worker(m.to).sessionId, toFlow: "agent",
      ...(m.inReplyTo === undefined ? {} : { inReplyTo: m.inReplyTo }),
      ...(m.replyRequested === true ? { replyRequested: true as const } : {}),
      ...(answer === undefined ? {} : { answeredBy: answer.id }),
    };
  };
  /** The worker messages view: the worker's open messages, by the view's own rule (`isOpenMessage`), and each id's row and answer. */
  const workerMessages = ({ worker: id, ids = [] }: { worker: string; ids?: string[] }) =>
    log
      .map(logEntry)
      .filter((m) => ((m.from === id || m.to === id) && isOpenMessage(m)) || ids.includes(m.id) || (m.inReplyTo !== undefined && ids.includes(m.inReplyTo)))
      .sort((a, b) => a.at - b.at);
  /** A session's items as the server stores them, for a message popup's feed: a turn starts at your line or a received message. */
  const itemsOf = (sessionId: string) => {
    let requestId = "turn-0";
    return (bySession(sessionId)?.entries ?? []).flatMap((e, i): Record<string, unknown>[] => {
      if (e.kind === "user" || e.kind === "received") requestId = `turn-${e.id}`;
      const at = { id: e.id, requestId, itemIndex: i, ts: i + 1, status: "completed" };
      if (e.kind === "received") return [{ ...at, type: "data", dataType: RECEIVED_MESSAGE_DATA_TYPE, value: { id: e.messageId, text: e.text } }];
      if (e.kind === "assistant") return [{ ...at, type: "message", role: "assistant", status: e.streaming ? "in_progress" : "completed", content: [{ type: "output_text", text: e.text }] }];
      if (e.kind === "sent") return [{ ...at, type: "tool_output", toolCall: { name: SEND_MESSAGE_TOOL, arguments: JSON.stringify({ to: e.to, text: e.text }) }, output: { sent: e.messageId } }];
      return [];
    });
  };
  const rosterWrites: FixtureApp["rosterWrites"] = [];
  const VIEWS: Record<string, (input: any) => unknown> = {
    roster: () => {
      if (unreachable > 0) {
        unreachable -= 1;
        throw new TypeError("fetch failed");
      }
      return rosterEntries();
    },
    context: () => ({ folder: "/work/launch-site", folderProblem: null, model: "openai/gpt-6-luna", harness: "cursor", delegates: { [LEAD]: "all" as const } }),
    readiness: () => [
      { harness: "claude-code", label: "Claude Code", ready: true, reason: null, remedy: null, unanswered: false },
      { harness: "codex", label: "Codex", ready: false, reason: "Codex has no credential", remedy: "Run `codex login`", unanswered: false },
      { harness: "cursor", label: "Cursor", ready: true, reason: null, remedy: null, unanswered: false },
    ],
    // Only a teammate has a conversation; it runs while a turn of its does.
    workerSessions: ({ worker: id }) => {
      const w = workers.get(id);
      return w === undefined || w.row.takesTasks ? [] : [{ id: w.sessionId, title: "Untitled", worker: id, updatedAt: w.lastActiveAt, running: w.turns.length > 0, state: {}, isDefault: true, waiting: [] }];
    },
    // Its last turn: running now, or ended when it was last active.
    sessionTurns: ({ sessionId }) => {
      const w = bySession(sessionId);
      if (w === undefined) return [];
      const running = w.turns.length > 0;
      return [{ id: `turn:${w.lastActiveAt}`, action: "respond", status: running ? "in_progress" : "completed", source: "user", startedAt: w.lastActiveAt, completedAt: running ? null : w.lastActiveAt, endedAt: running ? null : w.lastActiveAt, error: null }];
    },
    workerMessages,
    // The double files no tasks: each conversation's coding board is empty (a test serves rows from `stub-server.ts`).
    codingBoard: () => [],
  };
  const client = {
    userId: "you",
    async view(ref: { view: string }, input: unknown) {
      const answer = VIEWS[ref.view];
      if (answer === undefined) throw new Error(`the double serves no view "${ref.view}"`);
      return { value: answer(input ?? {}), topics: [] };
    },
    // Every change the double makes is a notice to every live read, one per turn of the event loop however many
    // changes it holds, as a socket delivers them; subscribing reads nothing by itself.
    subscribe(_topics: unknown, options: { onChange: (notice: null) => void }) {
      let due = false;
      const heard = () => {
        if (due) return;
        due = true;
        setTimeout(() => {
          due = false;
          options.onChange(null);
        }, 0);
      };
      listeners.add(heard);
      return { close: () => void listeners.delete(heard) };
    },
    resource: () => ({
      async send(action: string, input: any) {
        rosterWrites.push({ action, input });
        if (action === "hire") return hire(input);
        if (action === "edit") return edit(input);
        if (action === "reset") return reset(input.id);
        if (action === "fire") return fire(input.id);
        throw new Error(`the double has no roster action "${action}"`);
      },
    }),
    sessions: {
      async state(sessionId: string) {
        const items = itemsOf(sessionId);
        return { items, at: items.length, sessionCreatedAt: 1, pagination: { offset: 0, limit: 200, total: items.length, hasMore: false } };
      },
      stream(sessionId: string, handlers: { onItem: (event: { item: unknown }) => void; onRuns?: (event: { runs: unknown[] }) => void }) {
        queueMicrotask(() => handlers.onRuns?.({ runs: [] }));
        const heard = () => itemsOf(sessionId).forEach((item) => handlers.onItem({ item }));
        listeners.add(heard);
        return { close: () => void listeners.delete(heard) };
      },
    },
  } as unknown as Client;

  const fake: FixtureApp = {
    refuseNextStop() {
      refuseStop = true;
    },
    failNextTurn(reason) {
      failNext = reason;
    },
    setConnection(state) {
      connection = state;
      notify();
    },
    retries,
    failTurn(sessionId, reason) {
      const w = bySession(sessionId);
      if (!w) throw new Error(`no conversation ${sessionId}`);
      // The turn's line names it, so Retry can run it again; an older failure is no longer the newest turn.
      const line = [...w.entries].reverse().find((e) => e.kind === "user");
      const last = w.entries[w.entries.length - 1];
      w.entries = w.entries.map((e) =>
        e.kind === "failed" ? { ...e, retryable: false } : e === last && e.kind === "assistant" ? { kind: "assistant", id: e.id, text: e.text, incomplete: true } : e,
      );
      push(w, { kind: "failed", id: nextId("f"), requestId: `turn-${line?.id ?? nextId("r")}`, reason, retryable: true });
    },
    async retry(sessionId, requestId) {
      retries.push({ sessionId, requestId });
      const w = bySession(sessionId);
      const line = w?.entries.find((e) => e.kind === "user" && `turn-${e.id}` === requestId);
      if (!w || line?.kind !== "user") throw new Error(`No failed turn "${requestId}" to retry.`);
      w.entries = w.entries.map((e) => (e.kind === "failed" ? { ...e, retryable: false } : e));
      startTurn(w, { kind: "user", entryId: line.id, text: line.text });
    },

    async openConversation(workerId) {
      return worker(workerId).sessionId;
    },

    async send(sessionId, text, attachments = []) {
      const w = bySession(sessionId);
      if (!w) throw new Error(`no conversation ${sessionId}`);
      const entryId = nextId("u");
      push(w, { kind: "user", id: entryId, text, ...(attachments.length > 0 ? { files: [...attachments] } : {}) });
      // Its own turn, at once, beside any running: the door is `hold`.
      startTurn(w, { kind: "user", entryId, text });
    },

    // A stored file is its reference; the bytes are the picked file's, kept here for its thumbnail.
    async upload({ data, mediaType, filename }) {
      const id = `b_${String(uploads.size + 1).padStart(8, "0")}`;
      uploads.set(id, data);
      return { type: "file" as const, data: `fsd-blob:${id}`, mediaType: mediaType ?? data.type, ...(filename === undefined ? {} : { filename }) };
    },

    async readFile(file) {
      const found = uploads.get(file.data.replace(/^fsd-blob:/, ""));
      if (found === undefined) throw new Error(`${file.filename ?? "file"} was never uploaded`);
      return found;
    },

    async interrupt(sessionId) {
      const w = bySession(sessionId);
      if (w === undefined || w.turns.length === 0) return;
      if (refuseStop) {
        refuseStop = false;
        throw new Error("The turn went on before the stop reached it. Press Stop again.");
      }
      // The turns answering at the press; a line sent after it is its own turn, and runs on.
      const pressed = [...w.turns];
      for (const t of pressed) t.live = false;
      // As the real adapter draws it: stopping until the turns have ended, then each one's stopped line after its last entry.
      w.stopping = true;
      notify();
      setTimeout(() => {
        w.stopping = false;
        for (const t of pressed) {
          const requestId = nextId("req");
          const line: ConversationEntry = { kind: "stopped", id: `stopped:${requestId}`, requestId };
          const at = w.entries.findIndex((e) => e.id === t.last);
          w.entries = at < 0 ? [...w.entries, line] : [...w.entries.slice(0, at + 1), line, ...w.entries.slice(at + 1)];
          endTurn(w, t);
        }
      }, 50 * speed);
    },

    watchConversation(sessionId, onChange) {
      return watch(() => {
        const w = bySession(sessionId);
        if (!w) return;
        // The real adapter's count is the conversation's unfinished runs: the double runs none in the background.
        onChange({ entries: w.entries, running: w.turns.length > 0, stopping: w.stopping === true, backgroundRunning: 0 });
      });
    },

    watchConnection(_sessionId, onChange) {
      return watch(() => onChange(connection));
    },

    async answerApproval(_sessionId, { suspensionId }, approve) {
      const w = approvals.get(suspensionId);
      if (!w) throw new Error(`no approval ${suspensionId}`);
      approvals.delete(suspensionId);
      w.entries = w.entries.map((e) => (e.kind === "approval" && e.suspensionId === suspensionId ? { ...e, resolution: approve ? "approved" : "rejected" } : e));
      say(w, approve ? "Published." : "Left it unpublished.")();
    },

    watchWindow(sessionId, onChange) {
      return watch(() => {
        const w = bySession(sessionId);
        // Stands in for the history window's mark (G1). A turn starts at your line or at a received message.
        const starts = (w?.entries ?? []).filter((e) => e.kind === "user" || e.kind === "received");
        const mark: WindowMark | undefined =
          starts.length > WINDOW_TURNS ? { firstVerbatimEntryId: starts[starts.length - WINDOW_TURNS].id, summarized: options.summary ?? false } : undefined;
        onChange(mark);
      });
    },

    client,
    hire: async ({ name, role }) => hire({ id: name, description: role }),
    fire: async (workerId) => void (await fire(workerId)),
    roster: () => rosterEntries(),
    close: () => {},
    rosterWrites,

  };
  return fake;
}

/**
 * `AppProvider` over a double's calls and its client: a test's calls spread
 * from a double keep its `client`; ones that hold none read through a client
 * that answers nothing, for a screen that reads no package view.
 */
export function FixtureProvider({ calls, client, children }: { calls: AppCalls; client?: Client; children?: ReactNode }) {
  const held = (calls as Partial<FixtureApp>).client;
  return createElement(AppProvider, { calls, client: client ?? held ?? NO_CLIENT }, children);
}

/**
 * `lab`'s client with its roster view reads answered by `answer`, given the
 * read's number (from 1) and the double's own read: a server that is down, or
 * slow, for the roster alone.
 */
export function rosterReadsBy(lab: FixtureApp, answer: (call: number, read: () => Promise<unknown>) => Promise<unknown>): Client {
  let calls = 0;
  const view = (ref: { view: string }, input: unknown, options?: unknown) =>
    ref.view === "roster" ? answer(++calls, () => lab.client.view(ref as never, input as never, options as never)) : lab.client.view(ref as never, input as never, options as never);
  return { ...lab.client, view } as unknown as Client;
}

/** A roster row as workforce's roster view answers it, for a screen drawn without the double: a standard teammate on the agent flow unless `fields` say otherwise. */
export const rosterEntry = (fields: Partial<RosterEntry> & { id: string }): RosterEntry => ({
  flow: "agent", standard: true, description: null, name: null, teamName: null, forkedFrom: null, edited: false, settings: {}, ...fields,
});

/** A client with nothing behind it: every read waits. */
const NO_CLIENT = {
  userId: "you",
  view: () => new Promise(() => {}),
  subscribe: () => ({ close: () => {} }),
  sessions: { state: () => new Promise(() => {}), stream: () => ({ close: () => {} }) },
} as unknown as Client;
