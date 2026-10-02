/**
 * Goal check (epic closure): a Lab is reached and worked through one skinned
 * shell. See goal.md for the contract; the plan it runs is FIX-1663's
 * `PLAN.md`, read with the epic's 2026-10-01 amendment (design v2's
 * structure: Chief of Staff, Roster, the Day / Night switch).
 *
 * A thin driver over one commit, in the plan's order:
 *
 *   part 1   legs a (DevForce, real model on a4), b0 (the pentest config
 *            written from Shift Manager's README by an isolated writer), b
 *            (pentest, keyless, plus every Lab opening under an org) and c
 *            (no theme, `--shift day` then `--shift night`, plus the static
 *            fence over packages/)
 *   controls each on its own build or start; each must fail its own leg at
 *            its own signal and leave the rest green
 *   part 2   J3 (FSD UI reused in a fresh app) and J4 (a sibling's surfaces
 *            open by address)
 *   part 3   every child's goal check, with its controls, and the goal labs'
 *            checks, by subprocess; `pnpm typecheck` and `pnpm test`
 *   part 4   the seams
 *
 * Every verdict is printed as `VERDICT <id>: …` with the commit it ran on.
 *
 * Run:      PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers pnpm tsx goals/shift-manager/a-lab-is-worked-through-one-skinned-shell/run.mts
 * Parts:    GOAL_PART=a,b0,b,c,controls,part2,part3,part4 (default: all, in that order)
 * Controls: GOAL_CONTROLS=hardcoded-accent,… (default: all of them)
 * Needs:    a model key (leg a, and the real-model child checks), a signed-in
 *           Claude Code (a4's harness, and b0's writer through the `claude`
 *           CLI), Chromium, and `pnpm build:assets` for the devtool pages.
 */
import { execFileSync, spawn } from "node:child_process";
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { readDeclaredRoster } from "@flow-state-dev/workforce/loader";
import { REPO_ROOT, goalTmpDir, runGoal } from "../../lib/index.mts";
import { readShiftManagerTheme } from "../../lib/colour.mts";
import { launchChromium } from "../../lib/playwright.mts";
import { PENTEST_CONFIG, TREES, legA, legB, legC, staticFence, type LegCtx, type Report } from "./legs.mts";
import { j3, j4, part4 } from "./parts.mts";
import { SHIFT_MANAGER, buildPages, injected, labApi, open, readStore, readTree, startShiftManager, type Built, type Patch, type Swap } from "./shell.mts";

const HERE = fileURLToPath(new URL(".", import.meta.url));
const SCRATCH = goalTmpDir("shift-manager-closure");
const PARTS = (process.env.GOAL_PART ?? "a,b0,b,c,controls,part2,part3,part4").split(",").map((s) => s.trim());
const git = (...args: string[]) => execFileSync("git", args, { cwd: REPO_ROOT, encoding: "utf8" }).trim();

const COMMIT = git("rev-parse", "HEAD");
const DIRTY = git("status", "--porcelain", "--", ".", `:(exclude)${relative(REPO_ROOT, HERE)}`) !== "";
const AT = `${COMMIT.slice(0, 9)}${DIRTY ? "+wip" : ""}`;

/** The commit before FIX-1662's first merge: today's main, as the epic's control. */
const TODAYS_MAIN = (() => {
  const merge = git("log", "--first-parent", "--diff-filter=A", "--format=%H", "HEAD", "--", "labs/app-lab/package.json").split("\n").at(-1)!;
  return git("rev-parse", `${merge}^1`);
})();

// ---- reporting -----------------------------------------------------------------

type Failure = { signal: string; why: string };
/** A fresh report: failures by signal, and notes for the evidence. */
function collector(): Report & { failures: Failure[]; notes: string[] } {
  const failures: Failure[] = [];
  const notes: string[] = [];
  return { failures, notes, fail: (signal, why) => failures.push({ signal, why }), note: (line) => notes.push(line) };
}

const verdicts: Array<{ id: string; ok: boolean; line: string }> = [];
function verdict(id: string, ok: boolean, line: string, detail: string[] = []): void {
  verdicts.push({ id, ok, line });
  console.log(`VERDICT ${id} @ ${AT}: ${line}`);
  for (const d of detail) console.log(`    ${d}`);
}

/** Report one leg's own result: PASS, or FAIL with each failure. */
function legVerdict(id: string, prefix: string[], report: ReturnType<typeof collector>): void {
  const mine = report.failures.filter((f) => prefix.some((p) => f.signal === p || f.signal.startsWith(`${p}:`)));
  const notes = report.notes.filter((n) => prefix.some((p) => n.startsWith(`${p}:`) || n.startsWith(`${p} `)));
  verdict(id, mine.length === 0, mine.length === 0 ? "PASS" : `FAIL (${mine.length})`, [...mine.map((f) => `✗ [${f.signal}] ${f.why}`), ...notes]);
}

// ---- builds --------------------------------------------------------------------

const THEME_IMPORT = /^@import "@flow-state-dev\/design-system\/shift-manager\.css";\n/m;
const NO_THEME: Patch = { file: "src/styles.css", from: THEME_IMPORT, to: "", why: "the design-system import line removed (leg c)" };
const ACCENT = readShiftManagerTheme().attentionLight;
const HARDCODED_ACCENT: Patch = {
  file: "src/components/flow-state/tool.tsx",
  from: /CheckCircleIcon className="size-4 text-success"/g,
  to: `CheckCircleIcon className="size-4 text-[${ACCENT}]"`,
  why: `control hardcoded-accent: Shift Manager's copy of the tool card paints its completed icon with Shift Manager's accent ${ACCENT} as a literal`,
};
const NO_ORG: Patch = {
  file: "src/surfaces/Sidebar.tsx",
  from: "<OrgSwitcher orgId={loaded.orgId} onSwitch={retry} />",
  to: '<OrgSwitcher orgId={""} onSwitch={retry} />',
  why: "control no-org: Shift Manager renders with no org, the org switcher empty",
};
const CHILD = (goal: string, file: string) => join(REPO_ROOT, "goals", "shift-manager", goal, "controls", file);
const swapOf = (target: string, goal: string, file: string): Swap => ({ target: join(SHIFT_MANAGER, "src", "lib", target), with: CHILD(goal, file) });

/**
 * A build with a module swapped in and the theme import removed in the
 * bundler, in a child process: the scratch-copy route can't take a swap (the control module
 * imports the checkout's sources), and removing a stylesheet import changes
 * no class name Tailwind reads off disk.
 */
async function swapBuild(name: string, swap: Swap, noTheme: boolean, staticSeats?: Array<{ id: string; kind: string }>): Promise<Built> {
  if (!noTheme) return buildPages(SCRATCH, name, { swap, staticSeats });
  // In a process of its own: Tailwind's Vite plugin keeps a stylesheet's
  // compiled CSS per file across builds in one process, so this build would
  // otherwise ship the themed build's CSS for the same \`src/styles.css\`.
  const pages = join(SCRATCH, name, "pages");
  const script = join(SCRATCH, name, "build.mts");
  mkdirSync(join(SCRATCH, name), { recursive: true });
  writeFileSync(
    script,
    `import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
const [root, outDir, target, withFile, seats] = ${JSON.stringify([SHIFT_MANAGER, pages, swap.target, swap.with, staticSeats ?? []])};
const THEME_IMPORT = ${THEME_IMPORT.toString()};
const vite = await import(pathToFileURL(createRequire(root + "/package.json").resolve("vite")).href);
let swapped = 0;
let stripped = 0;
await vite.build({
  root,
  configFile: root + "/vite.config.ts",
  logLevel: "error",
  build: { outDir, emptyOutDir: true },
  define: { __STATIC_SEATS__: JSON.stringify(seats) },
  plugins: [
    {
      name: "goal-control-swap",
      enforce: "pre",
      async resolveId(source, importer, opts) {
        if (importer === undefined || importer === withFile) return null;
        const resolved = await this.resolve(source, importer, { ...opts, skipSelf: true });
        if (resolved?.id !== target) return null;
        swapped += 1;
        return withFile;
      },
    },
    {
      name: "goal-no-theme",
      enforce: "pre",
      load(id) {
        if (id.includes("?") || !id.endsWith("/src/styles.css")) return null;
        const code = readFileSync(id, "utf8");
        const out = code.replace(THEME_IMPORT, "");
        if (out !== code) stripped += 1;
        return out;
      },
    },
  ],
});
if (swapped === 0) throw new Error("the build never imported " + target);
if (stripped === 0) throw new Error("the theme import was never removed");
`,
  );
  try {
    execFileSync(join(REPO_ROOT, "node_modules", ".bin", "tsx"), [script], { cwd: REPO_ROOT, encoding: "utf8", stdio: "pipe", maxBuffer: 64 * 1024 * 1024 });
  } catch (error) {
    throw new Error(`setup [${name}]: ${String((error as { stderr?: string }).stderr ?? error).trim().split("\n").slice(-3).join(" ")}`);
  }
  const css = readdirSync(join(pages, "assets")).filter((f) => f.endsWith(".css")).map((f) => readFileSync(join(pages, "assets", f), "utf8")).join("\n");
  if (/Space Grotesk/i.test(css)) throw new Error(`setup [${name}]: the no-theme build still ships the Shift Manager theme`);
  return { pages, diff: `# the design-system import line removed in the bundler (src/styles.css), plus ${relative(REPO_ROOT, swap.with)} in place of ${relative(REPO_ROOT, swap.target)}` };
}

// ---- b0: the pentest config, from the README alone -------------------------------

/**
 * b0. An isolated writer (the `claude` CLI, in a scratch directory holding
 * only Shift Manager's README and a copy of the pentest Lab with its config
 * removed, no project instructions) writes a config and lists what it had to
 * guess. The run boots Shift Manager over it once, then compares what it boots
 * with what the committed config boots: flows, the org, the inventory, who
 * the page reads as. A semantic difference, a failed boot, or a guessed step
 * is a finding.
 */
async function b0(report: Report): Promise<void> {
  const fail = (why: string) => report.fail("b0", why);
  const room = join(SCRATCH, "b0-writer");
  rmSync(room, { recursive: true, force: true });
  mkdirSync(room, { recursive: true });
  cpSync(join(SHIFT_MANAGER, "README.md"), join(room, "SHIFT-MANAGER-README.md"));
  const labDir = join(REPO_ROOT, "goals", "pentest-lab", "lab");
  cpSync(labDir, join(room, "pentest-lab", "lab"), { recursive: true, filter: (src) => src !== PENTEST_CONFIG });
  const prompt = [
    "You are opening a Lab in Shift Manager for the first time. You have two things and nothing else:",
    "SHIFT-MANAGER-README.md (Shift Manager's README) and the Lab's tree under pentest-lab/lab/.",
    "Following the README, write the one file the README says a Lab needs so Shift Manager can open it:",
    "pentest-lab/lab/fsdev.config.mts. It must default-export what the README asks for. Use the Lab's own code",
    "where it helps; edit nothing else. Read only files in this directory.",
    "When done, reply with one line per step the README did not tell you and you had to guess, each starting",
    "'GUESSED: ', or the single line 'GUESSED: none'.",
  ].join(" ");
  const env = { ...process.env };
  for (const key of ["CLAUDE_CODE_ADDITIONAL_DIRECTORIES_CLAUDE_MD", "CLAUDE_ADDITIONAL_DIRECTORIES"]) delete env[key];
  let reply = "";
  try {
    reply = execFileSync("claude", ["-p", prompt, "--allowedTools", "Read,Glob,Grep,Write", "--disallowedTools", "Bash,WebFetch,WebSearch", "--max-turns", "40"], {
      cwd: room,
      env,
      encoding: "utf8",
      timeout: 15 * 60_000,
      maxBuffer: 16 * 1024 * 1024,
    });
  } catch (error) {
    return fail(`blocked: the writer did not run (${String((error as Error).message).split("\n")[0]})`);
  }
  const written = join(room, "pentest-lab", "lab", "fsdev.config.mts");
  if (!existsSync(written)) return fail("the writer wrote no fsdev.config.mts");
  const guesses = reply.split("\n").filter((l) => l.startsWith("GUESSED:")).map((l) => l.slice("GUESSED:".length).trim()).filter((g) => g !== "none");
  for (const guess of guesses) fail(`the writer had to guess: ${guess}`);
  const text = readFileSync(written, "utf8");
  report.note(`b0: the writer's config (${text.split("\n").length} lines), kept at ${written}:\n${text.split("\n").map((l) => `      | ${l}`).join("\n")}`);
  const devteam = readFileSync(join(SHIFT_MANAGER, "teams", "devteam", "fsdev.config.mts"), "utf8");
  report.note(`b0: lines that differ from DevTeam's config:\n${lineDiff(devteam, text).map((l) => `      ${l}`).join("\n")}`);

  // Boot it once, beside the committed config so its relative imports resolve, and compare what each boots.
  const beside = join(labDir, ".b0-writer.fsdev.config.mts");
  writeFileSync(beside, text);
  try {
    const browser = await launchChromium();
    try {
      const boot = async (config: string, label: string) => {
        const served = await startShiftManager(SCRATCH, label, { config, pages: PAGES!.pages, env: { AI_GATEWAY_API_KEY: "", OPENAI_API_KEY: "", OPENROUTER_API_KEY: "", ANTHROPIC_API_KEY: "" } });
        const page = await browser.newPage();
        try {
          await open(page, served.origin, "/");
          const who = await injected(page);
          const api = labApi(served.origin, who.bearer);
          const store = await readStore(api, await readTree(TREES.pentest), who.userId);
          const listed = await api.get("");
          const flows = (Array.isArray(listed) ? listed : (listed?.flows ?? [])) as Array<{ id?: string; kind?: string }>;
          return {
            flows: flows.map((f) => String(f.id ?? f.kind)).sort(),
            orgs: store.orgs,
            seats: store.seats,
            channels: store.channels.map((c) => `${c.id}[${c.members.join(",")}]`),
            userId: who.userId,
            bearer: who.bearer !== undefined,
          };
        } finally {
          await page.close();
          await served.stop();
        }
      };
      let theirs: Awaited<ReturnType<typeof boot>>;
      try {
        theirs = await boot(beside, "b0-writer");
      } catch (error) {
        return fail(`Shift Manager does not boot over the writer's config: ${String((error as Error).message).split("\n").slice(0, 4).join(" ")}`);
      }
      const ours = await boot(PENTEST_CONFIG, "b0-committed");
      for (const key of Object.keys(ours) as Array<keyof typeof ours>) {
        const a = JSON.stringify(ours[key]);
        const b = JSON.stringify(theirs[key]);
        if (a !== b) fail(`the writer's config boots a different ${key}: ${b}, the committed config ${a}`);
      }
      report.note(`b0: booted with the README's command over the writer's copy; both configs boot ${ours.flows.length} flows, org [${ours.orgs.join(", ")}], seats [${ours.seats.join(", ")}], workstreams [${ours.channels.join(", ")}], page as ${ours.userId}${ours.bearer ? " with a bearer" : ""}`);
    } finally {
      await browser.close();
    }
  } finally {
    rmSync(beside, { force: true });
  }
}

/** A plain line diff: lines only in `a` as `-`, only in `b` as `+`. */
function lineDiff(a: string, b: string): string[] {
  const left = new Set(a.split("\n").map((l) => l.trim()).filter(Boolean));
  const right = new Set(b.split("\n").map((l) => l.trim()).filter(Boolean));
  return [...[...left].filter((l) => !right.has(l)).map((l) => `- ${l}`), ...[...right].filter((l) => !left.has(l)).map((l) => `+ ${l}`)];
}

// ---- controls --------------------------------------------------------------------

type Control = {
  name: string;
  /** Builds: one for legs a and b, one (no theme) for leg c. */
  build: () => Promise<{ themed: Built; noTheme: Built }>;
  /** The signals that must go red. Anything else red is a finding. */
  must: string[];
  /** Signals allowed to go red with `must` (none unless a goal names the co-failure). */
  also?: string[];
  legs: Array<"a" | "b" | "c">;
};

async function controls(only: string[] | null): Promise<void> {
  const devforceSeats = (await readDeclaredRoster(TREES.devforce)).workers.map((w) => ({ id: w.id, kind: String(w.declared.flow) }));
  const all: Control[] = [
    {
      name: "hardcoded-accent",
      build: async () => ({
        themed: await buildPages(SCRATCH, "ctl-hardcoded-accent-themed", { patches: [HARDCODED_ACCENT] }),
        noTheme: await buildPages(SCRATCH, "ctl-hardcoded-accent-no-theme", { patches: [NO_THEME, HARDCODED_ACCENT] }),
      }),
      must: ["c:tool"],
      legs: ["a", "b", "c"],
    },
    {
      name: "static-names",
      build: async () => {
        const swap = swapOf("reads.ts", "it-opens-a-lab", "static-names.ts");
        return { themed: await swapBuild("ctl-static-names", swap, false, devforceSeats), noTheme: await swapBuild("ctl-static-names-no-theme", swap, true, devforceSeats) };
      },
      must: ["b:teams"],
      // Jump to's Workers list is the same written-in seat list TEAMS draws.
      also: ["b:reach"],
      legs: ["a", "b", "c"],
    },
    {
      name: "optimistic-post",
      build: async () => {
        const swap = swapOf("transcript.ts", "it-opens-a-lab", "optimistic-post.ts");
        return { themed: await swapBuild("ctl-optimistic-post", swap, false), noTheme: await swapBuild("ctl-optimistic-post-no-theme", swap, true) };
      },
      must: ["a4", "b:post"],
      legs: ["a", "b", "c"],
    },
    {
      name: "worker-session",
      build: async () => {
        const swap = swapOf("run.ts", "it-shows-and-stops-a-task-run", "worker-session.ts");
        return { themed: await swapBuild("ctl-worker-session", swap, false), noTheme: await swapBuild("ctl-worker-session-no-theme", swap, true) };
      },
      must: ["a2"],
      // Leg c draws its message, reasoning, tool and code block cards through
      // the run-lab's task Session, which this control points elsewhere.
      also: ["c:sweep"],
      legs: ["a", "b", "c"],
    },
    {
      name: "no-org",
      build: async () => ({
        themed: await buildPages(SCRATCH, "ctl-no-org-themed", { patches: [NO_ORG] }),
        noTheme: await buildPages(SCRATCH, "ctl-no-org-no-theme", { patches: [NO_THEME, NO_ORG] }),
      }),
      must: ["b:org"],
      legs: ["a", "b", "c"],
    },
  ];

  // Today's main: Shift Manager is absent, so legs a and b can't start; c's static half stays green.
  if (only === null || only.includes("todays-main")) {
    const absent = ["labs/shift-manager/package.json", "labs/app-lab/package.json"].every((p) => {
      try {
        git("cat-file", "-e", `${TODAYS_MAIN}:${p}`);
        return false;
      } catch {
        return true;
      }
    });
    const report = collector();
    const tree = join(SCRATCH, "todays-main");
    rmSync(tree, { recursive: true, force: true });
    mkdirSync(tree, { recursive: true });
    execFileSync("sh", ["-c", `git archive ${TODAYS_MAIN} packages | tar -x -C ${tree}`], { cwd: REPO_ROOT });
    staticFence(join(tree, "packages"), "c:static", report);
    const staticGreen = report.failures.length === 0;
    verdict(
      "control today's-main",
      absent && staticGreen,
      absent && staticGreen ? `FAIL (expected) at ${TODAYS_MAIN.slice(0, 9)}: legs a and b, Shift Manager is absent; c's static half green` : `WRONG: Shift Manager absent ${absent}, static half green ${staticGreen}`,
      [...report.failures.map((f) => `✗ [${f.signal}] ${f.why}`), ...report.notes],
    );
  }

  for (const control of all) {
    if (only !== null && !only.includes(control.name)) continue;
    const report = collector();
    let built: { themed: Built; noTheme: Built };
    try {
      built = await control.build();
    } catch (error) {
      verdict(`control ${control.name}`, false, `WRONG: failed at setup: ${String((error as Error).message).split("\n")[0]}`);
      continue;
    }
    const browser = await launchChromium();
    try {
      const ctx = (pages: string): LegCtx => ({ scratch: join(SCRATCH, `ctl-${control.name}`), pages, browser, report });
      for (const leg of control.legs.filter((l) => process.env.GOAL_CONTROL_LEGS === undefined || process.env.GOAL_CONTROL_LEGS.split(",").includes(l))) {
        try {
          if (leg === "a") await legA(ctx(built.themed.pages));
          if (leg === "b") await legB(ctx(built.themed.pages));
          if (leg === "c") await legC(ctx(built.noTheme.pages));
        } catch (error) {
          const at = String((error as Error).stack ?? "").split("\n").find((l) => l.includes(HERE)) ?? "";
          report.fail(`${leg}:setup`, `${String((error as Error).message).split("\n")[0]!}${at === "" ? "" : ` (${relative(HERE, at.trim().replace(/^at .*\(|\)$/g, "").replace(/^at /, ""))})`}`);
        }
      }
    } finally {
      await browser.close();
    }
    const red = new Set(report.failures.map((f) => f.signal));
    const missing = control.must.filter((s) => !red.has(s));
    const stray = [...red].filter((s) => !control.must.includes(s) && !(control.also ?? []).includes(s));
    const ok = missing.length === 0 && stray.length === 0;
    verdict(
      `control ${control.name}`,
      ok,
      ok ? `FAIL (expected) at ${control.must.join(" + ")} only` : `WRONG: ${missing.length > 0 ? `stayed green at ${missing.join(", ")}` : ""}${missing.length > 0 && stray.length > 0 ? "; " : ""}${stray.length > 0 ? `also red at ${stray.join(", ")}` : ""}`,
      [
        ...report.failures.map((f) => `✗ [${f.signal}] ${f.why}`),
        ...[built.themed.diff, built.noTheme.diff].filter(Boolean).map((d) => `patch:\n${d}`),
        ...report.notes.filter((n) => /^a4|^b:org|^b:/.test(n)),
      ],
    );
  }
}

// ---- part 3: every child's check, by subprocess -----------------------------------

type Child = { id: string; run: string; control?: string; env?: Record<string, string>; must?: RegExp; allowed?: RegExp };

const SM = (goal: string) => `goals/shift-manager/${goal}/run.mts`;
const CHILDREN: Child[] = [
  // P3.1: FIX-1655.
  { id: "P3.1 design-system", run: "goals/design-system/skins-reused-components-from-one-token-set/run.mts" },
  { id: "P3.1 design-system", run: "goals/design-system/skins-reused-components-from-one-token-set/run.mts", control: "hardcoded-accent", must: /b:themed[^\n]*tool:awaiting/, allowed: /tool:awaiting|b:themed summary — 1 components: tool\.tsx/ },
  // P3.2: each child's merged goal check, with its controls.
  { id: "P3.2 FIX-1662 it-opens-a-lab", run: SM("it-opens-a-lab") },
  { id: "P3.2 FIX-1662 it-opens-a-lab", run: SM("it-opens-a-lab"), control: "static-names", must: /\[multi-seat-collab\] TEAMS equals the store's seats/, allowed: /\[multi-seat-collab\] TEAMS equals the store's seats/ },
  { id: "P3.2 FIX-1662 it-opens-a-lab", run: SM("it-opens-a-lab"), control: "optimistic-post", must: /the post is in the stored transcript/, allowed: /the post is in the stored transcript/ },
  { id: "P3.2 FIX-1662 it-opens-a-lab", run: SM("it-opens-a-lab"), control: "unanswerable-asks", must: /an answer from Inbox lands in the store/, allowed: /an answer from Inbox lands in the store/ },
  { id: "P3.2 FIX-1664 it-shows-and-stops-a-task-run", run: SM("it-shows-and-stops-a-task-run") },
  { id: "P3.2 FIX-1664 it-shows-and-stops-a-task-run", run: SM("it-shows-and-stops-a-task-run"), control: "worker-session", must: /items equal the run session's/, allowed: /items equal the run session's|\blive\b/ },
  { id: "P3.2 FIX-1664 it-shows-and-stops-a-task-run", run: SM("it-shows-and-stops-a-task-run"), control: "optimistic-interrupt", must: /the request reads aborted first/, allowed: /the request reads aborted first/ },
  { id: "P3.2 FIX-1664 it-shows-and-stops-a-task-run", run: SM("it-shows-and-stops-a-task-run"), control: "board-flow", must: /items equal the run session's/, allowed: /./ },
  { id: "P3.2 FIX-1688/1689/1725 it-takes-its-look-from-the-design-system", run: SM("it-takes-its-look-from-the-design-system") },
  { id: "P3.2 FIX-1688/1689/1725 it-takes-its-look-from-the-design-system", run: SM("it-takes-its-look-from-the-design-system"), control: "hardcoded-accent", must: /\] neutral .*tool:/, allowed: /\] neutral .*tool:/ },
  { id: "P3.2 FIX-1688/1689/1725 it-takes-its-look-from-the-design-system", run: SM("it-takes-its-look-from-the-design-system"), control: "switch-ignored", must: /\] switch /, allowed: /\] switch / },
  { id: "P3.2 FIX-1690 it-sends-a-turn-into-a-seat-session", run: SM("it-sends-a-turn-into-a-seat-session") },
  { id: "P3.2 FIX-1690 it-sends-a-turn-into-a-seat-session", run: SM("it-sends-a-turn-into-a-seat-session"), control: "optimistic-turn", must: /\] delivered:/, allowed: /\] (delivered|stopped|continued|standing|heard):/ },
  { id: "P3.2 FIX-1690 it-sends-a-turn-into-a-seat-session", run: SM("it-sends-a-turn-into-a-seat-session"), control: "fresh-session", must: /\] continued:/, allowed: /\] continued:/ },
  { id: "P3.2 FIX-1722 it-briefs-and-talks-with-the-chief-of-staff", run: SM("it-briefs-and-talks-with-the-chief-of-staff") },
  { id: "P3.2 FIX-1722 it-briefs-and-talks-with-the-chief-of-staff", run: SM("it-briefs-and-talks-with-the-chief-of-staff"), control: "optimistic-reply", must: /\[desk\] talk/, allowed: /\[desk\] talk/ },
  { id: "P3.2 FIX-1722 it-briefs-and-talks-with-the-chief-of-staff", run: SM("it-briefs-and-talks-with-the-chief-of-staff"), control: "static-brief", must: /\[desk\] inline/, allowed: /\[desk\] inline/ },
  { id: "P3.2 FIX-1723 it-shows-who-is-on-shift", run: SM("it-shows-who-is-on-shift") },
  { id: "P3.2 FIX-1723 it-shows-who-is-on-shift", run: SM("it-shows-who-is-on-shift"), control: "ignore-asks", must: /\] status/, allowed: /\] (status|summary|sidebar|TEAMS)/ },
  { id: "P3.2 FIX-1723 it-shows-who-is-on-shift", run: SM("it-shows-who-is-on-shift"), control: "count-queued", must: /\] slots/, allowed: /\] (slots|holding)/ },
  { id: "P3.2 FIX-1717 it-hands-a-run-the-work-it-approved", run: SM("it-hands-a-run-the-work-it-approved") },
  { id: "P3.2 FIX-1717 it-hands-a-run-the-work-it-approved", run: SM("it-hands-a-run-the-work-it-approved"), control: "drop-task", must: /does not carry the approved/, allowed: /does not carry the (approved|posted) goal|does not carry the goal's token/ },
  // D1's children.
  { id: "P3.2 FIX-1666 it-waits-for-a-person-before-it-files", run: "goals/devforce-lab/it-waits-for-a-person-before-it-files/run.mts" },
  { id: "P3.2 FIX-1666 it-waits-for-a-person-before-it-files", run: "goals/devforce-lab/it-waits-for-a-person-before-it-files/run.mts", control: "no-gate", must: /a row existed before any approval/, allowed: /./ },
  { id: "P3.2 FIX-1667 it-keeps-its-rows-on-the-channels-board", run: "goals/devforce-lab/it-keeps-its-rows-on-the-channels-board/run.mts" },
  { id: "P3.2 FIX-1667 it-keeps-its-rows-on-the-channels-board", run: "goals/devforce-lab/it-keeps-its-rows-on-the-channels-board/run.mts", control: "kind-ledger", must: /the channel's board returned no rows/, allowed: /./ },
  // P3.3: the goal labs the set touched.
  { id: "P3.3 devforce-lab it-wakes-the-seat-a-file-declared", run: "goals/devforce-lab/it-wakes-the-seat-a-file-declared/run.mts" },
  { id: "P3.3 devforce-lab it-commits-from-the-seats-own-file", run: "goals/devforce-lab/it-commits-from-the-seats-own-file/run.mts" },
  { id: "P3.3 devforce-lab it-ships-an-artifact-a-person-can-open", run: "goals/devforce-lab/it-ships-an-artifact-a-person-can-open/run.mts" },
  { id: "P3.3 pentest-lab a-post-reaches-both-declared-seats", run: "goals/pentest-lab/a-post-reaches-both-declared-seats/run.mts" },
  { id: "P3.3 pentest-lab a-seat-answers-from-its-own-document", run: "goals/pentest-lab/a-seat-answers-from-its-own-document/run.mts" },
  { id: "P3.3 multi-seat-collab it-hands-a-row-between-two-seats-in-view", run: "goals/multi-seat-collab/it-hands-a-row-between-two-seats-in-view/run.mts" },
];

/** Run one command to its end, keeping its output in a log beside the scratch builds. */
function runLogged(label: string, cmd: string, args: string[], env: Record<string, string | undefined>): Promise<{ code: number; out: string; log: string }> {
  const log = join(SCRATCH, "part3", `${label.replace(/[^a-z0-9.-]+/gi, "_")}.log`);
  mkdirSync(join(SCRATCH, "part3"), { recursive: true });
  return new Promise((resolve) => {
    let out = "";
    const merged: Record<string, string | undefined> = { ...process.env, ...env };
    for (const key of Object.keys(merged)) if (merged[key] === undefined) delete merged[key];
    const child = spawn(cmd, args, { cwd: REPO_ROOT, env: merged as NodeJS.ProcessEnv, stdio: ["ignore", "pipe", "pipe"] });
    child.stdout.on("data", (d) => (out += String(d)));
    child.stderr.on("data", (d) => (out += String(d)));
    child.on("exit", (code) => {
      writeFileSync(log, out);
      resolve({ code: code ?? 1, out, log });
    });
  });
}

const failBullets = (out: string) => {
  const at = out.lastIndexOf("FAIL —");
  return at < 0 ? [] : out.slice(at).split("\n").filter((l) => /^\s+- /.test(l)).map((l) => l.replace(/^\s+- /, ""));
};
const verdictLine = (out: string) => out.split("\n").reverse().find((l) => /^(PASS|FAIL) —/.test(l)) ?? "";

async function part3(): Promise<void> {
  const tsx = join(REPO_ROOT, "node_modules", ".bin", "tsx");
  // GOAL_CHILDREN narrows part 3 to the entries whose label matches it (a rerun); unset runs them all.
  const pick = process.env.GOAL_CHILDREN === undefined ? null : new RegExp(process.env.GOAL_CHILDREN);
  for (const child of CHILDREN) {
    const label = `${child.id}${child.control === undefined ? "" : ` GOAL_CONTROL=${child.control}`}`;
    if (pick !== null && !pick.test(label)) continue;
    const { code, out, log } = await runLogged(label, tsx, [child.run], { GOAL_CONTROL: child.control, ...(child.env ?? {}) });
    const bullets = failBullets(out);
    if (child.control === undefined) {
      verdict(label, code === 0, code === 0 ? `PASS — ${verdictLine(out).slice(7, 400)}` : `FAIL (${bullets.length})`, [...bullets.slice(0, 12).map((b) => `✗ ${b}`), `log: ${log}`]);
    } else {
      const hit = bullets.some((b) => child.must!.test(b)) || child.must!.test(out.slice(out.lastIndexOf("FAIL —")));
      const strays = bullets.filter((b) => !child.allowed!.test(b));
      const ok = code !== 0 && hit && strays.length === 0;
      verdict(label, ok, ok ? `FAIL (expected) — ${bullets.length} bullet(s) at its named signal` : `WRONG: exit ${code}, named signal ${hit ? "red" : "green"}, ${strays.length} stray`, [
        ...bullets.slice(0, 8).map((b) => `✗ ${b}`),
        ...strays.slice(0, 5).map((b) => `stray: ${b}`),
        `log: ${log}`,
      ]);
    }
  }
  // P3.1's CI half, and P3.3's whole-repo checks.
  for (const [label, args] of [
    ["P3.1 design-system static fence", ["--filter", "@flow-state-dev/design-system", "test"]],
    ["P3.1 registry drift and palette census", ["--filter", "@flow-state-dev/ui", "exec", "vitest", "run", "test/registry-drift.test.ts", "test/palette-census.test.ts"]],
    ["P3.1 Shift Manager's copies unedited", ["--filter", "@flow-state-dev/shift-manager", "exec", "vitest", "run", "test/static.test.ts"]],
    ["P3.3 pnpm typecheck", ["typecheck"]],
    ["P3.3 pnpm test", ["test"]],
  ] as const) {
    if (pick !== null && !pick.test(label)) continue;
    const { code, out, log } = await runLogged(label, "pnpm", [...args], {});
    const tail = out.trim().split("\n").filter((l) => /Tests?|passed|failed|Tasks:|error/i.test(l)).slice(-3).join(" · ");
    verdict(label, code === 0, code === 0 ? `PASS — ${tail.slice(0, 300)}` : `FAIL — exit ${code}: ${tail.slice(0, 300)}`, [`log: ${log}`]);
  }
}

// ---- the run ---------------------------------------------------------------------

let PAGES: Built | undefined;

await runGoal(async () => {
  console.log(`closure run on ${COMMIT}${DIRTY ? " (with uncommitted changes outside this goal)" : ""}; today's main is ${TODAYS_MAIN}`);
  const want = (part: string) => PARTS.includes(part);
  if (["a", "b0", "b", "c", "part2"].some(want)) {
    PAGES = await buildPages(SCRATCH, "as-written");
  }
  const noTheme = want("c") ? await buildPages(SCRATCH, "no-theme", { patches: [NO_THEME] }) : undefined;
  if (noTheme !== undefined) console.log(`leg c's no-theme build, the whole patch:\n${noTheme.diff}`);

  const report = collector();
  const browser = await launchChromium();
  try {
    const ctx = (pages: string): LegCtx => ({ scratch: SCRATCH, pages, browser, report });
    const leg = async (id: string, prefixes: string[], run: () => Promise<void>) => {
      try {
        await run();
      } catch (error) {
        report.fail(`${prefixes[0]}:setup`, String((error as Error).message ?? error).split("\n").slice(0, 3).join(" "));
      }
      legVerdict(id, prefixes, report);
    };
    if (want("a")) await leg("leg a (a1-a4)", ["a1", "a2", "a3", "a4", "a"], () => legA(ctx(PAGES!.pages)));
    if (want("b0")) await leg("b0", ["b0"], () => b0(report));
    if (want("b")) await leg("leg b", ["b"], () => legB(ctx(PAGES!.pages)));
    if (want("c")) await leg("leg c", ["c"], () => legC(ctx(noTheme!.pages)));
    if (want("part2")) {
      await leg("J3", ["J3"], () => j3(SCRATCH, browser, report));
      await leg("J4", ["J4"], () => j4(SCRATCH, PAGES!.pages, browser, report));
    }
  } finally {
    await browser.close();
  }
  if (want("controls")) {
    const only = process.env.GOAL_CONTROLS?.split(",").map((s) => s.trim()) ?? null;
    await controls(only);
  }
  if (want("part3")) await part3();
  if (want("part4")) {
    const p4 = collector();
    part4(TODAYS_MAIN, p4);
    legVerdict("part 4", ["P4"], p4);
  }

  const bad = verdicts.filter((v) => !v.ok);
  return {
    failures: bad.map((v) => `${v.id}: ${v.line}`),
    evidence: `${verdicts.length} verdicts on ${AT}, all as expected: ${verdicts.map((v) => `${v.id} ${v.line.split(" — ")[0]}`).join("; ")}`,
  };
});
