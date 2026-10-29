/**
 * Goal check: in the Teammates lab, you talk to lead, lead messages
 * researcher, researcher's reply reaches lead while you are still talking to
 * it, and a coding task lead starts runs through Claude Code, in the
 * background, in the lab's working folder. See goal.md for the contract.
 *
 * Real path, real model, out of CI. The lab's pages are built here and served
 * by `fsdev dev --app` over a fresh SQLite store, with a scratch git checkout
 * made here as its working folder (`TEAMMATES_WORKDIR`). One headless browser drives the
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
 *   4  you give lead a codename, then 60 more lines, past the 50-turn window;
 *      lead answers the codename and the launch date without asking anyone,
 *      and the divider, labelled summarized, sits after both the codename
 *      line and researcher's reply.
 *   5  you ask for a fix; lead starts a coding task with no question and no
 *      project anywhere on the screen, the run goes through
 *      Claude Code, a worktree of the checkout gets one commit that changes the
 *      README's first line and nothing else, the checkout itself is untouched,
 *      and the result lands in lead's conversation as the coding task's.
 *
 * Inputs are held out: the launch date is drawn at random and written into the
 * working folder's README, where researcher reads it, the codename is drawn at random, and the
 * README's typo is one of several.
 *
 * Run:      pnpm tsx goals/teammates-lab/a-worker-talks-to-another-while-you-talk/run.mts
 * Controls: GOAL_CONTROL=no-model | no-lead-send | no-reply-tool | no-summary | no-memory (see goal.md)
 */
import { spawn, execFileSync, type ChildProcess } from "node:child_process";
import { writeFileSync, mkdirSync } from "node:fs";
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
  type Tell,
} from "../../lib/index.mts";
import { launchChromium } from "../../lib/playwright.mts";

interface Fixture {
  port: number;
  lead: string;
  researcher: string;
  ask: string;
  second: string;
  fix: string;
  /** Step 4's first line; `{code}` is the codename drawn for the run. */
  remember: string;
  recall: string;
  codename: { colours: string[]; animals: string[]; numbers: number[] };
  fillers: string[];
  /** How many lines step 4 sends between the codename and the question: past the 50-turn window. */
  pastWindow: number;
  typos: { readme: string; wrong: string; right: string }[];
  rest: string;
  answerWithinMs: number;
  replyWithinMs: number;
  runWithinMs: number;
}

const fixture = loadFixture<Fixture>(import.meta.url);
const LAB = repoPath("labs", "teammates");
const CONTROL = process.env.GOAL_CONTROL ?? "";
const MODEL = process.env.GOAL_MODEL ?? DEFAULT_MODEL;

/** Drop one worker's `sendMessage`: the capability lists no tool on that worker's turns. */
const dropSendFor = (worker: string): ModulePatch => ({
  module: "packages/workforce/src/messages/message-tool.ts",
  from: String.raw`if \(typeof self !== "string"\) return \[\];`,
  to: `if (typeof self !== "string" || self === ${JSON.stringify(worker)}) return [];`,
});

/** A scratch patch to the lab's host, where lead's flow is put together. */
const hostPatch = (from: string): ModulePatch => ({ module: "labs/teammates/host.mts", from, to: "" });
/** The history summary out of lead's flow: its capability and its fold. */
const NO_SUMMARY = [hostPatch(String.raw`,\s*earlier\.capability`), hostPatch(String.raw`beforeAnswer: earlier\.fold,`)];

/**
 * Each control: what it changes, the steps it must redden, and any step it may
 * redden besides, with the reason in a comment. Any other red step is a leak.
 * `skip` is step 4 under a control about another step: its 60 turns test
 * nothing there.
 */
const CONTROLS: Record<string, { patches?: ModulePatch[]; model?: string; steps: string[]; mayAlso?: string[]; skip?: string[] }> = {
  // No model answers: lead's conversation holds only your own lines.
  "no-model": { model: "openai/no-such-model-goal-control", steps: ["1", "2", "3", "5"], skip: ["4"] },
  // lead can't message: no card, no line in researcher's conversation, no row, and so no reply.
  // Step 5 may go red too: with no way to message, lead files its research ask as a task instead
  // (seen in 2 of 2 runs before the lab dropped projects). That is the model, not a leak.
  "no-lead-send": { patches: [dropSendFor(fixture.lead)], steps: ["2", "3"], mayAlso: ["5"], skip: ["4"] },
  // researcher hears lead but can't answer it.
  "no-reply-tool": { patches: [dropSendFor(fixture.researcher)], steps: ["3"], skip: ["4"] },
  // Step 3 may go red under both of these: researcher sometimes answers lead in its own conversation
  // instead of with `sendMessage`, so no reply lands (2 of 3 runs on 2026-10-28). Neither patch
  // touches messaging; that is the model, not a leak.
  // No history summary: memory may still answer, but the divider can't say the earlier turns were summarized.
  "no-summary": { patches: NO_SUMMARY, steps: ["4"], mayAlso: ["3"] },
  // Neither memory nor the summary: nothing holds what left the window, so lead can't answer it.
  "no-memory": {
    patches: [
      ...NO_SUMMARY,
      hostPatch(String.raw`mem\.capability\.presets\(\{[^)]*\}\)`),
      hostPatch(String.raw`afterAnswer: mem\.captureFromItems,`),
    ],
    steps: ["4"],
    mayAlso: ["3"],
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

/** The README after its first line: the fixture's, with the held-out launch date. */
const restWith = (date: string) => `${fixture.rest}\nThe launch date is ${date}.\n`;

/** A scratch git checkout whose README's first line has a typo; `.fsdev/` ignored, as a run needs. */
function scratchCheckout(dir: string, typo: Fixture["typos"][number], rest: string): string {
  const checkout = join(dir, "relay");
  mkdirSync(checkout, { recursive: true });
  writeFileSync(join(checkout, "README.md"), `${typo.readme}\n${rest}`);
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
  /** The divider's reading: "false" for an entry above it, out of lead's word-for-word view. */
  inWindow?: string;
}

/** The open conversation's entries in order, as drawn. */
async function entriesOf(page: Page): Promise<Drawn[]> {
  return await conversation(page)
    .locator("[data-entry]")
    .evaluateAll((els) =>
      els.map((el) => ({
        kind: (el as HTMLElement).dataset.entry ?? "",
        label: el.getAttribute("aria-label") ?? el.querySelector("[aria-label]")?.getAttribute("aria-label") ?? "",
        // As shown: block breaks between the label and a Markdown body, and the label in its uppercase style.
        text: (el as HTMLElement).innerText,
        status: el.querySelector("[data-task-status]")?.textContent ?? undefined,
        inWindow: el.closest("[data-in-window]")?.getAttribute("data-in-window") ?? undefined,
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
const lastUserAt = (entries: Drawn[], text: string) => entries.map((e) => e.kind === "user" && e.text.includes(text)).lastIndexOf(true);
const short = (id: string) => (id === fixture.lead ? "Chief of Staff" : id.replace(/^teammates\./, ""));

/** Say `text` to lead and wait until lead has answered it and finished the turn; false when it didn't in time. */
async function turnWith(page: Page, lead: string, text: string): Promise<boolean> {
  const said = (es: Drawn[]) => es.filter((e) => e.kind === "user" && e.text.includes(text)).length;
  const before = said(await entriesOf(page));
  await tell(page, lead, text);
  // The line is drawn once its turn starts; only an answer after this copy of it counts.
  const answered = await readUntil(
    page,
    (es) => said(es) > before && es.slice(lastUserAt(es, text) + 1).some((e) => e.kind === "assistant" && e.text.trim() !== ""),
    fixture.answerWithinMs,
  );
  if (!answered.ok) return false;
  // Memory records the turn after the answer, in the same request: the next line waits for it.
  const busy = conversation(page).getByRole("status").filter({ hasText: "is answering" });
  for (const until = Date.now() + fixture.answerWithinMs; Date.now() < until && (await busy.count()) > 0; ) await sleep(250);
  if ((await busy.count()) > 0) return false;
  // "is answering" clears when the request ends, which can be before the streamed answer's last words are drawn.
  const shown = async () => (await entriesOf(page)).map((e) => e.text).join("\n");
  for (let was = await shown(), until = Date.now() + 10_000; Date.now() < until; ) {
    await sleep(1_000);
    const now = await shown();
    if (now === was) break;
    was = now;
  }
  return true;
}

/**
 * Step 4: a codename, then more lines than the window holds, then the codename
 * and the launch date asked back. Both left the window long before the
 * question, so lead answers them from what it kept, and the divider says where
 * its word-for-word reading begins.
 */
async function stepFour(
  page: Page,
  log: () => Promise<{ from: string; to: string }[]>,
  date: ReturnType<typeof launchDate>,
  fail: (step: string, line: string) => void,
  evidence: string[],
  tell_: Tell,
): Promise<void> {
  const lead = short(fixture.lead);
  const researcher = short(fixture.researcher);
  const code = { colour: pick(fixture.codename.colours), animal: pick(fixture.codename.animals), number: pick(fixture.codename.numbers) };
  const codename = `${code.colour} ${code.animal} ${code.number}`;
  const remember = fixture.remember.replace("{code}", codename);
  const fillers = [...fixture.fillers].sort(() => Math.random() - 0.5);
  console.error(`goal: step 4 codename "${codename}", then ${fixture.pastWindow} lines`);
  for (const [i, line] of [remember, ...Array.from({ length: fixture.pastWindow }, (_, n) => fillers[n % fillers.length]!)].entries()) {
    if (!(await turnWith(page, lead, line))) {
      fail("4", `lead didn't finish answering line ${i + 1} of step 4 within ${fixture.answerWithinMs / 1000}s: "${line}"`);
      return;
    }
  }

  // A standing rule is in lead's view on every turn, so a codename kept as one never left it.
  const afterRemember = await entriesOf(page);
  if (afterRemember.slice(userAt(afterRemember, remember) + 1).some((e) => /Rule added/.test(e.text) && e.text.includes(code.animal))) {
    fail("4", "lead kept the codename as a standing rule, so it never left lead's view and the step tests nothing");
  }

  // Asked back, from what lead kept: a fresh message to researcher would answer the date without it.
  const asked = (await log()).filter((r) => r.from === fixture.lead && r.to === fixture.researcher).length;
  const card = conversation(page).getByRole("button", { name: new RegExp(`^To ${researcher}: `) });
  const cards = await card.count();
  if (!(await turnWith(page, lead, fixture.recall))) {
    fail("4", `lead didn't answer the question within ${fixture.answerWithinMs / 1000}s`);
    return;
  }
  const drawn = tell_.over("4 · entries drawn in lead's conversation", await entriesOf(page));
  const answer = drawn.slice(lastUserAt(drawn, fixture.recall) + 1).find((e) => e.kind === "assistant")?.text ?? "";
  const missing = [code.colour, code.animal, String(code.number)].filter((word) => !answer.toLowerCase().includes(word));
  if (missing.length > 0) fail("4", `lead's answer lacks ${missing.join(", ")} of the codename "${codename}": "${answer.slice(0, 300)}"`);
  if (!date.isIn(answer)) fail("4", `lead's answer doesn't state the launch date ${date.text}: "${answer.slice(0, 300)}"`);
  if ((await card.count()) > cards || (await log()).filter((r) => r.from === fixture.lead && r.to === fixture.researcher).length > asked) {
    fail("4", "lead messaged researcher again to answer the question");
  }

  // The divider: labelled summarized, with the codename line and researcher's reply above it.
  const divider = conversation(page).getByRole("separator");
  const shown = await divider.first().waitFor({ timeout: 15_000 }).then(() => true, () => false);
  const label = shown ? await divider.first().getAttribute("aria-label") : null;
  if (!shown) fail("4", "no divider in lead's conversation");
  else if (label !== "Earlier turns summarized") fail("4", `the divider reads "${label}", not "Earlier turns summarized"`);
  const marked = await entriesOf(page);
  const codeLine = marked[userAt(marked, remember)];
  const reply = marked.find((e) => e.kind === "received" && e.label === `From ${researcher}`);
  if (codeLine?.inWindow !== "false") fail("4", "the codename line is not above the divider, so lead may have read it word for word");
  if (reply?.inWindow !== "false") fail("4", "researcher's reply is not above the divider, so lead may have read the date word for word");
  if (missing.length === 0 && date.isIn(answer) && label === "Earlier turns summarized") {
    evidence.push(`4: after ${fixture.pastWindow} more lines lead answered "${codename}" and ${date.text}; divider "${label}" below both`);
  }
}

// ---------------------------------------------------------------------------

await runGoal(async (failures, tell_) => {
  const evidence: string[] = [];
  const fail = (step: string, line: string) => failures.push(`[${step}] ${line}`);
  const dir = goalTmpDir("teammates-lab");
  const date = launchDate();
  const typo = pick(fixture.typos);
  const rest = restWith(date.text);
  const checkout = scratchCheckout(dir, typo, rest);
  // Where the lab puts runs: beside its store (`fsdev.config.mts`).
  const runsRoot = join(dir, "teammates-runs");
  const lead = short(fixture.lead);
  const researcher = short(fixture.researcher);

  // The pages, built from this checkout, never assumed.
  execFileSync("npx", ["vite", "build", "--logLevel", "error"], { cwd: LAB, stdio: "inherit" });

  const mark = join(dir, "patched.txt");
  const patches = control?.patches ?? [];
  if (patches.length > 0) console.error(`GOAL_CONTROL=${CONTROL} patches:\n${describePatches(patches, REPO_ROOT)}`);
  const env = intentFreeEnv(process.env, {
    TEAMMATES_MODEL: control?.model ?? MODEL,
    TEAMMATES_STORE: join(dir, "teammates.sqlite"),
    TEAMMATES_USER: "you",
    TEAMMATES_WORKDIR: checkout,
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
    // A panel just opened reads the log first: wait for it rather than count at once.
    const talked = await talk
      .getByRole("region", { name: `with ${researcher}` })
      .first()
      .waitFor({ timeout: 10_000 })
      .then(() => true, () => false);
    if (!talked) fail("2", `the Talk panel lists nothing under "with ${researcher}"`);
    const rows = tell_.over("2 · message log rows", await log(), { emptyIs: "no message sent, which a control produces" });
    const asked = rows.filter((r) => r.from === fixture.lead && r.to === fixture.researcher);
    if (!asked.some((r) => r.status === "delivered")) {
      fail("2", `no delivered row ${fixture.lead} → ${fixture.researcher} in the message log (${asked.map((r) => r.status).join(", ") || "none"})`);
    }
    await open(page, researcher);
    const heard = await conversation(page)
      .getByRole("region", { name: `From ${lead}` })
      .first()
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

    // ---- 4 · past the history window --------------------------------------------
    if (control?.skip?.includes("4")) evidence.push(`4: not run under GOAL_CONTROL=${CONTROL}`);
    else await stepFour(page, log, date, fail, evidence, tell_);

    // ---- 5 · lead starts a coding task for a fix, in the working folder ------
    const before = diskOf(checkout);
    await tell(page, lead, fixture.fix);
    const tasks = conversation(page).locator("[data-entry=task]");
    // Only the cards lead files from here on are this step's.
    const earlier = (await entriesOf(page)).filter((e) => e.kind === "task").length;
    const cardsNow = (es: Drawn[]) => es.filter((e) => e.kind === "task").slice(earlier);
    const fixAt = (es: Drawn[]) => userAt(es, fixture.fix);
    const ended = await readUntil(
      page,
      (es) => cardsNow(es).some((e) => e.status !== undefined && /^(done|failed)$/.test(e.status)),
      fixture.runWithinMs,
    );
    const filed = tell_.over("5 · task cards lead filed in this step", cardsNow(ended.entries), { emptyIs: "lead filed nothing, which a control produces" });
    const run = filed.find((e) => e.status !== undefined && /^(done|failed)$/.test(e.status));
    if (filed.length === 0) fail("5", `lead started no coding task within ${fixture.runWithinMs / 1000}s`);
    else if (run?.status !== "done") fail("5", `lead's task ended "${run?.status ?? filed[0]!.status}", not "done"`);
    // The lab has no projects (FIX-2335): the page never shows one, and no worker says the word.
    const said = (await page.locator("body").innerText()).match(/[^\n]*\bprojects?\b[^\n]*/i);
    if (said !== null) fail("5", `the page mentions a project: "${said[0].slice(0, 200)}"`);
    if (run?.status === "done") {
      // The run, opened on its card: it went through Claude Code.
      const runCard = tasks.nth(earlier + filed.indexOf(run));
      await runCard.getByRole("button", { name: /^Coding task: / }).click();
      const runList = runCard.getByRole("list", { name: /^Run of / });
      let runText: string | null = "";
      // The run's steps are read once the card opens; give them time to arrive.
      for (const until = Date.now() + 30_000; Date.now() < until && !/Claude Code/.test(runText ?? ""); await sleep(500)) {
        runText = (await runList.count()) > 0 ? await runList.textContent() : "";
      }
      if (!/Claude Code/.test(runText ?? "")) fail("5", `the run's steps don't show it ran on Claude Code: "${(runText ?? "").slice(0, 200)}"`);

      const result = await readUntil(page, (es) => es.some((e, i) => i > fixAt(es) && e.kind === "result" && e.label === "From the coding task"), 60_000);
      const resultAt = result.entries.map((e) => e.kind === "result" && e.label === "From the coding task").lastIndexOf(true);
      if (resultAt < 0 || resultAt < fixAt(result.entries)) fail("5", "the result never landed in lead's conversation as the coding task's");
      else if (/task failed/i.test(result.entries[resultAt]!.text)) fail("5", `the coding task's last result is a failure: "${result.entries[resultAt]!.text}"`);
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
      const [worktree] = changed;
      const files = git(checkout, "diff", "--name-only", before.head, worktree!.head).split("\n").filter(Boolean);
      if (files.join(",") !== "README.md") fail("5", `the run changed ${files.join(", ") || "nothing"}, not README.md alone`);
      const readme = git(checkout, "show", `${worktree!.head}:README.md`).split("\n");
      if (!readme[0]!.includes(typo.right) || readme[0]!.includes(typo.wrong)) fail("5", `the README's first line is still wrong: "${readme[0]}"`);
      // `git` here trims the output, so the README's last newline is gone.
      if (readme.slice(1).join("\n") !== rest.trimEnd()) fail("5", "the run changed more of the README than its first line");
      if (!worktree!.path.startsWith(runsRoot)) fail("5", `the run's worktree ${worktree!.path} is not under the lab's runs folder`);
      evidence.push(`5: started with no question and no project; Claude Code fixed "${typo.wrong}" in ${worktree!.path}, README.md only, checkout untouched`);
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
      if (!control.steps.includes(step) && !(control.mayAlso ?? []).includes(step) && step !== "control") failures.push(`[control] GOAL_CONTROL=${CONTROL} also reddened step ${step}`);
    }
  }
  return { failures, evidence: evidence.join("; ") };
});
