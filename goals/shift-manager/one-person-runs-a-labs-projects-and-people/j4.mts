/**
 * Part 2, J4: someone builds the next Lab from the published docs alone (D3).
 *
 * A writer that sees only the pages DOCS.md lists, the pentest Lab's README
 * and a scratch copy of `goals/pentest-lab/lab/` (S5) adds the chief of staff,
 * the hire capability with `askBefore: ["fire"]`, the `projects` collection
 * with its template and the project tools. The writer is an isolated Claude
 * Code agent (the Agent SDK) whose only tools read and write inside its own
 * workspace: the docs and the copy, nothing else of the repository. Every
 * step it reports no page covered is a failed step, reason *doc silent*
 * (QR-14).
 *
 * Then Shift Manager serves the copy, and the person asks its chief of staff
 * for a project and a seat in the Chief of Staff view: PROJECTS must list the
 * project with a room the person can post in, TEAMS the worker it hired, and a
 * fire of that worker must suspend on one `human_approval` in the store (askBefore). The copy is
 * deleted after the run; `packages/shift-manager` is left untouched.
 */
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, realpathSync, rmSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { execFileSync, spawnSync } from "node:child_process";
import type { Browser } from "playwright";
import { REPO_ROOT } from "../../lib/index.mts";
import { labRoutes, personPage, startShiftManager, openShiftManager } from "../../lib/shift-manager.mts";
import { askCos, asksOf, callsTo, hex, projectsDrawn, quote, readRoom, RunRecord, sleep, teamsSeats, visible, World } from "./steps.mts";

/** The pages D3's writer sees, as published on the commit (DOCS.md). */
export const J4_PAGES = [
  "apps/docs/docs/workforce/overview.md",
  "apps/docs/docs/workforce/projects.md",
  "apps/docs/docs/workforce/mailboxes.md",
  "apps/docs/docs/workforce/chief-of-staff.md",
  "apps/docs/docs/workforce/durable-hire.md",
  "apps/docs/docs/workforce/workers-on-disk.md",
  "packages/workforce/README.md",
  "packages/shift-manager/README.md",
  "goals/pentest-lab/lab/README.md",
];

const TASK = `You are setting up the Lab in \`lab/\` so that Shift Manager can run it the way the docs describe.
Read only the pages under \`docs/\` (and the Lab's own files) to learn how. Nothing else is available to you.

What the Lab must get:
1. A chief of staff: the org seat Shift Manager talks to, on the built-in agent kind, able to hire seats at once and
   fire them only after a person approves (the hire capability installed with askBefore: ["fire"]).
2. Projects: the organization's \`projects\` collection with its talk template, and the project tools on the chief
   of staff so a person can ask it to create a project. A project must have a room its members can post in.

Keep everything the Lab does today working. Edit the files under \`lab/\` (its host and config, and its workforce tree).
The Lab is served by Shift Manager from \`lab/fsdev.config.mts\`.

As you work, keep a log at \`lab/J4-STEPS.md\`: one line per step, in this form:
- <what you did> · <the docs page and section that told you how>
When no page told you how to do a step and you had to guess or infer it, write instead:
- <what you did> · doc silent: <what the docs did not say>
Be honest: a step you inferred from the Lab's own code or from general knowledge, and not from a docs page, is doc silent.`;

export interface J4Result {
  ok: boolean;
  failures: string[];
  notes: string[];
  steps: string[];
  silent: string[];
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
 * The kind J4 names when it asks the chief of staff to hire, read from the
 * writer's files, never from the model: `agent` when the hire capability the
 * writer installed allows it, otherwise the one other kind it allows. Its
 * `allowKinds`, when set, is read as written: string literals, and constants
 * declared in the Lab's own files or exported by the workspace's packages
 * (`AGENT_KIND`). Left out, every kind is hireable, the built-in `agent`
 * among them. `error` when no file installs the capability, or when what it
 * allows can't be read well enough to pick.
 */
export function hireableKind(lab: string): { kind: string; allowed: string[] } | { error: string } {
  const walk = (dir: string): string[] =>
    readdirSync(dir, { withFileTypes: true }).flatMap((e) => (["node_modules", "dist", "test"].includes(e.name) ? [] : e.isDirectory() ? walk(join(dir, e.name)) : /\.m?ts$/.test(e.name) ? [join(dir, e.name)] : []));
  const read = (paths: string[]) => paths.map((path) => readFileSync(path, "utf8"));
  const files = read(walk(lab));
  if (!files.some((t) => /createSeatHireCapability\s*\(/.test(t))) return { error: "no file in the writer's Lab calls createSeatHireCapability, so nothing can be hired" };
  const lists = files.flatMap((t) => [...t.matchAll(/allowKinds\s*:\s*\[([^\]]*)\]/g)].map((m) => m[1]!));
  if (lists.length === 0) return { kind: "agent", allowed: ["agent (no allowKinds: every kind)"] };
  let packages: string[] | undefined;
  const declared = (name: string, texts: string[]) => texts.map((t) => new RegExp(`const\\s+${name}\\s*(?::[^=]+)?=\\s*["'\`]([^"'\`]+)["'\`]`).exec(t)?.[1]).find((v) => v !== undefined);
  const constant = (name: string) =>
    declared(name, files) ??
    declared(name, (packages ??= read(readdirSync(join(REPO_ROOT, "packages")).flatMap((p) => (existsSync(join(REPO_ROOT, "packages", p, "src")) ? walk(join(REPO_ROOT, "packages", p, "src")) : [])))));
  const allowed = new Set<string>();
  const unread: string[] = [];
  for (const entry of lists.flatMap((l) => l.split(",")).map((e) => e.trim()).filter(Boolean)) {
    const literal = /^["'`]([^"'`]+)["'`]$/.exec(entry)?.[1];
    const value = literal ?? (/^[A-Za-z_$][\w$]*$/.test(entry) ? constant(entry) : undefined);
    if (value === undefined) unread.push(entry);
    else allowed.add(value);
  }
  const kinds = [...allowed].sort();
  if (allowed.has("agent")) return { kind: "agent", allowed: kinds };
  if (unread.length > 0 || kinds.length === 0) return { error: `the writer's allowKinds can't be read well enough to pick a kind (${lists.map((l) => `[${l.trim()}]`).join(", ")}; read [${kinds.join(", ")}], unread [${unread.join(", ")}])` };
  return { kind: kinds[0]!, allowed: kinds };
}

export async function j4(browser: Browser, scratch: string, pages: string, shots: string, log: (s: string) => void): Promise<J4Result> {
  const record = new RunRecord("j4", shots);
  const failures: string[] = [];
  const notes: string[] = [];
  const source = join(REPO_ROOT, "goals", "pentest-lab", "lab");
  // The workspace sits in the repository so the copy resolves the workspace's packages, and the copy is a real
  // directory in it: the writer's Glob doesn't follow a symlink, and would report a linked `lab/` empty.
  const workspace = join(REPO_ROOT, "goals", "pentest-lab", `j4-${hex(3)}`);
  const copy = join(workspace, "lab");
  const smBefore = execFileSync("git", ["-C", REPO_ROOT, "status", "--porcelain", "--", "packages/shift-manager"], { encoding: "utf8" });
  cpSync(source, copy, { recursive: true });
  let diff = "";
  let steps: string[] = [];
  try {
    mkdirSync(join(workspace, "docs"), { recursive: true });
    for (const page of J4_PAGES.filter((p) => !p.startsWith("goals/pentest-lab/"))) {
      const to = join(workspace, "docs", page.replaceAll("/", "__"));
      cpSync(join(REPO_ROOT, page), to);
    }
    // The pentest Lab's README sits in the copy itself, where its author would find it.
    const summary = await write(workspace, copy, log);
    notes.push(`writer's summary: ${summary.slice(0, 600)}`);
    diff = spawnSync("diff", ["-ruN", "--exclude=J4-STEPS.md", source, copy], { encoding: "utf8", maxBuffer: 1 << 24 }).stdout.replaceAll(REPO_ROOT + "/", "");
    const stepsFile = join(copy, "J4-STEPS.md");
    steps = existsSync(stepsFile) ? readFileSync(stepsFile, "utf8").split("\n").filter((l) => /^\s*-\s+/.test(l)) : [];
    if (steps.length === 0) failures.push("J4: the writer kept no step log");
    const silent = steps.filter((l) => /doc silent/i.test(l));
    for (const s of silent) failures.push(`J4 doc silent: ${s.replace(/^\s*-\s+/, "").slice(0, 400)}`);

    // ---- Shift Manager over the copy: the person asks CoS for a project and a seat ----
    let served;
    try {
      served = await startShiftManager({ scratch, label: "j4", config: join(copy, "fsdev.config.mts"), pages, timeoutMs: 120_000 });
    } catch (error) {
      failures.push(`J4: Shift Manager over the writer's Lab did not boot: ${(error as Error).message.slice(0, 1500)}`);
      return { ok: false, failures, notes, steps, silent, diff, record };
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
          else {
            await openShiftManager(world.page, served.origin, `/p/${encodeURIComponent(id)}/stream`);
            const token = `j4-${hex(3)}`;
            if (!(await visible(world.page, "composer-input", 15_000))) failures.push(`J4: ${id}'s Stream has no composer for the person`);
            else {
              await world.page.getByTestId("composer-input").fill(`${token} hello room`);
              await world.page.getByTestId("composer-send").click();
              try {
                await world.page.getByTestId("transcript-line-body").filter({ hasText: token }).first().waitFor({ timeout: 30_000 });
                notes.push(`J4: PROJECTS lists ${id} ("${title}"); the person posted ${token} in its Stream and it is drawn`);
              } catch {
                failures.push(`J4: the line posted in ${id}'s Stream was never drawn`);
              }
              // The room the Stream reads: its talk session, as the page names it, read back through the Lab.
              const talk = (await world.page.getByTestId("stream").getAttribute("data-talk-session").catch(() => null)) ?? undefined;
              if (talk === undefined) failures.push(`J4: ${id}'s Stream names no talk session, so the room can't be read from the store`);
              else {
                const read = await readRoom(world.routes.owner, talk).then(
                  (lines) => ({ lines }),
                  (error: Error) => ({ error: error.message }),
                );
                if ("error" in read) failures.push(`J4: ${id}'s room could not be read through ${talk}: ${read.error.slice(0, 300)}`);
                else if (!read.lines.some((l) => l.body.includes(token))) failures.push(`J4: ${id}'s room holds no line with ${token}`);
                else notes.push(`J4: ${id}'s room, read through ${talk}, holds the line with ${token}`);
              }
            }
          }
        }
        const seat = `helper-${hex()}`;
        // Name the kind, so the chief of staff isn't left to ask which one: the writer's Lab says which it may hire.
        const hireable = hireableKind(copy);
        const hire = "error" in hireable ? undefined : await askCos(world, "J4", `Please hire a seat with the seat id "${seat}" on the "${hireable.kind}" kind.${hireable.kind === "agent" ? " It needs no settings." : ""}`);
        if ("error" in hireable) failures.push(`J4: no kind to hire: ${hireable.error}`);
        else if (hire === undefined) failures.push("J4: asked for a worker, the Chief of Staff view draws no chief of staff to ask");
        else {
          await sleep(500);
          const teams = await teamsSeats(world);
          if (!teams.some((t) => t === seat || t.endsWith(`.${seat}`))) failures.push(`J4: asked for a seat, TEAMS doesn't list "${seat}": ${quote(hire)}`);
          else {
            notes.push(`J4: TEAMS lists ${teams.find((t) => t.endsWith(seat))}, hired on "${hireable.kind}" (the writer allows [${hireable.allowed.join(", ")}])`);
            // askBefore: ["fire"]: a fire of that worker suspends on the person's approval, read from the store. Left unanswered.
            const fire = await askCos(world, "J4", `Please fire the seat "${seat}".`);
            if (fire === undefined || fire.sessionId === null || fire.requestId === null) failures.push(`J4: the fire was not asked: ${quote(fire)}`);
            else {
              const asks = (await asksOf(world.routes.owner, fire.sessionId, fire.requestId)).filter((a) => a.reason === "human_approval");
              const data = asks[0]?.data as { verb?: string; seatId?: string } | undefined;
              if (fire.status !== "suspended" || asks.length !== 1) failures.push(`J4: asked to fire "${seat}", the turn ended ${fire.status} with ${asks.length} human_approval ask(s), not suspended on one: ${quote(fire)}`);
              else if (data?.verb !== "fire" || data?.seatId !== seat) failures.push(`J4: the fire's ask names ${JSON.stringify(data)}, not fire "${seat}"`);
              else notes.push(`J4: asked to fire "${seat}", the turn suspended on one human_approval ${JSON.stringify(data)}; left unanswered`);
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
    return { ok: failures.length === 0, failures, notes, steps, silent, diff, record };
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
