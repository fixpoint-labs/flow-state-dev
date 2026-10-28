/**
 * Goal check for FIX-1989, amended for FIX-2238, FIX-2160 and FIX-2239. See goal.md.
 *
 * Run:      pnpm tsx goals/shift-manager/workers-message-each-other/run.mts
 * Controls: GOAL_CONTROL=<name> (controls.mts names each)
 *           (each runs the legs it needs, unless GOAL_LEGS says otherwise)
 * Before:   GOAL_COMMIT=<sha> serves that commit, from its own tree and install
 * Legs:     GOAL_LEGS=1,1b,2,3b,3,4,6,7,8,10,10b,10c,5 (default: all, in that order)
 */
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { pathToFileURL } from "node:url";
import { REPO_ROOT, RUN_STAMP, goalTmpDir, keysServing, runGoal } from "../../lib/index.mts";
import { assertPatched, describePatches, modulePatchEnv } from "../../lib/module-patch.mts";
import { launchChromium } from "../../lib/playwright.mts";
import { buildShiftManagerPages, openShiftManager, personPage, startShiftManager, type ServedShiftManager } from "../../lib/shift-manager.mts";
import { CONTROL_NAMES, CONTROLS, type Control } from "./controls.mts";
import {
  connect,
  hireTeam,
  leg1,
  leg1b,
  leg2,
  leg3,
  leg3b,
  leg4,
  loadShipped,
  openConversations,
  quiet,
  sentIds,
  word,
  COS,
  RESEARCHER,
  type LegResult,
  type Person,
  type World,
} from "./legs.mts";
import { leg10, leg10b, leg10c, WAIT_DEFAULT_MS } from "./legs-calls.mts";
import { leg6, leg7, leg8, setupTargets, type Targets } from "./legs-targets.mts";

const SCRATCH = goalTmpDir("workers-message");
const ORDER = ["1", "1b", "2", "3b", "3", "4", "6", "7", "8", "10", "10b", "10c", "5"] as const;
const say = (s: string) => console.error(`[messages ${new Date().toISOString().slice(11, 19)}] ${s}`);

const controlName = process.env.GOAL_CONTROL ?? "";
if (controlName !== "" && !(CONTROL_NAMES as readonly string[]).includes(controlName)) {
  console.error(`unknown GOAL_CONTROL "${controlName}"; known: ${CONTROL_NAMES.join(", ")}`);
  process.exit(2);
}
const control: Control | undefined = controlName === "" ? undefined : CONTROLS[controlName as keyof typeof CONTROLS];
const legs = new Set(
  (process.env.GOAL_LEGS ?? (control === undefined ? ORDER.join(",") : control.legs.join(",")))
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean),
);
for (const l of legs) if (!(ORDER as readonly string[]).includes(l)) throw new Error(`unknown leg "${l}" in GOAL_LEGS`);

/** The tree a run serves: this checkout, or another commit's own tree and install. */
function checkoutFor(commit: string | undefined): { root: string; commit: string; describe: string } {
  const git = (...args: string[]) => execFileSync("git", ["-C", REPO_ROOT, ...args], { encoding: "utf8" }).trim();
  if (commit === undefined || commit === "") {
    const head = git("rev-parse", "HEAD");
    const dirty = git("status", "--porcelain", "--", ".", ":(exclude)goals").length > 0;
    return { root: REPO_ROOT, commit: head, describe: `this checkout, \`${head.slice(0, 9)}\`${dirty ? " with uncommitted changes outside goals/" : ""}` };
  }
  const sha = git("rev-parse", `${commit}^{commit}`);
  const root = join(tmpdir(), "fsd-goal-messages-trees", sha.slice(0, 12));
  if (!existsSync(join(root, "package.json"))) {
    mkdirSync(root, { recursive: true });
    execFileSync("sh", ["-c", `git -C "${REPO_ROOT}" archive --format=tar ${sha} | tar -x -C "${root}"`]);
  }
  if (!existsSync(join(root, "node_modules"))) {
    say(`installing ${sha.slice(0, 9)} in ${root}`);
    const installed = spawnSync("pnpm", ["install", "--frozen-lockfile", "--prefer-offline"], { cwd: root, encoding: "utf8", timeout: 900_000 });
    if (installed.status !== 0) throw new Error(`setup: ${sha} did not install: ${(installed.stdout + installed.stderr).slice(-1500)}`);
  }
  return { root, commit: sha, describe: `\`${sha.slice(0, 9)}\` (GOAL_COMMIT=${commit}), its own tree and install` };
}

/** The names FIX-2238 removed, as Workforce wrote them. `replyTo` only where the message field lived. */
const REMOVED = /\b(onWorkerMessage|messageWorker|MESSAGE_WORKER_TOOL|WORKER_MESSAGE_ENTRY|workerMessageEntry|workforceRelayTo|takes_tasks_only|no_turn|takesWorkerMessages|sendWorkerMessage|answerTo)\b/;
const REMOVED_FIELD = /\breplyTo\b/;

/** `sweep`: no package's source names a removed name. */
function sweep(root: string): string[] {
  const hits: string[] = [];
  const walk = (dir: string, field: boolean) => {
    for (const name of readdirSync(dir)) {
      const path = join(dir, name);
      if (statSync(path).isDirectory()) walk(path, field);
      else if (/\.(ts|tsx|mts)$/.test(name)) {
        readFileSync(path, "utf8")
          .split("\n")
          .forEach((line, i) => {
            if (REMOVED.test(line) || (field && REMOVED_FIELD.test(line))) hits.push(`${path.slice(root.length + 1)}:${i + 1}: ${line.trim().slice(0, 120)}`);
          });
      }
    }
  };
  const packages = join(root, "packages");
  for (const pkg of readdirSync(packages)) {
    const src = join(packages, pkg, "src");
    if (existsSync(src)) walk(src, pkg === "workforce" || pkg === "shift-manager");
  }
  return hits.length === 0 ? [] : [`sweep — removed names are still in package source: ${hits.slice(0, 8).join(" | ")}`];
}

/** Leg 5: after a restart, the Messages view lists every message the legs sent, and each side opens its session. */
async function leg5(origin: string, alice: Person, sent: Map<string, { sessionId: string; args: Record<string, unknown> }>): Promise<LegResult> {
  const r: LegResult = { failures: [], notes: [] };
  const browser = await launchChromium();
  try {
    const { page, errors } = await personPage(browser, origin, alice, true);
    await openShiftManager(page, origin, "/messages");
    await page.getByTestId("messages").waitFor();
    await page.waitForFunction(() => document.querySelector("[data-testid=messages-reading]") === null, undefined, { timeout: 30_000 });
    const listed = await page.$$eval("[data-testid=message]", (els) =>
      els.map((el) => ({ id: el.getAttribute("data-message-id"), from: el.getAttribute("data-from"), to: el.getAttribute("data-to") })),
    );
    const ids = new Set(listed.map((m) => m.id));
    const missing = [...sent.keys()].filter((id) => !ids.has(id));
    if (sent.size === 0) r.failures.push(`5:lists-every-message — the legs sent no message, so the view has nothing to show`);
    if (missing.length > 0) {
      r.failures.push(`5:lists-every-message — after the restart the Messages view lists ${listed.length} message(s); ${missing.length} of the ${sent.size} the legs sent are missing: ${missing.slice(0, 5).join(", ")}`);
    }
    if (listed.some((m) => !m.from || !m.to)) r.failures.push(`5:both-sides — a listed message names no sender or no recipient`);
    r.notes.push(`the view lists ${listed.length} message(s); the legs' tool calls sent ${sent.size}`);
    // Each side opens the session that holds it: the first message Researcher sent the coordinator.
    const first = [...sent.entries()].find(([, call]) => call.args.to === COS);
    if (first !== undefined && ids.has(first[0])) {
      const row = page.locator(`[data-testid=message][data-message-id="${first[0]}"]`);
      const toSession = await row.getByTestId("message-to").getAttribute("data-session-id");
      const fromSession = await row.getByTestId("message-from").getAttribute("data-session-id");
      await row.getByTestId("message-to").click();
      await page.waitForURL(`**/s/${encodeURIComponent(toSession ?? "")}`);
      const opened = page.getByTestId("session-conversation");
      await opened.waitFor();
      if ((await opened.getAttribute("data-session-id")) !== toSession) r.failures.push(`5:opens-side — the recipient's link opened ${await opened.getAttribute("data-session-id")}, not ${toSession}`);
      await page.waitForFunction(() => document.querySelectorAll("[data-testid=session-item]").length > 0, undefined, { timeout: 20_000 });
      const shown = await page.locator(`[data-testid=received-message][data-from="${RESEARCHER}"]`).count();
      if (shown === 0) r.failures.push(`5:opens-side — the coordinator's session the link opened doesn't show Researcher's message as its own item`);
      await page.goBack();
      await page.getByTestId("messages").waitFor();
      await page.locator(`[data-testid=message][data-message-id="${first[0]}"]`).getByTestId("message-from").click();
      await page.waitForURL(`**/s/${encodeURIComponent(fromSession ?? "")}`);
      if ((await page.getByTestId("session-conversation").getAttribute("data-session-id")) !== fromSession) r.failures.push(`5:opens-side — the sender's link didn't open ${fromSession}`);
      r.notes.push(`message ${first[0]}: to ${toSession}, from ${fromSession}, each opened`);
    } else if (r.failures.length === 0) {
      r.failures.push(`5:opens-side — no message from Researcher to the coordinator is listed to open`);
    }
    if (errors.length > 0) r.notes.push(`page errors: ${errors.slice(0, 3).join(" | ")}`);
  } finally {
    await browser.close();
  }
  return r;
}

await runGoal(async () => {
  const checkout = checkoutFor(process.env.GOAL_COMMIT);
  mkdirSync(SCRATCH, { recursive: true });
  const mark = join(SCRATCH, `patch-mark-${RUN_STAMP}`);
  rmSync(mark, { force: true });
  const env = control === undefined ? {} : modulePatchEnv(control.patches, checkout.root, mark);
  say(`serving ${checkout.describe}; legs ${[...legs].join(", ")}${control === undefined ? "" : `; control ${control.name}`}`);
  if (control !== undefined) say(`control ${control.name}: ${control.does}\n${describePatches(control.patches, checkout.root)}`);

  const profile = join(checkout.root, "packages", "shift-manager", "teams", "devteam");
  for (const model of ["openai/gpt-5.4-mini", "anthropic/claude-haiku-5-5"]) {
    if (!keysServing(model).some((k) => (process.env[k] ?? "") !== "")) {
      return { failures: [`blocked: no key here serves ${model}; none of ${keysServing(model).join(", ")} is set`], evidence: "" };
    }
  }
  const host = (await import(pathToFileURL(join(profile, "host.mts")).href)) as { LAB_USERS?: Record<string, { userId: string; bearer: string }> };
  const users = host.LAB_USERS;
  if (users?.owner === undefined || users.member === undefined) throw new Error("setup: the DevTeam host exports no LAB_USERS owner and member");
  const alicePerson: Person = { label: "Alice", ...users.owner };
  const bobPerson: Person = { label: "Bob", ...users.member };
  say("building Shift Manager's pages");
  const pages = await buildShiftManagerPages(join(SCRATCH, `pages-${checkout.commit.slice(0, 9)}`), join(checkout.root, "packages", "shift-manager"));
  const shipped = await loadShipped(checkout.root);

  const storeDir = join(SCRATCH, "stores", RUN_STAMP);
  mkdirSync(storeDir, { recursive: true });
  const store = join(storeDir, "devteam.sqlite");
  const serve = (label: string) =>
    startShiftManager({
      scratch: SCRATCH,
      label: `devteam-${label}`,
      config: join(profile, "fsdev.config.mts"),
      pages,
      // The coder's scripted run paces its steps, so leg 8 can message a task while it runs.
      // A call with no deadline waits the host default, short here so leg 10 can time it.
      env: { DEVTEAM_STORE: store, DEVFORCE_LAB_STEP_MS: "6000", DEVTEAM_WAIT_DEFAULT_MS: String(WAIT_DEFAULT_MS), ...env },
      root: join(checkout.root, "packages", "shift-manager"),
      tsx: join(checkout.root, "node_modules", ".bin", "tsx"),
      timeoutMs: 180_000,
    });

  const results: Record<string, LegResult> = {};
  let served: ServedShiftManager = await serve("first");
  const world: World = {
    shipped,
    alice: connect(shipped, served.origin, alicePerson),
    bob: connect(shipped, served.origin, bobPerson),
    turns: [],
    say,
    conversation: {},
    words: { codename: word(), codename2: word(), colourA: word(), w3b: word(), ring: word(), bobWorker: `bob-${word()}` },
  };
  let sent = new Map<string, { sessionId: string; args: Record<string, unknown> }>();
  try {
    say(`DevTeam at ${served.origin}; held out: ${JSON.stringify(world.words)}`);
    const hired = await hireTeam(world);
    if (hired.length > 0) return { failures: hired, evidence: "" };
    await openConversations(world);
    const filedGoals: string[] = [];
    const runLeg = async (name: string, run: () => Promise<LegResult>) => {
      if (!legs.has(name)) return;
      say(`leg ${name}`);
      try {
        results[name] = await run();
      } catch (error) {
        results[name] = { failures: [`${name}:threw — ${error instanceof Error ? error.stack ?? error.message : String(error)}`], notes: [] };
      }
      say(`leg ${name}: ${results[name]!.failures.length === 0 ? "PASS" : `FAIL (${results[name]!.failures.map((f) => f.split(" — ")[0]).join(", ")})`}`);
      await quiet(world.alice, 240_000);
    };
    await runLeg("1", () => leg1(world));
    await runLeg("1b", () => leg1b(world));
    await runLeg("2", async () => {
      filedGoals.push("helper-a");
      return leg2(world);
    });
    await runLeg("3b", async () => {
      filedGoals.push(world.words.w3b);
      return leg3b(world);
    });
    await runLeg("3", async () => {
      filedGoals.push(world.words.ring);
      return leg3(world);
    });
    // The hire check runs in its own process, under the control's patches.
    const hireCheck = async () => {
      const ran = spawnSync(join(checkout.root, "node_modules", ".bin", "tsx"), [join(dirname(fileURLToPath(import.meta.url)), "hire-check.mts"), checkout.root], {
        cwd: checkout.root,
        encoding: "utf8",
        env: { ...process.env, ...env },
        timeout: 120_000,
      });
      const last = ran.stdout.trim().split("\n").at(-1) ?? "";
      try {
        return JSON.parse(last) as { deaf: string | null; heard: string | null };
      } catch {
        throw new Error(`the hire check printed no verdict: ${(ran.stdout + ran.stderr).slice(-800)}`);
      }
    };
    await runLeg("4", () => leg4(world, filedGoals, hireCheck));
    // Legs 6 to 8 (FIX-2160) share the courier and the sessions they address.
    if (legs.has("6") || legs.has("7") || legs.has("8")) {
      const setup = await setupTargets(world);
      const targets: Targets | undefined = setup.targets;
      if (targets === undefined) {
        for (const l of ["6", "7", "8"]) if (legs.has(l)) results[l] = { failures: setup.failures, notes: [] };
      } else {
        await runLeg("6", () => leg6(world, targets));
        await runLeg("7", () => leg7(world, targets));
        await runLeg("8", () => leg8(world, targets));
      }
    }
    await runLeg("10", () => leg10(world));
    await runLeg("10b", () => leg10b(world));
    await runLeg("10c", () => leg10c(world));
    for (const t of world.turns) {
      say(`turn (${t.leg}) ${t.worker} ${t.status}: calls ${t.calls.map((c) => `${typeof c.args.to === "string" ? c.args.to : JSON.stringify(c.args.to)}→${c.output?.sent ?? String(c.output?.error ?? "").slice(0, 40)}`).join(", ") || "none"}; reply: ${t.reply.slice(0, 200).replace(/\n/g, " ")}`);
    }
    sent = new Map([...(await sentIds(world.alice)).entries()].map(([id, c]) => [id, { sessionId: c.sessionId, args: c.args }]));
  } finally {
    await served.stop();
  }

  if (legs.has("5")) {
    say(`leg 5: restarting on the same store (${sent.size} message(s) sent)`);
    served = await serve("restarted");
    try {
      results["5"] = await leg5(served.origin, alicePerson, sent);
      say(`leg 5: ${results["5"].failures.length === 0 ? "PASS" : "FAIL"}`);
    } finally {
      await served.stop();
    }
  }
  // GOAL_KEEP_STORE=1 keeps the store for reading a failed leg's sessions afterwards.
  if (process.env.GOAL_KEEP_STORE === undefined) rmSync(storeDir, { recursive: true, force: true });
  else say(`store kept at ${store}`);

  if (control !== undefined) {
    assertPatched(control.patches, checkout.root, mark);
    say(`control ${control.name}: the patch reached ${control.patches.map((p) => p.module).join(", ")}`);
  }

  const failures: string[] = sweep(checkout.root);
  for (const l of ORDER) {
    const r = results[l];
    if (r === undefined) continue;
    for (const note of r.notes) say(`${l}: ${note}`);
    failures.push(...r.failures);
  }
  if (control !== undefined) {
    const named = failures.some((f) => f.startsWith(`${control.assertion} `));
    failures.unshift(
      named
        ? `control ${control.name}: failed on ${control.assertion}, as it must`
        : `control ${control.name}: did NOT fail on ${control.assertion}, so the check can't see what the control removes`,
    );
  }
  return { failures, evidence: `legs ${[...legs].join(", ")} PASS on ${checkout.describe}; worker turns on the models their files name (openai/gpt-5.4-mini, the Shift Coordinator on anthropic/claude-haiku-5-5)` };
});
