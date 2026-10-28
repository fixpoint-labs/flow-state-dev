/**
 * Part 2, J4: someone builds the next Lab from the published docs alone (D3).
 *
 * A writer that sees only the pages DOCS.md lists, the pentest Lab's README
 * and a scratch copy of `goals/pentest-lab/lab/` (S5) adds the chief of staff,
 * its `hire` and `fire` tools from `createWorkerHireBlocks` with the fire
 * asking first, the `projects` collection and the project tools it names. The
 * task also states what the Lab's other checks need of it (every start fresh;
 * `probe`, `probe-desk` and `coordinator` run only declared workers), facts
 * the writer can't read from the docs or the copy; what to do about them is
 * still the docs' to say. The writer is an isolated Claude Code agent (the
 * Agent SDK) whose only tools read and write inside its own workspace: the
 * docs and the copy, nothing else of the repository. It logs
 * each step it took with the page that told it how, or *doc silent*. Jev
 * judges each doc-silent line against the docs as the writer saw them
 * (`j4-judge.mts`): a line fails J4, reason *doc silent* (QR-14), unless Jev
 * is sure the docs answer it or it is outside what the task asked for. A line
 * Jev is unsure about is judged three times and fails on the majority.
 *
 * `J4_CUT=store` is the control: it cuts the Shift Manager README's stores and
 * restarts from the writer's copy of the docs, a real gap J4 must fail on.
 *
 * Then Shift Manager serves the copy, and the person asks its chief of staff
 * for a project and a worker in the Chief of Staff view: PROJECTS must list
 * the project; the person's roster must hold the worker it hired, and Roster
 * list it as theirs; and a fire of that worker must suspend on one
 * `user_approval` in the store naming it. The copy is deleted after the run;
 * `packages/shift-manager` is left untouched.
 */
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { execFileSync, spawnSync } from "node:child_process";
import type { Browser } from "playwright";
import { REPO_ROOT } from "../../lib/index.mts";
import { labRoutes, personPage, startShiftManager, openShiftManager } from "../../lib/shift-manager.mts";
import { judgeSilent, sectionsOf, type JudgedLine } from "./j4-judge.mts";
import { askCos, asksOf, callsTo, hex, projectsDrawn, quote, readWorkers, RunRecord, rosterOwn, sleep, World } from "./steps.mts";

/** The pages D3's writer sees, as published on the commit (DOCS.md). */
export const J4_PAGES = [
  "apps/docs/docs/workforce/overview.md",
  "apps/docs/docs/workforce/projects.md",
  "apps/docs/docs/workforce/coordinators.md",
  "apps/docs/docs/workforce/shift-coordinator.md",
  "apps/docs/docs/workforce/durable-hire.md",
  "apps/docs/docs/workforce/workers-on-disk.md",
  "packages/workforce/README.md",
  "packages/shift-manager/README.md",
  "goals/pentest-lab/lab/README.md",
];

const TASK = `You are setting up the Lab in \`lab/\` so that Shift Manager can run it the way the docs describe.
Read only the pages under \`docs/\` (and the Lab's own files) to learn how. Nothing else is available to you.

What the Lab must get:
1. A chief of staff: the org worker Shift Manager talks to, able to hire workers of the person's own at once and
   fire them only after the person approves.
2. Projects: the organization's \`projects\` collection, and the project tools \`createProject\` and \`openWorkstream\`
   on the chief of staff, so a person can ask it to create a project and open workstreams in it.
The chief of staff runs on the \`coordinator\` flow with no \`delegates:\`, and its model is \`anthropic/claude-haiku-5-5\`.
It needs no \`setRepository\` and no memory; whether it also gets \`discover\` doesn't matter.

What the Lab's other checks need of it, which its files don't show you:
- Every start of the Lab is fresh: nothing one run writes is kept for the next.
- Only the workers its files declare run its \`probe\`, \`probe-desk\` and \`coordinator\` flows. Nobody hires onto them.

Keep everything the Lab does today working. Edit the files under \`lab/\` (its host and config, and its workforce tree).
The Lab is served by Shift Manager from \`lab/fsdev.config.mts\`.

As you work, keep a log at \`lab/J4-STEPS.md\`: one line per step, in this form:
- <what you did> · <the docs page and section that told you how>
When this task names the exact value you wrote, such as a tool or the model, write \`· this task\` in place of the page.
When no page told you how to do a step and you had to guess or infer it, write instead:
- <what you did> · doc silent: <what the docs did not say>
Be honest: a step you inferred from the Lab's own code or from general knowledge, and not from a docs page, is doc silent.`;

/** J4's controls: each cuts what the docs say about one step from the writer's copy. */
export const J4_CUTS: Record<string, { page: string; cut: RegExp }[]> = {
  store: [
    { page: "packages/shift-manager/README.md", cut: /\*\*A store\.\*\*[\s\S]*?runs on SQLite\.\n/ },
    { page: "packages/shift-manager/README.md", cut: /A restart is a new process:[^\n]*/ },
  ],
};

export interface J4Result {
  ok: boolean;
  failures: string[];
  notes: string[];
  steps: string[];
  silent: string[];
  /** Jev's verdict on each doc-silent line. */
  judged: JudgedLine[];
  diff: string;
  record: RunRecord;
}

/** Run the writer in its own workspace. Returns its summary, or throws when it can't start (blocked). */
async function write(workspace: string, labCopy: string, log: (s: string) => void): Promise<string> {
  const key = process.env.ANTHROPIC_API_KEY ?? process.env.MY_ANTHROPIC_API_KEY;
  if (key === undefined || key === "") throw new Error("blocked: no Anthropic key for the docs-only writer");
  const { query } = (await import("@anthropic-ai/claude-agent-sdk")) as { query: (args: Record<string, unknown>) => AsyncIterable<any> };
  const inside = (p: unknown) => {
    if (typeof p !== "string") return true;
    const abs = resolve(workspace, p);
    let real = abs;
    try {
      real = realpathSync(existsSync(abs) ? abs : dirname(abs));
    } catch {
      /* new path */
    }
    return [workspace, labCopy].some((root) => abs.startsWith(root) || real.startsWith(root));
  };
  // An existing file is overwritten only after it is read, as Claude Code's own Write requires:
  // a writer that clobbers the Lab's host unread is grading the agent, not the docs.
  const realOf = (p: string) => {
    const abs = resolve(workspace, p);
    try {
      return realpathSync(abs);
    } catch {
      return abs;
    }
  };
  const read = new Set<string>();
  let summary = "";
  for await (const message of query({
    prompt: TASK,
    options: {
      cwd: workspace,
      additionalDirectories: [labCopy],
      settingSources: [],
      allowedTools: ["Read", "Write", "Edit", "Glob", "Grep"],
      disallowedTools: ["Bash", "WebFetch", "WebSearch", "Task", "NotebookEdit"],
      maxTurns: 120,
      env: { ...process.env, ANTHROPIC_API_KEY: key },
      // `allowedTools` skips `canUseTool`, so the workspace fence and read-before-write run as a hook, on every call.
      hooks: {
        PreToolUse: [
          {
            hooks: [
              async (hook: { tool_name: string; tool_input: Record<string, unknown> }) => {
                const deny = (reason: string) => ({ hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: "deny", permissionDecisionReason: reason } });
                const paths = [hook.tool_input.file_path, hook.tool_input.path, hook.tool_input.notebook_path].filter((p) => p !== undefined);
                if (!paths.every(inside)) return deny("Only the docs and the Lab in this workspace are available.");
                const file = typeof hook.tool_input.file_path === "string" ? realOf(hook.tool_input.file_path) : undefined;
                if (hook.tool_name === "Read" && file !== undefined) read.add(file);
                if (hook.tool_name === "Write" && file !== undefined && existsSync(file) && !read.has(file)) return deny("That file already exists. Read it before you overwrite it.");
                return {};
              },
            ],
          },
        ],
      },
      canUseTool: async (tool: string, input: Record<string, unknown>) => {
        const paths = [input.file_path, input.path, input.notebook_path].filter((p) => p !== undefined);
        if (!["Read", "Write", "Edit", "Glob", "Grep"].includes(tool) || !paths.every(inside)) {
          return { behavior: "deny", message: "Only the docs and the Lab in this workspace are available." };
        }
        return { behavior: "allow", updatedInput: input };
      },
    },
  })) {
    if (message.type === "assistant") {
      for (const part of message.message?.content ?? []) {
        if (part.type === "tool_use") log(`writer ${part.name} ${JSON.stringify(part.input).slice(0, 160)}`);
      }
    }
    if (message.type === "result") summary = String(message.result ?? message.subtype ?? "");
  }
  return summary;
}

/**
 * The flow J4 names when it asks the chief of staff to hire, read from the
 * writer's files, never from the model: the built-in `agent`, which takes a
 * hire with no settings unless the Lab marks it `standardOnly`. `error` when
 * no file builds the hire blocks, or when the Lab keeps `agent` for its
 * declared workers.
 */
export function hireableFlow(lab: string): { flow: string } | { error: string } {
  const walk = (dir: string): string[] =>
    readdirSync(dir, { withFileTypes: true }).flatMap((e) => (["node_modules", "dist", "test"].includes(e.name) ? [] : e.isDirectory() ? walk(join(dir, e.name)) : /\.m?ts$/.test(e.name) ? [join(dir, e.name)] : []));
  const files = walk(lab).map((path) => readFileSync(path, "utf8"));
  if (!files.some((t) => /createWorkerHireBlocks\s*\(/.test(t))) return { error: "no file in the writer's Lab calls createWorkerHireBlocks, so nothing can be hired" };
  if (files.some((t) => /\bagent\s*:\s*\{[^{}]*standardOnly\s*:\s*true/.test(t))) return { error: "the writer's Lab marks the agent flow standardOnly, so a person can't hire onto it" };
  return { flow: "agent" };
}

export async function j4(browser: Browser, scratch: string, pages: string, shots: string, log: (s: string) => void): Promise<J4Result> {
  const record = new RunRecord("j4", shots);
  const failures: string[] = [];
  const notes: string[] = [];
  const source = join(REPO_ROOT, "goals", "pentest-lab", "lab");
  // The workspace sits in the repository so the copy resolves the workspace's packages, and the copy is a real
  // directory in it: the writer's Glob doesn't follow a symlink, and would report a linked `lab/` empty. The copy
  // sits as deep as the Lab itself, so the Lab's relative imports of `goals/lib` still resolve.
  const workspace = join(REPO_ROOT, "goals", `j4-${hex(3)}`);
  const copy = join(workspace, "lab");
  const smBefore = execFileSync("git", ["-C", REPO_ROOT, "status", "--porcelain", "--", "packages/shift-manager"], { encoding: "utf8" });
  cpSync(source, copy, { recursive: true });
  let diff = "";
  let steps: string[] = [];
  let judged: JudgedLine[] = [];
  try {
    mkdirSync(join(workspace, "docs"), { recursive: true });
    const cutName = process.env.J4_CUT ?? "";
    const cuts = cutName === "" ? [] : J4_CUTS[cutName];
    if (cuts === undefined) throw new Error(`unknown J4_CUT "${cutName}"; known: ${Object.keys(J4_CUTS).join(", ")}`);
    const seen: { page: string; text: string }[] = [];
    for (const page of J4_PAGES.filter((p) => !p.startsWith("goals/pentest-lab/"))) {
      let text = readFileSync(join(REPO_ROOT, page), "utf8");
      for (const c of cuts.filter((c) => c.page === page)) {
        if (!c.cut.test(text)) throw new Error(`J4_CUT=${cutName}: nothing in ${page} matches ${c.cut}, so the control cuts nothing`);
        text = text.replace(c.cut, "");
      }
      writeFileSync(join(workspace, "docs", page.replaceAll("/", "__")), text);
      seen.push({ page, text });
    }
    if (cutName !== "") notes.push(`J4_CUT=${cutName}: cut ${cuts.length} passage(s) from the writer's docs`);
    seen.push({ page: "goals/pentest-lab/lab/README.md", text: readFileSync(join(source, "README.md"), "utf8") });
    // The pentest Lab's README sits in the copy itself, where its author would find it.
    const summary = await write(workspace, copy, log);
    notes.push(`writer's summary: ${summary.slice(0, 600)}`);
    diff = spawnSync("diff", ["-ruN", "--exclude=J4-STEPS.md", source, copy], { encoding: "utf8", maxBuffer: 1 << 24 }).stdout.replaceAll(REPO_ROOT + "/", "");
    const stepsFile = join(copy, "J4-STEPS.md");
    steps = existsSync(stepsFile) ? readFileSync(stepsFile, "utf8").split("\n").filter((l) => /^\s*-\s+/.test(l)) : [];
    if (steps.length === 0) failures.push("J4: the writer kept no step log");
    const silent = steps.filter((l) => /doc silent/i.test(l)).map((l) => l.replace(/^\s*-\s+/, ""));
    // Jev reads each line against the docs as the writer saw them, the control's cut included.
    judged = await judgeSilent(TASK, silent, sectionsOf(seen));
    for (const j of judged) {
      const said = (c: { verdict: string; confidence: number; gap?: number }) => `${c.verdict} ${c.confidence.toFixed(2)}${c.gap === undefined ? "" : ` (gap ${c.gap.toFixed(2)})`}`;
      const calls = j.calls === undefined ? "" : ` (calls: ${j.calls.map(said).join(", ")})`;
      const read = `${said(j)}${calls}, read ${j.cited}`;
      if (j.fails) failures.push(`J4 doc silent (judge: ${read}): ${j.line.slice(0, 400)}`);
      else notes.push(`J4 doc-silent line dropped (judge: ${read}): ${j.line.slice(0, 300)}`);
    }

    // ---- Shift Manager over the copy: the person asks CoS for a project and a worker ----
    let served;
    try {
      served = await startShiftManager({ scratch, label: "j4", config: join(copy, "fsdev.config.mts"), pages, timeoutMs: 120_000 });
    } catch (error) {
      failures.push(`J4: Shift Manager over the writer's Lab did not boot: ${(error as Error).message.slice(0, 1500)}`);
      return { ok: false, failures, notes, steps, silent, judged, diff, record };
    }
    try {
      const html = await (await fetch(`${served.origin}/`)).text();
      const config = JSON.parse(/window\.__FSD_DEVTOOL_CONFIG__ = (\{.*?\});<\/script>/.exec(html)?.[1] ?? "{}") as { userId?: string; bearerToken?: string };
      const person = { userId: String(config.userId), bearer: String(config.bearerToken ?? "") };
      const bootErrors = served.log().split("\n").filter((l) => /error|refus|problem|skipped/i.test(l));
      if (bootErrors.length > 0) notes.push(`boot printed: ${bootErrors.slice(0, 5).join(" | ")}`);
      const world = new World(browser, { owner: person, member: person, outsider: person }, { config: join(copy, "fsdev.config.mts"), pages, scratch, store: join(scratch, "j4-unused.sqlite") }, record);
      // Attach the world to this already-served Lab.
      world.served = served;
      world.routes = { owner: labRoutes(served.origin, person), member: labRoutes(served.origin, person), outsider: labRoutes(served.origin, person) };
      const opened = await personPage(browser, served.origin, person, true);
      world.page = opened.page;
      try {
        const title = `Recon ${hex(2)}`;
        const project = await askCos(world, "J4", `Please create a project called "${title}" for me.`);
        if (project === undefined) failures.push("J4: the Chief of Staff view draws no chief of staff for the writer's Lab");
        else {
          const created = callsTo(project, "createProject").filter((c) => c.ok);
          if (created.length !== 1) failures.push(`J4: asked for a project, CoS made ${created.length} ok createProject call(s): ${quote(project)}`);
          await openShiftManager(world.page, served.origin, "/cos");
          const groups = await projectsDrawn(world.page);
          const ids = groups.map((g) => g.id);
          const titled = await world.page.locator("[data-testid=project-group]").evaluateAll((els, t) => els.filter((e) => (e.textContent ?? "").toLowerCase().includes(String(t).toLowerCase())).map((e) => e.getAttribute("data-project-id") ?? ""), title);
          const id = titled[0];
          if (id === undefined) failures.push(`J4: PROJECTS doesn't list "${title}" (lists [${ids.join(", ")}])`);
          else notes.push(`J4: PROJECTS lists ${id} ("${title}")`);
        }
        const worker = `helper-${hex()}`;
        // Name the flow, so the chief of staff isn't left to ask which one: the writer's Lab says whether `agent` takes a hire.
        const hireable = hireableFlow(copy);
        const hire = "error" in hireable ? undefined : await askCos(world, "J4", `Please hire a worker with the id "${worker}" on the "${hireable.flow}" flow. It needs no settings.`);
        if ("error" in hireable) failures.push(`J4: no flow to hire on: ${hireable.error}`);
        else if (hire === undefined) failures.push("J4: asked for a worker, the Chief of Staff view draws no chief of staff to ask");
        else {
          await sleep(500);
          // A worker the person hires is theirs: a row on their own roster, which Roster lists as theirs.
          const row = (await readWorkers(world.routes.owner)).find((w) => w.id === worker);
          const own = (await rosterOwn(world)).some((w) => w.id === worker);
          if (row === undefined || !own) failures.push(`J4: asked for a worker, "${worker}" is roster row ${row !== undefined}, listed in Roster as the person's ${own}: ${quote(hire)}`);
          else if (row.flow !== hireable.flow) failures.push(`J4: asked for a worker on "${hireable.flow}", "${worker}" was hired on "${row.flow}": ${quote(hire)}`);
          else {
            notes.push(`J4: the person's roster holds "${worker}" on "${row.flow}", and Roster lists it as theirs`);
            // The fire asks first: a fire of that worker suspends on the person's approval, read from the store. Left unanswered.
            const fire = await askCos(world, "J4", `Please fire the worker "${worker}".`);
            if (fire === undefined || fire.sessionId === null || fire.requestId === null) failures.push(`J4: the fire was not asked: ${quote(fire)}`);
            else {
              const asks = (await asksOf(world.routes.owner, fire.sessionId, fire.requestId)).filter((a) => a.reason === "user_approval");
              const named = (asks[0]?.data as { worker?: string } | undefined)?.worker;
              if (fire.status !== "suspended" || asks.length !== 1) failures.push(`J4: asked to fire "${worker}", the turn ended ${fire.status} with ${asks.length} user_approval ask(s), not suspended on one: ${quote(fire)}`);
              else if (named !== worker || !/fire/i.test(asks[0]!.message ?? "")) failures.push(`J4: the fire's ask says "${asks[0]!.message}" naming ${JSON.stringify(asks[0]!.data)}, not a fire of "${worker}"`);
              // Nothing is removed before the person answers: a fire that writes first and asks after still raises the same ask.
              else if (!(await readWorkers(world.routes.owner)).some((w) => w.id === worker)) failures.push(`J4: asked to fire "${worker}", the turn suspended on its ask, but the person's roster no longer holds it: the fire ran before anyone approved`);
              else notes.push(`J4: asked to fire "${worker}", the turn suspended on one user_approval "${asks[0]!.message}" ${JSON.stringify(asks[0]!.data)}; left unanswered, and the worker is still on the roster`);
            }
          }
        }
        await record.shot(world.page, "j4");
      } finally {
        await opened.context.close();
      }
    } finally {
      await served.stop();
    }
    const smAfter = execFileSync("git", ["-C", REPO_ROOT, "status", "--porcelain", "--", "packages/shift-manager"], { encoding: "utf8" });
    if (smAfter !== smBefore) failures.push("J4: packages/shift-manager changed");
    return { ok: failures.length === 0, failures, notes, steps, silent, judged, diff, record };
  } finally {
    // The writer's files, kept for the report, then the copy is deleted.
    try {
      cpSync(copy, join(scratch, "j4-writer-files"), { recursive: true });
    } catch {
      /* best effort */
    }
    rmSync(workspace, { recursive: true, force: true });
  }
}
