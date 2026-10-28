/**
 * Goal check: in the Teammates lab, you talk to lead, lead messages
 * researcher, researcher's reply reaches lead while you are still talking to
 * it, and a coding job lead hands coder runs through Claude Code in lead's
 * project. See goal.md for the contract.
 *
 * Real path, real model, out of CI. The lab's pages are built here and served
 * by `fsdev dev --app` over a fresh SQLite store, with one project, `relay`,
 * mapped to a scratch git checkout made here. One headless browser drives the
 * screen as a person would. Graded, per step:
 *
 *   1  lead answers your first line in its conversation.
 *   2  a card "To researcher" in lead's conversation, a line "From lead" in
 *      researcher's, the exchange under "with researcher" in the Talk panel,
 *      and a delivered row lead → researcher in the message log.
 *   3  your second line goes in before researcher's reply has landed; the reply
 *      shows in lead's conversation under researcher's name after lead's answer
 *      to you, a delivered reply row is in the log, and a line of lead's after
 *      it carries the held-out launch date.
 *   4  not run: the history window's mark is gap G1 (FIX-1613).
 *   5  with no project, coder's run is refused and the task card asks for one;
 *      for 30 s nothing else runs and nothing on disk changes; you pick
 *      `relay`, lead files again, the run goes through Claude Code, a worktree
 *      of the checkout gets one commit that changes the README's first line and
 *      nothing else, the checkout itself is untouched, and the result lands in
 *      lead's conversation from coder.
 *
 * Inputs are held out: the launch date is drawn at random and written into a
 * copy of the workers' tree, and the README's typo is one of several.
 *
 * Run:      pnpm tsx goals/teammates-lab/a-worker-talks-to-another-while-you-talk/run.mts
 * Controls: GOAL_CONTROL=no-model | no-lead-send | no-reply-tool | pick-not-kept (see goal.md)
 */
import { spawn, execFileSync, type ChildProcess } from "node:child_process";
import { cpSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import type { Page } from "playwright";
import { createClient, readEveryCollectionPage } from "@flow-state-dev/client";
import { createWorkforceClient, WORKER_MESSAGES_RESOURCE, workerMessageRowSchema } from "@flow-state-dev/workforce/browser";
import {
  DEFAULT_MODEL,
  assertPatched,
  describePatches,
  goalTmpDir,
  intentFreeEnv,
  loadFixture,
  modulePatchEnv,
  refuseIfAnswering,
  repoPath,
  REPO_ROOT,
  runGoal,
  stopProcessGroup,
  type ModulePatch,
} from "../../lib/index.mts";
import { launchChromium } from "../../lib/playwright.mts";

interface Fixture {
  port: number;
  lead: string;
  researcher: string;
  coder: string;
  ask: string;
  second: string;
  fix: string;
  project: { id: string; title: string };
  typos: { readme: string; wrong: string; right: string }[];
  rest: string;
  answerWithinMs: number;
  replyWithinMs: number;
  unpickedMs: number;
  runWithinMs: number;
}

const fixture = loadFixture<Fixture>(import.meta.url);
const LAB = repoPath("labs", "teammates");
const CONTROL = process.env.GOAL_CONTROL ?? "";
const MODEL = process.env.GOAL_MODEL ?? DEFAULT_MODEL;
/** What the page says after you pick a project (the lab's `PICKED_LINE`). */
const PICKED_LINE = "I picked a project for you. File the task again.";

/** Drop one worker's `sendMessage`: the capability lists no tool on that worker's turns. */
const dropSendFor = (worker: string): ModulePatch => ({
  module: "packages/workforce/src/messages/message-tool.ts",
  from: String.raw`if \(typeof self !== "string"\) return \[\];`,
  to: `if (typeof self !== "string" || self === ${JSON.stringify(worker)}) return [];`,
});

/** Each control: what it changes, and the steps it must redden, and only those. */
const CONTROLS: Record<string, { patches?: ModulePatch[]; model?: string; steps: string[] }> = {
  // No model answers: lead's conversation holds only your own lines.
  "no-model": { model: "openai/no-such-model-goal-control", steps: ["1", "2", "3", "5"] },
  // lead can't message: no card, no line in researcher's conversation, no row, and so no reply.
  "no-lead-send": { patches: [dropSendFor(fixture.lead)], steps: ["2", "3"] },
  // researcher hears lead but can't answer it.
  "no-reply-tool": { patches: [dropSendFor(fixture.researcher)], steps: ["3"] },
  // The pick answers as kept but is never stored, so the task filed again still has no project.
  "pick-not-kept": {
    patches: [
      {
        module: "packages/workforce/src/projects/work-project.ts",
        from: String.raw`await ctx\.session\.patchState\(\{ \[WORK_PROJECT_STATE_KEY\]: projectRef\(input\.project\) \}\);`,
        to: "/* goal control pick-not-kept: not stored */",
      },
    ],
    steps: ["5"],
  },
};
if (CONTROL !== "" && CONTROLS[CONTROL] === undefined) {
  throw new Error(`unknown GOAL_CONTROL "${CONTROL}"; known: ${Object.keys(CONTROLS).join(", ")}`);
}
const control = CONTROLS[CONTROL];

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const git = (cwd: string, ...args: string[]) => execFileSync("git", ["-C", cwd, ...args], { encoding: "utf8" }).trim();

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const pick = <T,>(xs: readonly T[]): T => xs[Math.floor(Math.random() * xs.length)]!;

/** The held-out launch date, and whether a line states it. */
function launchDate() {
  const month = pick(MONTHS.filter((m) => m !== "November"));
  const day = 2 + Math.floor(Math.random() * 26);
  const said = new RegExp(`\\b${day}(st|nd|rd|th)?\\b`);
  const monthSaid = new RegExp(`\\b${month.slice(0, 3)}`, "i");
  return { text: `${day} ${month}`, isIn: (line: string) => said.test(line) && monthSaid.test(line) };
}

/** A copy of the lab's workers whose researcher knows the held-out date instead of the shipped one. */
function workersWith(dir: string, date: string): string {
  const tree = join(dir, "workforce");
  cpSync(join(LAB, "workforce"), tree, { recursive: true });
  const file = join(tree, "teams/teammates/workers/researcher/WORKER.md");
  const before = readFileSync(file, "utf8");
  const after = before.replace(/The launch date is [^.\n]+\./, `The launch date is ${date}.`);
  if (after === before) throw new Error("setup: researcher's WORKER.md has no launch date line to hold out");
  writeFileSync(file, after);
  return tree;
}

/** A scratch git checkout whose README's first line has a typo; `.fsdev/` ignored, as a run needs. */
function scratchCheckout(dir: string, typo: Fixture["typos"][number]): string {
  const checkout = join(dir, "relay");
  mkdirSync(checkout, { recursive: true });
  writeFileSync(join(checkout, "README.md"), `${typo.readme}\n${fixture.rest}`);
  writeFileSync(join(checkout, ".gitignore"), "**/.fsdev/\n");
  git(checkout, "init", "-q", "-b", "main");
  git(checkout, "-c", "user.email=goal@example.com", "-c", "user.name=goal", "add", ".");
  git(checkout, "-c", "user.email=goal@example.com", "-c", "user.name=goal", "commit", "-q", "-m", "init");
  return checkout;
}

/** What the checkout holds, to tell whether anything on disk changed. */
function diskOf(checkout: string) {
  return {
    head: git(checkout, "rev-parse", "HEAD"),
    status: git(checkout, "status", "--porcelain"),
    worktrees: git(checkout, "worktree", "list", "--porcelain"),
    branches: git(checkout, "branch", "--list", "--format=%(refname:short) %(objectname)"),
  };
}

/** Start the lab's server, refusing a port something already answers on. */
async function startLab(env: Record<string, string>, log: string): Promise<{ child: ChildProcess; origin: string }> {
  const origin = `http://127.0.0.1:${fixture.port}`;
  await refuseIfAnswering(origin);
  const out: string[] = [];
  const child = spawn(
    "npx",
    ["tsx", "../../packages/cli/bin/fsdev.ts", "dev", "--app", "@flow-state-dev/teammates", "--port", String(fixture.port), "--no-open"],
    { cwd: LAB, env, detached: true, stdio: ["ignore", "pipe", "pipe"] },
  );
  const keep = (chunk: Buffer) => {
    out.push(chunk.toString());
    writeFileSync(log, out.join(""));
  };
  child.stdout!.on("data", keep);
  child.stderr!.on("data", keep);
  for (const until = Date.now() + 120_000; Date.now() < until; ) {
    if (child.exitCode !== null) throw new Error(`the lab exited (${child.exitCode}) before it answered; log: ${log}`);
    try {
      if ((await fetch(origin, { signal: AbortSignal.timeout(2_000) })).ok) return { child, origin };
    } catch {
      // not up yet
    }
    await sleep(500);
  }
  stopProcessGroup(child);
  throw new Error(`the lab did not answer on ${origin} within 120s; log: ${log}`);
}

// ---- reading the screen ----------------------------------------------------

const conversation = (page: Page) => page.getByRole("main", { name: "Conversation" });
const workerRow = (page: Page, name: string) => page.locator(`nav[aria-label="Workers"] [data-worker="${name}"]`);

interface Drawn {
  kind: string;
  label: string;
  text: string;
  status?: string;
}

/** The open conversation's entries in order, as drawn. */
async function entriesOf(page: Page): Promise<Drawn[]> {
  return await conversation(page)
    .locator("[data-entry]")
    .evaluateAll((els) =>
      els.map((el) => ({
        kind: (el as HTMLElement).dataset.entry ?? "",
        label: el.getAttribute("aria-label") ?? el.querySelector("[aria-label]")?.getAttribute("aria-label") ?? "",
        text: el.textContent ?? "",
        status: el.querySelector("[data-task-status]")?.textContent ?? undefined,
      })),
    );
}

/** Read the conversation until `done` holds, or the time runs out; the last reading either way. */
async function readUntil(page: Page, done: (entries: Drawn[]) => boolean, withinMs: number): Promise<{ entries: Drawn[]; ok: boolean }> {
  let entries: Drawn[] = [];
  for (const until = Date.now() + withinMs; Date.now() < until; ) {
    entries = await entriesOf(page);
    if (done(entries)) return { entries, ok: true };
    await sleep(500);
  }
  return { entries, ok: false };
}

async function tell(page: Page, worker: string, text: string): Promise<void> {
  const box = page.getByLabel(`Message ${worker}`);
  await box.fill(text);
  await box.press("Enter");
}

async function open(page: Page, worker: string): Promise<void> {
  await workerRow(page, worker).click();
  await conversation(page).getByRole("heading", { name: worker }).waitFor({ timeout: 15_000 });
}

const userAt = (entries: Drawn[], text: string) => entries.findIndex((e) => e.kind === "user" && e.text.includes(text));
const short = (id: string) => id.replace(/^teammates\./, "");

// ---------------------------------------------------------------------------

await runGoal(async (failures, tell_) => {
  const evidence: string[] = [];
  const fail = (step: string, line: string) => failures.push(`[${step}] ${line}`);
  const dir = goalTmpDir("teammates-lab");
  const date = launchDate();
  const typo = pick(fixture.typos);
  const tree = workersWith(dir, date.text);
  const checkout = scratchCheckout(dir, typo);
  // Where the lab puts runs: beside its store (`fsdev.config.mts`).
  const runsRoot = join(dir, "teammates-runs");
  const lead = short(fixture.lead);
  const researcher = short(fixture.researcher);
  const coder = short(fixture.coder);

  // The pages, built from this checkout, never assumed.
  execFileSync("npx", ["vite", "build", "--logLevel", "error"], { cwd: LAB, stdio: "inherit" });

  const mark = join(dir, "patched.txt");
  const patches = control?.patches ?? [];
  if (patches.length > 0) console.error(`GOAL_CONTROL=${CONTROL} patches:\n${describePatches(patches, REPO_ROOT)}`);
  const env = intentFreeEnv(process.env, {
    TEAMMATES_MODEL: control?.model ?? MODEL,
    TEAMMATES_STORE: join(dir, "teammates.sqlite"),
    TEAMMATES_TREE: tree,
    TEAMMATES_USER: "you",
    TEAMMATES_PROJECTS: JSON.stringify([{ ...fixture.project, checkout }]),
    ...(patches.length > 0 ? modulePatchEnv(patches, REPO_ROOT, mark) : {}),
  });
  console.error(`goal: launch date ${date.text}; typo "${typo.wrong}"; scratch ${dir}`);

  const browser = await launchChromium();
  let server: ChildProcess | undefined;
  try {
    const lab = await startLab(env, join(dir, "server.log"));
    server = lab.child;
    const client = createClient({ userId: "you", baseUrl: lab.origin });
    const workforce = createWorkforceClient(client);
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    await page.goto(lab.origin);
    await page.getByLabel(`Message ${lead}`).waitFor({ timeout: 30_000 });

    /** The message log, read through lead's conversation as any client reads it. */
    const log = async () => {
      const session = await workforce.ensureWorkerSession({ worker: fixture.lead });
      const rows = await readEveryCollectionPage(client.resources, session.id, WORKER_MESSAGES_RESOURCE);
      return rows.flatMap((row) => {
        const parsed = workerMessageRowSchema.safeParse(row.clientData);
        return parsed.success ? [parsed.data] : [];
      });
    };

    // ---- 1 · you talk to lead ------------------------------------------------
    await tell(page, lead, fixture.ask);
    const sentAsk = Date.now();
    // Step 3's second line goes in as soon as lead has messaged researcher, before the reply can land.
    let secondSentAt: number | undefined;
    let replyBeforeSecond = false;
    const card = conversation(page).getByRole("button", { name: new RegExp(`^To ${researcher}: `) });
    for (const until = sentAsk + fixture.answerWithinMs; Date.now() < until; ) {
      if ((await card.count()) > 0) {
        replyBeforeSecond = (await conversation(page).getByRole("region", { name: `From ${researcher}` }).count()) > 0;
        await tell(page, lead, fixture.second);
        secondSentAt = Date.now();
        break;
      }
      const drawn = await entriesOf(page);
      // No message to researcher, but lead has answered: send the second line anyway, so step 3 is graded.
      if (drawn.slice(userAt(drawn, fixture.ask) + 1).some((e) => e.kind === "assistant") && Date.now() - sentAsk > 60_000) break;
      await sleep(250);
    }
    if (secondSentAt === undefined) {
      await tell(page, lead, fixture.second);
      secondSentAt = Date.now();
    }
    const one = await readUntil(
      page,
      (es) => es.slice(userAt(es, fixture.ask) + 1).some((e) => e.kind === "assistant" && e.text.trim() !== ""),
      Math.max(0, sentAsk + fixture.answerWithinMs - Date.now()),
    );
    const answers1 = tell_.over("1 · entries drawn in lead's conversation", one.entries).filter((e, i) => i > userAt(one.entries, fixture.ask) && e.kind === "assistant");
    if (userAt(one.entries, fixture.ask) < 0) fail("1", "your first line is not in lead's conversation");
    if (answers1.length === 0) fail("1", `no answer from lead after your first line within ${fixture.answerWithinMs / 1000}s`);
    else evidence.push(`1: lead answered (${answers1[0]!.text.length} chars)`);

    // ---- 2 · lead messages researcher ------------------------------------------
    const cards = await card.count();
    if (cards === 0) fail("2", `no card "To ${researcher}" in lead's conversation`);
    const talk = page.getByRole("complementary", { name: "Talk" });
    if ((await talk.count()) === 0) await conversation(page).getByRole("button", { name: "Talk" }).click();
    const talked = (await talk.getByRole("region", { name: `with ${researcher}` }).count()) > 0;
    if (!talked) fail("2", `the Talk panel lists nothing under "with ${researcher}"`);
    const rows = tell_.over("2 · message log rows", await log(), { emptyIs: "no message sent, which a control produces" });
    const asked = rows.filter((r) => r.from === fixture.lead && r.to === fixture.researcher);
    if (!asked.some((r) => r.status === "delivered")) {
      fail("2", `no delivered row ${fixture.lead} → ${fixture.researcher} in the message log (${asked.map((r) => r.status).join(", ") || "none"})`);
    }
    await open(page, researcher);
    const heard = await conversation(page)
      .getByRole("region", { name: `From ${lead}` })
      .waitFor({ timeout: 30_000 })
      .then(() => true, () => false);
    if (!heard) fail("2", `researcher's conversation shows no line "From ${lead}"`);
    if (cards > 0 && talked && heard) evidence.push(`2: card, Talk group, line in researcher's conversation, ${asked.length} log row(s)`);
    await open(page, lead);

    // ---- 3 · researcher replies while you are still talking to lead ------------
    if (replyBeforeSecond) fail("3", "researcher's reply had landed before the second line could be sent, so this run doesn't test the step");
    const three = await readUntil(
      page,
      (es) => {
        const at = es.findIndex((e) => e.kind === "received" && e.label === `From ${researcher}`);
        return at >= 0 && es.slice(at + 1).some((e) => e.kind === "assistant" && date.isIn(e.text));
      },
      Math.max(0, secondSentAt + fixture.replyWithinMs - Date.now()),
    );
    const drawn3 = tell_.over("3 · entries drawn in lead's conversation", three.entries);
    const replyAt = drawn3.findIndex((e) => e.kind === "received" && e.label === `From ${researcher}`);
    const firstAnswerAt = drawn3.findIndex((e, i) => i > userAt(drawn3, fixture.ask) && e.kind === "assistant");
    if (replyAt < 0) {
      fail("3", `no reply "From ${researcher}" in lead's conversation within ${fixture.replyWithinMs / 1000}s of your second line`);
    } else {
      if (firstAnswerAt < 0 || replyAt < firstAnswerAt) fail("3", "researcher's reply is not after lead's answer to you");
      if (!date.isIn(drawn3[replyAt]!.text)) fail("3", `researcher's reply doesn't carry the launch date ${date.text}: "${drawn3[replyAt]!.text}"`);
      const used = drawn3.slice(replyAt + 1).find((e) => e.kind === "assistant" && date.isIn(e.text));
      if (used === undefined) fail("3", `no line of lead's after the reply states the launch date ${date.text}`);
      const replies = (await log()).filter((r) => r.from === fixture.researcher && r.to === fixture.lead && r.inReplyTo !== undefined);
      if (!replies.some((r) => r.status === "delivered")) fail("3", "no delivered reply row researcher → lead in the message log");
      if (used !== undefined) evidence.push(`3: reply landed after lead's answer; lead's next line says ${date.text}`);
    }

    // ---- 4 · the history window ------------------------------------------------
    evidence.push("4: not run, waits on the history window's mark (G1, FIX-1613)");

    // ---- 5 · lead hands coder a fix, in lead's project ------------------------
    const chip = (await page.getByLabel(`Project for ${lead}`).inputValue()) || "none";
    if (chip !== "none") fail("5", `lead already shows project "${chip}" before any pick`);
    const before = diskOf(checkout);
    await tell(page, lead, fixture.fix);
    const tasks = conversation(page).locator("[data-entry=task]");
    const asking = await readUntil(page, (es) => es.some((e) => e.kind === "task" && e.status === "needs a project"), fixture.answerWithinMs);
    if (!asking.ok) {
      fail("5", `no task card for ${coder} asking for a project within ${fixture.answerWithinMs / 1000}s (${asking.entries.filter((e) => e.kind === "task").map((e) => e.status).join(", ") || "no task card"})`);
    } else {
      const prompt = tasks.first().getByRole("group", { name: "Pick a project" });
      if ((await prompt.count()) === 0) fail("5", "the refused task's card shows no project picker");
      await sleep(fixture.unpickedMs);
      const waited = await entriesOf(page);
      const running = waited.filter((e) => e.kind === "task" && e.status?.startsWith("running"));
      if (running.length > 0) fail("5", `with no pick, a run started: ${running.map((e) => e.status).join(", ")}`);
      const still = diskOf(checkout);
      if (JSON.stringify(still) !== JSON.stringify(before)) fail("5", "with no pick, something changed in the checkout");

      const picked = await prompt
        .getByLabel("Project")
        .selectOption(fixture.project.id, { timeout: 15_000 })
        .then(() => prompt.getByRole("button", { name: "Use project" }).click())
        .then(() => true, (error: Error) => (fail("5", `couldn't pick ${fixture.project.id} on the card: ${error.message.split("\n")[0]}`), false));
      if (!picked) throw new Error("step 5 stopped: no pick could be made");
      const ended = await readUntil(
        page,
        (es) => {
          const filed = es.filter((e) => e.kind === "task");
          const last = filed[filed.length - 1];
          return filed.length >= 2 && last!.status !== undefined && /^(done in|failed|refused)/.test(last!.status);
        },
        fixture.runWithinMs,
      );
      const filed = tell_.over("5 · task cards in lead's conversation", ended.entries.filter((e) => e.kind === "task"));
      if (userAt(ended.entries, PICKED_LINE) < 0) fail("5", "your pick was not said to lead as your line");
      const rerun = filed.length >= 2 ? filed[filed.length - 1]! : undefined;
      if (rerun === undefined) fail("5", "lead never filed the task again after the pick");
      else if (rerun.status !== `done in ${fixture.project.id}`) fail("5", `the task filed again ended "${rerun.status}", not "done in ${fixture.project.id}"`);
      if (rerun?.status === `done in ${fixture.project.id}`) {
        // The run, opened on its card: it went through Claude Code.
        const rerunCard = tasks.last();
        await rerunCard.getByRole("button", { name: new RegExp(`^Task for ${coder}: `) }).click();
        const runList = rerunCard.getByRole("list", { name: /^Run of / });
        let runText: string | null = "";
        // The run's steps are read once the card opens; give them time to arrive.
        for (const until = Date.now() + 30_000; Date.now() < until && !/Claude Code/.test(runText ?? ""); await sleep(500)) {
          runText = (await runList.count()) > 0 ? await runList.textContent() : "";
        }
        if (!/Claude Code/.test(runText ?? "")) fail("5", `the run's steps don't show it ran on Claude Code: "${(runText ?? "").slice(0, 200)}"`);

        const result = await readUntil(page, (es) => es.some((e) => e.kind === "result" && e.label === `From ${coder}`), 60_000);
        // The refused task's ending lands from coder too, before the pick; the run's is the last one.
        const resultAt = result.entries.map((e) => e.kind === "result" && e.label === `From ${coder}`).lastIndexOf(true);
        if (resultAt < 0) fail("5", `the result never landed in lead's conversation as a line from ${coder}`);
        else if (resultAt < userAt(result.entries, PICKED_LINE)) fail("5", `no result from ${coder} after your pick`);
        else if (/task failed/.test(result.entries[resultAt]!.text)) fail("5", `${coder}'s last result is a failure: "${result.entries[resultAt]!.text}"`);
      }

      // The disk: the checkout untouched, one worktree of it with one commit that fixes the first line only.
      const after = diskOf(checkout);
      if (after.head !== before.head || after.status !== before.status) fail("5", "the checkout itself changed (HEAD or working tree)");
      const worktrees = tell_.over(
        "5 · worktrees of the checkout other than itself",
        after.worktrees
          .split("\n\n")
          .map((block) => ({ path: /^worktree (.+)$/m.exec(block)?.[1], head: /^HEAD (.+)$/m.exec(block)?.[1] }))
          .filter((w): w is { path: string; head: string } => w.path !== undefined && w.head !== undefined && w.path !== checkout),
        { emptyIs: "no run worked in the checkout, which a control produces" },
      );
      const changed = worktrees.filter((w) => w.head !== before.head);
      if (changed.length !== 1) {
        fail("5", `${changed.length} worktree(s) of the checkout carry a commit; want exactly one`);
      } else {
        const [run] = changed;
        const files = git(checkout, "diff", "--name-only", before.head, run!.head).split("\n").filter(Boolean);
        if (files.join(",") !== "README.md") fail("5", `the run changed ${files.join(", ") || "nothing"}, not README.md alone`);
        const readme = git(checkout, "show", `${run!.head}:README.md`).split("\n");
        if (!readme[0]!.includes(typo.right) || readme[0]!.includes(typo.wrong)) fail("5", `the README's first line is still wrong: "${readme[0]}"`);
        // `git` here trims the output, so the README's last newline is gone.
        if (readme.slice(1).join("\n") !== fixture.rest.trimEnd()) fail("5", "the run changed more of the README than its first line");
        if (!run!.path.startsWith(runsRoot)) fail("5", `the run's worktree ${run!.path} is not under the lab's runs folder`);
        evidence.push(`5: refused until picked, then Claude Code fixed "${typo.wrong}" in ${run!.path}, README.md only, checkout untouched`);
      }
    }
    if (patches.length > 0) assertPatched(patches, REPO_ROOT, mark);
  } finally {
    await browser.close();
    stopProcessGroup(server);
  }

  // A control must redden each step it names, and only those.
  if (control !== undefined) {
    const steps = new Set(failures.map((f) => /^\[([^\]]+)\]/.exec(f)?.[1] ?? ""));
    for (const step of control.steps) {
      if (!steps.has(step)) failures.push(`[control] GOAL_CONTROL=${CONTROL} left step ${step} green, so that step cannot fail`);
    }
    for (const step of steps) {
      if (!control.steps.includes(step) && step !== "control") failures.push(`[control] GOAL_CONTROL=${CONTROL} also reddened step ${step}`);
    }
  }
  return { failures, evidence: evidence.join("; ") };
});
