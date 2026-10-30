/**
 * A test double for the screen tests: an in-memory `LabAdapter` that plays the
 * script on a timer. It proves the UI only, including the divider G1 will
 * place; the goal check (`goals/teammates-lab/`) proves the package. Nothing
 * in `src/` imports it.
 *
 * Three teammates, each with one conversation, and three hidden coding
 * workers, one per harness (Claude Code, Codex, Cursor). Your first ask to Chief of Staff makes it message researcher;
 * researcher looks the fact up and replies. Ask Chief of Staff to fix something and Chief of Staff
 * starts a coding task on the agent you name, or on Claude Code, which runs in the working folder;
 * one on a harness the double is told isn't set up fails at once, saying so. Ask writer to
 * publish and it waits for your yes first. Each worker
 * answers one request at a time: a line you send, or a message from another
 * worker, waits while the worker is answering, and runs when it is done.
 * Chief of Staff's conversation starts past the 50-turn history window.
 */
import type { ConversationEntry, LabAdapter, SessionStep, TalkRow, BoardTask, Unsubscribe, WindowMark, WorkerRow } from "../src/adapter";

/** How the double keeps time, and what it plays. */
export interface FixtureOptions {
  /** Multiplies every delay. 1 is real time; tests pass a small number. */
  speed?: number;
  /** The clock, in ms. */
  now?: () => number;
  /** Turns past the window are summarized for the worker, not dropped. */
  summary?: boolean;
  /** Harnesses this machine isn't set up for: a task on one fails at once, saying so. */
  notSetUp?: string[];
}

/** Each coding worker's harness, by name, and the model its run reports, if it reports one. */
const HARNESS: Record<string, { name: string; model?: string }> = {
  "claude-code": { name: "Claude Code" },
  codex: { name: "Codex", model: "gpt-5.5-codex" },
  cursor: { name: "Cursor" },
};

/** How many turns a worker reads word for word: the agent flow's default. */
const WINDOW_TURNS = 50;
const MINUTE = 60_000;

const ROSTER: WorkerRow[] = [
  { id: "teammates.chief-of-staff", name: "Chief of Staff", icon: "★", color: "amber", role: "Plans the launch with you, and asks the other workers when it needs a fact or a draft." },
  { id: "teammates.researcher", name: "researcher", icon: "🔎", color: "teal", role: "Finds facts for the team, and replies to whoever asked." },
  { id: "teammates.writer", name: "writer", icon: "✎", color: "violet", role: "Drafts and tightens copy when you or another worker asks." },
  { id: "teammates.claude-code", name: "Claude Code", role: "Runs coding tasks on Claude Code.", takesTasks: true, harness: "claude-code" },
  { id: "teammates.codex", name: "Codex", role: "Runs coding tasks on Codex.", takesTasks: true, harness: "codex" },
  { id: "teammates.cursor", name: "Cursor", role: "Runs coding tasks on Cursor.", takesTasks: true, harness: "cursor" },
];
const LEAD = "teammates.chief-of-staff";
const RESEARCHER = "teammates.researcher";
const WRITER = "teammates.writer";
/** The coding worker a task that names no harness goes to: Chief of Staff's default. */
const DEFAULT_CODER = "teammates.cursor";

type Job = { kind: "user"; entryId: string; text: string } | { kind: "receive"; message: TalkRow } | { kind: "result"; task: BoardTask };

/** A board row, and the conversation that filed it. */
type FixtureTask = BoardTask & { sessionId: string };

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

/** Planning chatter for Chief of Staff's older turns. */
const OLDER_TURNS: [string, string][] = [
  ["Who is the post for?", "Teams that sync files across offices. I'd write for the person who sets it up."],
  ["List the launch channels.", "The blog, the changelog, and the newsletter a day later."],
  ["What's the one line pitch?", "Relay keeps every office's files in step, without a server to run."],
  ["Remind me of the beta numbers.", "212 teams, and setup took a median of 4 minutes."],
  ["Which customer quote should we use?", "Dana at Northwind: \"We stopped emailing files the first week.\""],
  ["Do we need a demo video?", "A 40-second clip of the setup. Writer can script it later."],
];

/** The double. */
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
  const fired = new Set<string>();
  let tasks: FixtureTask[] = [];
  const runs = new Map<string, SessionStep[]>();
  /** The harness each task's run went through, by name. */
  const runHarness = new Map<string, string>();
  const notSetUp = new Set(options.notSetUp ?? []);
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

  const push = (w: FixtureWorker, entry: ConversationEntry) => {
    w.entries = [...w.entries, entry];
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
   * `receive` queued for the recipient. A send that isn't an answer asks for one.
   */
  const sendMessage = (w: FixtureWorker, to: string, text: string, inReplyTo?: string): Step[1] => () => {
    const message: TalkRow = { id: nextId("m"), from: w.row.id, to, text, inReplyTo, ...(inReplyTo ? {} : { replyRequested: true }), at: now() };
    push(w, { kind: "sent", id: nextId("s"), messageId: message.id, to, text });
    log.push(message);
    const recipient = worker(to);
    recipient.queue.push({ kind: "receive", message });
    notify();
    startNext(recipient);
  };

  const updateTask = (id: string, patch: Partial<BoardTask>) => {
    tasks = tasks.map((t) => (t.id === id ? { ...t, ...patch } : t));
    notify();
  };
  const step = (taskId: string, text: string): Step[1] => () => {
    runs.set(taskId, [...(runs.get(taskId) ?? []), { id: nextId("step"), kind: "tool", text }]);
    notify();
  };

  /**
   * `createTask` for coder: a card in the filer's conversation, and a run in the working folder. The
   * board's row lands a moment after the filing, as the real stream sends it.
   */
  const fileTask = (w: FixtureWorker, title: string, to = DEFAULT_CODER): Step[1] => () => {
    const id = nextId("t");
    const harness = worker(to).row.harness!;
    const task: FixtureTask = { id, to, title, status: "running", runSessionId: `run:${id}`, sessionId: w.sessionId, harness: HARNESS[harness]!.name };
    runHarness.set(id, HARNESS[harness]!.name);
    push(w, { kind: "task", id: nextId("k"), taskId: task.id, title, to });
    setTimeout(() => {
      tasks = [...tasks, task];
      notify();
    }, 300 * speed);
    const end = (status: "done" | "failed", result: string) => () => {
      updateTask(task.id, { status, result });
      w.queue.push({ kind: "result", task: { ...task, status, result } });
      startNext(w);
    };
    // A harness this machine isn't set up for: the task fails before any run, naming it.
    if (notSetUp.has(harness)) {
      const name = HARNESS[harness]!.name;
      setTimeout(end("failed", `${name} isn't set up on this machine: no sign-in found. Sign in to ${name}, then start the task again.`), 400 * speed);
      return;
    }
    const model = HARNESS[harness]!.model;
    let at = 0;
    for (const [delay, run] of [
      // The run reports its model, if its harness reports one, once it starts.
      [600, () => {
        if (model !== undefined) updateTask(task.id, { model });
        step(task.id, "Read README.md")();
      }],
      [1200, step(task.id, 'Edited line 1: "Relay keps" → "Relay keeps"')],
      [800, step(task.id, "Ran the docs check: passed")],
      [400, end("done", "Fixed the typo in README.md, line 1.")],
    ] as Step[]) {
      at += delay;
      setTimeout(run, at * speed);
    }
  };

  const script = (w: FixtureWorker, job: Job): Step[] => {
    if (job.kind === "result") return [[900, say(w, `The coding task is done: "${job.task.result}"`)]];
    if (job.kind === "receive") {
      const { message } = job;
      const from = worker(message.from).row.name;
      if (message.inReplyTo) return [[900, say(w, `${from} answered: "${message.text}" I've worked it into the plan.`)]];
      if (w.row.id === RESEARCHER) {
        return [[700, say(w, "Looking it up in the plan doc.")], [4000, sendMessage(w, message.from, "Nov 12, per the plan doc.", message.id)]];
      }
      return [[700, say(w, "On it.")], [2000, sendMessage(w, message.from, "Done. It's in the doc.", message.id)]];
    }
    // writer waits for your yes before it publishes: `waitForUser` with an approval.
    if (w.row.id === WRITER && /\bpublish\b/i.test(job.text)) {
      const suspensionId = nextId("sus");
      approvals.set(suspensionId, w);
      return [[600, () => push(w, { kind: "approval", id: nextId("ap"), requestId: nextId("req"), suspensionId, text: "Publish the draft to the team page?" })]];
    }
    if (w.row.id === LEAD && /\bfix\b/i.test(job.text)) {
      // The coding agent you name, else the default.
      const named = ROSTER.find((r) => r.takesTasks && new RegExp(`\\b${r.name}\\b`, "i").test(job.text));
      const to = named?.id ?? DEFAULT_CODER;
      return [
        [800, sayStreamed(w, `Starting a coding task on ${worker(to).row.name} for that. It runs in the background, and its card shows here.`)],
        [1200, fileTask(w, "Fix the typo in the README's first line", to)],
      ];
    }
    if (w.row.id === LEAD && !log.some((m) => m.from === LEAD && m.to === RESEARCHER)) {
      return [
        [800, say(w, "Asking researcher now. An outline:\n1 · the problem\n2 · what ships\n3 · how to try it")],
        [600, sendMessage(w, RESEARCHER, "What's our launch date?")],
      ];
    }
    // Chief of Staff thinks longer than researcher looks a fact up, so a reply can arrive while you talk to Chief of Staff.
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
    } else if (job.kind === "result") {
      const { task } = job;
      w.entries = [...w.entries, { kind: "result", id: nextId("r"), taskId: task.id, from: task.to, text: task.result ?? "" }];
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

  // Seed: Chief of Staff's conversation runs two turns past the window, with an exchange with writer near its end.
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
      return [...workers.values()].filter((w) => !fired.has(w.row.id)).map((w) => w.row);
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
        onChange({ entries: w.entries, running: w.running });
      });
    },

    async answerApproval(_sessionId, { suspensionId }, approve) {
      const w = approvals.get(suspensionId);
      if (!w) throw new Error(`no approval ${suspensionId}`);
      approvals.delete(suspensionId);
      w.entries = w.entries.map((e) => (e.kind === "approval" && e.suspensionId === suspensionId ? { ...e, resolution: approve ? "approved" : "rejected" } : e));
      say(w, approve ? "Published." : "Left it unpublished.")();
    },

    watchTalk(workerId, onChange) {
      return watch(() => onChange(log.filter((m) => m.from === workerId || m.to === workerId).sort((a, b) => a.at - b.at)));
    },

    watchActivity(workerId, onChange) {
      return watch(() => {
        const w = worker(workerId);
        // A worker that takes tasks is busy while one of its runs is.
        const running = w.row.takesTasks ? tasks.some((t) => t.to === workerId && t.status === "running") : w.running;
        onChange({ running, lastActiveAt: w.lastActiveAt });
      });
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

    async hire({ name, role }) {
      if (workers.has(name) && !fired.has(name)) throw new Error(`"${name}" is already on your roster`);
      const row: WorkerRow = { id: name, name, role, own: true };
      workers.set(name, { row, sessionId: `conversation:${name}`, entries: [], running: false, lastActiveAt: now(), queue: [] });
      notify();
      return row;
    },

    async editInstructions(workerId) {
      if (!worker(workerId).row.own) throw new Error(`"${workerId}" is a standard worker`);
    },

    async fire(workerId) {
      if (!worker(workerId).row.own) throw new Error(`"${workerId}" is a standard worker`);
      // Its conversation stays readable, so it keeps its place here and leaves the roster.
      fired.add(workerId);
      notify();
    },

    watchTasks(sessionId, onChange) {
      return watch(() => onChange(tasks.filter((t) => t.sessionId === sessionId).map(({ sessionId: _, ...card }) => card)));
    },

    watchRun(runSessionId, onChange) {
      const taskId = runSessionId.replace(/^run:/, "");
      return watch(() => {
        const steps = runs.get(taskId) ?? [];
        onChange(steps.length === 0 ? [] : [{ id: "harness", kind: "harness", text: `on ${runHarness.get(taskId)}` }, ...steps]);
      });
    },

    watchExchange(workerId, messageId, onChange) {
      // The recipient's turn that read the message: from its received entry to the next thing it was given.
      return watch(() => {
        const entries = worker(workerId).entries;
        const at = entries.findIndex((e) => e.kind === "received" && e.messageId === messageId);
        if (at < 0) return onChange([]);
        const steps: SessionStep[] = [];
        for (const e of entries.slice(at)) {
          if (steps.length > 0 && (e.kind === "user" || e.kind === "received")) break;
          if (e.kind === "received") steps.push({ id: e.id, kind: "given", text: e.text });
          else if (e.kind === "assistant") steps.push({ id: e.id, kind: "said", text: e.text, ...(e.streaming ? { streaming: true } : {}) });
          else if (e.kind === "sent") steps.push({ id: e.id, kind: "sent", text: e.text, to: e.to });
        }
        onChange(steps);
      });
    },
  };
}
