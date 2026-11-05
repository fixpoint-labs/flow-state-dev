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
 * one on a harness the double is told isn't set up fails at once, saying so. Told to, a run asks
 * you a question before it edits, and waits for your review once it has committed. A run reports
 * items in its harness's own shape (its tool names and arguments), read into steps by the
 * adapter's own `runSteps`. A task's buttons act on its row as the board would: Cancel stops its
 * run, Steer adds a line the run shows, Retry runs it again as the same task, and Re-run files a new
 * task on another coding worker, refused (`already_open`) while the same work is open there. Ask writer to
 * publish and it waits for your yes first. Each worker
 * answers one request at a time: a line you send, or a message from another
 * worker, waits while the worker is answering, and runs when it is done.
 * Chief of Staff's conversation starts past the 50-turn history window.
 */
import type { SessionConnectionState } from "@flow-state-dev/client";
import {
  rerunOverrides,
  runSteps,
  type ConversationEntry,
  type ReviewDetail,
  type TaskAnswer,
  type LabAdapter,
  type SessionStep,
  type TalkRow,
  type BoardTask,
  type Unsubscribe,
  type WindowMark,
  type WorkerRow,
} from "../src/adapter";

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
  /** A coding run asks which line has the typo before it edits, and waits for your answer. */
  asks?: boolean;
  /** A coding run that committed waits for your review: Accept completes it, Ask for changes runs it once more. */
  review?: boolean;
  /** How many roster reads fail as an unreachable server would, before one lands. */
  unreachableReads?: number;
  /** Board rows already there when the lab opens, each filed by the conversation of the worker `filer` names. */
  tasks?: (BoardTask & { filer: string })[];
}

/** The fixture, plus what a test does to its server. */
export interface FixtureLab extends LabAdapter {
  /** Every conversation's feed reports `state` from now on. */
  setConnection(state: SessionConnectionState): void;
}

/**
 * Each coding worker's harness, by name, the model its run reports, if it
 * reports one, and what its run spent once it has run its check: Codex on an
 * API key reports a charge; Claude Code on a subscription reports tokens only.
 */
const HARNESS: Record<string, { name: string; model?: string; spent?: { inputTokens: number; outputTokens: number; costUsd: number | null } }> = {
  "claude-code": { name: "Claude Code", spent: { inputTokens: 8_000, outputTokens: 1_200, costUsd: null } },
  codex: { name: "Codex", model: "gpt-5.5-codex", spent: { inputTokens: 12_400, outputTokens: 2_300, costUsd: 0.42 } },
  cursor: { name: "Cursor" },
};

/**
 * The tools each harness's run calls to fix the typo, under their own names
 * and arguments: it reads the file, edits it, and runs the docs check.
 */
const RUN_TOOLS: Record<string, Record<"read" | "edit" | "check", [string, Record<string, unknown>]>> = {
  "claude-code": {
    read: ["Read", { file_path: "/work/README.md" }],
    edit: ["Edit", { file_path: "/work/README.md", old_string: "Relay keps", new_string: "Relay keeps" }],
    check: ["Bash", { command: "pnpm docs:check", description: "Run the docs check" }],
  },
  codex: {
    read: ["command_execution", { command: "sed -n 1p README.md" }],
    edit: ["file_change", { changes: [{ path: "/work/README.md", kind: "update" }] }],
    check: ["command_execution", { command: "cd /work && pnpm docs:check" }],
  },
  cursor: {
    read: ["read", { path: "/work/README.md" }],
    edit: ["edit", { path: "/work/README.md" }],
    check: ["shell", { command: "pnpm docs:check" }],
  },
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

/** A board row, and the conversation that filed it. `attempt` counts its runs, so a run a cancel or retry left behind stops. */
type FixtureTask = BoardTask & { sessionId: string; attempt?: number };

/** The board's words for an action on a task that has ended or is still open, as `updateTask` and `retryTask` refuse. */
const refusal = (task: FixtureTask, verb: string) => `${verb}: task "${task.title}" (${task.id}) is ${task.boardStatus}.`;

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
export function createFixtureLab(options: FixtureOptions = {}): FixtureLab {
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
  let tasks: FixtureTask[] = (options.tasks ?? []).map(({ filer, ...task }) => ({ ...task, sessionId: worker(filer).sessionId }));
  /** Each task's run, as the items its harness reports. */
  const runs = new Map<string, Record<string, unknown>[]>();
  const notSetUp = new Set(options.notSetUp ?? []);
  let unreachable = options.unreachableReads ?? 0;
  let connection: SessionConnectionState = "live";
  /** What each run waiting on you is waiting for: the answer it goes on with. */
  const waits = new Map<string, (answer: TaskAnswer) => void>();
  /** Each run's latest review, by its run session. */
  const reviews = new Map<string, ReviewDetail>();
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

  const updateTask = (id: string, patch: Partial<FixtureTask>) => {
    tasks = tasks.map((t) => (t.id === id ? { ...t, ...patch } : t));
    notify();
  };
  /** One item of a run, as its harness's block reports it. */
  const report = (taskId: string, harness: string, item: Record<string, unknown>): Step[1] => () => {
    runs.set(taskId, [...(runs.get(taskId) ?? []), { id: nextId("item"), status: "completed", provenance: { blockName: `${harness}-agent` }, ...item }]);
    notify();
  };
  const tool = (name: string, args: Record<string, unknown>) => ({ type: "tool_output", toolCall: { name, arguments: JSON.stringify(args) } });
  const said = (text: string) => ({ type: "message", role: "assistant", content: [{ type: "output_text", text }] });

  /**
   * `createTask` for coder: a card in the filer's conversation, and a run in the working folder. The
   * board's row lands a moment after the filing, as the real stream sends it.
   */
  const fileTask = (w: FixtureWorker, title: string, to = DEFAULT_CODER): Step[1] => () => {
    const id = nextId("t");
    const harness = worker(to).row.harness!;
    const task: FixtureTask = {
      id,
      to,
      title,
      goal: title,
      status: "running",
      boardStatus: "in_progress",
      runSessionId: `run:${id}`,
      sessionId: w.sessionId,
      harness: HARNESS[harness]!.name,
    };
    push(w, { kind: "task", id: nextId("k"), taskId: task.id, title, to });
    setTimeout(() => {
      tasks = [...tasks, task];
      notify();
    }, 300 * speed);
    runTask(w, task);
  };

  /** A coding task's run, on its worker's harness, until it ends, or a cancel or a retry leaves it behind. */
  const runTask = (w: FixtureWorker, task: FixtureTask) => {
    const harness = worker(task.to).row.harness!;
    const attempt = (task.attempt ?? 0) + 1;
    task.attempt = attempt;
    if (tasks.some((t) => t.id === task.id)) updateTask(task.id, { attempt });
    /** The row as it stands now. */
    const row = () => tasks.find((t) => t.id === task.id);
    /** This run still owns its task: it wasn't cancelled, nor run again. */
    const live = () => (row()?.attempt ?? attempt) === attempt && row()?.boardStatus !== "cancelled";
    const end = (status: "done" | "failed", text: string) => () => {
      if (!live()) return;
      const ending = status === "done" ? { result: text } : { error: text };
      updateTask(task.id, { status, boardStatus: status === "done" ? "completed" : "errored", ...ending });
      w.queue.push({ kind: "result", task: { ...task, status, ...ending } });
      startNext(w);
    };
    // A harness this machine isn't set up for: the task fails before any run, naming it.
    if (notSetUp.has(harness)) {
      const name = HARNESS[harness]!.name;
      setTimeout(end("failed", `${name} isn't set up on this machine: no sign-in found. Sign in to ${name}, then start the task again.`), 400 * speed);
      return;
    }
    const model = HARNESS[harness]!.model;
    const spent = HARNESS[harness]!.spent;
    const calls = RUN_TOOLS[harness]!;
    const call = (which: "read" | "edit" | "check") => report(task.id, harness, tool(...calls[which]));
    const sleep = async (ms: number) => {
      await new Promise<void>((resolve) => setTimeout(resolve, ms * speed));
      // A cancelled or re-run task's old run goes no further.
      if (!live()) throw new Error("left behind");
    };
    /** The task waits on you for `waiting`, until you answer. */
    const waitOn = (waiting: NonNullable<BoardTask["waiting"]>) =>
      new Promise<TaskAnswer>((resolve) => {
        waits.set(task.id, (answer) => {
          waits.delete(task.id);
          updateTask(task.id, { waiting: undefined });
          resolve(answer);
        });
        updateTask(task.id, { waiting });
      });
    void (async () => {
      await sleep(600);
      // The run reports its model, if its harness reports one, once it starts.
      if (model !== undefined) updateTask(task.id, { model });
      call("read")();
      await sleep(600);
      report(task.id, harness, said('The typo is on line 1: "Relay keps".'))();
      if (options.asks) {
        const answer = await waitOn({ kind: "question", prompt: "Should I fix only line 1, or every typo?", unanswerable: null });
        report(task.id, harness, { type: "message", role: "user", content: [{ type: "input_text", text: "text" in answer ? answer.text : "" }] })();
      }
      await sleep(600);
      call("edit")();
      await sleep(800);
      call("check")();
      // What the run spent, as the row's folded view reads it once the run has reported.
      if (spent !== undefined) updateTask(task.id, { spend: { harness, model: model ?? null, ...spent, unreported: false, live: false } });
      for (let commits = 1; options.review; commits++) {
        reviews.set(task.runSessionId!, {
          branch: `teammates/${task.id}--change`,
          commits,
          subjects: Array.from({ length: commits }, (_, i) => (i === 0 ? "docs: fix the README typo" : "docs: keep the old wording")).reverse(),
          judge: { verdict: "done", confidence: 0.91, reason: "The typo on line 1 is fixed." },
          checks: null,
        });
        notify();
        const answer = await waitOn({ kind: "review", prompt: `${commits} commit${commits === 1 ? "" : "s"} on teammates/${task.id}--change`, unanswerable: null });
        if ("verdict" in answer && answer.verdict === "accepted") break;
        report(task.id, harness, said(`Revising: ${"words" in answer ? answer.words : ""}`))();
        await sleep(600);
        call("edit")();
      }
      await sleep(400);
      end("done", "Fixed the typo in README.md, line 1.")();
    })().catch(() => {});
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
    // writer waits for your yes before it publishes: `suspendForUser` with an approval.
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
      w.entries = [...w.entries, { kind: "result", id: nextId("r"), taskId: task.id, from: task.to, text: task.result ?? task.error ?? "", title: task.title, ...(task.status === "failed" ? { failed: true } : {}) }];
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
    setConnection(state) {
      connection = state;
      notify();
    },

    async readContext() {
      return { folder: "/work/launch-site", folderProblem: null, model: "openai/gpt-6-luna", harness: "cursor", delegates: { [LEAD]: "all" as const } };
    },

    async readHarnesses() {
      return [
        { harness: "claude-code", label: "Claude Code", ready: true, reason: null, remedy: null, unanswered: false },
        { harness: "codex", label: "Codex", ready: false, reason: "Codex has no credential", remedy: "Run `codex login`", unanswered: false },
        { harness: "cursor", label: "Cursor", ready: true, reason: null, remedy: null, unanswered: false },
      ];
    },

    async listWorkers() {
      return [...workers.values()].filter((w) => !fired.has(w.row.id)).map((w) => w.row);
    },

    watchWorkers(onChange, onError) {
      if (unreachable > 0) {
        unreachable -= 1;
        // Told after the call returns, as a read that failed would be.
        queueMicrotask(() => onError?.(new TypeError("fetch failed")));
        return () => {};
      }
      let last = "";
      return watch(() => {
        const rows = [...workers.values()].filter((w) => !fired.has(w.row.id)).map((w) => w.row);
        const seen = JSON.stringify(rows);
        if (seen === last) return;
        last = seen;
        onChange(rows);
      });
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

    watchReview(runSessionId, onChange) {
      return watch(() => onChange(reviews.get(runSessionId)));
    },

    async answerTask(_sessionId, taskId, answer) {
      const go = waits.get(taskId);
      if (go === undefined) throw new Error(`This task isn't waiting on you.`);
      go(answer);
    },

    taskActions(sessionId) {
      const filed = (taskId: string) => {
        const task = tasks.find((t) => t.id === taskId && t.sessionId === sessionId);
        if (task === undefined) throw new Error(`not_found: no task "${taskId}" on this board.`);
        return task;
      };
      const open = (task: FixtureTask) => ["pending", "held", "in_progress"].includes(task.boardStatus);
      const filer = () => bySession(sessionId)!;
      return {
        async cancel(taskId) {
          const task = filed(taskId);
          if (!open(task)) throw new Error(refusal(task, "finished"));
          waits.delete(taskId);
          updateTask(taskId, { status: "cancelled", boardStatus: "cancelled", waiting: undefined });
          return [];
        },
        async steer(taskId, message) {
          const task = filed(taskId);
          if (!open(task)) throw new Error(refusal(task, "finished"));
          // The run reads the line as one more given to it.
          report(taskId, worker(task.to).row.harness!, { type: "message", role: "user", content: [{ type: "input_text", text: message }] })();
        },
        async release(taskId) {
          const task = filed(taskId);
          if (task.boardStatus !== "held") throw new Error(refusal(task, "not_held"));
          updateTask(taskId, { boardStatus: "pending" });
        },
        async retry(taskId) {
          const task = filed(taskId);
          if (task.boardStatus !== "errored" && task.boardStatus !== "cancelled") throw new Error(refusal(task, "not_ended"));
          updateTask(taskId, { status: "running", boardStatus: "in_progress", error: undefined, result: undefined });
          runTask(filer(), filed(taskId));
        },
        async rerun(task, to) {
          const { assignee, context } = rerunOverrides(task, to) as { assignee: string; context: string };
          const same = tasks.find((t) => t.sessionId === sessionId && t.to === assignee && open(t) && t.goal === task.goal);
          if (same !== undefined) {
            throw new Error(`already_open: task "${same.title}" (${same.id}) is this same work for ${assignee}, and it is still ${same.boardStatus}. Nothing was filed.`);
          }
          const id = nextId("t");
          const harness = worker(assignee).row.harness!;
          const next: FixtureTask = {
            id,
            to: assignee,
            title: task.title,
            goal: task.goal,
            context,
            status: "running",
            boardStatus: "in_progress",
            runSessionId: `run:${id}`,
            sessionId,
            harness: HARNESS[harness]!.name,
          };
          tasks = [...tasks, next];
          notify();
          runTask(filer(), next);
          return id;
        },
      };
    },

    watchRun(runSessionId, onChange) {
      const taskId = runSessionId.replace(/^run:/, "");
      return watch(() => {
        onChange(runSteps((runs.get(taskId) ?? []) as never));
      });
    },

    watchWorking(_run, onChange) {
      // The double's runs report each step as it finishes and record no plan: the line keeps its plain label.
      onChange({});
      return () => {};
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
