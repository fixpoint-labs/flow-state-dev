/**
 * Goal check: a person who asks the desk clerk something from the kitchen-sink
 * page gets an answer a model wrote, or sees their note filed onto the board
 * that fits it, and never gets their own words back.
 *
 * Real path, scripted model, out of CI. See goal.md for the contract.
 *
 * Two legs, in one real browser against the app's PRODUCTION build (built
 * here, never assumed), on its scripted model, keyless:
 *
 *   answer  start a conversation on the clerk seat, send a note carrying a
 *           fresh token; reload; the note is the person's turn and the reply
 *           under it carries the answer marker, under the seat's desk, and not
 *           the token.
 *   file    send a note the script files; reload; a row carrying the token is
 *           on the board in the team panel, and the reply carries the filed
 *           marker.
 *
 * Everything graded is read after a reload, so only what the server kept can
 * pass.
 *
 * Run:      PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers pnpm tsx goals/kitchen-sink-talk/answers-a-clerk-note-or-files-it/run.mts
 * Control:  GOAL_CONTROL=echo  (the clerk's answer before this goal: must FAIL both legs)
 * Held-out: GOAL_SEAT=<another desk-clerk seat> GOAL_DESK=<its desk> GOAL_BOARD=followups
 */
import { spawn, execFileSync, type ChildProcess } from "node:child_process";
import { randomUUID } from "node:crypto";
import type { Page } from "playwright";
import { KITCHEN_SINK, REPO_ROOT, intentFreeEnv, loadFixture, runGoal } from "../../lib/index.mts";
import { launchChromium } from "../../lib/playwright.mts";

interface Fixture {
  port: number;
  seat: { kind: string; id: string; desk: string };
  answer: { marker: string; replyMarker: string };
  file: { marker: string; replyMarker: string; channel: string; board: string };
}

const fixture = loadFixture<Fixture>(import.meta.url);
const ORIGIN = `http://127.0.0.1:${fixture.port}`;
const SEAT = process.env.GOAL_SEAT ?? fixture.seat.id;
const DESK = process.env.GOAL_DESK ?? fixture.seat.desk;
const BOARD = process.env.GOAL_BOARD ?? fixture.file.board;
const CONTROL = process.env.GOAL_CONTROL ?? "";

/** The legs each control must redden. */
const EXPECTED: Record<string, string[]> = { echo: ["answer", "file"] };
if (CONTROL !== "" && EXPECTED[CONTROL] === undefined) {
  throw new Error(`unknown GOAL_CONTROL "${CONTROL}"; known: ${Object.keys(EXPECTED).join(", ")}`);
}

// ---------------------------------------------------------------------------
// The built app
// ---------------------------------------------------------------------------

async function flowIndexStatus(): Promise<number | undefined> {
  try {
    return (await fetch(`${ORIGIN}/api/flows`)).status;
  } catch {
    return undefined;
  }
}

let server: ChildProcess | undefined;
let serverLog = "";

/**
 * The production server, on the scripted model and the in-memory store, with
 * no model key. The control, when set, reaches the server through the same
 * environment: the app honours it only in test mode.
 */
async function startServer(): Promise<void> {
  if ((await flowIndexStatus()) !== undefined) {
    throw new Error(`something is already answering on ${ORIGIN}; stop it first, or this check would grade it`);
  }
  server = spawn("pnpm", ["exec", "next", "start", "--port", String(fixture.port)], {
    cwd: KITCHEN_SINK,
    env: intentFreeEnv(process.env, {
      KITCHEN_SINK_TEST_MODE: "1",
      STORE_TYPE: "memory",
      AI_GATEWAY_API_KEY: "",
    }),
    stdio: ["ignore", "pipe", "pipe"],
    detached: true,
  });
  server.stdout?.on("data", (chunk: Buffer) => (serverLog += chunk.toString()));
  server.stderr?.on("data", (chunk: Buffer) => (serverLog += chunk.toString()));
  for (let i = 0; i < 180; i += 1) {
    if ((await flowIndexStatus()) === 200) return;
    if (server.exitCode !== null) throw new Error(`the app exited (${server.exitCode}) before serving:\n${serverLog}`);
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`the built app never served ${ORIGIN}/api/flows:\n${serverLog}`);
}

function stopServer(): void {
  if (server?.pid !== undefined) {
    try {
      process.kill(-server.pid, "SIGTERM");
    } catch {
      // already gone
    }
  }
  server = undefined;
}

// ---------------------------------------------------------------------------
// The page, as a person uses it
// ---------------------------------------------------------------------------

const rail = (page: Page) => page.getByTestId("rail");
const row = (page: Page, name: string) => rail(page).getByRole("button", { name, exact: true });
const panel = (page: Page) => page.locator('[data-testid="picked-session"]:visible');

async function openShell(page: Page): Promise<void> {
  await page.goto(`${ORIGIN}/`);
  await page.locator('[data-testid="message-input"]:visible').waitFor({ state: "visible", timeout: 30_000 });
}

async function open(page: Page, name: string): Promise<void> {
  const button = row(page, name);
  await button.waitFor({ timeout: 15_000 });
  if ((await button.getAttribute("aria-expanded")) !== "true") await button.click();
}

/** Poll `read` until `done` holds, or the time is up; return the last reading either way. */
async function readUntil<T>(read: () => Promise<T>, done: (value: T) => boolean, ms = 15_000): Promise<T> {
  let value = await read();
  for (let waited = 0; !done(value) && waited < ms; waited += 250) {
    await new Promise((resolve) => setTimeout(resolve, 250));
    value = await read();
  }
  return value;
}

/** The seat's conversation as drawn: each message's role and text, in order. */
const conversation = (page: Page) =>
  panel(page)
    .locator("[data-message-role]")
    .evaluateAll((messages) =>
      messages.map((message) => ({
        role: message.getAttribute("data-message-role") ?? "",
        text: message.textContent ?? "",
      })),
    );

/** Open a new conversation on the seat, send `note`, and wait for a reply. Returns the conversation id. */
async function sendNote(page: Page, note: string): Promise<string | null> {
  await openShell(page);
  await open(page, fixture.seat.kind);
  await open(page, SEAT);
  await rail(page)
    .locator(`[data-instance-id="${SEAT}"]`)
    .locator("xpath=..")
    .getByRole("button", { name: "New conversation" })
    .click();
  await panel(page).waitFor({ timeout: 15_000 });
  const sessionId = await rail(page)
    .locator(`ul[data-leaf="${SEAT}"] [aria-current="true"]`)
    .getAttribute("data-session-id");
  await panel(page).getByLabel("Message this seat").fill(note);
  await panel(page).getByRole("button", { name: "Send" }).click();
  // Let the reply land before the reload; nothing here is graded.
  await readUntil(() => conversation(page), (ms) => ms.some((m) => m.role === "assistant"));
  return sessionId;
}

/** Reload, reopen the conversation, and read it as drawn. */
async function reopen(page: Page, sessionId: string, until: (ms: Array<{ role: string; text: string }>) => boolean) {
  await page.reload();
  await openShell(page);
  await open(page, fixture.seat.kind);
  await open(page, SEAT);
  await rail(page).locator(`[data-session-id="${sessionId}"]`).click();
  return await readUntil(() => conversation(page), until);
}

/** The rows the team panel draws on one board: each row's text. */
const boardRows = (page: Page, board: string) =>
  page
    .getByTestId(`board-${fixture.file.channel}.${board}`)
    .locator("li[data-task-id]")
    .evaluateAll((rows) => rows.map((row) => row.textContent ?? ""));

// ---------------------------------------------------------------------------

await runGoal(async () => {
  const failures: string[] = [];
  const evidence: string[] = [];
  const fail = (leg: string, line: string) => failures.push(`[${leg}] ${line}`);
  const run = randomUUID().replace(/-/g, "").slice(0, 10);
  const tag = `[${DESK} desk]`;

  // The packages the app imports, then the app itself, so the check grades
  // this checkout and not a `.next` or a `dist` an earlier branch left behind.
  execFileSync("pnpm", ["exec", "turbo", "run", "build", "--filter=@flow-state-dev/kitchen-sink^..."], {
    cwd: REPO_ROOT,
    stdio: "inherit",
  });
  execFileSync("pnpm", ["build"], {
    cwd: KITCHEN_SINK,
    stdio: "inherit",
    env: { ...process.env, NEXT_PUBLIC_KITCHEN_SINK_TEST_MODE: "1" },
  });

  const browser = await launchChromium();
  try {
    await startServer();
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });

    // ---- answer: a note, a reload, a reply a model wrote -------------------
    const answerToken = `clerk-token-a${run}`;
    const answerNote = `${fixture.answer.marker} ${answerToken} where is my refund?`;
    const answerSession = await sendNote(page, answerNote);
    if (answerSession === null) {
      fail("answer", `"New conversation" on ${SEAT} opened no conversation in the rail`);
    } else {
      const messages = await reopen(
        page,
        answerSession,
        (ms) => ms.some((m) => m.role === "user" && m.text.includes(answerToken)) && ms.some((m) => m.role === "assistant"),
      );
      const asked = messages.findIndex((m) => m.role === "user" && m.text.includes(answerToken));
      const replies = messages.filter((m) => m.role === "assistant");
      const answered = messages.findIndex((m) => m.role === "assistant" && m.text.includes(fixture.answer.replyMarker));
      if (asked === -1) {
        fail("answer", `after the reload, ${SEAT}'s conversation does not hold the note as the person's turn (roles on screen: ${messages.map((m) => m.role).join(", ") || "none"})`);
      }
      if (answered === -1) {
        fail("answer", `after the reload, no reply carries ${fixture.answer.replyMarker}; replies on screen: ${JSON.stringify(replies.map((m) => m.text))}`);
      } else {
        const reply = messages[answered]!.text;
        if (!reply.startsWith(tag)) fail("answer", `the reply ${JSON.stringify(reply)} does not start with the seat's desk tag ${tag}`);
        if (asked !== -1 && answered < asked) fail("answer", `the reply sits above the note it answers`);
      }
      const echoed = replies.filter((m) => m.text.includes(answerToken));
      if (echoed.length > 0) fail("answer", `a reply hands the note back: ${JSON.stringify(echoed[0]!.text)}`);
      if (asked !== -1 && answered > asked && echoed.length === 0 && messages[answered]!.text.startsWith(tag)) {
        evidence.push(`answer: after a reload, ${SEAT}'s conversation ${answerSession} keeps the note as the person's turn and ${JSON.stringify(messages[answered]!.text)} under it`);
      }
    }

    // ---- file: a note the script files, a reload, the row on the panel -----
    const fileToken = `clerk-token-f${run}`;
    const boardMarker = BOARD === fixture.file.board ? "" : ` [board:${BOARD}]`;
    const fileNote = `${fixture.file.marker}${boardMarker} ${fileToken} the charger caught fire`;
    const fileSession = await sendNote(page, fileNote);
    // The row is written by the channel's own request, a moment after the
    // dispatch. Let it land before the reload; nothing here is graded.
    await readUntil(
      async () =>
        (await page.request.get(`${ORIGIN}/api/flows/sessions/${fixture.file.channel}/resources/${fixture.file.channel}.${BOARD}`)).text(),
      (body) => body.includes(fileToken),
      10_000,
    );
    if (fileSession === null) {
      fail("file", `"New conversation" on ${SEAT} opened no conversation in the rail`);
    } else {
      const messages = await reopen(page, fileSession, (ms) => ms.some((m) => m.role === "assistant"));
      const filed = messages.find((m) => m.role === "assistant" && m.text.includes(fixture.file.replyMarker));
      if (filed === undefined) {
        fail("file", `after the reload, no reply carries ${fixture.file.replyMarker}; replies on screen: ${JSON.stringify(messages.filter((m) => m.role === "assistant").map((m) => m.text))}`);
      }
      const rows = await readUntil(() => boardRows(page, BOARD), (rs) => rs.some((r) => r.includes(fileToken)), 10_000);
      const mine = rows.filter((r) => r.includes(fileToken));
      if (mine.length !== 1) {
        fail("file", `after the reload, the team panel's ${BOARD} board holds ${mine.length} rows carrying ${fileToken} (want 1); it shows ${rows.length} rows`);
      } else if (filed !== undefined) {
        evidence.push(`file: after a reload, the team panel's ${BOARD} board shows ${JSON.stringify(mine[0])} and the reply reads ${JSON.stringify(filed.text)}`);
      }
    }
  } finally {
    await browser.close();
    stopServer();
  }

  // The boot still warns that escalations is unattended: filing is not draining.
  if (!serverLog.includes('board "escalations"')) {
    fail("warning", `the boot no longer warns that escalations is unattended`);
  } else {
    evidence.push(`the boot still warns that escalations is unattended`);
  }

  // A control must redden each leg it names, and only those.
  if (CONTROL !== "") {
    const want = EXPECTED[CONTROL]!;
    const legs = new Set(failures.map((f) => /^\[(\w+)\]/.exec(f)?.[1]));
    for (const leg of want) {
      if (!legs.has(leg)) failures.push(`[control] GOAL_CONTROL=${CONTROL} left the ${leg} leg green, so that leg cannot fail`);
    }
    for (const leg of legs) {
      if (!want.includes(leg ?? "") && leg !== "control") failures.push(`[control] GOAL_CONTROL=${CONTROL} also reddened the ${leg} leg`);
    }
  }
  return { failures, evidence: evidence.join("; ") };
});
