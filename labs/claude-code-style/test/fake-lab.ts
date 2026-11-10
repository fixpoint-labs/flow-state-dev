/**
 * A test double for the screen's tests: an in-memory `LabAdapter` that plays
 * each mode's script on a timer, so the layout and its interactions can be
 * tested without a server. It proves the UI only; the goal check
 * (`goals/claude-code-style-lab/`) proves the package. The app never imports
 * it: `src/adapter.ts` binds every verb to the package.
 *
 * Session mode: any ask starts the vendor script. The main session writes,
 * starts two background tasks, takes the quick one's result while its turn
 * still runs, and ends with the long one still running.
 *
 * Threads mode: any ask starts three threads. One asks you a question and
 * waits under *Waiting on you* until you answer in its thread; one becomes
 * ready for review. A request that names a code change or the CHANGELOG starts
 * one thread through Claude Code instead, which becomes ready for review with
 * the judge's verdict.
 *
 * In either mode, a request that says "stop" or "cancel" while a task runs makes
 * the main session cancel it. A line sent while a turn runs starts its own
 * turn at once, beside the running one, as the main session's door (`hold`)
 * starts it on the server; that turn only notes the line. `failTurn` fails the
 * newest running turn, as an engine `error` item would; Retry runs that turn's
 * line again.
 */
import type {
  ConnectionState,
  LabAdapter,
  LabProject,
  ReviewDetail,
  LabSession,
  LabTask,
  TaskWork,
  ThreadEntry,
  ThreadView,
  Unsubscribe,
} from "../src/adapter";
import { taskView } from "@flow-state-dev/orchestration/inbox";
import { dismissalKey, waitingOnYou } from "../src/lib/columns";
import { toolRun } from "../src/lib/tool-steps";
import { modeById, modeOfWorker, type ModeId } from "../src/modes";

/** How the fake keeps time. Tests pass `speed` to run the script fast. */
export interface FakeOptions {
  /** Multiplies every delay. 1 is real time. */
  speed?: number;
  /** The clock, in ms. */
  now?: () => number;
}

/** The fake, plus what a test does to its server. */
export interface FakeLab extends LabAdapter {
  /** Every thread's feed reports `state` from now on. */
  setConnection(state: ConnectionState): void;
  /** The open task titled `title`, in any session, fails with `error`, as its run would. */
  fail(title: string, error: string): void;
  /** The running turn of session `sessionId` fails with `reason`: a reply under way is left incomplete. */
  failTurn(sessionId: string, reason: string): void;
  /** Each `retry` the screen made, in order. */
  readonly retries: { sessionId: string; requestId: string }[];
  /** The next turn's model call fails with `reason`, before any reply: the contract tests' failed turn. */
  failNextTurn(reason: string): void;
  /** The next Stop is refused while its turn runs on, as a server that resumed the turn first refuses it. */
  refuseNextStop(): void;
}

interface FixtureTask extends LabTask {
  work: ThreadEntry[];
  /** What its run's review stop carries, for a harness thread ready for review. */
  reviewDetail?: ReviewDetail;
}

/** One running turn: when it started, its steps still due, and its last entry so far. */
interface FixtureTurn {
  startedAt: number;
  /** The line it answers: Retry runs it again. */
  origin: string;
  /** The turn's steps: Stop clears these. */
  timers: ReturnType<typeof setTimeout>[];
  /** Its latest entry's id: a stopped line goes after it, as the real adapter places one. */
  last?: string;
}

interface FixtureSession {
  row: LabSession;
  entries: ThreadEntry[];
  /** The turns running now, oldest first: a line sent mid-turn starts one beside the others. */
  turns: FixtureTurn[];
  /** A Stop is under way: from the press until the turn has ended, as the real adapter reads it. */
  stopping?: boolean;
  /** Background tasks' steps: they outlive the turn; a step skips a task that is no longer running. */
  taskTimers: ReturnType<typeof setTimeout>[];
  tasks: FixtureTask[];
}

/** A scripted step; `background` steps belong to a task, not to the turn. */
type Step = [delayMs: number, run: () => void, background?: "background"];

const MINUTE = 60_000;
/** The models the fake's runs report: a researcher's, and Claude Code's. */
const RESEARCH_MODEL = "openai/gpt-6-luna";
const CODE_MODEL = "claude-sonnet-4-5";

/** A coding run's review, as its stop carries it: a real run's branch is this long. */
const CODE_REVIEW: ReviewDetail = {
  branch: "conductor/t0/ha62422c9f1e0b7d4c2a8e5f3b1d6a9c0e4f7b2d-h0163a0cb8e2d4f6a1c3b5d7e9f0a2c4e6b8d0f1a/t-7f3c2e1a9b--code",
  commits: 1,
  subjects: ["docs(changelog): note the vendor pick, with the status-page comparison it came from and the date it was made"],
  judge: {
    verdict: "done",
    confidence: 0.91,
    reason: "The CHANGELOG gains one line naming Vendor C and why; nothing else in the repository changed, and the line follows the file's existing format.",
  },
  checks: null,
};

/** The run's last words, as a real one ends: a long path and its branch, unbroken. */
const CODE_ANSWER = [
  "One commit, CHANGELOG.md only.",
  "",
  "**Remaining / caveats**",
  "",
  `- Committed on \`${CODE_REVIEW.branch}\`; nothing is pushed.`,
  "- The line links `docs/internal/vendor-comparisons/2026-10-30-status-page-vendors-pricing-uptime-regions.md`, which this run did not write.",
].join("\n");

/** The prompt harness-manager's review stop writes for `CODE_REVIEW` (its `reviewPrompt`). */
const CODE_REVIEW_PROMPT = [
  `1 commit on ${CODE_REVIEW.branch}:`,
  `- ${CODE_REVIEW.subjects[0]}`,
  "",
  `The judge: done (0.91): ${CODE_REVIEW.judge!.reason}`,
  "The judge's verdict is information, not approval. Accept the changes, or ask for changes in words.",
].join("\n");

/** fake: stands in for the whole package until wiring. */
export function createFakeLab(options: FakeOptions = {}): FakeLab {
  const speed = options.speed ?? 1;
  const now = options.now ?? (() => Date.now());
  const sessions = new Map<string, FixtureSession>();
  const listeners = new Set<() => void>();
  let seq = 0;
  let connection: ConnectionState = "live";
  let failNext: string | undefined;
  let refuseStop = false;
  const nextId = (prefix: string) => `${prefix}-${++seq}`;
  /** Files the composer uploaded, by id: what `readFile` serves. */
  const uploads = new Map<string, Blob>();

  const notify = () => {
    for (const listener of [...listeners]) listener();
  };
  const watch = (emit: () => void): Unsubscribe => {
    listeners.add(emit);
    emit();
    return () => listeners.delete(emit);
  };

  const session = (id: string): FixtureSession => {
    const found = sessions.get(id);
    if (!found) throw new Error(`no session ${id}`);
    return found;
  };

  const isRunning = (s: FixtureSession) => s.turns.length > 0;

  const touch = (s: FixtureSession) => {
    s.row = { ...s.row, updatedAt: now(), running: isRunning(s) };
  };

  /** The turn whose step is running now, so an entry it pushes is counted as its. */
  let active: FixtureTurn | undefined;

  const push = (s: FixtureSession, entry: ThreadEntry) => {
    s.entries = [...s.entries, entry];
    if (active !== undefined) active.last = entry.id;
    touch(s);
    notify();
  };

  const setTask = (s: FixtureSession, id: string, patch: Partial<FixtureTask>) => {
    s.tasks = s.tasks.map((t) => (t.id === id ? { ...t, ...patch, updatedAt: now() } : t));
    touch(s);
    notify();
  };

  /** Plays `steps` on their timers: a turn's steps under turn `t`, a task's in the background. */
  const play = (s: FixtureSession, t: FixtureTurn | undefined, steps: Step[]) => {
    let at = 0;
    for (const [delay, run, background] of steps) {
      at += delay;
      if (background || t === undefined) {
        s.taskTimers.push(setTimeout(run, at * speed));
        continue;
      }
      t.timers.push(
        setTimeout(() => {
          active = t;
          try {
            run();
          } finally {
            active = undefined;
          }
        }, at * speed),
      );
    }
  };

  /** A turn starts for the line `origin`, beside any already running. */
  const startTurn = (s: FixtureSession, origin: string): FixtureTurn => {
    const t: FixtureTurn = { startedAt: now(), origin, timers: [], last: origin };
    s.turns = [...s.turns, t];
    touch(s);
    notify();
    return t;
  };

  const endTurn = (s: FixtureSession, t: FixtureTurn) => {
    // The turn's steps have all run; background steps stay in `taskTimers`.
    for (const timer of t.timers) clearTimeout(timer);
    s.turns = s.turns.filter((other) => other !== t);
    touch(s);
    notify();
  };

  const say = (s: FixtureSession, text: string): Step[1] => () => push(s, { kind: "assistant", id: nextId("a"), text });

  const startTask = (title: string, goal: string, note: string | undefined, extra: Partial<FixtureTask> = {}): FixtureTask => ({
    id: nextId("task"),
    title,
    goal,
    status: "in_progress",
    assignee: "desk.thread",
    statusNote: note,
    work: [{ kind: "assistant", id: nextId("w"), text: `Starting: ${goal}` }],
    ...extra,
  });

  /** The next state of a task that is still working, with an optional line of its work. */
  const writeStep = (s: FixtureSession, task: FixtureTask | undefined, patch: Partial<FixtureTask>, line?: string) => {
    if (!task || task.status !== "in_progress") return;
    const work = line ? [...task.work, { kind: "assistant" as const, id: nextId("w"), text: line }] : task.work;
    setTask(s, task.id, { ...patch, work });
  };

  /** A row's `spend`, as the board's `listTasks` reads it. */
  const spent = (model: string, inputTokens: number | null, outputTokens: number | null, live: boolean, harness: string | null = null): FixtureTask["spend"] => ({
    harness,
    model,
    inputTokens,
    outputTokens,
    unreported: inputTokens === null,
    live,
  });

  const file = (s: FixtureSession, title: string, goal: string, note: string): Step[1] => () => {
    const task = startTask(title, goal, note, { assignee: "desk.researcher", spend: spent(RESEARCH_MODEL, 1200, 300, true) });
    s.tasks = [...s.tasks, task];
    push(s, { kind: "tool", id: nextId("tool"), ...toolRun([{ id: "c", name: "createTask", args: { title, goal }, status: "done", output: { ok: true, taskId: task.id } }]) });
  };

  const progress = (s: FixtureSession, title: string, note: string) => () =>
    writeStep(s, s.tasks.find((t) => t.title === title), { statusNote: note }, note);

  const settle = (s: FixtureSession, title: string, summary: string): Step[1] => () => {
    const task = s.tasks.find((t) => t.title === title);
    if (!task || task.status !== "in_progress") return;
    writeStep(s, task, { status: "completed", statusNote: undefined, spend: spent(RESEARCH_MODEL, 5400, 900, false) }, summary);
    // fake: stands in for the main worker's `answerAgain: true` (FIX-2159): the take shows as an item in the running request.
    push(s, {
      kind: "result",
      id: nextId("r"),
      taskId: task.id,
      title,
      status: "completed",
      summary,
      duringTurn: isRunning(s),
    });
  };

  const vendorScript = (s: FixtureSession, t: FixtureTurn): Step[] => [
    [800, say(s, "I'll write the outline myself and research both vendors in the background.")],
    [600, file(s, "Research Acme", "Find Acme's price, support hours and certifications.", "searching")],
    [400, file(s, "Research Globex", "Read Globex's pricing pages, support terms and audits.", "reading pricing pages")],
    [800, say(s, "Outline:\n1. Price\n2. Support\n3. Risks")],
    [600, progress(s, "Research Acme", "summarizing"), "background"],
    [1000, settle(s, "Research Acme", "Acme: $40 per user, 24-hour support, SOC 2 since 2024."), "background"],
    [800, say(s, "Acme's research is in. Section 1 now reads: Acme costs $40 per user, with 24-hour support.")],
    [1200, say(s, "Globex is still running in the background. I'll fold it in when it lands.")],
    [200, () => endTurn(s, t)],
    [2800, progress(s, "Research Globex", "reading support terms"), "background"],
    [3000, progress(s, "Research Globex", "checking audit reports"), "background"],
  ];

  const stopScript = (s: FixtureSession, t: FixtureTurn, task: FixtureTask): Step[] => [
    [700, () => {
      // The task may have settled since the turn began; a finished task stays finished.
      const current = s.tasks.find((t) => t.id === task.id)?.status;
      if (current === "completed" || current === "cancelled" || current === "errored") {
        push(s, { kind: "assistant", id: nextId("a"), text: `"${task.title}" had already finished, so there was nothing to stop.` });
        return;
      }
      push(s, { kind: "tool", id: nextId("tool"), ...toolRun([{ id: "c", name: "updateTask", args: { taskId: task.id, status: "cancelled" }, status: "done", output: { ok: true } }]) });
      setTask(s, task.id, { status: "cancelled", statusNote: undefined, openHold: undefined });
      push(s, { kind: "assistant", id: nextId("a"), text: `Stopped "${task.title}". The summary covers what is done so far.` });
    }],
    [200, () => endTurn(s, t)],
  ];

  /** A filed thread's id, set when the lead files it, so later steps find that thread and no other. */
  type Ref = { id?: string };

  const fileThread = (
    s: FixtureSession,
    origin: string,
    ref: Ref,
    title: string,
    goal: string,
    note: string,
    extra: Partial<FixtureTask> = {},
  ): Step[1] => () => {
    const task = startTask(title, goal, note, { updatedAt: now(), ...extra });
    ref.id = task.id;
    s.tasks = [...s.tasks, task];
    push(s, { kind: "thread", id: nextId("card"), taskId: task.id });
    // The line that asked for it is marked once the lead's turn files a thread for it.
    s.entries = s.entries.map((e) => (e.id === origin && e.kind === "user" ? { ...e, sentToThread: true } : e));
    notify();
  };

  const advance = (s: FixtureSession, ref: Ref, patch: Partial<FixtureTask>, line?: string): Step[1] => () =>
    writeStep(s, s.tasks.find((t) => t.id === ref.id), patch, line);

  const ask = (prompt: string): Partial<FixtureTask> => ({ status: "held", openHold: { kind: "question", prompt }, statusNote: prompt });
  const review = (prompt: string): Partial<FixtureTask> => ({ status: "in_progress", openHold: { kind: "review", prompt }, statusNote: prompt });

  const threadsScript = (s: FixtureSession, t: FixtureTurn, origin: string): Step[] => {
    const [a, b, c]: Ref[] = [{}, {}, {}];
    return [
      [600, fileThread(s, origin, a, "Vendor A · pricing and uptime", "Compare Vendor A's price and uptime record.", "Reading pricing pages", { steps: { done: 0, total: 7 } })],
      [300, fileThread(s, origin, b, "Vendor B · regions", "Find where Vendor B hosts, for the region that matters.", "Listing regions")],
      [300, fileThread(s, origin, c, "Vendor C · summary", "Draft a summary of Vendor C for review.", "Gathering notes")],
      [500, say(s, "I've started three threads, one per vendor. Each comes back to you when it needs you.")],
      [200, () => endTurn(s, t)],
      [600, advance(s, a, { steps: { done: 1, total: 7 }, statusNote: "Comparing plans" }, "Comparing plans"), "background"],
      [400, advance(s, b, ask("Which region matters, EU or US?"), "Which region matters, EU or US?"), "background"],
      [600, advance(s, a, { steps: { done: 2, total: 7 }, statusNote: "Comparing SLA tiers" }, "Comparing SLA tiers"), "background"],
      [600, advance(s, c, review("Draft summary attached"), "Vendor C: $29 per user, 99.95% uptime last year, EU and US hosting."), "background"],
    ];
  };

  const codeScript = (s: FixtureSession, t: FixtureTurn, text: string, origin: string): Step[] => {
    const ref: Ref = {};
    return [
      [600, fileThread(s, origin, ref, text.split("\n")[0].slice(0, 60), text, "Editing CHANGELOG.md", { assignee: "desk.coder", harness: "claude-code", spend: spent(CODE_MODEL, null, null, true, "claude-code") })],
      [400, say(s, "I've started a Claude Code thread for it, in this session's project.")],
      [200, () => endTurn(s, t)],
      [1200, advance(s, ref, { statusNote: "Committing", spend: spent(CODE_MODEL, 8200, 1100, true, "claude-code") }, "Committing: docs: note the vendor pick"), "background"],
      [800, advance(s, ref, { ...review(CODE_REVIEW_PROMPT), reviewDetail: CODE_REVIEW, spend: spent(CODE_MODEL, 12000, 1600, true, "claude-code") }, CODE_ANSWER), "background"],
    ];
  };

  const turn = (s: FixtureSession, text: string, origin: string) => {
    // Another turn already running: this line's turn starts beside it.
    const beside = isRunning(s);
    const t = startTurn(s, origin);
    if (failNext !== undefined) {
      const reason = failNext;
      failNext = undefined;
      play(s, t, [[300, () => failTurnOf(s, t, reason)]]);
      return;
    }
    const threads = modeOfWorker(s.row.worker)?.id === "threads";
    // The task the line names (by a word of its title), finished or not, else the first one running.
    // The stop script re-reads its status, so a finished one is reported, not swapped for another.
    const runningTasks = s.tasks.filter((t) => t.status === "in_progress" || t.status === "held");
    // One tokenizer for the line and the titles, so punctuation (`second.ts`) splits the same on both sides.
    const tokens = (s: string) => s.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];
    const words = new Set(tokens(text));
    // The task whose title shares the most words with the line, so `second.ts` beats a shared `ts`.
    const score = (t: FixtureTask) => tokens(t.title).slice(1).filter((word) => words.has(word)).length;
    const named = s.tasks.reduce<FixtureTask | undefined>((best, t) => (score(t) > (best ? score(best) : 0) ? t : best), undefined);
    const running = named ?? runningTasks[0];
    if (/\b(stop|cancel)\b/i.test(text) && running) {
      play(s, t, stopScript(s, t, running));
    } else if (threads && /\b(changelog|code)\b/i.test(text)) {
      play(s, t, codeScript(s, t, text, origin));
    } else if (!beside && threads && !s.tasks.some((task) => task.assignee === "desk.thread")) {
      play(s, t, threadsScript(s, t, origin));
    } else if (!beside && !threads && s.tasks.length === 0) {
      play(s, t, vendorScript(s, t));
    } else {
      play(s, t, [[800, say(s, "Noted. I'll keep that in mind as the background work comes in.")], [200, () => endTurn(s, t)]]);
    }
  };

  // fake: the person's access to each project. A session may open only where they may work: a
  // member of a shared project or the owner of a private one. Reading one is not enough, the same
  // not-a-member refusal projectWorkspace() makes for a run.
  const projects: (LabProject & { visibility: "shared" | "private"; access: "member" | "owner" | "reader" })[] = [
    { id: "project-vendor-notes", name: "vendor-notes", visibility: "shared", access: "member" },
    { id: "project-onboarding-app", name: "onboarding-app", visibility: "private", access: "owner" },
    { id: "project-billing-service", name: "billing-service", visibility: "shared", access: "reader" },
  ];
  const mayWorkIn = projects
    .filter((p) => (p.visibility === "shared" ? p.access === "member" : p.access === "owner"))
    .map(({ id, name }): LabProject => ({ id, name }));

  const seed = (title: string, ago: number, projectId: string | null, lines: [string, string]) => {
    const id = nextId("session");
    sessions.set(id, {
      row: { id, title, worker: modeById("session").worker, updatedAt: now() - ago, running: false, waiting: 0, projectId },
      entries: [
        { kind: "user", id: nextId("u"), text: lines[0] },
        { kind: "assistant", id: nextId("a"), text: lines[1] },
      ],
      turns: [],
      taskTimers: [],
      tasks: [],
    });
  };
  // fake: an older session with no project, so the screen shows what asking looks like.
  seed("Fix the onboarding copy", 26 * 60 * MINUTE, null, ["Tighten the onboarding copy.", "Done. The three screens now read in under ten seconds each."]);
  seed("Draft the launch note", 2 * 60 * MINUTE, "project-vendor-notes", ["Draft the launch note.", "Here is a first draft, about 200 words."]);

  // fake: your pinned task ids, which the lab's pins flow keeps at wiring.
  const pins = new Set<string>();
  // fake: the failed attempts you dismissed, which the lab's dismissals flow keeps at wiring.
  const dismissed = new Set<string>();

  // fake: an older threads-mode session, with a pinned thread, a failed one and two resolved.
  const seedThreads = () => {
    const id = nextId("session");
    const ago = 26 * 60 * MINUTE;
    const thread = (title: string, status: FixtureTask["status"], note?: string) =>
      startTask(title, title, note, { status, updatedAt: now() - ago });
    const tasks = [
      thread("Weekly uptime digest", "in_progress", "Collecting this week's incidents"),
      { ...thread("Export failed invoices", "errored", "The export timed out"), error: "The export timed out after 30s.", attempts: 1 },
      thread("Refund report", "completed"),
      thread("Dunning emails", "completed"),
      // A harness run nobody reviewed by the person-stop deadline: it completed, marked so.
      { ...thread("Retry webhook on 502", "completed"), assignee: "desk.coder", harness: "claude-code", review: "deadline" as const },
    ];
    pins.add(tasks[0].id);
    sessions.set(id, {
      row: { id, title: "Billing triage", worker: modeById("threads").worker, updatedAt: now() - ago, running: false, waiting: 0, projectId: "project-vendor-notes" },
      entries: [
        { kind: "user", id: nextId("u"), text: "Triage this week's billing work, a thread each.", sentToThread: true },
        ...tasks.map((t): ThreadEntry => ({ kind: "thread", id: nextId("card"), taskId: t.id })),
        { kind: "assistant", id: nextId("a"), text: "I've started four threads." },
      ],
      turns: [],
      taskTimers: [],
      tasks,
    });
  };
  seedThreads();

  /** An open task, by id, or the board's refusal in words. */
  const openTask = (s: FixtureSession, id: string): FixtureTask => {
    const task = s.tasks.find((t) => t.id === id);
    if (!task) throw new Error(`No task "${id}" on this board.`);
    if (task.status === "completed" || task.status === "errored" || task.status === "cancelled") throw new Error(`Task "${id}" is already ${task.status}.`);
    return task;
  };

  const retries: { sessionId: string; requestId: string }[] = [];

  /** Turn `t` fails with `reason`: its reply under way is left incomplete, and its failed line is the one Retry is offered on. */
  const failTurnOf = (s: FixtureSession, t: FixtureTurn, reason: string) => {
    // The turn's line names it, so Retry can run it again; an older failure is no longer the newest turn.
    const requestId = `turn-${t.origin}`;
    const last = s.entries.find((e) => e.id === t.last);
    s.entries = s.entries.map((e) => (e.kind === "failed" ? { ...e, retryable: false } : e === last && e.kind === "assistant" ? { ...e, incomplete: true } : e));
    push(s, { kind: "failed", id: nextId("f"), reason, retryable: true, requestId });
    endTurn(s, t);
  };

  const fake: FakeLab = {
    retries,
    failTurn(sessionId, reason) {
      const s = session(sessionId);
      const t = s.turns.at(-1);
      if (t !== undefined) failTurnOf(s, t, reason);
    },
    setConnection(state) {
      connection = state;
      notify();
    },
    refuseNextStop() {
      refuseStop = true;
    },
    failNextTurn(reason) {
      failNext = reason;
    },
    fail(title, error) {
      for (const s of sessions.values()) {
        const task = s.tasks.find((t) => t.title === title && t.status === "in_progress");
        if (task) setTask(s, task.id, { status: "errored", statusNote: undefined, error });
      }
    },
    modes: ["session", "threads"],
    watchSessions(onChange) {
      return watch(() => onChange([...sessions.values()].map((s) => ({ ...s.row, waiting: waitingOnYou(s.tasks, dismissed) })).sort((a, b) => b.updatedAt - a.updatedAt)));
    },

    async listProjects() {
      return mayWorkIn;
    },

    async createProject(name: string) {
      const project = { id: nextId("project"), name };
      mayWorkIn.push(project);
      return project;
    },

    async checkRepository(repository: string) {
      // The fake's one unusable shape: a folder named for it. Everything else is a listed repository.
      return repository.includes("not-a-repo")
        ? { usable: false as const, problem: "there is no git repository there. Run `git init` there, or name a repository's folder." }
        : { usable: true as const, how: "worktree" as const };
    },

    async readHarnesses() {
      return [
        { harness: "claude-code", label: "Claude Code", ready: true, reason: null, remedy: null, unanswered: false },
        { harness: "codex", label: "Codex", ready: false, reason: "Codex has no credential", remedy: "Run `codex login`", unanswered: false },
      ];
    },

    async openSession(mode: ModeId, projectId: string) {
      if (!mayWorkIn.some((p) => p.id === projectId)) throw new Error(`not-a-member: ${projectId}`);
      const id = nextId("session");
      const row: LabSession = { id, title: "New session", worker: modeById(mode).worker, updatedAt: now(), running: false, waiting: 0, projectId };
      sessions.set(id, { row, entries: [], turns: [], taskTimers: [], tasks: [] });
      notify();
      return row;
    },

    async send(sessionId, text, attachments = []) {
      const s = session(sessionId);
      if (s.entries.length === 0) s.row = { ...s.row, title: text.split("\n")[0].slice(0, 120) };
      // A line sent while a turn runs starts its own turn at once, as the server's `hold` starts it.
      const id = nextId("u");
      push(s, { kind: "user", id, text, ...(attachments.length > 0 ? { files: [...attachments] } : {}) });
      turn(s, text, id);
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
      const s = session(sessionId);
      if (!isRunning(s)) return;
      if (refuseStop) {
        refuseStop = false;
        throw new Error("The turn went on before the stop reached it. Press Stop again.");
      }
      // The turns running at the press; a line sent after it is its own turn, and runs on.
      const pressed = [...s.turns];
      for (const t of pressed) for (const timer of t.timers) clearTimeout(timer);
      // Stopping until the server says the turns ended, then each one's stopped line after its last entry.
      s.stopping = true;
      notify();
      setTimeout(() => {
        s.stopping = false;
        for (const t of pressed) {
          const at = s.entries.findIndex((e) => e.id === t.last);
          const line: ThreadEntry = { kind: "stopped", id: nextId("i") };
          s.entries = at < 0 ? [...s.entries, line] : [...s.entries.slice(0, at + 1), line, ...s.entries.slice(at + 1)];
          endTurn(s, t);
        }
      }, 50 * speed);
    },

    async retry(sessionId, requestId) {
      retries.push({ sessionId, requestId });
      const s = session(sessionId);
      const line = s.entries.find((e) => e.kind === "user" && `turn-${e.id}` === requestId);
      if (line?.kind !== "user") throw new Error(`No failed turn "${requestId}" to retry.`);
      s.entries = s.entries.map((e) => (e.kind === "failed" ? { ...e, retryable: false } : e));
      turn(s, line.text, line.id);
    },

    watchThread(sessionId, onChange) {
      return watch(() => {
        const s = sessions.get(sessionId);
        if (!s) return;
        // The real adapter's count is the session's unfinished runs: here, its tasks still going.
        const backgroundRunning = s.tasks.filter((task) => task.status === "in_progress" || task.status === "pending").length;
        const view: ThreadView = { entries: s.entries, running: isRunning(s), stopping: s.stopping === true, backgroundRunning, turnStartedAt: s.turns[0]?.startedAt, connection };
        onChange(view);
      });
    },

    watchTasks(sessionId, onChange) {
      return watch(() => {
        const s = sessions.get(sessionId);
        // Each row with its view, as the adapter reads one from the board's row (no holds: a fixture's wait is its `openHold`).
        onChange(s ? s.tasks.map(({ work: _work, reviewDetail: _review, ...row }) => ({ ...row, view: taskView({ id: row.id, title: row.title, goal: row.goal, status: row.status, updatedAt: row.updatedAt, board: sessionId }) })) : []);
      });
    },

    async sayInThread(sessionId, taskId, line) {
      const s = session(sessionId);
      const task = s.tasks.find((t) => t.id === taskId);
      if (!task) return;
      const work = [...task.work, { kind: "user" as const, id: nextId("w"), text: line }];
      if (task.openHold?.kind !== "question") {
        setTask(s, taskId, { work: [...work, { kind: "assistant", id: nextId("w"), text: "Noted. I'll work that in." }] });
        return;
      }
      setTask(s, taskId, { status: "in_progress", openHold: undefined, statusNote: "Working with your answer", work });
      play(s, undefined, [[1200, advance(s, { id: taskId }, review(`Summary for ${line} ready`), `Done, going by your answer: ${line}.`), "background"]]);
    },

    // fake: stands in for the board's own calls (`inbox.board(at)`); a refusal rejects with words as the board's do.
    taskActions(sessionId) {
      return {
        async cancel(id) {
          openTask(session(sessionId), id);
          setTask(session(sessionId), id, { status: "cancelled", statusNote: undefined, openHold: undefined });
          return [];
        },
        async steer(id, message) {
          const s = session(sessionId);
          const task = openTask(s, id);
          setTask(s, id, { work: [...task.work, { kind: "user", id: nextId("w"), text: message }] });
        },
        async release(id) {
          const s = session(sessionId);
          if (openTask(s, id).status !== "held") throw new Error(`Task "${id}" isn't held.`);
          setTask(s, id, { status: "pending", openHold: undefined });
        },
        async retry(id) {
          const s = session(sessionId);
          const task = s.tasks.find((t) => t.id === id);
          if (task?.status !== "errored" && task?.status !== "cancelled") throw new Error(`Task "${id}" hasn't failed or been cancelled.`);
          // A retry is a new attempt, as the board counts it.
          setTask(s, id, { status: "in_progress", error: undefined, statusNote: "Running again", attempts: (task.attempts ?? 0) + 1 });
        },
      };
    },

    async resolve(sessionId, taskId) {
      const s = session(sessionId);
      const task = s.tasks.find((t) => t.id === taskId);
      if (task?.openHold?.kind !== "review") return;
      setTask(s, taskId, {
        status: "completed",
        openHold: undefined,
        statusNote: undefined,
        review: "accepted",
        work: [...task.work, { kind: "assistant", id: nextId("w"), text: "Resolved. Your review accepted the work." }],
      });
    },

    async requestChanges(sessionId, taskId, words) {
      const s = session(sessionId);
      const task = s.tasks.find((t) => t.id === taskId);
      if (task?.openHold?.kind !== "review") return;
      setTask(s, taskId, {
        status: "in_progress",
        openHold: undefined,
        statusNote: "Revising",
        work: [...task.work, { kind: "user", id: nextId("w"), text: words }],
      });
      play(s, undefined, [[1500, advance(s, { id: taskId }, review("Revised draft attached"), "Revised with your notes."), "background"]]);
    },

    watchPins(onChange) {
      return watch(() => onChange([...pins]));
    },

    async pin(taskId) {
      pins.add(taskId);
      notify();
    },

    async unpin(taskId) {
      pins.delete(taskId);
      notify();
    },

    watchDismissed(onChange) {
      return watch(() => onChange([...dismissed]));
    },

    async dismiss(task) {
      dismissed.add(dismissalKey(task));
      notify();
    },

    watchTaskWork(sessionId, taskId, onChange) {
      return watch(() => {
        const task = sessions.get(sessionId)?.tasks.find((t) => t.id === taskId);
        const work: TaskWork = { entries: task?.work ?? [], ...(task?.reviewDetail === undefined ? {} : { review: task.reviewDetail }) };
        onChange(work);
      });
    },
  };
  return fake;
}
