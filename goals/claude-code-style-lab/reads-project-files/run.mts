/**
 * Goal check: in the Claude Code-style lab, the main session answers a
 * question about its repository's code from the repository's files, in its own
 * turn, with no coding run; and a session with no repository gets the refusal
 * a coding run gets. On a real model, over the lab's HTTP API, against
 * `fsdev dev --config labs/claude-code-style/fsdev.config.mts`.
 *
 * Legs, each graded from what a person sees (the reply), the server's own
 * records (`listTasks`, the sessions) and the server's disk:
 *   1. a session opened on the repository (the server writes it, as the lab's
 *      open does) asks for a value that lives only inside one file's body: the
 *      reply names it, no task is filed, no harness ran, and the host's root
 *      holds one clone and no place, after two questions.
 *   2. a session with no repository asks the same: no value, and its turn
 *      holds a read refused `no-repository`.
 * And in the lab's own tool lines (its thread's steps lines over the turn's
 * items): each of leg 1's reads names what it read (a read its file, a search
 * its pattern, a listing its pattern); leg 2's refused read reads "(failed)".
 *
 * Controls (`GOAL_CONTROL=<name>`, same command):
 *   - `no-read`: `desk.main`'s file names no `projectSource` preset. Leg 1 must
 *     FAIL on `value named` or `0 tasks`.
 *   - `first-repository`: the lab's run source answers the first repository it
 *     lists, whatever the session's (`fsdev.config.mts` reads it). Leg 2 must
 *     FAIL on `read refused`.
 *   - `old-lines`: the lab's lines are graded as its old `lib/tool-line.ts`
 *     drew them. `lines name what was read` and `refusal reads failed` must FAIL.
 *
 * Run: pnpm tsx goals/claude-code-style-lab/reads-project-files/run.mts
 */
import { randomInt } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { createClient } from "@flow-state-dev/client";
import { SET_SESSION_FIELDS_ACTION } from "@flow-state-dev/workforce/browser";
import { goalTmpDir, loadFixture, REPO_ROOT, runGoal, stopProcessGroup } from "../../lib/index.mts";
import { conversationLines } from "@flow-state-dev/react";
import { stepRun, stepsOf } from "../../../labs/claude-code-style/src/components/flow-state/conversation-lines.tsx";
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
const MAIN = "desk.main";
const READ_TOOLS = new Set(["globProjectSource", "readProjectSource", "grepProjectSource"]);
const MAIN_FILE = join(LAB, "workforce", "teams", "desk", "workers", "main", "WORKER.md");

/** A stored item, as far as this goal reads it. */
type Item = { id: string; type: string; role?: string; requestId?: string; status?: string; blockName?: string; content?: { text?: string }[]; output?: unknown; toolCall?: { name?: string; arguments?: string } };

/**
 * The tool lines a turn's items draw in the lab: its thread's steps lines (React's
 * conversation model), each call as the registry's compact steps line words it. Under `old-lines`, the lab's lines as they were before it read
 * the registry: one fixed phrase per tool, and no step ever failed.
 */
async function linesOf(items: readonly Item[]): Promise<{ tool: string; args: Record<string, unknown>; line: string; failed: boolean }[]> {
  const calls = items.filter((item) => item.type === "tool_output");
  const argsOf = (item: Item) => {
    try {
      return JSON.parse(item.toolCall?.arguments ?? "{}") as Record<string, unknown>;
    } catch {
      return {};
    }
  };
  if (CONTROL === "old-lines") {
    const { toolLine } = await oldToolLine();
    return calls.map((item) => ({ tool: item.blockName ?? "tool", args: argsOf(item), line: toolLine(item.blockName ?? "tool"), failed: false }));
  }
  // The thread draws one step per call, in the calls' order.
  const steps = conversationLines(items as never).flatMap((line) => (line.kind === "steps" ? stepsOf(line.items, line.ended === true) : []));
  if (steps.length !== calls.length) throw new Error(`the lab drew ${steps.length} step(s) for ${calls.length} call(s)`);
  return calls.map((item, i) => ({ tool: item.blockName ?? "tool", args: argsOf(item), line: stepRun([steps[i]!]).label, failed: steps[i]!.state === "error" }));
}

/** The lab's `lib/tool-line.ts` from before it read the registry, written to the scratch folder and loaded. */
let oldLines: Promise<{ toolLine: (name: string) => string }> | undefined;
function oldToolLine() {
  oldLines ??= (async () => {
    const file = join(goalTmpDir("reads-project-files-old-lines"), "tool-line.ts");
    writeFileSync(file, git(REPO_ROOT, "show", `${OLD_LINES_COMMIT}:labs/claude-code-style/src/lib/tool-line.ts`));
    return (await import(file)) as { toolLine: (name: string) => string };
  })();
  return oldLines;
}

/**
 * Whether a line names the file at `path`: the whole path, or the tail a long
 * one is shortened to on a line ("…/billing/ledger/codes.ts").
 */
function namesFile(line: string, path: string): boolean {
  const words = line.split(/\s+/).map((word) => word.replace(/[,;:]$/, ""));
  return words.some((word) => word === path || (word.startsWith("…/") && path.endsWith(word.slice(1))));
}

/** What a project read's line must name: a read its file, a search its pattern, a listing its pattern. */
function namesWhatItRead(call: { tool: string; args: Record<string, unknown>; line: string }): boolean {
  const { path, pattern } = call.args;
  if (call.tool === "readProjectSource") return typeof path === "string" && namesFile(call.line, path);
  if (call.tool === "grepProjectSource") return typeof pattern === "string" && call.line.includes(`"${pattern}"`);
  return typeof pattern === "string" ? call.line.includes(pattern) : call.line.includes("the project's files");
}

/** The last commit whose lab still drew its own tool lines (`lib/tool-line.ts`). */
const OLD_LINES_COMMIT = "f3b19ba46051525ebf31268a95050ddd30c9e82b";

/** A repository: the decoys, and the one file whose body holds the value. */
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
  return {
    reply,
    reads: reads.map((item) => ({ tool: item.blockName!, output: item.output as { kind?: string; reason?: string } })),
    lines: await linesOf(turn),
  };
}

/** The tasks on a session's board, as `listTasks` reads them. */
async function tasksOf(fsd: ReturnType<typeof createClient>, sessionId: string): Promise<any[]> {
  const output = await act(fsd, "agent", sessionId, "listTasks_tasks", {});
  return ((output as { tasks?: any[] } | undefined)?.tasks ?? []) as any[];
}

/** The places and clones under the host's root. */
function underRoot(root: string) {
  const clonesDir = join(root, ".clones");
  return {
    clones: existsSync(clonesDir) ? readdirSync(clonesDir).filter((name) => name.endsWith(".git")) : [],
    places: existsSync(root) ? readdirSync(root).filter((name) => !name.startsWith(".")) : [],
  };
}

/** One run: a fresh lab, a fresh repository, the two legs. Failures are pushed with the leg and assertion that failed. */
async function oneRun(n: number, failures: string[], notes: string[]): Promise<void> {
  const scratch = goalTmpDir(`reads-project-files-${n}`);
  const data = join(scratch, "data");
  const root = join(data, "runs");
  const value = `LC-${randomInt(100_000, 999_999)}-${randomInt(100, 999)}`;
  const repo = makeProjectRepository(join(scratch, "repo"), value);
  const labBefore = labCheckout();
  const fail = (what: string) => failures.push(`run ${n} · ${what}`);

  const lab = await startLab(data, USER, { GOAL_CONTROL: CONTROL === "first-repository" ? CONTROL : "" });
  try {
    const me = { fsd: createClient({ userId: USER, baseUrl: lab.origin }) };

    // ── Leg 1: a session opened on the repository asks, twice.
    const mine = (await me.fsd.flow("agent").createSession({ state: { workerId: MAIN } })).id;
    await act(me.fsd, "agent", mine, SET_SESSION_FIELDS_ACTION, { worker: MAIN, fields: { repository: `file://${repo}` } });
    const first = await ask(me.fsd, mine, fixture.question);
    const second = await ask(me.fsd, mine, fixture.follow);
    if (!first.reply.includes(value)) fail(`leg 1 · value named: the reply doesn't name ${value}: ${JSON.stringify(first.reply.slice(0, 300))}`);
    // Every project read's line names what it read: the file, the search's pattern, the listing's.
    const readLines = [...first.lines, ...second.lines].filter((line) => READ_TOOLS.has(line.tool));
    const unnamed = readLines.filter((line) => !namesWhatItRead(line));
    if (readLines.length === 0) fail("leg 1 · lines name what was read: the turns made no read call");
    else if (unnamed.length > 0) fail(`leg 1 · lines name what was read: ${unnamed.length} of ${readLines.length} don't: ${JSON.stringify(unnamed.map((l) => l.line)).slice(0, 300)}`);
    const fileNamed = readLines.some((line) => line.tool === "readProjectSource" && namesFile(line.line, fixture.path));
    const filed = await tasksOf(me.fsd, mine);
    if (filed.length !== 0) fail(`leg 1 · 0 tasks: the session filed ${filed.length} (${filed.map((t) => t.assignee).join(", ")})`);
    const harness = await me.fsd.sessions.list({ flowKind: "coder", userId: USER });
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
      `run ${n} leg 1: ${first.reads.length + second.reads.length} read call(s)${fileNamed ? " (one names the value's file)" : ""}, ${filed.length} task(s), ${disk.clones.length} clone, ${disk.places.length} place(s)`,
    );

    // ── Leg 2: a session with no repository asks the same.
    const none = (await me.fsd.flow("agent").createSession({ state: { workerId: MAIN } })).id;
    const noRepository = await ask(me.fsd, none, fixture.question);
    if (noRepository.reply.includes(value)) fail("leg 2 · no value: a session with no repository was told the value");
    if (noRepository.reads.length === 0) fail("leg 2 · read refused: the turn made no read call");
    else if (!noRepository.reads.some((read) => read.output?.kind === "refused" && read.output.reason === "no-repository")) {
      fail(`leg 2 · read refused: no read was refused no-repository: ${JSON.stringify(noRepository.reads).slice(0, 300)}`);
    }
    if (!noRepository.lines.some((line) => line.failed && line.line.endsWith("(failed)"))) {
      fail(`leg 2 · refusal reads failed: no tool line says failed: ${JSON.stringify(noRepository.lines.map((l) => l.line)).slice(0, 300)}`);
    }
    notes.push(`run ${n} leg 2: ${noRepository.reads.length} read call(s)`);

    if (labCheckout() !== labBefore) fail("the lab's own checkout changed");
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
