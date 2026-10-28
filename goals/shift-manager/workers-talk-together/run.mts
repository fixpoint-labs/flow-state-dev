/**
 * Goal check for FIX-2242, the FIX-2070 closure: workers talk by send and call,
 * to any worker, task or conversation, with the legs colliding on one durable
 * host. See goal.md.
 *
 * Run:      pnpm tsx goals/shift-manager/workers-talk-together/run.mts
 * Controls: GOAL_CONTROL=<name> (controls.mts names each; it runs the scenes it needs)
 * Before:   GOAL_COMMIT=<sha> serves that commit, from its own tree and install
 * Scenes:   GOAL_SCENES=ac,ed,b,sweep,j1 (default: all, in that order)
 */
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { RUN_STAMP, goalTmpDir, keysServing, runGoal } from "../../lib/index.mts";
import { assertPatched, describePatches, modulePatchEnv } from "../../lib/module-patch.mts";
import { launchChromium } from "../../lib/playwright.mts";
import { buildShiftManagerPages, openShiftManager, personPage, startShiftManager, type ServedShiftManager } from "../../lib/shift-manager.mts";
import { checkoutFor } from "../workers-message-each-other/checkout.mts";
import { faultPatches, type FaultName } from "../workers-message-each-other/faults.mts";
import type { Servers } from "../workers-message-each-other/legs-delivery.mts";
import { connect, hireTeam, loadShipped, openConversations, quiet, word, HELPER_A, HERALD, RESEARCHER, type LegResult, type Person, type World } from "../workers-message-each-other/legs.mts";
import { CONTROL_NAMES, CONTROLS, SCENES, type Control, type Scene } from "./controls.mts";
import { hireRing, sceneAC, sceneB, sceneED, RING_ONE, RING_TWO, type Walked } from "./scenes.mts";

const SCRATCH = goalTmpDir("workers-talk");
const say = (s: string) => console.error(`[talk ${new Date().toISOString().slice(11, 19)}] ${s}`);

/** Every assertion the walk grades, in the order the report prints them. */
const ASSERTIONS = [
  "c:lands-once",
  "a:answer-in-request",
  "a:one-place",
  "a:no-relay",
  "e:filer-hears",
  "e:heard-while-calling",
  "e:steer-releases",
  "e:kept-once",
  "d:per-request",
  "d:seventh-refused",
  "b:in-task-session",
  "b:task-unchanged",
  "sweep:no-old-path",
  "j1:own-item",
  "j1:states",
  "j1:opens-side",
] as const;

/** Which of the other four teams' *after* each leg walks (plan row 2). */
const TEAMS = [
  "builds a worker that talks to others → a (a call across a crash returns its answer, once, to the request that asked)",
  "builds a worker that files work → e (hears its task's question while its own call waits, steers, the task goes on)",
  "runs Workforce in production → c and d (lands once across a crash; a ring stops in one typed message's budget)",
  "maintains Workforce → sweep (CI fails a PR that brings a removed name back)",
  "uses Shift Manager, like Alice → j1 (in a browser)",
];

const controlName = process.env.GOAL_CONTROL ?? "";
if (controlName !== "" && !(CONTROL_NAMES as readonly string[]).includes(controlName)) {
  console.error(`unknown GOAL_CONTROL "${controlName}"; known: ${CONTROL_NAMES.join(", ")}`);
  process.exit(2);
}
const control: Control | undefined = controlName === "" ? undefined : CONTROLS[controlName as keyof typeof CONTROLS];
const scenes = new Set((process.env.GOAL_SCENES ?? (control === undefined ? SCENES.join(",") : control.scenes.join(","))).split(",").map((s) => s.trim()).filter(Boolean)) as Set<Scene>;
for (const s of scenes) if (!(SCENES as readonly string[]).includes(s)) throw new Error(`unknown scene "${s}" in GOAL_SCENES`);

/** The vocabulary sweep's two message rows (FIX-2242 D2), read from this checkout's rules. */
type RetiredRow = { id: string; files: RegExp; pattern: RegExp };
const RULES = fileURLToPath(new URL("../../vocabulary/one-word-per-thing/rules.mjs", import.meta.url));
const { RETIRED } = (await import(pathToFileURL(RULES).href)) as { RETIRED: RetiredRow[] };
const MESSAGE_ROWS = RETIRED.filter((r) => r.id === "message-names" || r.id === "message-reply-to");
/** Build output and installs, which the vocabulary sweep never reads either (it reads tracked files only). */
const SKIP_DIRS = new Set(["node_modules", ".next", ".turbo", "build", "coverage", "storybook-static", ".docusaurus", ".git"]);
const skipped = (name: string) => SKIP_DIRS.has(name) || name.startsWith("dist");

/**
 * `sweep:no-old-path`: none of D2's rows has a hit in what the vocabulary
 * sweep reads, tests included, each at its own scope, over the served tree.
 * The tree is walked on disk so a `GOAL_COMMIT` tree, which has no git, is read the same way.
 */
function sweep(root: string): LegResult {
  const r: LegResult = { failures: [], notes: [] };
  if (MESSAGE_ROWS.length !== 2) return { failures: ["sweep:no-old-path — setup: the vocabulary sweep's message rows are missing"], notes: [] };
  const hits: string[] = [];
  let read = 0;
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      if (skipped(name)) continue;
      const path = join(dir, name);
      if (statSync(path).isDirectory()) {
        walk(path);
        continue;
      }
      const rel = relative(root, path);
      const rows = MESSAGE_ROWS.filter((row) => row.files.test(rel));
      if (rows.length === 0) continue;
      read += 1;
      readFileSync(path, "utf8")
        .split("\n")
        .forEach((line, i) => {
          for (const row of rows) if (row.pattern.test(line)) hits.push(`${row.id} ${rel}:${i + 1}: ${line.trim().slice(0, 100)}`);
        });
    }
  };
  for (const top of ["packages", "apps", "docs/architecture"]) if (existsSync(join(root, top))) walk(join(root, top));
  r.notes.push(`sweep: ${read} file(s) read under the two rows' scopes, ${hits.length} hit(s)`);
  if (read === 0) r.failures.push(`sweep:no-old-path — setup: the sweep read no file`);
  if (hits.length > 0) r.failures.push(`sweep:no-old-path — ${hits.length} hit(s) of a removed name: ${hits.slice(0, 6).join(" | ")}`);
  // The rows' own control: the vocabulary sweep must still report each plant.
  const planted = spawnSync(process.execPath, [fileURLToPath(new URL("../../vocabulary/one-word-per-thing/sweep.mjs", import.meta.url)), "--control"], { encoding: "utf8" });
  if (planted.status !== 0 || !planted.stdout.includes("CONTROL OK")) r.failures.push(`sweep:no-old-path — the vocabulary sweep's --control didn't report its plants: ${planted.stdout.slice(-300)}`);
  return r;
}

/** j1: in a browser as Alice after the walk, the screen shows what row 1 graded in the store. */
async function journey(origin: string, alice: Person, world: World, walked: Walked): Promise<LegResult> {
  const r: LegResult = { failures: [], notes: [] };
  const browser = await launchChromium();
  try {
    const { page, errors } = await personPage(browser, origin, alice, true);
    const researcher = world.conversation[RESEARCHER]!;
    const helperA = world.conversation[HELPER_A]!;
    const conversation = async (sessionId: string) => {
      await openShiftManager(page, origin, `/s/${encodeURIComponent(sessionId)}`);
      await page.getByTestId("session-conversation").waitFor({ timeout: 30_000 });
      await page.waitForFunction(() => document.querySelectorAll("[data-testid=session-item]").length > 0, undefined, { timeout: 30_000 });
    };

    // j1:own-item — the crashed call shows once in Researcher's conversation, as its own item, with its sender and its call mark.
    if (walked.crashedCall === undefined) {
      r.failures.push(`j1:own-item — setup: scene ac left no call to look for`);
    } else {
      await conversation(researcher.id);
      const shown = page.locator(`[data-testid=received-message][data-message-id="${walked.crashedCall}"]`);
      const count = await shown.count();
      const from = count === 1 ? await shown.getAttribute("data-from") : null;
      const marked = count === 1 ? await shown.locator("[data-testid=received-message-call]").count() : 0;
      r.notes.push(`j1: Researcher's conversation draws call ${walked.crashedCall} ${count} time(s), from ${from}, with ${marked} call mark(s)`);
      if (count !== 1 || from !== HELPER_A) r.failures.push(`j1:own-item — Researcher's conversation draws call ${walked.crashedCall} ${count} time(s), from ${from}, not once from ${HELPER_A}`);
      else if (marked !== 1) r.failures.push(`j1:own-item — Researcher's conversation draws call ${walked.crashedCall} from ${HELPER_A} with no mark saying it is a call`);
      // Helper A's side: the call's tool line answered with the reply, never a received item from Researcher.
      await conversation(helperA.id);
      const answered = await page.locator(`[data-testid=message-call][data-to="${RESEARCHER}"] [data-testid=message-call-answer][data-status=answered]`).count();
      const received = await page.locator(`[data-testid=received-message][data-from="${RESEARCHER}"]`).count();
      r.notes.push(`j1: Helper A's conversation draws ${answered} answered call line(s) to Researcher and ${received} received item(s) from it`);
      if (answered === 0 || received > 0) r.failures.push(`j1:own-item — Helper A's conversation draws ${answered} answered call line(s) to Researcher and ${received} received item(s) from it`);
    }

    // j1:states — the Messages view: the crashed call once, delivered; the parked call answered; the ring's six, and no seventh.
    await openShiftManager(page, origin, "/messages");
    await page.getByTestId("messages").waitFor();
    await page.waitForFunction(() => document.querySelector("[data-testid=messages-reading]") === null, undefined, { timeout: 30_000 });
    const listed = await page.$$eval("[data-testid=message]", (els) =>
      els.map((el) => ({
        id: el.getAttribute("data-message-id"),
        status: el.getAttribute("data-status"),
        from: el.getAttribute("data-from"),
        to: el.getAttribute("data-to"),
        call: el.querySelector("[data-testid=message-call-state]")?.textContent ?? null,
        text: el.querySelector("[data-testid=message-text]")?.getAttribute("title") ?? "",
      })),
    );
    const crashed = listed.filter((m) => m.id === walked.crashedCall);
    const parked = listed.filter((m) => m.id === walked.parkedCall);
    const ring = listed.filter((m) => (m.from === RING_ONE || m.from === RING_TWO) && (m.to === RING_ONE || m.to === RING_TWO));
    r.notes.push(`j1: the view lists ${listed.length} message(s); crashed ${JSON.stringify(crashed)}; parked ${JSON.stringify(parked)}; ${ring.length} ring message(s)`);
    if (crashed.length !== 1 || crashed[0]!.status !== "delivered") r.failures.push(`j1:states — the crashed call is listed ${crashed.length} time(s), ${crashed[0]?.status ?? "-"}, not once delivered`);
    if (parked.length !== 1 || !/answered/.test(parked[0]!.call ?? "")) r.failures.push(`j1:states — the parked call is listed ${parked.length} time(s), reading "${parked[0]?.call ?? ""}", not once answered`);
    if (ring.length !== 6 || ring.some((m) => m.status !== "delivered")) r.failures.push(`j1:states — the view lists ${ring.length} ring message(s) (${ring.map((m) => m.status).join(", ")}), not the six it passed`);

    // j1:opens-side — each side's link of the crashed call opens its session.
    if (crashed.length === 1) {
      const row = page.locator(`[data-testid=message][data-message-id="${walked.crashedCall}"]`);
      const toSession = await row.getByTestId("message-to").getAttribute("data-session-id");
      const fromSession = await row.getByTestId("message-from").getAttribute("data-session-id");
      await row.getByTestId("message-to").click();
      await page.waitForURL(`**/s/${encodeURIComponent(toSession ?? "")}`);
      const opened = await page.getByTestId("session-conversation").getAttribute("data-session-id");
      if (opened !== researcher.id) r.failures.push(`j1:opens-side — the recipient's link opened ${opened}, not Researcher's conversation ${researcher.id}`);
      await page.goBack();
      await page.getByTestId("messages").waitFor();
      await page.locator(`[data-testid=message][data-message-id="${walked.crashedCall}"]`).getByTestId("message-from").click();
      await page.waitForURL(`**/s/${encodeURIComponent(fromSession ?? "")}`);
      const sender = await page.getByTestId("session-conversation").getAttribute("data-session-id");
      if (sender !== helperA.id) r.failures.push(`j1:opens-side — the sender's link opened ${sender}, not Helper A's conversation ${helperA.id}`);
    } else {
      r.failures.push(`j1:opens-side — setup: no single listed crashed call to open`);
    }
    if (errors.length > 0) r.notes.push(`j1: page errors: ${errors.slice(0, 3).join(" | ")}`);
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
  say(`serving ${checkout.describe}; scenes ${[...scenes].join(", ")}${control === undefined ? "" : `; control ${control.name}`}`);
  if (control !== undefined) say(`control ${control.name}: ${control.does}\n${describePatches(control.patches, checkout.root)}`);
  for (const t of TEAMS) say(`team: ${t}`);

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
  const faultLog = join(storeDir, "faults.ndjson");
  const release = join(storeDir, "release-held-resends");
  // Leg c's fault fires only on Helper A's messages, and goes on before the control's patches.
  const withFaults = (faults: readonly FaultName[]) =>
    faults.length === 0
      ? env
      : { ...modulePatchEnv([...faultPatches(faults, HELPER_A), ...(control?.patches ?? [])], checkout.root, mark), GOAL_FAULT_LOG: faultLog, GOAL_FAULT_RELEASE: release };
  const serve = (label: string, faults: readonly FaultName[] = []) =>
    startShiftManager({
      scratch: SCRATCH,
      label: `devteam-${label}`,
      config: join(profile, "fsdev.config.mts"),
      pages,
      env: { DEVTEAM_STORE: store, ...withFaults(faults) },
      root: join(checkout.root, "packages", "shift-manager"),
      tsx: join(checkout.root, "node_modules", ".bin", "tsx"),
      timeoutMs: 180_000,
    });

  const results: Record<string, LegResult> = {};
  const walked: Walked = {};
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
  const servers: Servers = {
    faultLog,
    release,
    restart: async (faults, label) => {
      await served.stop();
      served = await serve(label, faults);
      world.alice = connect(shipped, served.origin, alicePerson);
      world.bob = connect(shipped, served.origin, bobPerson);
      say(`${label}: serving at ${served.origin}${faults.length === 0 ? "" : ` with ${faults.join(", ")} on ${HELPER_A}'s messages`}`);
    },
    crashed: async (timeoutMs) => {
      let timer: NodeJS.Timeout | undefined;
      const late = new Promise<boolean>((resolve) => (timer = setTimeout(() => resolve(false), timeoutMs)));
      try {
        return await Promise.race([served.exited.then(() => true), late]);
      } finally {
        clearTimeout(timer);
      }
    },
  };
  const runScene = async (name: Scene, run: () => Promise<LegResult>) => {
    if (!scenes.has(name)) return;
    say(`scene ${name}`);
    try {
      results[name] = await run();
    } catch (error) {
      results[name] = { failures: [`${name}:threw — ${error instanceof Error ? error.stack ?? error.message : String(error)}`], notes: [] };
    }
    say(`scene ${name}: ${results[name]!.failures.length === 0 ? "PASS" : `FAIL (${results[name]!.failures.map((f) => f.split(" — ")[0]).join(", ")})`}`);
  };
  try {
    say(`DevTeam at ${served.origin}`);
    const live = ["ac", "ed", "b", "j1"].some((s) => scenes.has(s as Scene));
    if (live) {
      const hired = [...(await hireTeam(world)), ...(await hireRing(world))];
      if (hired.length > 0) return { failures: hired, evidence: "" };
      await openConversations(world);
      for (const id of [RING_ONE, RING_TWO]) world.conversation[id] = await world.alice.workforce.ensureWorkerSession({ worker: id });
    }
    await runScene("ac", async () => {
      try {
        return await sceneAC(world, servers, walked);
      } finally {
        await quiet(world.alice, 240_000);
      }
    });
    await runScene("ed", () => sceneED(world, walked, { ring: true, question: true }));
    await runScene("b", () => sceneB(world));
    await runScene("sweep", async () => sweep(checkout.root));
    await runScene("j1", () => journey(served.origin, alicePerson, world, walked));
    for (const t of world.turns) {
      say(`turn (${t.leg}) ${t.worker} ${t.status}: calls ${t.calls.map((c) => `${typeof c.args.to === "string" ? c.args.to : JSON.stringify(c.args.to)}→${c.output?.sent ?? c.output?.status ?? String(c.output?.error ?? "").slice(0, 40)}`).join(", ") || "none"}; reply: ${t.reply.slice(0, 200).replace(/\n/g, " ")}`);
    }
  } finally {
    await served.stop();
  }
  // GOAL_KEEP_STORE=1 keeps the store for reading a failed scene's sessions afterwards.
  if (process.env.GOAL_KEEP_STORE === undefined) rmSync(storeDir, { recursive: true, force: true });
  else say(`store kept at ${store}`);

  if (control !== undefined) {
    assertPatched(control.patches, checkout.root, mark);
    say(`control ${control.name}: the patch reached ${control.patches.map((p) => p.module).join(", ")}`);
  }

  const failures: string[] = [];
  for (const s of SCENES) {
    const r = results[s];
    if (r === undefined) continue;
    for (const note of r.notes) say(`${s}: ${note}`);
    failures.push(...r.failures);
  }
  // The report: every assertion the run reached, beside its verdict.
  const ran = ASSERTIONS.filter((a) => {
    const leg = a.split(":")[0]!;
    return scenes.has(leg === "a" || leg === "c" ? "ac" : leg === "e" || leg === "d" ? "ed" : (leg as Scene));
  });
  // A scene that threw graded none of its assertions: each reads FAIL, never PASS.
  const sceneOf = (a: string): Scene => {
    const leg = a.split(":")[0]!;
    return leg === "a" || leg === "c" ? "ac" : leg === "e" || leg === "d" ? "ed" : (leg as Scene);
  };
  const broken = (a: string) => {
    const r = results[sceneOf(a)];
    return r === undefined || r.failures.some((f) => /^[a-z0-9]+:threw /.test(f));
  };
  for (const a of ran) say(`${failures.some((f) => f.startsWith(`${a} `)) || broken(a) ? "FAIL" : "PASS"}  ${a}`);
  if (control !== undefined) {
    // A control must fail its assertion on what it grades: a setup failure or a throw counts for nothing.
    const graded = failures.filter((f) => f.startsWith(`${control.assertion} `) && !/— (setup|threw)/.test(f));
    failures.unshift(
      graded.length > 0
        ? `control ${control.name}: failed on ${control.assertion}, as it must`
        : `control ${control.name}: did NOT fail on ${control.assertion}, so the check can't see what the control removes`,
    );
  }
  return { failures, evidence: `${ran.join(", ")} PASS on ${checkout.describe}; worker turns on the models their files name (openai/gpt-5.4-mini, the Shift Coordinator on anthropic/claude-haiku-5-5)` };
});
