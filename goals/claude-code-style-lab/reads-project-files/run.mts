/**
 * Goal check: in the Claude Code-style lab, the main session answers a
 * question about its project's code from the project's files, in its own
 * turn, with no coding run; and a session that may not see the project gets
 * the refusal a coding run gets. On a real model, over the lab's HTTP API,
 * against `fsdev dev --config labs/claude-code-style/fsdev.config.mts`.
 *
 * Legs, each graded from what a person sees (the reply), the server's own
 * records (`listTasks`, the sessions) and the server's disk:
 *   1. a member, in a session set to the project, asks for a value that lives
 *      only inside one file's body: the reply names it, no task is filed, no
 *      harness ran, and the host's root holds one clone and no place, after
 *      two questions.
 *   2. a session with no project asks the same: no value, and its turn holds
 *      a read refused `no-project`.
 *   3. a second user, a member when they set the project and taken off its
 *      members since (the stored row edited, the server restarted), asks the
 *      same: no value, and its turn holds a read refused `not-a-member`.
 *
 * Controls (`GOAL_CONTROL=<name>`, same command):
 *   - `no-read`: `desk.main`'s file names no `projectSource` preset. Leg 1 must
 *     FAIL on `value named` or `0 tasks`.
 *   - `no-gate`: the run source's membership check is patched out as the
 *     server loads it. Leg 3 must FAIL on `no value`.
 *
 * Run: pnpm tsx goals/claude-code-style-lab/reads-project-files/run.mts
 */
import { randomInt } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { createClient } from "@flow-state-dev/client";
import { createWorkforceClient } from "@flow-state-dev/workforce/browser";
import {
  assertPatched,
  describePatches,
  goalTmpDir,
  loadFixture,
  modulePatchEnv,
  REPO_ROOT,
  runGoal,
  stopProcessGroup,
  type ModulePatch,
} from "../../lib/index.mts";
import { git, LAB, labCheckout, startLab } from "../lab.mts";

const fixture = loadFixture<{
  project: string;
  path: string;
  line: string;
  decoys: Record<string, string>;
  question: string;
  follow: string;
}>(import.meta.url);
const CONTROL = process.env.GOAL_CONTROL ?? "";
const RUNS = Number(process.env.GOAL_RUNS ?? 3);
const USER = "u_goal";
const OTHER = "u_goal_other";
const MAIN = "desk.main";
const READ_TOOLS = new Set(["globProjectSource", "readProjectSource", "grepProjectSource"]);
const MAIN_FILE = join(LAB, "workforce", "teams", "desk", "workers", "main", "WORKER.md");

/** The `no-gate` control: the run source's membership check on the project path, patched out as the server loads it. */
const NO_GATE: ModulePatch[] = [
  {
    module: "packages/workforce/src/projects/run-project.ts",
    from: String.raw` \|\| !mayWorkOn\(address\.visibility, project, owner\)`,
    to: "",
  },
];

type Item = { type: string; role?: string; requestId?: string; blockName?: string; output?: unknown; content?: { text?: string }[] };

/** A project repository: the decoys, and the one file whose body holds the value. */
function makeProjectRepository(dir: string, value: string): string {
  mkdirSync(dir, { recursive: true });
  git(dir, "init", "-q", "-b", "main");
  const files = { ...fixture.decoys, [fixture.path]: `${fixture.line.replace("{value}", value)}\n`, ".gitignore": ".fsdev/\n" };
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(dirname(join(dir, path)), { recursive: true });
    writeFileSync(join(dir, path), text);
  }
  git(dir, "add", ".");
  git(dir, "-c", "user.email=goal@example.com", "-c", "user.name=goal", "commit", "-q", "-m", "start");
  return dir;
}

/** One client per user, against one server. */
function clientsFor(origin: string) {
  const make = (userId: string) => {
    const fsd = createClient({ userId, baseUrl: origin });
    return { fsd, workforce: createWorkforceClient(fsd) };
  };
  return { me: make(USER), other: make(OTHER) };
}

/** Run one action and hand back its output, or throw why it failed. */
async function act(fsd: ReturnType<typeof createClient>, flow: string, sessionId: string, action: string, input: unknown): Promise<any> {
  const sent = await fsd.flow(flow).send(action, input, { sessionId });
  const { status } = await sent.wait();
  const found = (await fsd.sessions.requests(sessionId, { includeResultOutput: true, limit: 50 })).find((r) => r.id === sent.id);
  if (status !== "completed") throw new Error(`setup: ${action} ended ${status}: ${found?.result?.error?.message ?? ""}`);
  return found?.result?.output;
}

/** Every message and tool item of a session. */
async function itemsOf(fsd: ReturnType<typeof createClient>, sessionId: string): Promise<Item[]> {
  const items: Item[] = [];
  for (let offset = 0; ; ) {
    const page = (await fsd.sessions.state(sessionId, { includeItems: true, itemTypes: ["message", "tool_output"], offset, limit: 100 })) as {
      items?: Item[];
      pagination?: { hasMore: boolean; nextOffset: number };
    };
    items.push(...(page.items ?? []));
    if (page.pagination?.hasMore !== true) return items;
    offset = page.pagination.nextOffset;
  }
}

/** Ask the main session one line and wait for the turn; what it said, and the read calls it made, in that turn. */
async function ask(fsd: ReturnType<typeof createClient>, sessionId: string, line: string) {
  const sent = await fsd.flow("agent").send("respond", { message: line }, { sessionId });
  await sent.wait();
  // A settle may start a turn of its own; wait for every turn of the session.
  for (let waited = 0; waited < 5 * 60_000; waited += 2_000) {
    const running = await fsd.sessions.requests(sessionId, { status: "in_progress", limit: 20 });
    if (running.length === 0) break;
    await new Promise((resolve) => setTimeout(resolve, 2_000));
  }
  const items = await itemsOf(fsd, sessionId);
  const turn = items.filter((item) => item.requestId === sent.id);
  const reply = turn
    .filter((item) => item.type === "message" && item.role === "assistant")
    .map((item) => (item.content ?? []).map((part) => part.text ?? "").join(""))
    .join("\n");
  const reads = turn.filter((item) => item.type === "tool_output" && READ_TOOLS.has(item.blockName ?? ""));
  return { reply, reads: reads.map((item) => ({ tool: item.blockName!, output: item.output as { kind?: string; reason?: string } })) };
}

/** The tasks on a session's board, as `listTasks` reads them. */
async function tasksOf(fsd: ReturnType<typeof createClient>, sessionId: string): Promise<any[]> {
  const output = await act(fsd, "agent", sessionId, "listTasks_tasks", {});
  return ((output as { tasks?: any[] } | undefined)?.tasks ?? []) as any[];
}

/** Take `user` off the shared project's members, in the lab's SQLite file. The package has no write that does. */
function dropMember(dbFile: string, projectId: string, user: string): number {
  const db = new DatabaseSync(dbFile);
  try {
    const rows = db.prepare("SELECT scope_type, scope_id, resource_key, state FROM resource_state WHERE resource_key = ?").all(`projects/${projectId}`) as {
      scope_type: string;
      scope_id: string;
      resource_key: string;
      state: string;
    }[];
    let changed = 0;
    for (const row of rows) {
      const state = JSON.parse(row.state) as { members?: string[] };
      if (!state.members?.includes(user)) continue;
      state.members = state.members.filter((member) => member !== user);
      db.prepare("UPDATE resource_state SET state = ?, version = version + 1 WHERE scope_type = ? AND scope_id = ? AND resource_key = ?").run(
        JSON.stringify(state),
        row.scope_type,
        row.scope_id,
        row.resource_key,
      );
      changed += 1;
    }
    return changed;
  } finally {
    db.close();
  }
}

/** The places and clones under the host's root. */
function underRoot(root: string) {
  const clonesDir = join(root, ".clones");
  return {
    clones: existsSync(clonesDir) ? readdirSync(clonesDir).filter((name) => name.endsWith(".git")) : [],
    places: existsSync(root) ? readdirSync(root).filter((name) => !name.startsWith(".")) : [],
  };
}

/** One run: a fresh lab, a fresh project, the three legs. Failures are pushed with the leg and assertion that failed. */
async function oneRun(n: number, failures: string[], notes: string[]): Promise<void> {
  const scratch = goalTmpDir(`reads-project-files-${n}`);
  const data = join(scratch, "data");
  const root = join(data, "runs");
  const value = `LC-${randomInt(100_000, 999_999)}-${randomInt(100, 999)}`;
  const repo = makeProjectRepository(join(scratch, "repo"), value);
  const projectId = `billing-${n}`;
  const labBefore = labCheckout();
  const mark = join(scratch, "patched.txt");
  const env = CONTROL === "no-gate" ? modulePatchEnv(NO_GATE, REPO_ROOT, mark) : {};
  const fail = (what: string) => failures.push(`run ${n} · ${what}`);

  let lab = await startLab(data, USER, env);
  try {
    let { me, other } = clientsFor(lab.origin);
    const projectsSession = (await me.fsd.flow("projects").createSession()).id;
    await act(me.fsd, "projects", projectsSession, "createProject", {
      id: projectId,
      title: fixture.project,
      visibility: "shared",
      members: [OTHER],
      repository: `file://${repo}`,
    });
    const project = { visibility: "shared" as const, id: projectId };

    // ── Leg 1: a member asks, twice, in a session set to the project.
    const mine = (await me.fsd.flow("agent").createSession({ state: { workerId: MAIN } })).id;
    await me.workforce.setWorkProject(MAIN, project, { sessionId: mine });
    const first = await ask(me.fsd, mine, fixture.question);
    const second = await ask(me.fsd, mine, fixture.follow);
    if (!first.reply.includes(value)) fail(`leg 1 · value named: the reply doesn't name ${value}: ${JSON.stringify(first.reply.slice(0, 300))}`);
    const filed = await tasksOf(me.fsd, mine);
    if (filed.length !== 0) fail(`leg 1 · 0 tasks: the session filed ${filed.length} (${filed.map((t) => t.assignee).join(", ")})`);
    const harness = await me.fsd.sessions.list({ flowKind: "harness-thread", userId: USER });
    if (harness.length !== 0) fail(`leg 1 · no harness: ${harness.length} harness session(s) started`);
    const others = (await me.fsd.sessions.list({ flowKind: "agent", userId: USER })).filter((s) => s.id !== mine);
    for (const session of others) {
      const theirs = await tasksOf(me.fsd, session.id);
      if (theirs.length !== 0) fail(`leg 1 · 0 tasks: session ${session.id} holds ${theirs.length} task(s)`);
    }
    const disk = underRoot(root);
    if (disk.clones.length !== 1 || disk.places.length !== 0) {
      fail(`leg 1 · one clone, no place: ${disk.clones.length} clone(s), place(s) [${disk.places.join(", ")}] under ${root}`);
    }
    notes.push(
      `run ${n} leg 1: ${first.reads.length + second.reads.length} read call(s), ${filed.length} task(s), ${disk.clones.length} clone, ${disk.places.length} place(s)`,
    );

    // ── Leg 2: a session with no project asks the same.
    const none = (await me.fsd.flow("agent").createSession({ state: { workerId: MAIN } })).id;
    const noProject = await ask(me.fsd, none, fixture.question);
    if (noProject.reply.includes(value)) fail("leg 2 · no value: a session with no project was told the value");
    if (noProject.reads.length === 0) fail("leg 2 · read refused: the turn made no read call");
    else if (!noProject.reads.some((read) => read.output?.kind === "refused" && read.output.reason === "no-project")) {
      fail(`leg 2 · read refused: no read was refused no-project: ${JSON.stringify(noProject.reads).slice(0, 300)}`);
    }

    // ── Leg 3: a member sets the project, is taken off its members, and asks.
    const theirs = (await other.fsd.flow("agent").createSession({ state: { workerId: MAIN } })).id;
    await other.workforce.setWorkProject(MAIN, project, { sessionId: theirs });
    stopProcessGroup(lab.child);
    await new Promise((resolve) => setTimeout(resolve, 2_000));
    const dropped = dropMember(join(data, "lab.db"), projectId, OTHER);
    if (dropped !== 1) throw new Error(`setup: the project row to edit was found ${dropped} time(s) in ${join(data, "lab.db")}`);
    lab = await startLab(data, USER, env);
    ({ me, other } = clientsFor(lab.origin));
    const offMembers = await ask(other.fsd, theirs, fixture.question);
    if (offMembers.reply.includes(value)) fail("leg 3 · no value: a user taken off the members was told the value");
    if (offMembers.reads.length === 0) fail("leg 3 · read refused: the turn made no read call");
    else if (!offMembers.reads.some((read) => read.output?.kind === "refused" && read.output.reason === "not-a-member")) {
      fail(`leg 3 · read refused: no read was refused not-a-member: ${JSON.stringify(offMembers.reads).slice(0, 300)}`);
    }
    notes.push(`run ${n} legs 2-3: ${noProject.reads.length} and ${offMembers.reads.length} read call(s)`);

    if (labCheckout() !== labBefore) fail("the lab's own checkout changed");
    if (CONTROL === "no-gate") assertPatched(NO_GATE, REPO_ROOT, mark);
  } finally {
    stopProcessGroup(lab.child);
  }
}

await runGoal(async (failures, tell) => {
  const original = readFileSync(MAIN_FILE, "utf8");
  if (CONTROL === "no-read") {
    const stripped = original.replace(/\ncapabilities:\n  projectSource: \[read\]\n/, "\n");
    if (stripped === original) throw new Error("setup: desk.main's file names no projectSource preset to drop");
    writeFileSync(MAIN_FILE, stripped);
  }
  if (CONTROL === "no-gate") console.error(describePatches(NO_GATE, REPO_ROOT));
  const notes: string[] = [];
  const graded: number[] = [];
  try {
    for (let n = 1; n <= RUNS; n += 1) {
      await oneRun(n, failures, notes);
      graded.push(n);
    }
  } finally {
    if (CONTROL === "no-read") writeFileSync(MAIN_FILE, original);
  }
  tell.over("runs graded", graded);
  return { failures, evidence: `${RUNS} of ${RUNS} runs: ${notes.join("; ")}` };
});
