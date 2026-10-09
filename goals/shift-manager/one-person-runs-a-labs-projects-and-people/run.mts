/**
 * Goal check: one person runs a Lab's projects and people from Shift Manager
 * (FIX-1720, the closure of the FIX-1650 Org primitives epic). See goal.md.
 *
 * A thin orchestrator over one commit. It builds Shift Manager once, then:
 *
 *   part 1   legs a and b on one store (a's restart, b's two), leg c on its own
 *            (three boots: `extra-flow`, then as shipped twice), every CoS turn
 *            on a real model in Chromium, graded once (D2)
 *   controls `deny-fire` (a click), `no-cos` and `no-tool` (scratch patches,
 *            printed in full), and today's `main` (its own checkout and build),
 *            each on fresh stores; each must fail its leg at its own step
 *   part 2   J4: the next Lab set up from the published docs alone
 *   part 3   every child's check on its green path, with the controls it still owes
 *   part 4   the epic's seams and Layer 1 fence, by script
 *
 * and writes the report (the closure PR's body, or the comment a run with
 * findings leaves) to the run's scratch directory.
 *
 * Run:   PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers pnpm tsx goals/shift-manager/one-person-runs-a-labs-projects-and-people/run.mts
 * Some:  GOAL_ONLY=legs,deny-fire,no-cos,no-tool,today,j4,p3,p4 (comma-separated; default all)
 */
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";
import { LAB_USERS } from "../../../packages/shift-manager/teams/devteam/host.mts";
import { REPO_ROOT, RUN_STAMP, goalTmpDir, runGoal } from "../../lib/index.mts";
import { launchChromium } from "../../lib/playwright.mts";
import { buildShiftManagerPages } from "../../lib/shift-manager.mts";
import { extraFlow, noCos, noTool, scratchLab, type Patch } from "./controls/patches.mts";
import { j4, type J4Result } from "./j4.mts";
import { legA, readBack } from "./legs/a.mts";
import { hireWithoutCos, legB } from "./legs/b.mts";
import { legC } from "./legs/c.mts";
import { manifest, runManifest, type RunResult } from "./manifest.mts";
import { seams, type SeamRow } from "./seams.mts";
import { askCos, hex, readProjects, RunRecord, World } from "./steps.mts";

const ALL = ["legs", "deny-fire", "no-cos", "no-tool", "today", "j4", "p3", "p4"] as const;
const ONLY = (process.env.GOAL_ONLY ?? "").split(",").map((s) => s.trim()).filter(Boolean);
for (const o of ONLY) if (!(ALL as readonly string[]).includes(o)) throw new Error(`unknown GOAL_ONLY part "${o}"; known: ${ALL.join(", ")}`);
const wants = (part: (typeof ALL)[number]) => ONLY.length === 0 || ONLY.includes(part);

/** The commit before FIX-1650's first child merged (FIX-1718's #2647): today's `main`, as a control. */
const TODAYS_MAIN = "1afe16ffeed2ed6c6ac1c4391ceaedbc2b9fb4e1";
const MODEL = "openai/gpt-5.4-mini";
const MODEL_KEYS = ["AI_GATEWAY_API_KEY", "OPENAI_API_KEY", "OPENROUTER_API_KEY"];
const CONFIG = join(REPO_ROOT, "packages", "shift-manager", "teams", "devteam", "fsdev.config.mts");
const git = (...args: string[]) => execFileSync("git", ["-C", REPO_ROOT, ...args], { encoding: "utf8" }).trim();

const SCRATCH = goalTmpDir("closure-fix-1720");
const SHOTS = join(SCRATCH, "screenshots");
const STORES = join(SCRATCH, "stores");
mkdirSync(SHOTS, { recursive: true });
mkdirSync(STORES, { recursive: true });
const say = (s: string) => console.error(`[closure] ${s}`);
const people = { owner: LAB_USERS.owner, member: LAB_USERS.member, outsider: LAB_USERS.outsider };

/** A run of part 1's legs: plain, or under one control. */
interface LegsRun {
  label: string;
  records: RunRecord[];
  patches: string[];
  stores: Array<{ file: string; steps: string }>;
}

/** The DevTeam tree's mailboxes: the board's (where b4 posts) and the one projects are read through. */
const BOARD_MAILBOX = "eng.feature";

async function runLegs(
  label: string,
  pages: string,
  browser: Awaited<ReturnType<typeof launchChromium>>,
  opts: { config: string; extraFlowConfig: (flow: string) => { config: string; diff: string; remove(): void }; deny: boolean; legs: Array<"a" | "b" | "c"> },
): Promise<LegsRun> {
  const run: LegsRun = { label, records: [], patches: [], stores: [] };
  if (opts.legs.includes("a") || opts.legs.includes("b")) {
    const record = new RunRecord(`${label}-ab`, SHOTS);
    run.records.push(record);
    const store = join(STORES, `${label}-ab.sqlite`);
    run.stores.push({ file: store, steps: opts.legs.filter((l) => l !== "c").join(", ") + " and their restarts" });
    const world = new World(browser, people, { config: opts.config, pages, scratch: SCRATCH, store }, record);
    await world.boot(`${label} ab boot 1`);
    try {
      const restart = async (why: string) => {
        await world.stop();
        await world.boot(`${label} ${why}`);
      };
      if (opts.legs.includes("a")) {
        say(`${label}: leg a`);
        const a = await legA(world, BOARD_MAILBOX);
        if (a !== undefined) {
          // a5: the rows as they stand now (the member joined at a4), on a new process.
          const now = (await readProjects(world.routes.owner, BOARD_MAILBOX)).rows;
          a.p1 = now.find((r) => r.id === a.p1.id) ?? a.p1;
          a.p2 = now.find((r) => r.id === a.p2.id) ?? a.p2;
          await restart("a5 restart");
          say(`${label}: a5`);
          await readBack(world, BOARD_MAILBOX, a, true);
        }
      }
      if (opts.legs.includes("b")) {
        say(`${label}: leg b`);
        await legB(world, BOARD_MAILBOX, BOARD_MAILBOX, restart, opts.deny);
      }
      if (world.pageErrors.length > 0) record.saw("page", `the page threw: ${world.pageErrors.join(" | ")}`);
    } catch (error) {
      record.fail("reach", (error as Error).stack?.slice(0, 1500) ?? String(error));
    } finally {
      await world.stop();
    }
  }
  if (opts.legs.includes("c")) {
    say(`${label}: leg c`);
    const record = new RunRecord(`${label}-c`, SHOTS);
    run.records.push(record);
    const store = join(STORES, `${label}-c.sqlite`);
    run.stores.push({ file: store, steps: "c1 (boot 1), c2 and c3 (boot 2), c4 (boot 3)" });
    const flow = `scratch-${hex(2)}`;
    const world = new World(browser, people, { config: opts.config, pages, scratch: SCRATCH, store }, record);
    let patched: ReturnType<typeof opts.extraFlowConfig> | undefined;
    try {
      patched = opts.extraFlowConfig(flow);
      run.patches.push(patched.diff);
      await legC(world, { worker: `helper-${hex()}`, flow, patchedConfig: patched.config, shippedConfig: opts.config });
    } catch (error) {
      record.fail("reach", (error as Error).stack?.slice(0, 1500) ?? String(error));
      await world.stop().catch(() => undefined);
    } finally {
      patched?.remove();
    }
  }
  return run;
}

/** Steps that went red in a run, by id. */
const reds = (run: LegsRun) => run.records.flatMap((r) => [...r.steps.entries()].filter(([, e]) => e.verdict !== "PASS").map(([id, e]) => ({ id, verdict: e.verdict, notes: e.notes })));

/** Today's `main`, checked out and installed on its own, for the control that must fail every leg. */
function todaysMainCheckout(): { root: string; tsx: string } {
  const root = join(SCRATCH, "todays-main");
  mkdirSync(root, { recursive: true });
  execFileSync("bash", ["-c", `git -C '${REPO_ROOT}' archive ${TODAYS_MAIN} | tar -x -C '${root}'`]);
  const install = spawnSync("pnpm", ["install", "--frozen-lockfile", "--prefer-offline"], { cwd: root, encoding: "utf8", timeout: 900_000 });
  if (install.status !== 0) throw new Error(`today's main did not install: ${install.stderr.slice(-1500)}`);
  return { root, tsx: join(root, "node_modules", ".bin", "tsx") };
}

await runGoal(async (failures) => {
  if (!MODEL_KEYS.some((k) => (process.env[k] ?? "") !== "")) {
    return { failures: [`blocked (QR-4): no model key; none of ${MODEL_KEYS.join(", ")} is set`], evidence: "" };
  }
  const head = git("rev-parse", "HEAD");
  const base = git("merge-base", "HEAD", "origin/main");
  say(`commit ${head} on main ${base}; scratch ${SCRATCH}`);
  const pages = await buildShiftManagerPages(join(SCRATCH, "pages"));
  const browser = await launchChromium();
  const runs: LegsRun[] = [];
  const controlVerdicts: Array<{ control: string; ok: boolean; line: string }> = [];
  let j4Result: J4Result | undefined;
  let p3: RunResult[] = [];
  let p4: SeamRow[] = [];
  const shipped = (patches: Patch[]) => (flow: string) => scratchLab(hex(2), [...patches, extraFlow(flow)]);

  try {
    // ---- part 1 -------------------------------------------------------------------
    if (wants("legs")) {
      const plain = await runLegs("plain", pages, browser, { config: CONFIG, extraFlowConfig: shipped([]), deny: false, legs: ["a", "b", "c"] });
      runs.push(plain);
      for (const red of reds(plain)) failures.push(`part 1 ${red.id}: ${red.notes.filter((n) => n.startsWith("FAIL") || n.startsWith("BLOCKED")).join(" / ")}`);
    }

    // ---- controls -------------------------------------------------------------------
    // A control passes only when it failed `mustFail` for `reason` and every step
    // in `staysGreen` is present and PASS: a step that never ran (an exception
    // cut the leg short) is not green. Any other red step outside the
    // control's leg (`reach`, `page`, `setup`) is a leak too.
    const LEG_STEP = /^[abc]\d$/;
    const grade = (control: string, run: LegsRun, mustFail: string, reason: RegExp, staysGreen: string[]) => {
      const red = reds(run);
      const at = red.find((r) => r.id === mustFail && r.notes.some((n) => reason.test(n)));
      // A step that is red in the plain run for the same reason is that run's
      // finding, not the control's leak: excuse it only when every failing note
      // also failed the plain run.
      const plainRun = runs.find((x) => x.label === "plain");
      const shape = (n: string) => n.replace(/[0-9a-f]{4,}/g, "#").replace(/\s+/g, " ").slice(0, 160);
      const baseline = new Set((plainRun === undefined ? [] : reds(plainRun)).flatMap((x) => x.notes.filter((n) => n.startsWith("FAIL")).map(shape)));
      const excused = (x: { notes: string[] }) => plainRun !== undefined && x.notes.filter((n) => n.startsWith("FAIL")).every((n) => baseline.has(shape(n)));
      const recorded = new Set(run.records.flatMap((r) => [...r.steps.keys()]));
      const absent = staysGreen.filter((id) => !recorded.has(id));
      const leaked = [
        ...absent.map((id) => ({ id, notes: ["never ran"] })),
        ...red.filter((r) => r.id !== mustFail && (staysGreen.includes(r.id) || !LEG_STEP.test(r.id)) && !excused(r)),
      ];
      const ok = at !== undefined && leaked.length === 0;
      const line = at === undefined ? `never failed ${mustFail} on ${reason.source}` : `failed ${mustFail}: ${at.notes.find((n) => reason.test(n))?.slice(0, 300)}`;
      controlVerdicts.push({ control, ok, line: `${line}${leaked.length > 0 ? `; also red or missing: ${leaked.map((l) => `${l.id} ${l.notes.join(" / ").slice(0, 200)}`).join("; ")}` : ""}` });
      if (!ok) failures.push(`control ${control}: ${controlVerdicts.at(-1)!.line}`);
    };
    const A = ["a1", "a2", "a3", "a4", "a5"];
    const B = ["b1", "b2", "b3", "b4"];
    const C = ["c1", "c2", "c3", "c4"];
    if (wants("deny-fire")) {
      const run = await runLegs("deny-fire", pages, browser, { config: CONFIG, extraFlowConfig: shipped([]), deny: true, legs: ["a", "b", "c"] });
      runs.push(run);
      grade("deny-fire", run, "b3", /seat gone/, [...A, "b1", "b2", "b4", ...C]);
    }
    if (wants("no-tool")) {
      const lab = scratchLab(hex(2), [noTool]);
      try {
        const run = await runLegs("no-tool", pages, browser, { config: lab.config, extraFlowConfig: shipped([noTool]), deny: false, legs: ["a", "b", "c"] });
        run.patches.unshift(lab.diff);
        runs.push(run);
        grade("no-tool", run, "a1", /two rows|createProject/, [...B, ...C]);
      } finally {
        lab.remove();
      }
    }
    if (wants("no-cos")) {
      const lab = scratchLab(hex(2), [noCos]);
      const record = new RunRecord("no-cos", SHOTS);
      const store = join(STORES, "no-cos.sqlite");
      const run: LegsRun = { label: "no-cos", records: [record], patches: [lab.diff], stores: [{ file: store, steps: "b1" }] };
      const world = new World(browser, people, { config: lab.config, pages, scratch: SCRATCH, store }, record);
      try {
        await world.boot("no-cos boot");
        await hireWithoutCos(world, BOARD_MAILBOX, BOARD_MAILBOX);
      } catch (error) {
        record.fail("setup", `the control failed at setup: ${(error as Error).message.slice(0, 1500)}`);
      } finally {
        await world.stop().catch(() => undefined);
        lab.remove();
      }
      runs.push(run);
      grade("no-cos", run, "b1", /seat appears/, ["setup"]);
    }
    if (wants("today")) {
      const record = new RunRecord("todays-main", SHOTS);
      const store = join(STORES, "todays-main.sqlite");
      const run: LegsRun = { label: "today's main", records: [record], patches: [`(today's main: ${TODAYS_MAIN}, its own checkout and build, unpatched)`], stores: [{ file: store, steps: "a1, b1, c1" }] };
      try {
        const checkout = todaysMainCheckout();
        const sm = join(checkout.root, "labs", "shift-manager");
        const oldPages = await buildShiftManagerPages(join(SCRATCH, "pages-todays-main"), sm);
        const world = new World(browser, people, { config: join(sm, "teams", "devteam", "fsdev.config.mts"), pages: oldPages, scratch: SCRATCH, store, root: sm, tsx: checkout.tsx }, record);
        await world.boot("today's main");
        try {
          for (const [step, words] of [
            ["a1", "Please create two projects for me."],
            ["b1", "Please hire one more coder for the team."],
            ["c1", "Please hire a seat on a kind of your choice."],
          ] as const) {
            const turn = await askCos(world, step, words);
            if (turn === undefined) record.fail(step, "no CoS seat: the Chief of Staff view draws no chief of staff to ask");
            else record.saw(step, `a chief of staff answered on today's main: ${turn.status}`);
          }
        } finally {
          await world.stop();
        }
      } catch (error) {
        record.fail("setup", `today's main failed at setup: ${(error as Error).message.slice(0, 1500)}`);
      }
      runs.push(run);
      const red = reds(run);
      const allThree = ["a1", "b1", "c1"].every((s) => red.some((r) => r.id === s && r.notes.some((n) => /no CoS seat/.test(n))));
      controlVerdicts.push({ control: "today's main", ok: allThree, line: red.map((r) => `${r.id}: ${r.notes.join(" / ").slice(0, 200)}`).join("; ") });
      if (!allThree) failures.push(`control today's main: ${controlVerdicts.at(-1)!.line}`);
    }

    // ---- part 2 -------------------------------------------------------------------------
    if (wants("j4")) {
      say("part 2: J4");
      try {
        j4Result = await j4(browser, SCRATCH, pages, SHOTS, say);
        failures.push(...j4Result.failures);
      } catch (error) {
        const message = (error as Error).message;
        failures.push(`${message.startsWith("blocked") ? "J4 blocked" : "J4"}: ${message.slice(0, 600)}`);
      }
    }
  } finally {
    await browser.close();
  }

  // ---- part 3 ---------------------------------------------------------------------------
  if (wants("p3")) {
    say("part 3: building @flow-state-dev/workforce and its dependencies (hire-plane checks import its dist)");
    // Through turbo, as the root build does: a plain `pnpm --filter workforce...` also
    // builds engine's dev dependency `testing` alongside engine and fails on the cycle.
    const built = spawnSync("pnpm", ["exec", "turbo", "run", "build", "--filter=@flow-state-dev/workforce..."], { cwd: REPO_ROOT, encoding: "utf8", timeout: 1_200_000 });
    if (built.status !== 0) failures.push(`part 3: the workforce build failed: ${(built.stdout + built.stderr).slice(-800)}`);
    const logs = join(SCRATCH, "part3");
    mkdirSync(logs, { recursive: true });
    const env: Record<string, string> = { PLAYWRIGHT_BROWSERS_PATH: process.env.PLAYWRIGHT_BROWSERS_PATH ?? "/opt/pw-browsers" };
    if ((process.env.ANTHROPIC_API_KEY ?? "") === "" && (process.env.MY_ANTHROPIC_API_KEY ?? "") !== "") env.ANTHROPIC_API_KEY = process.env.MY_ANTHROPIC_API_KEY!;
    p3 = await runManifest(manifest(), logs, env, Number(process.env.GOAL_PARALLEL ?? 3));
    for (const r of p3) if (r.verdict === "FAIL" || r.verdict === "PASS (control NOT red)" || r.verdict === "FAIL (not at its named assertion)" || r.verdict === "BLOCKED") failures.push(`part 3 ${r.id} ${r.path}${r.control === null ? "" : ` GOAL_CONTROL=${r.control}`}: ${r.verdict}: ${r.tail.slice(0, 400)}`);
  }

  // ---- part 4 ---------------------------------------------------------------------------
  if (wants("p4")) {
    p4 = seams(TODAYS_MAIN);
    for (const row of p4) if (!row.ok) failures.push(`part 4 ${row.check}: ${row.output.filter((o) => o.startsWith("FAIL") || o.startsWith("  ")).join(" / ").slice(0, 600)}`);
  }

  // ---- the report -------------------------------------------------------------------------
  const report = writeReport({ head, base, runs, controlVerdicts, j4Result, p3, p4, failures });
  // Every store this run owned is deleted, pass or fail (QR-7).
  // The Lab keeps a project's repository beside its store, so a store can be a directory.
  for (const f of existsSync(STORES) ? readdirSync(STORES) : []) rmSync(join(STORES, f), { recursive: true, force: true });
  say(`report: ${report}`);
  return { failures, evidence: `report at ${report}` };
});

function writeReport(r: {
  head: string;
  base: string;
  runs: LegsRun[];
  controlVerdicts: Array<{ control: string; ok: boolean; line: string }>;
  j4Result: J4Result | undefined;
  p3: RunResult[];
  p4: SeamRow[];
  failures: string[];
}): string {
  const out: string[] = [];
  const merges = git("log", "--first-parent", "--merges", "--format=%h %s", `${TODAYS_MAIN}..${r.base}`)
    .split("\n")
    .filter((l) => /fix-1718|fix-1719|FIX-1621|fix\/FIX-1621|FIX-1722|FIX-1723/i.test(l));
  const chromium = (() => {
    try {
      return readdirSync(process.env.PLAYWRIGHT_BROWSERS_PATH ?? "/opt/pw-browsers").filter((d) => d.startsWith("chromium-")).join(", ");
    } catch {
      return "unknown";
    }
  })();
  out.push("## 1. Head", "");
  out.push(`- Run: ${RUN_STAMP}`, `- Commit: \`${r.head}\` (the closure's goal files on \`main\` \`${r.base}\`)`, `- Blockers' merge commits: ${merges.join("; ")}`);
  out.push(`- Model: \`${MODEL}\` through ${MODEL_KEYS.filter((k) => (process.env[k] ?? "") !== "").map((k) => k.replace(/_API_KEY$/, "")).join(" / ")} (key never printed)`, `- Chromium: ${chromium}`);
  out.push(`- Store files (QR-7, all deleted at the end): ${r.runs.flatMap((run) => run.stores.map((s) => `\`${s.file.split("/").pop()}\` (${run.label}: ${s.steps})`)).join("; ")}`, "");
  out.push("## 2. Part 1", "");
  for (const run of r.runs) {
    out.push(`### ${run.label}`, "");
    for (const rec of run.records) {
      for (const boot of rec.boots) out.push(`- boot "${boot.label}" on \`${relative(REPO_ROOT, boot.config)}\``);
      out.push("", "| Step | Verdict | What it showed |", "|---|---|---|");
      for (const [id, e] of rec.steps) out.push(`| ${id} | ${e.verdict} | ${e.notes.join("<br>").replaceAll("|", "\\|").slice(0, 3000)} |`);
      out.push("");
      for (const t of rec.turns) {
        out.push(`- CoS turn ${t.step}: "${t.words}" · session \`${t.sessionId}\` · request \`${t.requestId}\` · ${t.status}${t.providerRetry === undefined ? "" : ` · re-run once after a provider error: ${t.providerRetry}`}`);
        for (const tool of t.tools) out.push(`  - \`${tool.name}\` (item \`${tool.itemId}\`) ${tool.ok ? "ok" : "NOT ok"}: ${tool.args.slice(0, 300)} → ${tool.output.slice(0, 300)}`);
        out.push(`  - said${t.onScreen ? " (drawn on screen by id)" : ""}: "${t.reply.replaceAll("\n", " ").slice(0, 400)}"`);
      }
      if (rec.screenshots.length > 0) out.push(`- screenshots: ${rec.screenshots.map((s) => `\`${s.split("/").pop()}\``).join(", ")}`);
      out.push("");
    }
  }
  out.push("## 3. Controls", "");
  for (const c of r.controlVerdicts) out.push(`- **${c.control}**: ${c.ok ? "failed as it must" : "DID NOT fail as it must"}. ${c.line}`);
  for (const run of r.runs.filter((x) => x.patches.length > 0)) {
    out.push("", `<details><summary>${run.label}: patches, in full</summary>`, "", "```diff", ...run.patches, "```", "", "</details>");
  }
  out.push("", "## 4. J4", "");
  if (r.j4Result === undefined) out.push("Not run, or blocked: see findings.");
  else {
    out.push(`Verdict: ${r.j4Result.ok ? "PASS" : "FAIL"}`, "", "Steps the writer logged:", ...r.j4Result.steps.map((s) => `  ${s}`), "", ...r.j4Result.notes.map((n) => `- ${n}`));
    out.push("", "<details><summary>The writer's files (diff from the pentest Lab)</summary>", "", "```diff", r.j4Result.diff, "```", "", "</details>");
  }
  out.push("", "## 5. Parts 3 and 4", "", "| Entry | Check | Control | Verdict | Time |", "|---|---|---|---|---|");
  for (const x of r.p3) out.push(`| ${x.id} | \`${x.path}\` | ${x.control ?? "green path"} | ${x.verdict} | ${Math.round(x.ms / 1000)} s |`);
  out.push("");
  for (const row of r.p4) out.push(`**${row.check}: ${row.ok ? "holds" : "FAILS"}**`, "", "```", ...row.output, "```", "");
  out.push("## 6. Findings", "", ...(r.failures.length === 0 ? ["None."] : r.failures.map((f) => `- ${f.replaceAll("\n", " ").slice(0, 800)}`)));
  const path = join(SCRATCH, "report.md");
  writeFileSync(path, out.join("\n"));
  return path;
}
