/**
 * fixture: the whole file. Deleted at wiring (spec, "Decided, not asked").
 *
 * An in-memory stand-in for the package, behind `LabAdapter`, that plays the
 * five-step script on a timer so the screen can be seen and tested before the
 * package pieces it needs exist. It proves the UI only. The README lists which
 * gap each part stands for.
 *
 * Any ask starts the vendor script: the main session writes, starts two
 * background tasks, takes the quick one's result while its turn still runs,
 * and ends with the long one still running. An ask that says "stop" or
 * "cancel" while a task runs makes the main session cancel it. A line sent
 * while a turn runs waits, and runs when the turn ends.
 */
import type {
  LabAdapter,
  ProjectRow,
  SessionRow,
  TaskRow,
  TaskWork,
  ThreadEntry,
  ThreadView,
  Unsubscribe,
} from "./adapter";
import { modeById, type ModeId } from "./modes";

/** How the fixtures keep time. Tests pass `speed` to run the script fast. */
export interface FixtureOptions {
  /** Multiplies every delay. 1 is real time. */
  speed?: number;
  /** The clock, in ms. */
  now?: () => number;
}

interface FixtureTask extends TaskRow {
  work: ThreadEntry[];
}

interface FixtureSession {
  row: SessionRow;
  entries: ThreadEntry[];
  running: boolean;
  turnStartedAt?: number;
  queue: string[];
  /** The running turn's steps: Stop clears these. */
  timers: ReturnType<typeof setTimeout>[];
  /** Background tasks' steps: they outlive the turn, and only asking the main session stops a task. */
  taskTimers: ReturnType<typeof setTimeout>[];
  tasks: FixtureTask[];
}

/** A scripted step; `background` steps belong to a task, not to the turn. */
type Step = [delayMs: number, run: () => void, background?: "background"];

const MINUTE = 60_000;

/** fixture: stands in for the whole package until wiring. */
export function createFixtureLab(options: FixtureOptions = {}): LabAdapter {
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
    s.tasks = s.tasks.map((t) => (t.id === id ? { ...t, ...patch } : t));
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
      s.entries = s.entries.map((e) => (e.kind === "user" && e.queued && e.text === next ? { ...e, queued: false } : e));
      turn(s, next);
    }
  };

  const say = (s: FixtureSession, text: string): Step[1] => () => push(s, { kind: "assistant", id: nextId("a"), text });

  const file = (s: FixtureSession, title: string, goal: string, note: string): Step[1] => () => {
    const id = nextId("task");
    push(s, { kind: "tool", id: nextId("tool"), name: "createTask", summary: `${title} → researcher` });
    s.tasks = [
      ...s.tasks,
      {
        id,
        title,
        goal,
        status: "in_progress",
        assignee: "desk.researcher",
        statusNote: note,
        work: [{ kind: "assistant", id: nextId("w"), text: `Starting: ${goal}` }],
      },
    ];
    touch(s);
    notify();
  };

  const progress = (s: FixtureSession, title: string, note: string): Step[1] => () => {
    const task = s.tasks.find((t) => t.title === title);
    if (!task || task.status !== "in_progress") return;
    setTask(s, task.id, { statusNote: note, work: [...task.work, { kind: "assistant", id: nextId("w"), text: note }] });
  };

  const settle = (s: FixtureSession, title: string, summary: string): Step[1] => () => {
    const task = s.tasks.find((t) => t.title === title);
    if (!task || task.status !== "in_progress") return;
    setTask(s, task.id, {
      status: "completed",
      statusNote: undefined,
      work: [...task.work, { kind: "assistant", id: nextId("w"), text: summary }],
    });
    // fixture: stands in for the main worker's `answerAgain: true` (FIX-2159): the take shows as an item in the running request.
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
      if (s.tasks.find((t) => t.id === task.id)?.status !== "in_progress") {
        push(s, { kind: "assistant", id: nextId("a"), text: `"${task.title}" had already finished, so there was nothing to stop.` });
        return;
      }
      push(s, { kind: "tool", id: nextId("tool"), name: "updateTask", summary: `${task.title} → cancelled` });
      setTask(s, task.id, { status: "cancelled", statusNote: undefined });
      push(s, { kind: "assistant", id: nextId("a"), text: `Stopped "${task.title}". The summary covers what is done so far.` });
    }],
    [200, () => endTurn(s)],
  ];

  const turn = (s: FixtureSession, text: string) => {
    startTurn(s);
    // The task the line names (by a word of its title), finished or not, else the first one running.
    // The stop script re-reads its status, so a finished one is reported, not swapped for another.
    const runningTasks = s.tasks.filter((t) => t.status === "in_progress");
    const named = s.tasks.find((t) => t.title.split(" ").slice(1).some((word) => new RegExp(`\\b${word}\\b`, "i").test(text)));
    const running = named ?? runningTasks[0];
    if (/\b(stop|cancel)\b/i.test(text) && running) {
      play(s, stopScript(s, running));
    } else if (s.tasks.length === 0) {
      play(s, vendorScript(s));
    } else {
      play(s, [[800, say(s, "Noted. I'll keep that in mind as the background work comes in.")], [200, () => endTurn(s)]]);
    }
  };

  // fixture: the person's access to each project. A session may open only where they may work: a
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
  // fixture: an older session with no project, so the screen shows what asking looks like.
  seed("Fix the onboarding copy", 26 * 60 * MINUTE, null, ["Tighten the onboarding copy.", "Done. The three screens now read in under ten seconds each."]);
  seed("Draft the launch note", 2 * 60 * MINUTE, "project-vendor-notes", ["Draft the launch note.", "Here is a first draft, about 200 words."]);

  return {
    watchSessions(onChange) {
      return watch(() => onChange([...sessions.values()].map((s) => s.row).sort((a, b) => b.updatedAt - a.updatedAt)));
    },

    async listProjects() {
      return mayWorkIn;
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
        s.queue.push(text);
        push(s, { kind: "user", id: nextId("u"), text, queued: true });
        return;
      }
      push(s, { kind: "user", id: nextId("u"), text });
      turn(s, text);
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
        onChange(s ? s.tasks.map(({ work: _work, ...row }) => row) : []);
      });
    },

    watchTaskWork(sessionId, taskId, onChange) {
      return watch(() => {
        const task = sessions.get(sessionId)?.tasks.find((t) => t.id === taskId);
        const work: TaskWork = { entries: task?.work ?? [] };
        onChange(work);
      });
    },
  };
}
