/**
 * fixture: the whole file. Deleted at wiring (spec, "What changes").
 *
 * An in-memory stand-in for the package, behind `LabAdapter`, that plays the
 * script on a timer so the screen can be seen and tested before the package
 * pieces it needs exist. It proves the UI only. The README lists which gap
 * each part stands for.
 *
 * Three workers, each with one conversation. Your first ask to lead makes it
 * message researcher; researcher looks the fact up and replies. Each worker
 * answers one request at a time: a line you send, or a message from another
 * worker, waits while the worker is answering, and runs when it is done.
 * lead's conversation starts past the 50-turn history window.
 */
import type {
  Activity,
  ConversationEntry,
  ConversationView,
  LabAdapter,
  TalkRow,
  Unsubscribe,
  WindowMark,
  WorkerRow,
} from "./adapter";

/** How the fixtures keep time, and what they stand in for. */
export interface FixtureOptions {
  /** Multiplies every delay. 1 is real time; tests pass a small number. */
  speed?: number;
  /** The clock, in ms. */
  now?: () => number;
  /** Turns past the window are summarized for the worker, not dropped. */
  summary?: boolean;
}

/** How many turns a worker reads word for word: the agent flow's default. */
const WINDOW_TURNS = 50;
const MINUTE = 60_000;

const ROSTER: WorkerRow[] = [
  { id: "teammates.lead", name: "lead", role: "Plans the launch with you, and asks the other workers when it needs a fact or a draft." },
  { id: "teammates.researcher", name: "researcher", role: "Finds facts for the team, and replies to whoever asked." },
  { id: "teammates.writer", name: "writer", role: "Drafts and tightens copy when you or another worker asks." },
];
const LEAD = "teammates.lead";
const RESEARCHER = "teammates.researcher";
const WRITER = "teammates.writer";

type Job = { kind: "user"; entryId: string; text: string } | { kind: "receive"; message: TalkRow };

interface FixtureWorker {
  row: WorkerRow;
  sessionId: string;
  entries: ConversationEntry[];
  running: boolean;
  lastActiveAt: number;
  queue: Job[];
}

/** A scripted step: wait, then run. */
type Step = [delayMs: number, run: () => void];

/** Planning chatter for lead's older turns. */
const OLDER_TURNS: [string, string][] = [
  ["Who is the post for?", "Teams that sync files across offices. I'd write for the person who sets it up."],
  ["List the launch channels.", "The blog, the changelog, and the newsletter a day later."],
  ["What's the one line pitch?", "Relay keeps every office's files in step, without a server to run."],
  ["Remind me of the beta numbers.", "212 teams, and setup took a median of 4 minutes."],
  ["Which customer quote should we use?", "Dana at Northwind: \"We stopped emailing files the first week.\""],
  ["Do we need a demo video?", "A 40-second clip of the setup. Writer can script it later."],
];

/** fixture: stands in for the whole package until wiring. */
export function createFixtureLab(options: FixtureOptions = {}): LabAdapter {
  const speed = options.speed ?? 1;
  const now = options.now ?? (() => Date.now());
  const listeners = new Set<() => void>();
  const log: TalkRow[] = [];
  let seq = 0;
  const nextId = (prefix: string) => `${prefix}-${++seq}`;

  const workers = new Map<string, FixtureWorker>(
    ROSTER.map((row) => [row.id, { row, sessionId: `conversation:${row.id}`, entries: [], running: false, lastActiveAt: now(), queue: [] }]),
  );
  const worker = (id: string): FixtureWorker => {
    const found = workers.get(id);
    if (!found) throw new Error(`no worker ${id}`);
    return found;
  };
  const bySession = (sessionId: string) => [...workers.values()].find((w) => w.sessionId === sessionId);

  const notify = () => {
    for (const listener of [...listeners]) listener();
  };
  const watch = (emit: () => void): Unsubscribe => {
    listeners.add(emit);
    emit();
    return () => listeners.delete(emit);
  };

  const push = (w: FixtureWorker, entry: ConversationEntry) => {
    w.entries = [...w.entries, entry];
    notify();
  };

  const say = (w: FixtureWorker, text: string): Step[1] => () => push(w, { kind: "assistant", id: nextId("a"), text });

  /** `sendMessage`: a card in the sender's conversation, a row in the log, and a `receive` queued for the recipient. */
  const sendMessage = (w: FixtureWorker, to: string, text: string, inReplyTo?: string): Step[1] => () => {
    const message: TalkRow = { id: nextId("m"), from: w.row.id, to, text, inReplyTo, at: now() };
    push(w, { kind: "sent", id: nextId("s"), messageId: message.id, to, text });
    log.push(message);
    const recipient = worker(to);
    recipient.queue.push({ kind: "receive", message });
    notify();
    startNext(recipient);
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
    if (w.row.id === LEAD && !log.some((m) => m.from === LEAD && m.to === RESEARCHER)) {
      return [
        [800, say(w, "Asking researcher now. An outline:\n1 · the problem\n2 · what ships\n3 · how to try it")],
        [600, sendMessage(w, RESEARCHER, "What's our launch date?")],
      ];
    }
    // lead thinks longer than researcher looks a fact up, so a reply can arrive while you talk to lead.
    return [[w.row.id === LEAD ? 6000 : 900, say(w, `Noted: "${job.text}" I've folded it into the plan.`)]];
  };

  const startNext = (w: FixtureWorker) => {
    if (w.running) return;
    const job = w.queue.shift();
    if (!job) return;
    w.running = true;
    w.lastActiveAt = now();
    if (job.kind === "user") {
      w.entries = w.entries.map((e) => (e.id === job.entryId && e.kind === "user" ? { ...e, queued: false } : e));
    } else {
      const { message } = job;
      w.entries = [...w.entries, { kind: "received", id: nextId("r"), messageId: message.id, from: message.from, text: message.text, inReplyTo: message.inReplyTo }];
    }
    notify();
    let at = 0;
    for (const [delay, run] of [...script(w, job), [200, () => endTurn(w)] as Step]) {
      at += delay;
      setTimeout(run, at * speed);
    }
  };

  const endTurn = (w: FixtureWorker) => {
    w.running = false;
    w.lastActiveAt = now();
    notify();
    startNext(w);
  };

  // Seed: lead's conversation runs two turns past the window, with an exchange with writer near its end.
  const seed = (w: FixtureWorker, entries: ConversationEntry[], lastActiveAt: number) => {
    w.entries = entries;
    w.lastActiveAt = lastActiveAt;
  };
  const exchange = (from: string, to: string, text: string, ago: number, inReplyTo?: string): TalkRow => {
    const message = { id: nextId("m"), from, to, text, inReplyTo, at: now() - ago };
    log.push(message);
    return message;
  };
  const user = (text: string): ConversationEntry => ({ kind: "user", id: nextId("u"), text });
  const assistant = (text: string): ConversationEntry => ({ kind: "assistant", id: nextId("a"), text });
  const sent = (m: TalkRow): ConversationEntry => ({ kind: "sent", id: nextId("s"), messageId: m.id, to: m.to, text: m.text });
  const received = (m: TalkRow): ConversationEntry => ({
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

  return {
    async listWorkers() {
      return ROSTER;
    },

    async openConversation(workerId) {
      return worker(workerId).sessionId;
    },

    async send(sessionId, text) {
      const w = bySession(sessionId);
      if (!w) throw new Error(`no conversation ${sessionId}`);
      const entryId = nextId("u");
      push(w, { kind: "user", id: entryId, text, queued: w.running });
      w.queue.push({ kind: "user", entryId, text });
      startNext(w);
    },

    watchConversation(sessionId, onChange) {
      return watch(() => {
        const w = bySession(sessionId);
        if (!w) return;
        const view: ConversationView = { entries: w.entries, running: w.running };
        onChange(view);
      });
    },

    watchTalk(workerId, onChange) {
      return watch(() => onChange(log.filter((m) => m.from === workerId || m.to === workerId).sort((a, b) => a.at - b.at)));
    },

    watchActivity(workerId, onChange) {
      return watch(() => {
        const w = worker(workerId);
        const activity: Activity = { running: w.running, lastActiveAt: w.lastActiveAt };
        onChange(activity);
      });
    },

    watchWindow(sessionId, onChange) {
      return watch(() => {
        const w = bySession(sessionId);
        // fixture: stands in for the history window's mark (G1). A turn starts at your line or at a received message.
        const starts = (w?.entries ?? []).filter((e) => e.kind === "user" || e.kind === "received");
        const mark: WindowMark | undefined =
          starts.length > WINDOW_TURNS ? { firstVerbatimEntryId: starts[starts.length - WINDOW_TURNS].id, summarized: options.summary ?? false } : undefined;
        onChange(mark);
      });
    },
  };
}
