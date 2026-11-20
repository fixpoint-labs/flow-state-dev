/**
 * A stand-in for the lab's server at the client, for the screen tests: an
 * in-memory world that plays a script on a timer and answers only what the
 * packages read and write (workforce's roster, sessions, session turns and
 * worker messages views and its roster writes; a session's state, stream and
 * requests; the worker flow's door, aborts, retries and answers; uploads and
 * a file's bytes). It stores items, as the server does, so every line the
 * screen draws goes through `src/app/`'s hooks and the real client: nothing
 * here draws an entry. The goal check (`goals/teammates-lab/`) and the
 * contract test (`test/contract/`) prove the real host; this proves the UI.
 *
 * Three teammates, each with one conversation, and three hidden coding
 * workers, one per harness (Claude Code, Codex, Cursor). Your first ask to
 * Lead makes it message researcher; researcher looks the fact up and
 * replies. The stand-in files no tasks: a conversation's tasks are read
 * through the coding board view, which a test serves from `stub-server.ts`
 * or the lab's own host. Ask writer to publish and it waits for your yes
 * first. A line you send starts its own turn at once, beside any the worker
 * is answering, as the worker's door starts it on the server. A message from
 * another worker waits until the worker has no turn running, as the server
 * defers it, then runs. Lead's conversation starts past the 50-turn history
 * window. `failTurn` leaves a failed turn in a conversation, as an engine
 * `error` item would; Retry runs that turn's line again. Each turn says
 * whether the engine retries it (`retryable`) as the engine does: by its
 * source, the built-in ones and a host's own (`retrySources`).
 */
import { createElement, type ReactNode } from "react";
import type { Client, ClientFetch, SessionConnectionStatus } from "@flow-state-dev/client";
import type { FileContent } from "@flow-state-dev/core/items";
import { CODER_FLOW } from "@flow-state-dev/harness-manager/browser";
import {
  isOpenMessage,
  RECEIVED_MESSAGE_DATA_TYPE,
  SENT_MESSAGE_DATA_TYPE,
  TURN_ACTIONS,
  type RosterEntry,
  type WorkerMessageResourceState,
} from "@flow-state-dev/workforce/browser";
import { AppProvider } from "../src/app";
import type { AppConnection } from "../src/lib/files";

/** A worker as the stand-in keeps it: what its roster entry says, flattened. */
type ScriptedTeammate = { id: string; name: string; role: string; takesTasks?: boolean; own?: boolean; edited?: boolean; harness?: string; icon?: string; color?: string };

/** A message in the stand-in's log: what the worker messages view reads of a log entry. */
type Message = { id: string; from: string; to: string; text: string; inReplyTo?: string; replyRequested?: boolean; at: number };

/** A stored item, as the server stores one. */
type StoredItem = Record<string, any> & { id: string; requestId: string };

/** How the stand-in keeps time, and what it plays. */
export interface ScriptedOptions {
  /** Multiplies every delay. 1 is real time; tests pass a small number. */
  speed?: number;
  /** The clock, in ms. */
  now?: () => number;
  /** Turns past the window are summarized for the worker, not dropped. */
  summary?: boolean;
  /** How many roster view reads fail as an unreachable server would, before one lands. */
  unreachableReads?: number;
  /** A host's own request sources the engine also retries (its `publicReentrySources`). */
  retrySources?: readonly string[];
  /** Every read of a conversation's items fails, as a server that can't read the session's history does. */
  historyUnreadable?: boolean;
}

/** The stand-in: the client the screen reads through, and what a test does to the server behind it. */
export interface ScriptedServer {
  /** The client every package hook reads and writes through. */
  client: Client;
  /** The page's connection: a line's files, and the answer route react's `useApproval` posts to. */
  connection: AppConnection;
  /** Another tab's hire: a teammate of the user's own on the roster. */
  hire(teammate: { name: string; role: string; instructions: string }): Promise<{ id: string }>;
  /** Another tab's fire of one of the user's own teammates. */
  fire(worker: string): Promise<void>;
  /** The roster as a client's roster view reads it now. */
  roster(): RosterEntry[];
  /** Each roster write the screen sent through workforce's client, in order: its action and input. */
  readonly rosterWrites: { action: string; input: Record<string, unknown> }[];
  /** Each line the worker flow's door took, in order, with its files: from the screen or from another tab. */
  readonly sends: { sessionId: string; text: string; attachments: readonly FileContent[] }[];
  /** Worker `worker`'s conversation's id, as `ensureWorkerSession` answers it. */
  conversationOf(worker: string): string;
  /** Another tab's line to conversation `sessionId`, with files, through the worker flow's door. */
  send(sessionId: string, text: string, attachments?: readonly FileContent[]): Promise<void>;
  /** Every conversation's feed hears `state` from now on, as its stream would say it. */
  setConnection(state: SessionConnectionStatus): void;
  /** The newest turn of conversation `sessionId` failed with `reason`: a reply under way is left incomplete. */
  failTurn(sessionId: string, reason: string, options?: { source?: string }): void;
  /** Each retry the screen asked for, in order. */
  readonly retries: { sessionId: string; requestId: string }[];
  /** The next line's turn fails at its model call with `reason`, before any reply. */
  failNextTurn(reason: string): void;
  /** The next Stop is refused while its turn runs on, as a server that resumed the turn first refuses it (409). */
  refuseNextStop(): void;
  /**
   * Hold every line at the door until `gate` settles: its rejection is the send's failure, as a server that
   * refused it or a network that is down fails it. `undefined` lets lines through again.
   */
  holdDoor(gate: ((text: string) => Promise<void>) | undefined): void;
  /**
   * Hold the next turn of `worker` at its start: it runs, with nothing written yet, until the returned
   * release, and then plays its script. For a test that reads what the screen says while a turn runs.
   */
  holdNextTurn(worker: string): () => void;
}

/** How many turns a worker reads word for word: the agent flow's default. */
const WINDOW_TURNS = 50;
/** How many turns the session turns view lists: the newest. */
const TURNS_LISTED = 50;
const MINUTE = 60_000;
/** The door's action, and the action a received message's turn runs. */
const RESPOND = "respond";
const RECEIVE = TURN_ACTIONS.find((action) => action !== RESPOND && /receive/i.test(action)) ?? "messageReceived";

const ROSTER: ScriptedTeammate[] = [
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

type Job = { kind: "user"; text: string } | { kind: "receive"; message: Message };

/** The request sources the engine's retry route runs again for a caller, before a host adds its own. */
const RETRIED = new Set(["http", "mcp", "scheduled"]);

/** One turn: a request of the worker's flow, as the session turns view and the requests read list it. */
interface Turn {
  id: string;
  action: string;
  /** `http` for your line, `internal` for a worker's message: only the first is retried for you. */
  source: string;
  status: "in_progress" | "completed" | "failed" | "aborted";
  startedAt: number;
  endedAt: number | null;
  /** Still running its script: a stopped one's steps do nothing. */
  live: boolean;
  /** The line it answers, for a retry. */
  text?: string;
  /** The send's own streamed response, when the line was sent `{ stream: true }`: what is written, as it is written. */
  response?: { push(event: string, data: Record<string, unknown>): void; close(): void };
  /** An answer is still being written into the response, which closes once it is done. */
  writing?: boolean;
}

interface ScriptedWorker {
  teammate: ScriptedTeammate;
  sessionId: string;
  items: StoredItem[];
  turns: Turn[];
  lastActiveAt: number;
  /** Messages the server defers: each waits until no turn runs. */
  deferred: Job[];
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

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
/** A refusal as the client throws one: its status, which workforce's stop reads. */
const refused = (status: number, message: string) => Object.assign(new Error(message), { status });

/** The stand-in. */
export function scriptedServer(options: ScriptedOptions = {}): ScriptedServer {
  const speed = options.speed ?? 1;
  const now = options.now ?? (() => Date.now());
  const listeners = new Set<() => void>();
  const log: Message[] = [];
  let seq = 0;
  const nextId = (prefix: string) => `${prefix}-${++seq}`;
  /** Files the composer uploaded, by id: what the blob route serves. */
  const uploads = new Map<string, Blob>();

  const workers = new Map<string, ScriptedWorker>(
    ROSTER.map((teammate) => [teammate.id, { teammate, sessionId: `conversation:${teammate.id}`, items: [], turns: [], lastActiveAt: now(), deferred: [] }]),
  );
  const worker = (id: string): ScriptedWorker => {
    const found = workers.get(id);
    if (!found) throw new Error(`no worker ${id}`);
    return found;
  };
  const bySession = (sessionId: string) => [...workers.values()].find((w) => w.sessionId === sessionId);
  const ofSession = (sessionId: string) => bySession(sessionId) ?? (() => { throw refused(404, `no session ${sessionId}`); })();
  const turnOf = (requestId: string) => {
    for (const w of workers.values()) {
      const turn = w.turns.find((t) => t.id === requestId);
      if (turn !== undefined) return { w, turn };
    }
    throw refused(404, `no request ${requestId}`);
  };
  const fired = new Set<string>();
  let unreachable = options.unreachableReads ?? 0;
  let failNext: string | undefined;
  let refuseStop = false;
  let gate: ((text: string) => Promise<void>) | undefined;
  /** The next turn's hold, by worker: its script waits on it. */
  const holds = new Map<string, Promise<void>>();
  /** Each open approval, by suspension id: its worker and turn. */
  const approvals = new Map<string, { w: ScriptedWorker; turn: Turn }>();
  /** Each open session stream's handlers, by session id. */
  const streams = new Map<string, Set<StreamHandlers>>();

  const notify = () => {
    for (const listener of [...listeners]) listener();
  };

  /** Store `fields` as a new item of `turn`, in the order it was written. */
  const store = (w: ScriptedWorker, turn: string, fields: Record<string, unknown>): StoredItem => {
    seq += 1;
    const item = { id: nextId("i"), requestId: turn, itemIndex: seq, ts: seq, status: "completed", ...fields } as StoredItem;
    w.items = [...w.items, item];
    notify();
    return item;
  };
  /** Write a new copy of `item` with `fields`, in its place. */
  const rewrite = (w: ScriptedWorker, id: string, fields: Record<string, unknown>) => {
    w.items = w.items.map((item) => (item.id === id ? { ...item, ...fields } : item));
    notify();
  };
  const said = (text: string) => ({ type: "message", role: "assistant", content: [{ type: "output_text", text }] });
  const userLine = (text: string, files: readonly FileContent[] = []) => ({ type: "message", role: "user", content: [{ type: "input_text", text }, ...files] });
  const receivedOf = (m: Message) => ({ type: "data", dataType: RECEIVED_MESSAGE_DATA_TYPE, value: { id: m.id, from: m.from, text: m.text, ...(m.inReplyTo === undefined ? {} : { inReplyTo: m.inReplyTo }) } });
  // The send's own line, as workforce writes it; the call it was written in is that line, not a step (React's model ties the two).
  const sentOf = (m: Message) => ({ type: "data", dataType: SENT_MESSAGE_DATA_TYPE, value: { to: m.to, text: m.text, messageId: m.id, ...(m.inReplyTo === undefined ? { replyRequested: true } : { inReplyTo: m.inReplyTo }) } });

  const say = (w: ScriptedWorker, t: Turn, text: string): Step[1] => () => void store(w, t.id, said(text));

  /**
   * An answer written word by word, as the server writes one: each word on the send's streamed response (its
   * `item.added`, then a `content.delta` a word), and the session stream's one finished copy once it is done.
   */
  const sayStreamed = (w: ScriptedWorker, t: Turn, text: string): Step[1] => () => {
    const words = text.split(" ");
    const item = store(w, t.id, { ...said(words[0]!), status: words.length > 1 ? "in_progress" : "completed" });
    t.writing = words.length > 1;
    t.response?.push("item.added", { item: { ...item, content: [{ type: "output_text", text: words[0] }] } });
    const draw = (count: number) => {
      // A stopped turn writes no more; one that ended meanwhile still finishes what it was writing.
      if (t.status === "aborted") return;
      t.response?.push("content.delta", { itemId: item.id, contentIndex: 0, delta: ` ${words[count - 1]}` });
      const done = count >= words.length;
      rewrite(w, item.id, { ...said(words.slice(0, count).join(" ")), status: done ? "completed" : "in_progress" });
      if (!done) setTimeout(() => draw(count + 1), 60 * speed);
      else {
        t.writing = false;
        t.response?.close();
      }
    };
    if (t.writing) setTimeout(() => draw(2), 60 * speed);
  };

  /**
   * `sendMessage`: a sent line in the sender's conversation, an entry in the log, and a
   * turn deferred for the recipient. A send that isn't an answer asks for one.
   */
  const sendMessage = (w: ScriptedWorker, t: Turn, to: string, text: string, inReplyTo?: string): Step[1] => () => {
    const message: Message = { id: nextId("m"), from: w.teammate.id, to, text, inReplyTo, ...(inReplyTo ? {} : { replyRequested: true }), at: now() };
    log.push(message);
    store(w, t.id, sentOf(message));
    const recipient = worker(to);
    recipient.deferred.push({ kind: "receive", message });
    startDeferred(recipient);
  };

  const script = (w: ScriptedWorker, t: Turn, job: Job): Step[] => {
    if (job.kind === "receive") {
      const { message } = job;
      const from = worker(message.from).teammate.name;
      if (message.inReplyTo) return [[900, say(w, t, `${from} answered: "${message.text}" I've worked it into the plan.`)]];
      if (w.teammate.id === RESEARCHER) {
        return [[700, say(w, t, "Looking it up in the plan doc.")], [4000, sendMessage(w, t, message.from, "Nov 12, per the plan doc.", message.id)]];
      }
      return [[700, say(w, t, "On it.")], [2000, sendMessage(w, t, message.from, "Done. It's in the doc.", message.id)]];
    }
    // writer waits for your yes before it publishes: `suspendForUser` with an approval.
    if (w.teammate.id === WRITER && /\bpublish\b/i.test(job.text)) {
      return [
        [
          600,
          () => {
            const suspensionId = nextId("sus");
            approvals.set(suspensionId, { w, turn: t });
            store(w, t.id, { type: "suspension", reason: "user_approval", suspensionId, message: "Publish the draft to the team page?" });
          },
        ],
      ];
    }
    // A long turn, as the contract's stop scenarios ask: work that runs until it is stopped.
    if (w.teammate.id === LEAD && /\bboth modules\b/i.test(job.text)) return [[30_000, say(w, t, "Written up.")]];
    if (w.teammate.id === LEAD && /\bmeanwhile\b/i.test(job.text)) return [[30_000, say(w, t, "Drafted.")]];
    // A long answer, written word by word, as a streamed send draws it.
    if (w.teammate.id === LEAD && /\bwalk me through\b/i.test(job.text)) {
      return [[800, sayStreamed(w, t, "Here is the plan for the post, part by part, so each part has one job. That is the whole plan.")]];
    }
    if (w.teammate.id === LEAD && !log.some((m) => m.from === LEAD && m.to === RESEARCHER)) {
      return [
        [800, say(w, t, "Asking researcher now. An outline:\n1 · the problem\n2 · what ships\n3 · how to try it")],
        [600, sendMessage(w, t, RESEARCHER, "What's our launch date?")],
      ];
    }
    // Lead thinks longer than researcher looks a fact up, so a reply can arrive while you talk to Lead.
    return [[w.teammate.id === LEAD ? 6000 : 900, say(w, t, `Noted: "${job.text}" I've folded it into the plan.`)]];
  };

  /** A turn for `job`, started now, beside any already running; `id` is the request id the door was sent with. */
  const startTurn = (w: ScriptedWorker, job: Job, id = nextId("req"), files: readonly FileContent[] = [], line = true): Turn => {
    const t: Turn = {
      id,
      action: job.kind === "user" ? RESPOND : RECEIVE,
      source: job.kind === "user" ? "http" : "internal",
      status: "in_progress",
      startedAt: now(),
      endedAt: null,
      live: true,
      ...(job.kind === "user" ? { text: job.text } : {}),
    };
    w.turns = [...w.turns, t];
    w.lastActiveAt = now();
    if (job.kind === "receive") store(w, t.id, receivedOf(job.message));
    else if (line) store(w, t.id, userLine(job.text, files));
    else notify();
    let at = 0;
    // The next line's turn fails before any reply: its failed line, then the turn ends.
    const failed = failNext !== undefined && job.kind === "user" ? failNext : undefined;
    if (failed !== undefined) failNext = undefined;
    const steps: Step[] = failed !== undefined ? [[0, () => failIn(w, t, failed)]] : script(w, t, job);
    const play = () => {
      for (const [delay, run] of [...steps, [200, () => endTurn(w, t, "completed")] as Step]) {
        at += delay;
        setTimeout(() => {
          if (t.live) run();
        }, at * speed);
      }
    };
    const hold = holds.get(w.teammate.id);
    holds.delete(w.teammate.id);
    if (hold === undefined) play();
    else void hold.then(play);
    return t;
  };

  /** The next deferred message, once the worker has no turn running. */
  const startDeferred = (w: ScriptedWorker) => {
    if (w.turns.some((t) => t.status === "in_progress")) return;
    const job = w.deferred.shift();
    if (job) startTurn(w, job);
  };

  const endTurn = (w: ScriptedWorker, t: Turn, status: Turn["status"]) => {
    if (t.status !== "in_progress") return;
    t.live = false;
    t.status = status;
    // The send's response ends with its turn, unless an answer is still being written into it.
    if (!t.writing || status === "aborted") t.response?.close();
    t.endedAt = now();
    w.lastActiveAt = now();
    notify();
    startDeferred(w);
  };

  /** Turn `t` failed with `reason`: its `error` item, and a reply it never finished left incomplete. */
  const failIn = (w: ScriptedWorker, t: Turn, reason: string) => {
    const reply = [...w.items].reverse().find((item) => item.requestId === t.id && item.type === "message" && item.role === "assistant");
    if (reply !== undefined) rewrite(w, reply.id, { status: "incomplete" });
    store(w, t.id, { type: "error", message: reason });
    endTurn(w, t, "failed");
  };

  // Seed: each conversation's turns, ended when it was last active. A turn starts at your line or a received message.
  const seed = (w: ScriptedWorker, lines: ({ user: string } | { said: string } | { sent: Message } | { received: Message })[], lastActiveAt: number) => {
    let turn: Turn | undefined;
    lines.forEach((line, i) => {
      const at = lastActiveAt - (lines.length - i) * 1000;
      if ("user" in line || "received" in line) {
        turn = { id: nextId("req"), action: "user" in line ? RESPOND : RECEIVE, source: "user" in line ? "http" : "internal", status: "completed", startedAt: at, endedAt: at, live: false, ...("user" in line ? { text: line.user } : {}) };
        w.turns.push(turn);
      }
      const fields = "user" in line ? userLine(line.user) : "said" in line ? said(line.said) : "sent" in line ? sentOf(line.sent) : receivedOf(line.received);
      seq += 1;
      w.items.push({ id: nextId("i"), requestId: turn?.id ?? "seed", itemIndex: seq, ts: seq, status: "completed", ...fields } as StoredItem);
    });
    if (turn !== undefined) turn.endedAt = lastActiveAt;
    w.lastActiveAt = lastActiveAt;
  };
  const exchange = (from: string, to: string, text: string, ago: number, inReplyTo?: string): Message => {
    const message = { id: nextId("m"), from, to, text, inReplyTo, at: now() - ago };
    log.push(message);
    return message;
  };

  const older: ({ user: string } | { said: string })[] = [
    { user: "I'm planning the launch of Relay, our sync tool. The post goes on our blog first, never social first." },
    { said: "Got it: Relay, blog first. I'll hold every plan to that." },
  ];
  for (let turn = 2; turn <= 48; turn++) {
    const [ask, answer] = OLDER_TURNS[(turn - 2) % OLDER_TURNS.length]!;
    older.push({ user: ask }, { said: answer });
  }
  const w1 = exchange(LEAD, WRITER, "Can you draft the changelog intro? About 120 words.", 3 * 60 * MINUTE);
  const w2 = exchange(WRITER, LEAD, "Draft is in the doc: 120 words.", 2.5 * 60 * MINUTE, w1.id);
  const w3 = exchange(LEAD, WRITER, "Tighten it to 80 words?", 2.4 * 60 * MINUTE, w2.id);
  const w4 = exchange(WRITER, LEAD, "Done: 78 words.", 2 * 60 * MINUTE, w3.id);
  seed(
    worker(LEAD),
    [
      ...older,
      { user: "Get writer started on the changelog intro." },
      { said: "Asking writer." },
      { sent: w1 },
      { received: w2 },
      { said: "Writer's draft is in. I asked for a tighter one." },
      { sent: w3 },
      { received: w4 },
      { said: "The changelog intro is ready at 78 words." },
      { user: "Good. What's left before launch?" },
      { said: "The launch post, and the date. Researcher can confirm the date." },
    ],
    now() - 90 * MINUTE,
  );
  seed(worker(RESEARCHER), [{ user: "What did the beta survey say about setup time?" }, { said: "A median of 4 minutes, from the March survey." }], now() - 40 * MINUTE);
  seed(worker(WRITER), [{ received: w1 }, { said: "Drafting it now." }, { sent: w2 }, { received: w3 }, { said: "Tightening." }, { sent: w4 }], now() - 2 * 60 * MINUTE);

  const retries: ScriptedServer["retries"] = [];
  const sends: ScriptedServer["sends"] = [];
  const rosterWrites: ScriptedServer["rosterWrites"] = [];

  /** The worker flow's door: your line, and its own turn at once, beside any running, under the id the client named. */
  const door = (sessionId: string, text: string, files: readonly FileContent[] = [], requestId?: string): Turn => {
    const w = ofSession(sessionId);
    sends.push({ sessionId, text, attachments: files });
    return startTurn(w, { kind: "user", text }, requestId, files);
  };

  // Workforce's roster writes and reads, as its roster flow answers them.
  const rosterEntries = (): RosterEntry[] =>
    [...workers.values()].filter((w) => !fired.has(w.teammate.id)).map(({ teammate }) => ({
      id: teammate.id,
      flow: teammate.takesTasks ? CODER_FLOW : "agent",
      standard: teammate.own !== true,
      description: teammate.role,
      name: teammate.name,
      teamName: null,
      forkedFrom: null,
      edited: teammate.edited === true,
      settings: { ...(teammate.harness === undefined ? {} : { harness: teammate.harness }), ...(teammate.icon === undefined ? {} : { icon: teammate.icon }), ...(teammate.color === undefined ? {} : { color: teammate.color }) },
    }));
  const hire = ({ id, description }: { id: string; description?: string }) => {
    if (workers.has(id) && !fired.has(id)) throw new Error(`"${id}" is already on your roster`);
    workers.set(id, { teammate: { id, name: id, role: description ?? "", own: true }, sessionId: `conversation:${id}`, items: [], turns: [], lastActiveAt: now(), deferred: [] });
    fired.delete(id);
    notify();
    return { id, flow: "agent" };
  };
  // As the workforce's edit: a file's teammate becomes the user's copy, under the same id; a null name clears it.
  const edit = ({ id, name }: { id: string; name?: string | null }) => {
    const w = worker(id);
    if (name !== undefined) w.teammate = { ...w.teammate, name: name === null ? id.slice(id.lastIndexOf(".") + 1) : name };
    if (!w.teammate.own) w.teammate = { ...w.teammate, edited: true };
    notify();
    return { id, flow: "agent" };
  };
  const reset = (id: string) => {
    const w = worker(id);
    const file = ROSTER.find((teammate) => teammate.id === id);
    if (file === undefined) throw new Error(`"${id}" isn't a standard worker`);
    if (!w.teammate.edited) throw new Error(`You haven't edited "${id}"`);
    w.teammate = file;
    notify();
    return { id };
  };
  const fire = (id: string) => {
    if (!worker(id).teammate.own) throw new Error(`"${id}" is a standard worker`);
    // Its conversation stays readable, so it keeps its place here and leaves the roster.
    fired.add(id);
    notify();
    return { id };
  };
  /** A log entry as the worker messages view answers it: delivered once its recipient's conversation read it, answered once a reply names it. */
  const logEntry = (m: Message): WorkerMessageResourceState => {
    const answer = log.find((r) => r.inReplyTo === m.id);
    const read = worker(m.to).items.some((item) => item.type === "data" && item.dataType === RECEIVED_MESSAGE_DATA_TYPE && item.value?.id === m.id);
    return {
      id: m.id, from: m.from, to: m.to, text: m.text, exchange: m.id, at: m.at, hop: 1, status: read ? "delivered" : "unconfirmed",
      fromSession: worker(m.from).sessionId, fromFlow: "agent", toSession: worker(m.to).sessionId, toFlow: "agent",
      ...(m.inReplyTo === undefined ? {} : { inReplyTo: m.inReplyTo }),
      ...(m.replyRequested === true ? { replyRequested: true as const } : {}),
      ...(answer === undefined ? {} : { answeredBy: answer.id }),
    };
  };
  /** The worker messages view: the worker's open messages, by the view's own rule (`isOpenMessage`), and each id's entry and answer. */
  const workerMessages = ({ worker: id, ids = [] }: { worker: string; ids?: string[] }) =>
    log
      .map(logEntry)
      .filter((m) => ((m.from === id || m.to === id) && isOpenMessage(m)) || ids.includes(m.id) || (m.inReplyTo !== undefined && ids.includes(m.inReplyTo)))
      .sort((a, b) => a.at - b.at);
  /** The session turns view's rows: the newest turns, oldest first, each with the first turn its history window held. */
  const sessionTurns = ({ sessionId }: { sessionId: string }) => {
    const turns = bySession(sessionId)?.turns ?? [];
    return turns
      .map((t, i) => ({
        id: t.id,
        action: t.action,
        status: t.status,
        source: t.source,
        retryable: RETRIED.has(t.source) || (options.retrySources ?? []).includes(t.source),
        startedAt: t.startedAt,
        completedAt: t.status === "completed" ? t.endedAt : null,
        endedAt: t.endedAt,
        error: t.status === "failed" ? { code: "turn_failed", message: "The turn failed." } : null,
        historyStart: i + 1 > WINDOW_TURNS ? { requestId: turns[i + 1 - WINDOW_TURNS]!.id } : null,
      }))
      .slice(-TURNS_LISTED);
  };
  /** The history summary's public face: its mark on the turn before the newest window, once turns have left it. */
  const summaryOf = (w: ScriptedWorker) => {
    if (options.summary !== true || w.turns.length <= WINDOW_TURNS) return {};
    return { historySummary: { clientData: { throughRequestId: w.turns[w.turns.length - WINDOW_TURNS - 1]!.id, complete: true, folds: 1 } } };
  };
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
      return w === undefined || w.teammate.takesTasks
        ? []
        : [{ id: w.sessionId, title: "Untitled", worker: id, updatedAt: w.lastActiveAt, running: w.turns.some((t) => t.status === "in_progress"), state: {}, isDefault: true, waiting: [] }];
    },
    sessionTurns,
    workerMessages,
    // The stand-in files no tasks: each conversation's coding board is empty (a test serves rows from `stub-server.ts`).
    codingBoard: () => [],
  };

  const sessionSummary = (w: ScriptedWorker) => ({ id: w.sessionId, flowKind: "agent", userId: "you", updatedAt: w.lastActiveAt, createdAt: 1, state: {} });
  /** A request summary, as the session's requests read lists one. */
  const requestSummary = (t: Turn) => ({ id: t.id, actionName: t.action, status: t.status, source: t.source, startedAtMs: t.startedAt });
  const flow = (address: string) => ({
    identity: async () => ({ userId: "you", orgId: "org" }),
    // A worker's conversation is at its own id here, whatever the client derived: the one conversation the screen opens.
    createSession: async ({ state = {} }: { state?: Record<string, unknown> } = {}) => {
      const w = [...workers.values()].find((candidate) => Object.values(state).includes(candidate.teammate.id));
      if (w === undefined) throw refused(400, `no worker in ${JSON.stringify(state)}`);
      return sessionSummary(w);
    },
    async send(action: string, input: { message?: string }, sendOptions: { sessionId: string; requestId?: string; stream?: boolean; attachments?: FileContent[] }) {
      if (action !== RESPOND) throw refused(404, `the stand-in's ${address} has no action "${action}"`);
      await gate?.(String(input.message ?? ""));
      const t = door(sendOptions.sessionId, String(input.message ?? ""), sendOptions.attachments ?? [], sendOptions.requestId);
      if (sendOptions.stream !== true) return { id: t.id };
      // The send's own response: what the turn writes as it writes it, until the turn ends.
      const encoder = new TextEncoder();
      let sequence = 0;
      // Open until the turn closes it, or the page stops reading it (a closed feed cancels it).
      let open = true;
      const body = new ReadableStream<Uint8Array>({
        cancel() {
          open = false;
        },
        start(controller) {
          t.response = {
            push: (event, data) => {
              if (open) controller.enqueue(encoder.encode(`id: ${++sequence}\nevent: ${event}\ndata: ${JSON.stringify({ type: event, sequence_number: sequence, ...data })}\n\n`));
            },
            close: () => {
              if (open) controller.close();
              open = false;
            },
          };
        },
      });
      return new Response(body, { status: 200, headers: { "content-type": "text/event-stream" } });
    },
    request: (id: string) => ({
      async abort() {
        const { w, turn } = turnOf(id);
        if (turn.status !== "in_progress") throw refused(409, "The request has ended.");
        if (refuseStop) {
          refuseStop = false;
          throw refused(409, "An answer resumed the request first.");
        }
        // Stopped at once; the request reads aborted a moment later, as the engine settles it.
        turn.live = false;
        setTimeout(() => endTurn(w, turn, "aborted"), 50 * speed);
        return {};
      },
      async retry() {
        const { w, turn } = turnOf(id);
        retries.push({ sessionId: w.sessionId, requestId: id });
        if (turn.text === undefined) throw refused(409, `No failed turn "${id}" to retry.`);
        // A new request for the same line: the line itself is stored once.
        return { id: startTurn(w, { kind: "user", text: turn.text }, undefined, [], false).id };
      },
    }),
    upload,
  });
  // A stored file is its reference; the bytes are the picked file's, kept here for its thumbnail.
  async function upload({ data, mediaType, filename }: { data: Blob; mediaType?: string; filename?: string }): Promise<FileContent> {
    const id = `b_${String(uploads.size + 1).padStart(8, "0")}`;
    uploads.set(id, data);
    return { type: "file" as const, data: `fsd-blob:${id}`, mediaType: mediaType ?? data.type, ...(filename === undefined ? {} : { filename }) };
  }

  const client = {
    userId: "you",
    async view(ref: { view: string }, input: unknown) {
      const answer = VIEWS[ref.view];
      if (answer === undefined) throw new Error(`the stand-in serves no view "${ref.view}"`);
      return { value: answer(input ?? {}), topics: [] };
    },
    // Every change the stand-in makes is a notice to every live read, one per turn of the event loop however many
    // changes it holds, as a socket delivers them; subscribing reads nothing by itself.
    subscribe(_topics: unknown, subscribeOptions: { onChange: (notice: null) => void }) {
      let due = false;
      const heard = () => {
        if (due) return;
        due = true;
        setTimeout(() => {
          due = false;
          subscribeOptions.onChange(null);
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
        throw new Error(`the stand-in has no roster action "${action}"`);
      },
    }),
    flow,
    upload,
    sessions: {
      async get(sessionId: string) {
        return sessionSummary(ofSession(sessionId));
      },
      // No conversation is listed at the client's derived address: an open always makes it, here at its own id.
      async list() {
        return [];
      },
      async requests(sessionId: string, read: { status?: string; limit?: number } = {}) {
        const requests = ofSession(sessionId).turns.filter((t) => read.status === undefined || t.status === read.status).map(requestSummary);
        return requests.slice(-(read.limit ?? 20));
      },
      async state(sessionId: string, read: { includeItems?: boolean } = {}) {
        if (options.historyUnreadable === true && read.includeItems !== false) throw refused(503, "The session's history can't be read.");
        const w = bySession(sessionId);
        const items = w?.items ?? [];
        return {
          sessionId,
          flowKind: "agent",
          at: items.length,
          sessionCreatedAt: 1,
          clientData: {},
          ...(read.includeItems === false ? {} : { items }),
          resources: { session: w === undefined ? {} : summaryOf(w) },
          pagination: { offset: 0, limit: 200, total: items.length, hasMore: false, nextOffset: items.length },
        };
      },
      stream(sessionId: string, handlers: StreamHandlers) {
        const open = streams.get(sessionId) ?? new Set<StreamHandlers>();
        streams.set(sessionId, open.add(handlers));
        // The runs, named on connect: the stand-in runs no background work.
        queueMicrotask(() => handlers.onRuns?.({ runs: [] }));
        // The session stream sends an item once it is finished: one being written is the send's response's.
        const heard = () => bySession(sessionId)?.items.forEach((item) => void (item.status === "in_progress" || handlers.onItem({ item })));
        listeners.add(heard);
        return {
          close: () => {
            listeners.delete(heard);
            open.delete(handlers);
          },
        };
      },
    },
  } as unknown as Client;

  // The page's own fetch: a file's bytes, and an approval's answer (react's `useApproval` posts through it).
  const fetcher = (async (url: string, init?: RequestInit) => {
    const path = new URL(url, "http://x").pathname;
    const blob = /\/api\/flows\/blobs\/([^/]+)$/.exec(path);
    if (blob !== null) {
      const bytes = uploads.get(blob[1]!);
      return bytes === undefined ? json({ error: "no such file" }, 404) : new Response(bytes, { status: 200 });
    }
    const answer = /\/requests\/([^/]+)\/answer$/.exec(path);
    if (answer !== null && init?.method === "POST") {
      const { suspensionId, action } = JSON.parse(String(init.body)) as { suspensionId: string; action: string };
      const open = approvals.get(suspensionId);
      if (open === undefined) return json({ error: `no approval ${suspensionId}` }, 409);
      approvals.delete(suspensionId);
      const approve = action === "approve";
      store(open.w, open.turn.id, { type: "suspension_resume", suspensionId, resolution: approve ? "approved" : "rejected" });
      store(open.w, open.turn.id, said(approve ? "Published." : "Left it unpublished."));
      return json({ requestId: answer[1] });
    }
    return json({ error: `the stand-in serves no ${init?.method ?? "GET"} ${path}` }, 404);
  }) as ClientFetch;

  return {
    client,
    connection: { fetcher },
    hire: async ({ name, role }) => hire({ id: name, description: role }),
    fire: async (workerId) => void fire(workerId),
    roster: () => rosterEntries(),
    rosterWrites,
    sends,
    conversationOf: (id) => worker(id).sessionId,
    send: async (sessionId, text, attachments = []) => void door(sessionId, text, attachments),
    setConnection(state) {
      for (const open of streams.values()) {
        for (const handlers of open) {
          if (state === "live") handlers.onRuns?.({ runs: [] });
          else if (state === "stopped") handlers.onStop?.();
          else handlers.onReconnecting?.({ attempt: state === "lapsed" ? 2 : 1 });
        }
      }
    },
    retries,
    failTurn(sessionId, reason, failing = {}) {
      const w = ofSession(sessionId);
      const newest = w.turns.at(-1);
      if (newest === undefined) throw new Error(`no turn in ${sessionId}`);
      // The newest turn fails; one that already failed is run again, as a retry, and that run fails.
      const t = newest.status === "failed" && newest.text !== undefined ? startTurn(w, { kind: "user", text: newest.text }, undefined, [], false) : newest;
      if (failing.source !== undefined) t.source = failing.source;
      t.status = "in_progress";
      failIn(w, t, reason);
    },
    failNextTurn(reason) {
      failNext = reason;
    },
    refuseNextStop() {
      refuseStop = true;
    },
    holdDoor(next) {
      gate = next;
    },
    holdNextTurn(workerId) {
      let release!: () => void;
      holds.set(workerId, new Promise<void>((resolve) => (release = resolve)));
      return () => release();
    },
  };
}

/** The session stream's handlers, as the client's session feed passes them. */
type StreamHandlers = {
  onItem: (event: { item: unknown }) => void;
  onRuns?: (event: { runs: unknown[] }) => void;
  onReconnecting?: (event: { attempt: number }) => void;
  onStop?: () => void;
};

/**
 * `AppProvider` over the stand-in: its client (or `client`, a test's own
 * over it), and its connection, for a line's files and an approval's answer.
 */
export function ScriptedProvider({ server, client, children }: { server: ScriptedServer; client?: Client; children?: ReactNode }) {
  return createElement(AppProvider, { client: client ?? server.client, connection: server.connection }, children);
}

/**
 * `server`'s client with its roster view reads answered by `answer`, given the
 * read's number (from 1) and the stand-in's own read: a server that is down,
 * or slow, for the roster alone.
 */
export function rosterReadsBy(server: ScriptedServer, answer: (call: number, read: () => Promise<unknown>) => Promise<unknown>): Client {
  let calls = 0;
  const view = (ref: { view: string }, input: unknown, options?: unknown) =>
    ref.view === "roster"
      ? answer(++calls, () => server.client.view(ref as never, input as never, options as never))
      : server.client.view(ref as never, input as never, options as never);
  return { ...server.client, view } as unknown as Client;
}

/** A roster entry as workforce's roster view answers it, for a screen drawn without the stand-in: a standard teammate on the agent flow unless `fields` say otherwise. */
export const rosterEntry = (fields: Partial<RosterEntry> & { id: string }): RosterEntry => ({
  flow: "agent", standard: true, description: null, name: null, teamName: null, forkedFrom: null, edited: false, settings: {}, ...fields,
});
