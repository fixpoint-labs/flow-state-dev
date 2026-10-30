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
 * ready for review. An ask that names a code change or the CHANGELOG starts
 * one thread through Claude Code instead, which becomes ready for review with
 * the judge's verdict.
 *
 * In either mode, an ask that says "stop" or "cancel" while a task runs makes
 * the main session cancel it. A line sent while a turn runs waits, and runs
 * when the turn ends.
 */
import type {
  LabAdapter,
  ProjectRow,
  ReviewDetail,
  SessionRow,
  TaskRow,
  TaskWork,
  ThreadEntry,
  ThreadView,
  Unsubscribe,
} from "../src/adapter";
import { modeById, modeOfWorker, type ModeId } from "../src/modes";

/** How the fake keeps time. Tests pass `speed` to run the script fast. */
export interface FakeOptions {
  /** Multiplies every delay. 1 is real time. */
  speed?: number;
  /** The clock, in ms. */
  now?: () => number;
}

interface FixtureTask extends TaskRow {
  work: ThreadEntry[];
  /** What its run's review stop carries, for a harness thread ready for review. */
  reviewDetail?: ReviewDetail;
}

interface FixtureSession {
  row: SessionRow;
  entries: ThreadEntry[];
  running: boolean;
  turnStartedAt?: number;
  /** Lines sent while a turn ran, by their entry id. */
  queue: { id: string; text: string }[];
  /** The running turn's steps: Stop clears these. */
  timers: ReturnType<typeof setTimeout>[];
  /** Background tasks' steps: they outlive the turn, and only asking the main session stops a task. */
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
export function createFakeLab(options: FakeOptions = {}): LabAdapter {
  const speed = options.speed ?? 1;
  const now = options.now ?? (() => Date.now());
  const sessions = new Map<string, FixtureSession>();
  const listeners = new Set<() => void>();
  let seq = 0;
  const nextId = (prefix: string) => `${prefix}-${++seq}`;

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

  const touch = (s: FixtureSession) => {
    s.row = { ...s.row, updatedAt: now(), running: s.running };
  };

  const push = (s: FixtureSession, entry: ThreadEntry) => {
    s.entries = [...s.entries, entry];
    touch(s);
    notify();
  };

  const setTask = (s: FixtureSession, id: string, patch: Partial<FixtureTask>) => {
    s.tasks = s.tasks.map((t) => (t.id === id ? { ...t, ...patch, updatedAt: now() } : t));
    touch(s);
    notify();
  };

  const play = (s: FixtureSession, steps: Step[]) => {
    let at = 0;
    for (const [delay, run, background] of steps) {
      at += delay;
      (background ? s.taskTimers : s.timers).push(setTimeout(run, at * speed));
    }
  };

  const startTurn = (s: FixtureSession) => {
    s.running = true;
    s.turnStartedAt = now();
    touch(s);
    notify();
  };

  const endTurn = (s: FixtureSession) => {
    s.running = false;
    s.turnStartedAt = undefined;
    // The turn's steps have all run; background steps stay in `taskTimers`.
    s.timers = [];
    touch(s);
    notify();
    const next = s.queue.shift();
    if (next !== undefined) {
      s.entries = s.entries.map((e) => (e.id === next.id && e.kind === "user" ? { ...e, queued: false } : e));
      turn(s, next.text, next.id);
    }
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
    push(s, { kind: "tool", id: nextId("tool"), name: "createTask", summary: `${title} → researcher` });
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
      duringTurn: s.running,
    });
  };

  const vendorScript = (s: FixtureSession): Step[] => [
    [800, say(s, "I'll write the outline myself and research both vendors in the background.")],
    [600, file(s, "Research Acme", "Find Acme's price, support hours and certifications.", "searching")],
    [400, file(s, "Research Globex", "Read Globex's pricing pages, support terms and audits.", "reading pricing pages")],
    [800, say(s, "Outline:\n1. Price\n2. Support\n3. Risks")],
    [600, progress(s, "Research Acme", "summarizing"), "background"],
    [1000, settle(s, "Research Acme", "Acme: $40 per user, 24-hour support, SOC 2 since 2024."), "background"],
    [800, say(s, "Acme's research is in. Section 1 now reads: Acme costs $40 per user, with 24-hour support.")],
    [1200, say(s, "Globex is still running in the background. I'll fold it in when it lands.")],
    [200, () => endTurn(s)],
    [2800, progress(s, "Research Globex", "reading support terms"), "background"],
    [3000, progress(s, "Research Globex", "checking audit reports"), "background"],
  ];

  const stopScript = (s: FixtureSession, task: FixtureTask): Step[] => [
    [700, () => {
      // The task may have settled since the turn began; a finished task stays finished.
      const current = s.tasks.find((t) => t.id === task.id)?.status;
      if (current === "completed" || current === "cancelled" || current === "errored") {
        push(s, { kind: "assistant", id: nextId("a"), text: `"${task.title}" had already finished, so there was nothing to stop.` });
        return;
      }
      push(s, { kind: "tool", id: nextId("tool"), name: "updateTask", summary: `${task.title} → cancelled` });
      setTask(s, task.id, { status: "cancelled", statusNote: undefined, waitingOn: undefined });
      push(s, { kind: "assistant", id: nextId("a"), text: `Stopped "${task.title}". The summary covers what is done so far.` });
    }],
    [200, () => endTurn(s)],
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

  const ask = (prompt: string): Partial<FixtureTask> => ({ status: "held", waitingOn: { kind: "question", prompt }, statusNote: prompt });
  const review = (prompt: string): Partial<FixtureTask> => ({ status: "in_progress", waitingOn: { kind: "review", prompt }, statusNote: prompt });

  const threadsScript = (s: FixtureSession, origin: string): Step[] => {
    const [a, b, c]: Ref[] = [{}, {}, {}];
    return [
      [600, fileThread(s, origin, a, "Vendor A · pricing and uptime", "Compare Vendor A's price and uptime record.", "Reading pricing pages", { steps: { done: 0, total: 7 } })],
      [300, fileThread(s, origin, b, "Vendor B · regions", "Find where Vendor B hosts, for the region that matters.", "Listing regions")],
      [300, fileThread(s, origin, c, "Vendor C · summary", "Draft a summary of Vendor C for review.", "Gathering notes")],
      [500, say(s, "I've started three threads, one per vendor. Each comes back to you when it needs you.")],
      [200, () => endTurn(s)],
      [600, advance(s, a, { steps: { done: 1, total: 7 }, statusNote: "Comparing plans" }, "Comparing plans"), "background"],
      [400, advance(s, b, ask("Which region matters, EU or US?"), "Which region matters, EU or US?"), "background"],
      [600, advance(s, a, { steps: { done: 2, total: 7 }, statusNote: "Comparing SLA tiers" }, "Comparing SLA tiers"), "background"],
      [600, advance(s, c, review("Draft summary attached"), "Vendor C: $29 per user, 99.95% uptime last year, EU and US hosting."), "background"],
    ];
  };

  const codeScript = (s: FixtureSession, text: string, origin: string): Step[] => {
    const ref: Ref = {};
    return [
      [600, fileThread(s, origin, ref, text.split("\n")[0].slice(0, 60), text, "Editing CHANGELOG.md", { assignee: "desk.coder", harness: "claude-code", spend: spent(CODE_MODEL, null, null, true, "claude-code") })],
      [400, say(s, "I've started a Claude Code thread for it, in this session's project.")],
      [200, () => endTurn(s)],
      [1200, advance(s, ref, { statusNote: "Committing", spend: spent(CODE_MODEL, 8200, 1100, true, "claude-code") }, "Committing: docs: note the vendor pick"), "background"],
      [800, advance(s, ref, { ...review(CODE_REVIEW_PROMPT), reviewDetail: CODE_REVIEW, spend: spent(CODE_MODEL, 12000, 1600, true, "claude-code") }, CODE_ANSWER), "background"],
    ];
  };

  const turn = (s: FixtureSession, text: string, origin: string) => {
    startTurn(s);
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
      play(s, stopScript(s, running));
    } else if (threads && /\b(changelog|code)\b/i.test(text)) {
      play(s, codeScript(s, text, origin));
    } else if (threads && !s.tasks.some((t) => t.assignee === "desk.thread")) {
      play(s, threadsScript(s, origin));
    } else if (!threads && s.tasks.length === 0) {
      play(s, vendorScript(s));
    } else {
      play(s, [[800, say(s, "Noted. I'll keep that in mind as the background work comes in.")], [200, () => endTurn(s)]]);
    }
  };

  // fake: the person's access to each project. A session may open only where they may work: a
  // member of a shared project or the owner of a private one. Reading one is not enough, the same
  // not-a-member refusal projectWorkspace() makes for a run.
  const projects: (ProjectRow & { visibility: "shared" | "private"; access: "member" | "owner" | "reader" })[] = [
    { id: "project-vendor-notes", name: "vendor-notes", visibility: "shared", access: "member" },
    { id: "project-onboarding-app", name: "onboarding-app", visibility: "private", access: "owner" },
    { id: "project-billing-service", name: "billing-service", visibility: "shared", access: "reader" },
  ];
  const mayWorkIn = projects
    .filter((p) => (p.visibility === "shared" ? p.access === "member" : p.access === "owner"))
    .map(({ id, name }): ProjectRow => ({ id, name }));

  const seed = (title: string, ago: number, projectId: string | null, lines: [string, string]) => {
    const id = nextId("session");
    sessions.set(id, {
      row: { id, title, worker: modeById("session").worker, updatedAt: now() - ago, running: false, projectId },
      entries: [
        { kind: "user", id: nextId("u"), text: lines[0] },
        { kind: "assistant", id: nextId("a"), text: lines[1] },
      ],
      running: false,
      queue: [],
      timers: [],
      taskTimers: [],
      tasks: [],
    });
  };
  // fake: an older session with no project, so the screen shows what asking looks like.
  seed("Fix the onboarding copy", 26 * 60 * MINUTE, null, ["Tighten the onboarding copy.", "Done. The three screens now read in under ten seconds each."]);
  seed("Draft the launch note", 2 * 60 * MINUTE, "project-vendor-notes", ["Draft the launch note.", "Here is a first draft, about 200 words."]);

  // fake: your pinned task ids, which the lab's pins flow keeps at wiring.
  const pins = new Set<string>();

  // fake: an older threads-mode session, with a pinned thread, a failed one and two resolved.
  const seedThreads = () => {
    const id = nextId("session");
    const ago = 26 * 60 * MINUTE;
    const thread = (title: string, status: FixtureTask["status"], note?: string) =>
      startTask(title, title, note, { status, updatedAt: now() - ago });
    const tasks = [
      thread("Weekly uptime digest", "in_progress", "Collecting this week's incidents"),
      thread("Export failed invoices", "errored", "The export timed out"),
      thread("Refund report", "completed"),
      thread("Dunning emails", "completed"),
      // A harness run nobody reviewed by the person-stop deadline: it completed, marked so.
      { ...thread("Retry webhook on 502", "completed"), assignee: "desk.coder", harness: "claude-code", review: "deadline" as const },
    ];
    pins.add(tasks[0].id);
    sessions.set(id, {
      row: { id, title: "Billing triage", worker: modeById("threads").worker, updatedAt: now() - ago, running: false, projectId: "project-vendor-notes" },
      entries: [
        { kind: "user", id: nextId("u"), text: "Triage this week's billing work, a thread each.", sentToThread: true },
        ...tasks.map((t): ThreadEntry => ({ kind: "thread", id: nextId("card"), taskId: t.id })),
        { kind: "assistant", id: nextId("a"), text: "I've started four threads." },
      ],
      running: false,
      queue: [],
      timers: [],
      taskTimers: [],
      tasks,
    });
  };
  seedThreads();

  return {
    modes: ["session", "threads"],
    watchSessions(onChange) {
      return watch(() => onChange([...sessions.values()].map((s) => s.row).sort((a, b) => b.updatedAt - a.updatedAt)));
    },

    async listProjects() {
      return mayWorkIn;
    },

    async createProject(name: string) {
      const project = { id: nextId("project"), name };
      mayWorkIn.push(project);
      return project;
    },

    async openSession(mode: ModeId, projectId: string) {
      if (!mayWorkIn.some((p) => p.id === projectId)) throw new Error(`not-a-member: ${projectId}`);
      const id = nextId("session");
      const row: SessionRow = { id, title: "New session", worker: modeById(mode).worker, updatedAt: now(), running: false, projectId };
      sessions.set(id, { row, entries: [], running: false, queue: [], timers: [], taskTimers: [], tasks: [] });
      notify();
      return row;
    },

    async send(sessionId, text) {
      const s = session(sessionId);
      if (s.entries.length === 0) s.row = { ...s.row, title: text.split("\n")[0].slice(0, 120) };
      if (s.running) {
        const id = nextId("u");
        s.queue.push({ id, text });
        push(s, { kind: "user", id, text, queued: true });
        return;
      }
      const id = nextId("u");
      push(s, { kind: "user", id, text });
      turn(s, text, id);
    },

    async interrupt(sessionId) {
      const s = session(sessionId);
      if (!s.running) return;
      for (const t of s.timers) clearTimeout(t);
      s.timers = [];
      push(s, { kind: "interrupted", id: nextId("i") });
      endTurn(s);
    },

    watchThread(sessionId, onChange) {
      return watch(() => {
        const s = sessions.get(sessionId);
        if (!s) return;
        const view: ThreadView = { entries: s.entries, running: s.running, turnStartedAt: s.turnStartedAt };
        onChange(view);
      });
    },

    watchTasks(sessionId, onChange) {
      return watch(() => {
        const s = sessions.get(sessionId);
        onChange(s ? s.tasks.map(({ work: _work, reviewDetail: _review, ...row }) => row) : []);
      });
    },

    async sayInThread(sessionId, taskId, line) {
      const s = session(sessionId);
      const task = s.tasks.find((t) => t.id === taskId);
      if (!task) return;
      const work = [...task.work, { kind: "user" as const, id: nextId("w"), text: line }];
      if (task.waitingOn?.kind !== "question") {
        setTask(s, taskId, { work: [...work, { kind: "assistant", id: nextId("w"), text: "Noted. I'll work that in." }] });
        return;
      }
      setTask(s, taskId, { status: "in_progress", waitingOn: undefined, statusNote: "Working with your answer", work });
      play(s, [[1200, advance(s, { id: taskId }, review(`Summary for ${line} ready`), `Done, going by your answer: ${line}.`), "background"]]);
    },

    async resolve(sessionId, taskId) {
      const s = session(sessionId);
      const task = s.tasks.find((t) => t.id === taskId);
      if (task?.waitingOn?.kind !== "review") return;
      setTask(s, taskId, {
        status: "completed",
        waitingOn: undefined,
        statusNote: undefined,
        review: "accepted",
        work: [...task.work, { kind: "assistant", id: nextId("w"), text: "Resolved. Your review accepted the work." }],
      });
    },

    async requestChanges(sessionId, taskId, words) {
      const s = session(sessionId);
      const task = s.tasks.find((t) => t.id === taskId);
      if (task?.waitingOn?.kind !== "review") return;
      setTask(s, taskId, {
        status: "in_progress",
        waitingOn: undefined,
        statusNote: "Revising",
        work: [...task.work, { kind: "user", id: nextId("w"), text: words }],
      });
      play(s, [[1500, advance(s, { id: taskId }, review("Revised draft attached"), "Revised with your notes."), "background"]]);
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

    watchTaskWork(sessionId, taskId, onChange) {
      return watch(() => {
        const task = sessions.get(sessionId)?.tasks.find((t) => t.id === taskId);
        const work: TaskWork = { entries: task?.work ?? [], ...(task?.reviewDetail === undefined ? {} : { review: task.reviewDetail }) };
        onChange(work);
      });
    },
  };
}
