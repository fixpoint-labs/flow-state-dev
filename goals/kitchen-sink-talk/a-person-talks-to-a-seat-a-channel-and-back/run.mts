/**
 * Closure goal check for the epic FIX-1592 (FIX-1601): a person asks the
 * support channel a question and, without reloading, sees the one specialist
 * whose purpose fits start work and then answer; each specialist keeps only
 * its own cases; a direct conversation remembers its own turns and stays out
 * of the channel; a case that needs a person is filed.
 *
 * Real path, scripted model, keyless, out of CI. See goal.md for the contract.
 *
 * One real browser against kitchen-sink's PRODUCTION build (built here, once,
 * never assumed). Each leg reads the OPEN page first and reloads only at its
 * end, then reads again. Everything graded is read off the page, by this run's
 * tokens:
 *
 *   a    `[route:<devices>]`, a text answer that never calls the post tool,
 *        token A: `<devices> is working`, then one line by it under the post
 *        within 15 s, and the row clears. Nobody else works or answers.
 *   b    three posts, each after the previous answer: B1 to devices, B2 to
 *        accounts, B3 unmarked for the fallback, each answered through the post
 *        tool: one line each, by the right seat; nobody else works. Each seat's
 *        conversation in the channel holds only its own posts.
 *   c1   "New conversation" on devices, token C1: the person's turn, a reply
 *        under it.
 *   c2   there, the recall scenario, token C2: the person's turn, and a reply
 *        naming C1 and no token from a or b. The channel shows none of it.
 *   seg  (part 4) devices' conversation in the channel holds nothing of C1.
 *   e    (part 2) a needs-a-person post, token E: the specialist's line says
 *        it filed (`e:line`); the team panel's escalations list shows one
 *        row carrying E on the open page (`e:row-open`) and after the reload
 *        (`e:row`); the boot still warns that nothing drains escalations
 *        (`e:warning`).
 *
 * With no GOAL_CONTROL the run takes the plain journey, then each control on a
 * fresh server and a fresh browser context, all on the one build. Each control
 * must redden the legs its row names and leave the ones it lists green.
 *
 * Run:      PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers pnpm tsx goals/kitchen-sink-talk/a-person-talks-to-a-seat-a-channel-and-back/run.mts
 * One:      GOAL_CONTROL=<name> on the same command runs that control alone
 * Main:     GOAL_CONTROL=main, from a checkout of today's `main` with this directory copied in
 * Smoke:    GOAL_LIVE=1 with AI_GATEWAY_API_KEY: the real-model smoke, out of test mode
 */
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import type { Browser, Page } from "playwright";
import { loadFixture, runGoal } from "../../lib/index.mts";
import {
  buildKitchenSink,
  conversation,
  newConversation,
  open,
  panel,
  rail,
  readUntil,
  row,
  startKitchenSink,
  type KitchenSinkServer,
} from "../../lib/kitchen-sink.mts";
import { launchChromium } from "../../lib/playwright.mts";

type Role = "devices" | "accounts" | "fsd" | "general";

interface Seat {
  kind: string;
  id: string;
}

interface SmokePost {
  text: string;
  /** The specialist whose purpose the post names. */
  want?: Role;
  /** For a follow-up: the index of the post it leans on. */
  followUpOf?: number;
  /** Words any one of which the follow-up's answer names its subject by. */
  subject?: string[];
}

interface Fixture {
  port: number;
  /** How the page labels the person's own lines. */
  person: string;
  channel: Seat & { board: string };
  seats: Record<Role, Seat>;
  /** The channel's `routing: fallback:`, as a role. */
  fallback: Role;
  /** Who part 2's case is routed to. */
  escalatesTo: Role;
  markers: {
    /** `{seat}` is replaced by the seat's id. */
    route: string;
    textAnswer: string;
    textReply: string;
    toolAnswer: string;
    toolReply: string;
    talk: string;
    talkReply: string;
    recall: string;
    recallReply: string;
    needsAPerson: string;
    filedReply: string;
  };
  lineWithinMs: number;
  providerKeys: string[];
  smoke: { withinMs: number; posts: SmokePost[] };
}

const CONTROL = process.env.GOAL_CONTROL ?? "";
const LIVE = process.env.GOAL_LIVE === "1";
// Names are inputs: today's `main` runs on its own roster.
const fixture = loadFixture<Fixture>(import.meta.url, CONTROL === "main" ? "today-main.json" : "input.json");
const M = fixture.markers;
const SEATS = fixture.seats;
const ROLES = Object.keys(SEATS) as Role[];
const CHANNEL = fixture.channel.id;

/** A post's route marker for one specialist. */
const route = (role: Role) => M.route.replace("{seat}", SEATS[role].id);

/**
 * The controls, as PLAN → Controls has them: the legs each must redden, and
 * the legs each must leave green. A leg in neither list is reported, not
 * graded. `how` is where the control acts: the server (`GOAL_CONTROL` on
 * `next start`, honoured only in test mode), the page (`?goalControl=`), the
 * page's network (this run), or a separate checkout.
 */
const CONTROLS: Record<string, { how: "server" | "page" | "network" | "checkout"; fail: string[]; green: string[] }> = {
  main: { how: "checkout", fail: ["a", "b"], green: ["c1"] },
  "no-live": { how: "page", fail: ["a", "b"], green: ["c1", "c2"] },
  "no-landing": { how: "server", fail: ["a"], green: ["b", "c1", "c2"] },
  "no-route": { how: "server", fail: ["a", "b"], green: ["c1", "c2"] },
  "drop-user-message": { how: "network", fail: ["c1", "c2"], green: ["a", "b"] },
  "no-history": { how: "server", fail: ["c2"], green: ["a", "b", "c1"] },
  "no-filing": { how: "server", fail: ["e"], green: ["a", "b", "c1", "c2"] },
};
if (CONTROL !== "" && CONTROLS[CONTROL] === undefined) {
  throw new Error(`unknown GOAL_CONTROL "${CONTROL}"; known: ${Object.keys(CONTROLS).join(", ")}`);
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const secs = (from: number, to: number | undefined) => (to === undefined ? "never" : `+${((to - from) / 1000).toFixed(1)}s`);

// ---------------------------------------------------------------------------
// drop-user-message: FIX-1585's control, at the page's network, on leg c
// ---------------------------------------------------------------------------

/** Where the page keeps the sessions whose person turns it is served without. Survives the leg's reload. */
const DROP_KEY = "goal-drop-user-message";

/**
 * Runs in the page before its own scripts. Every read of a session named under
 * `DROP_KEY` reaches the page without its `user` message items: the snapshot,
 * the action streams that talk to it, and the live session stream, which
 * Playwright's routing cannot filter because it never ends. What the page sees
 * when the server keeps no person turn. Scoped to leg c's conversation: a
 * seat hears a channel post as a `user` turn too.
 *
 * Plain JavaScript in a string: a function handed to Playwright is compiled
 * by tsx first, which adds helpers the page does not have.
 */
const DROP_USER_MESSAGES = `(() => {
  const key = ${JSON.stringify(DROP_KEY)};
  const named = () => { try { return JSON.parse(sessionStorage.getItem(key) || "[]"); } catch { return []; } };
  const isUser = (item) => item != null && item.type === "message" && item.role === "user";
  const original = window.fetch.bind(window);
  window.fetch = async (input, init) => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url, location.href);
    const method = String((init && init.method) || (input instanceof Request ? input.method : "GET")).toUpperCase();
    const read = /^\\/api\\/flows\\/sessions\\/([^/]+)\\/(state|stream)$/.exec(url.pathname);
    const body = init && typeof init.body === "string" ? init.body : "";
    const where = url.pathname + " " + body;
    const applies = read !== null
      ? () => named().includes(decodeURIComponent(read[1]))
      : method === "POST" && /\\/actions\\/[^/]+$/.test(url.pathname)
        ? () => named().some((id) => where.includes(id))
        : undefined;
    const response = await original(input, init);
    if (applies === undefined) return response;
    const type = response.headers.get("content-type") || "";
    if (type.includes("application/json")) {
      if (!applies()) return response;
      const json = await response.json();
      if (json && Array.isArray(json.items)) json.items = json.items.filter((item) => !isUser(item));
      return new Response(JSON.stringify(json), { status: response.status, statusText: response.statusText, headers: response.headers });
    }
    if (!type.includes("text/event-stream") || response.body === null) return response;
    const dropped = new Set();
    const decoder = new TextDecoder();
    const encoder = new TextEncoder();
    let buffer = "";
    const keep = (frame) => {
      if (!applies()) return true;
      const data = frame.split("\\n").filter((line) => line.startsWith("data:")).map((line) => line.slice(5).trim()).join("\\n");
      if (data === "") return true;
      let parsed;
      try { parsed = JSON.parse(data); } catch { return true; }
      if (parsed && isUser(parsed.item)) {
        if (typeof parsed.item.id === "string") dropped.add(parsed.item.id);
        return false;
      }
      return !(parsed && typeof parsed.itemId === "string" && dropped.has(parsed.itemId));
    };
    const filtered = response.body.pipeThrough(new TransformStream({
      transform(chunk, controller) {
        buffer += decoder.decode(chunk, { stream: true });
        for (let at = buffer.indexOf("\\n\\n"); at !== -1; at = buffer.indexOf("\\n\\n")) {
          const frame = buffer.slice(0, at);
          buffer = buffer.slice(at + 2);
          if (keep(frame)) controller.enqueue(encoder.encode(frame + "\\n\\n"));
        }
      },
      flush(controller) { if (buffer !== "" && keep(buffer)) controller.enqueue(encoder.encode(buffer)); },
    }));
    return new Response(filtered, { status: response.status, statusText: response.statusText, headers: response.headers });
  };
})();`;

// ---------------------------------------------------------------------------
// The page, as a person uses it. One load per journey; a reload only at a leg's end.
// ---------------------------------------------------------------------------

/** Wait until the page can be used. */
const ready = (page: Page) =>
  page.locator('[data-testid="message-input"]:visible').waitFor({ state: "visible", timeout: 30_000 });

/** Reload, the one each leg makes at its end, and wait until the page can be used. */
async function reload(page: Page): Promise<void> {
  await page.reload();
  await ready(page);
}

/** Show the channel's panel, from the rail, without leaving the page. */
async function showChannel(page: Page): Promise<void> {
  await open(page, fixture.channel.kind);
  await row(page, CHANNEL).click();
  await panel(page).getByTestId("channel-transcript").waitFor({ timeout: 15_000 });
}

interface Line {
  label: string;
  body: string;
}

interface Reading {
  at: number;
  /** Each working row's text. */
  working: string[];
  lines: Line[];
}

/** The channel's panel as drawn: its working rows and every line. */
async function readChannel(page: Page): Promise<Reading> {
  const drawn = panel(page);
  const [working, lines] = await Promise.all([
    drawn.getByTestId("working-row").allTextContents(),
    drawn.getByTestId("channel-line").evaluateAll((els) =>
      els.map((el) => ({
        label: el.querySelector('[data-testid="channel-line-label"]')?.textContent ?? "",
        body: el.querySelector('[data-testid="channel-line-body"]')?.textContent ?? "",
      })),
    ),
  ]);
  return { at: Date.now(), working, lines };
}

/** The seat a working row names, or `undefined` for background work. */
function seatOf(workingRow: string): string | undefined {
  return /^(\S+) (?:is working|was working at the last check)$/.exec(workingRow.trim())?.[1];
}

const isPerson = (line: Line) => line.label === fixture.person;
/** The person's lines carrying `token`. */
const postsOf = (lines: Line[], token: string) => lines.filter((l) => isPerson(l) && l.body.includes(token));
/** Every other line carrying `token`. */
const repliesOf = (lines: Line[], token: string) => lines.filter((l) => !isPerson(l) && l.body.includes(token));

/** The lines after the person's line carrying `token`, up to the person's next line. */
function answersTo(lines: Line[], token: string): Line[] | undefined {
  const at = lines.findIndex((l) => isPerson(l) && l.body.includes(token));
  if (at === -1) return undefined;
  const rest = lines.slice(at + 1);
  const next = rest.findIndex(isPerson);
  return next === -1 ? rest : rest.slice(0, next);
}

/** Post a line from the channel's panel once its composer is free. Returns when Send was pressed. */
async function postLine(page: Page, text: string): Promise<number> {
  const box = panel(page).getByLabel("Post to this channel");
  await readUntil(async () => (await box.isEnabled()) && (await box.inputValue()) === "", (free) => free, 30_000);
  await box.fill(text);
  await panel(page).getByRole("button", { name: "Send" }).click();
  return Date.now();
}

interface Followed {
  readings: Reading[];
  /** The first reading that showed the answer. */
  lineAt?: number;
  /** The first reading after it with no working row left. */
  clearedAt?: number;
}

/**
 * Read the channel's panel from Send until `answered`, or the time is up;
 * then until no working row is left, for at most `clearMs`. Every reading is
 * kept, so who showed as working, and when, is graded off them.
 */
async function follow(page: Page, sentAt: number, answered: (r: Reading) => boolean, withinMs: number, clearMs = 5_000): Promise<Followed> {
  const readings: Reading[] = [];
  let lineAt: number | undefined;
  while (Date.now() < sentAt + withinMs) {
    const r = await readChannel(page);
    readings.push(r);
    if (answered(r)) {
      lineAt = r.at;
      break;
    }
    await sleep(100);
  }
  let clearedAt: number | undefined;
  if (lineAt !== undefined) {
    for (const until = Date.now() + clearMs; Date.now() < until; await sleep(100)) {
      const r = await readChannel(page);
      readings.push(r);
      if (r.working.length === 0) {
        clearedAt = r.at;
        break;
      }
    }
  }
  return { readings, lineAt, clearedAt };
}

/** The seats seen working in `readings` that were not already working before Send. */
function othersWorking(readings: Reading[], before: Reading, seat: string): string[] {
  const already = new Set(before.working);
  const seen = readings.flatMap((r) => r.working).filter((w) => !already.has(w));
  return [...new Set(seen.map(seatOf).filter((s): s is string => s !== undefined && s !== seat))];
}

type Message = { role: string; text: string };

/** The seat's leaf in the rail, re-read now: closed if open, then opened. */
async function freshLeaf(page: Page, seat: Seat) {
  await open(page, seat.kind);
  const seatRow = row(page, seat.id);
  await seatRow.waitFor({ timeout: 15_000 });
  if ((await seatRow.getAttribute("aria-expanded")) === "true") await seatRow.click();
  await open(page, seat.id);
  const leaf = rail(page).locator(`ul[data-leaf="${seat.id}"]`);
  await leaf.waitFor({ timeout: 15_000 });
  await readUntil(
    async () => (await leaf.locator("[data-session-id]").count()) + (await leaf.getByText("No sessions yet").count()),
    (n) => n > 0,
    10_000,
  );
  return leaf;
}

let lastDrawn = "";

/** Open one of a seat's listed conversations and read it as drawn, once the panel holds it. */
async function readConversation(page: Page, seat: Seat, sessionId: string): Promise<Message[]> {
  const button = rail(page).locator(`ul[data-leaf="${seat.id}"] [data-session-id="${sessionId}"]`);
  await button.click();
  await readUntil(() => button.getAttribute("aria-current"), (v) => v === "true", 5_000);
  // The panel keeps the last conversation until this one replaces it.
  const messages = await readUntil(
    () => conversation(page),
    (ms) => ms.length > 0 && JSON.stringify(ms) !== lastDrawn,
    8_000,
  );
  lastDrawn = JSON.stringify(messages);
  return messages;
}

/** A seat's conversations in the channel (its dispatch runs of it), each read as drawn. */
async function runsOf(page: Page, seat: Seat): Promise<Array<{ sessionId: string; messages: Message[] }>> {
  const leaf = await freshLeaf(page, seat);
  const ids = await leaf
    .locator(`[data-dispatch-run-of="${CHANNEL}"]`)
    .evaluateAll((buttons) => buttons.map((b) => b.getAttribute("data-session-id") ?? ""));
  const out: Array<{ sessionId: string; messages: Message[] }> = [];
  for (const id of ids) out.push({ sessionId: id, messages: await readConversation(page, seat, id) });
  return out;
}

/** Whether a reply follows the person's turn carrying `token`, before the person's next turn. */
function replyTo(messages: Message[], token: string): Message | undefined {
  const at = messages.findIndex((m) => m.role === "user" && m.text.includes(token));
  if (at === -1) return undefined;
  const rest = messages.slice(at + 1);
  const next = rest.findIndex((m) => m.role === "user");
  return (next === -1 ? rest : rest.slice(0, next)).find((m) => m.role === "assistant");
}

/** The rows the team panel draws on the channel's board: each row's text. */
const boardRows = (page: Page) =>
  page
    .getByTestId(`board-${CHANNEL}.${fixture.channel.board}`)
    .locator("li[data-task-id]")
    .evaluateAll((rows) => rows.map((r) => r.textContent ?? ""));

// ---------------------------------------------------------------------------
// The legs
// ---------------------------------------------------------------------------

type Fail = (leg: string, line: string) => void;

/** Failures of the journey in progress, so a leg can tell whether it added one. */
let failuresSoFar: string[] = [];

interface Tokens {
  a: string;
  b: [string, string, string];
  c1: string;
  c2: string;
  e: string;
}

/** Leg a, ask `support`: the routed specialist works, then answers under its name, and nobody else. */
async function legA(page: Page, t: Tokens, fail: Fail, evidence: string[]): Promise<void> {
  const seat = SEATS.devices.id;
  await showChannel(page);
  const before = await readChannel(page);
  const sentAt = await postLine(page, `${route("devices")} ${M.textAnswer} ${t.a} is my laptop covered for a cracked screen?`);
  const f = await follow(page, sentAt, (r) => (answersTo(r.lines, t.a)?.length ?? 0) > 0, fixture.lineWithinMs);
  const workingAt = f.readings.find(
    (r) => (f.lineAt === undefined || r.at < f.lineAt) && r.working.includes(`${seat} is working`),
  )?.at;
  const last = f.readings.at(-1)!;
  const answers = answersTo(last.lines, t.a) ?? [];
  const most = Math.max(0, ...f.readings.map((r) => answersTo(r.lines, t.a)?.length ?? 0));
  const others = othersWorking(f.readings, before, seat);

  if (workingAt === undefined) {
    fail("a:working", `the panel never showed "${seat} is working" before its line (line ${secs(sentAt, f.lineAt)}; ${f.readings.length} readings, rows seen: ${JSON.stringify([...new Set(f.readings.flatMap((r) => r.working))])})`);
  }
  if (f.lineAt === undefined) {
    fail("a:line", `no line answered ${t.a} within ${fixture.lineWithinMs / 1000}s of Send, with no reload`);
  } else if (answers.length !== 1 || most > 1 || answers[0]!.label !== seat || !answers[0]!.body.includes(M.textReply)) {
    fail("a:line", `the lines answering ${t.a} are ${JSON.stringify(answers.map((l) => `${l.label}: ${l.body}`))}, at most ${most} in one reading (want one, by ${seat}, carrying ${M.textReply})`);
  } else if (workingAt !== undefined && f.clearedAt === undefined) {
    fail("a:clears", `"${seat} is working" still showed 5s after its line`);
  }
  if (others.length > 0) fail("a:alone", `the panel showed ${others.join(", ")} working on a post routed to ${seat}`);
  if (f.lineAt !== undefined && answers.length === 1) {
    evidence.push(`a: line ${secs(sentAt, f.lineAt)} by ${answers[0]!.label} ${JSON.stringify(answers[0]!.body)}; working ${secs(sentAt, workingAt)}; ${others.length === 0 ? "nobody else seen working" : `also working: ${others.join(", ")}`}`);
  }

  await reload(page);
  await showChannel(page);
  const after = await readUntil(
    () => readChannel(page),
    (r) => postsOf(r.lines, t.a).length > 0 && (answersTo(r.lines, t.a)?.length ?? 0) > 0,
    10_000,
  );
  const kept = answersTo(after.lines, t.a) ?? [];
  if (postsOf(after.lines, t.a).length !== 1 || kept.length !== 1 || kept[0]!.label !== seat) {
    fail("a:kept", `after the reload, ${t.a} shows ${postsOf(after.lines, t.a).length} times, answered by ${JSON.stringify(kept.map((l) => l.label))} (want once, answered once by ${seat})`);
  } else {
    evidence.push(`a: after the reload, the post and ${seat}'s one line are still there`);
  }
}

/** Leg b, one per post: three posts, three purposes, and each specialist keeps only its own. */
async function legB(page: Page, t: Tokens, fail: Fail, evidence: string[]): Promise<void> {
  const plan: Array<{ token: string; role: Role; marked: boolean; ask: string }> = [
    { token: t.b[0], role: "devices", marked: true, ask: "my phone will not pair with the car" },
    { token: t.b[1], role: "accounts", marked: true, ask: "why was I billed twice?" },
    { token: t.b[2], role: fixture.fallback, marked: false, ask: "where do I leave feedback about the office?" },
  ];
  await showChannel(page);
  for (const post of plan) {
    const seat = SEATS[post.role].id;
    // The last seat's row goes first, so this post's readings hold only its own work.
    await readUntil(() => readChannel(page), (r) => r.working.length === 0, 5_000);
    const before = await readChannel(page);
    const text = `${post.marked ? `${route(post.role)} ` : ""}${M.toolAnswer} ${post.token} ${post.ask}`;
    const sentAt = await postLine(page, text);
    const f = await follow(page, sentAt, (r) => repliesOf(r.lines, post.token).length > 0, fixture.lineWithinMs);
    const replies = repliesOf(f.readings.at(-1)!.lines, post.token);
    const most = Math.max(0, ...f.readings.map((r) => repliesOf(r.lines, post.token).length));
    const others = othersWorking(f.readings, before, seat);
    const name = `${post.token} (${post.marked ? route(post.role) : "unmarked, the fallback"})`;
    const ok0 = failuresSoFar.length;
    if (f.lineAt === undefined) {
      fail("b:line", `${name}: no line carrying it within ${fixture.lineWithinMs / 1000}s of Send, with no reload`);
    } else if (replies.length !== 1 || most > 1 || replies[0]!.label !== seat || !replies[0]!.body.includes(M.toolReply)) {
      fail("b:line", `${name}: the lines carrying it are ${JSON.stringify(replies.map((l) => `${l.label}: ${l.body}`))}, at most ${most} in one reading (want one, by ${seat}, carrying ${M.toolReply})`);
    }
    if (others.length > 0) fail("b:alone", `${name}: the panel showed ${others.join(", ")} working on it (want ${seat} alone)`);
    if (failuresSoFar.length === ok0) {
      evidence.push(`b: ${name}: line ${secs(sentAt, f.lineAt)} by ${seat}, working ${secs(sentAt, f.readings.find((r) => r.working.includes(`${seat} is working`))?.at)}, nobody else seen working`);
    }
  }

  const expected: Record<Role, string[]> = { devices: [], accounts: [], fsd: [], general: [] };
  expected.devices.push(t.a);
  for (const post of plan) expected[post.role].push(post.token);
  const every = [t.a, ...t.b];
  await gradeConversations(page, "open page", expected, every, fail, evidence);

  await reload(page);
  await showChannel(page);
  const after = await readUntil(
    () => readChannel(page),
    (r) => plan.every((p) => repliesOf(r.lines, p.token).length > 0),
    10_000,
  );
  for (const post of plan) {
    const seat = SEATS[post.role].id;
    const replies = repliesOf(after.lines, post.token);
    if (postsOf(after.lines, post.token).length !== 1 || replies.length !== 1 || replies[0]!.label !== seat) {
      fail("b:kept", `after the reload, ${post.token} shows ${postsOf(after.lines, post.token).length} times, with lines by ${JSON.stringify(replies.map((l) => l.label))} (want once, one line by ${seat})`);
    }
  }
  await gradeConversations(page, "after the reload", expected, every, fail, evidence);
}

/** Each seat's conversation in the channel holds its own posts once, each answered, and nobody else's. */
async function gradeConversations(
  page: Page,
  when: string,
  expected: Record<Role, string[]>,
  every: string[],
  failWith: Fail,
  evidence: string[],
): Promise<void> {
  const held: string[] = [];
  let red = 0;
  const fail: Fail = (leg, line) => {
    red += 1;
    failWith(leg, line);
  };
  for (const role of ROLES) {
    const seat = SEATS[role];
    const runs = await runsOf(page, seat);
    const mine = expected[role];
    const foreign = every.filter((token) => !mine.includes(token));
    const text = runs.flatMap((r) => r.messages).map((m) => m.text).join("\n");
    const leaked = foreign.filter((token) => text.includes(token));
    if (leaked.length > 0) fail("b:only-its-own", `${when}: ${seat.id}'s conversation in ${CHANNEL} holds ${leaked.join(", ")}, posts it was not routed`);
    if (mine.length === 0) {
      held.push(`${seat.id} none (${runs.length} conversations)`);
      continue;
    }
    if (runs.length !== 1) {
      fail("b:only-its-own", `${when}: ${seat.id} lists ${runs.length} conversations in ${CHANNEL} (want 1)`);
      continue;
    }
    const messages = runs[0]!.messages;
    for (const token of mine) {
      const heard = messages.filter((m) => m.role === "user" && m.text.includes(token)).length;
      if (heard !== 1) fail("b:only-its-own", `${when}: ${seat.id}'s conversation in ${CHANNEL} holds ${token} as a heard turn ${heard} times (want once)`);
      else if (replyTo(messages, token) === undefined) fail("b:only-its-own", `${when}: ${seat.id} heard ${token} and no reply sits under it`);
    }
    held.push(`${seat.id} ${mine.join(" ")}`);
  }
  if (red === 0) evidence.push(`b: ${when}, each conversation in ${CHANNEL} holds: ${held.join("; ")}`);
}

/** Leg c, direct talk, and the segmentation row of part 4. */
async function legC(page: Page, t: Tokens, dropUser: boolean, fail: Fail, evidence: string[]): Promise<void> {
  const seat = SEATS.devices;
  await freshLeaf(page, seat);
  await newConversation(page, seat.id);
  const box = panel(page).getByLabel("Message this seat");
  await box.waitFor({ timeout: 15_000 });
  const current = await readUntil(
    () =>
      rail(page)
        .locator(`ul[data-leaf="${seat.id}"] [aria-current="true"]`)
        .evaluateAll((els) => els.map((el) => el.getAttribute("data-session-id") ?? "")),
    (ids) => ids.length > 0,
    10_000,
  );
  const sessionId = current[0];
  if (sessionId === undefined) {
    fail("c1", `"New conversation" on ${seat.id} opened no conversation in the rail`);
    return;
  }
  if (dropUser) {
    await page.evaluate(
      ([key, id]) => {
        const ids = JSON.parse(sessionStorage.getItem(key!) ?? "[]") as string[];
        sessionStorage.setItem(key!, JSON.stringify([...ids, id]));
      },
      [DROP_KEY, sessionId],
    );
  }

  /** Send one message and read the open conversation until its reply shows. */
  const talk = async (text: string, token: string, marker: string) => {
    await readUntil(async () => (await box.isEnabled()) && (await box.inputValue()) === "", (free) => free, 30_000);
    await box.fill(text);
    await panel(page).getByRole("button", { name: "Send" }).click();
    const sentAt = Date.now();
    let heardAt: number | undefined;
    let composerHeldUntil: number | undefined;
    let most = 0;
    let messages: Message[] = [];
    while (Date.now() < sentAt + fixture.lineWithinMs) {
      messages = await conversation(page);
      const turns = messages.filter((m) => m.role === "user" && m.text.includes(token)).length;
      most = Math.max(most, turns);
      if (turns > 0) {
        heardAt ??= Date.now();
        if ((await box.inputValue().catch(() => "")).includes(token)) composerHeldUntil = Date.now();
      }
      if (replyTo(messages, token)?.text.includes(marker) === true) break;
      await sleep(100);
    }
    const held = heardAt === undefined || composerHeldUntil === undefined ? "" : `, the composer still held it ${secs(heardAt, composerHeldUntil)} after it showed`;
    return { messages, most, sentAt, heardAt, note: held };
  };

  // ---- c1: a new conversation, the person's turn and a reply under it -----
  const one = await talk(`${M.talk} ${t.c1} my screen flickers since the update`, t.c1, M.talkReply);
  gradeC1(one.messages, one.most, t, "open page", fail, evidence, `${secs(one.sentAt, one.heardAt)}${one.note}`);

  // ---- c2: recall, answered from the earlier turn and nothing else ---------
  const two = await talk(`${M.recall} ${t.c2} what did I tell you before this?`, t.c2, M.recallReply);
  gradeC2(two.messages, two.most, t, "open page", fail, evidence, `${secs(two.sentAt, two.heardAt)}${two.note}`);
  await showChannel(page);
  gradeChannelQuiet((await loaded(page, t)).lines, t, "open page", fail, evidence);

  // ---- the reload at the leg's end ----------------------------------------
  await reload(page);
  await freshLeaf(page, seat);
  const kept = await readConversation(page, seat, sessionId);
  gradeC1(kept, kept.filter((m) => m.role === "user" && m.text.includes(t.c1)).length, t, "after the reload", fail, evidence, "");
  gradeC2(kept, kept.filter((m) => m.role === "user" && m.text.includes(t.c2)).length, t, "after the reload", fail, evidence, "");
  await showChannel(page);
  gradeChannelQuiet((await loaded(page, t)).lines, t, "after the reload", fail, evidence);

  // ---- seg (part 4): the channel conversation holds nothing of the direct talk
  const runs = await runsOf(page, seat);
  const text = runs.flatMap((r) => r.messages).map((m) => m.text).join("\n");
  if (text.includes(t.c1) || text.includes(t.c2)) {
    fail("seg", `${seat.id}'s conversation in ${CHANNEL} holds the direct talk (${[t.c1, t.c2].filter((x) => text.includes(x)).join(", ")})`);
  } else {
    evidence.push(`seg: ${seat.id}'s conversation in ${CHANNEL} (${runs.length} run) holds nothing of ${t.c1} or ${t.c2}`);
  }
}

function gradeC1(messages: Message[], most: number, t: Tokens, when: string, fail: Fail, evidence: string[], timing: string): void {
  const turns = messages.filter((m) => m.role === "user" && m.text.includes(t.c1)).length;
  const reply = replyTo(messages, t.c1);
  if (turns !== 1 || most > 1) {
    fail("c1", `${when}: ${t.c1} is the person's turn ${turns} times, at most ${most} in one reading (want once); roles drawn: ${messages.map((m) => m.role).join(", ") || "none"}`);
  } else if (reply === undefined || !reply.text.includes(M.talkReply)) {
    fail("c1", `${when}: no ${M.talkReply} reply under ${t.c1}; under it: ${JSON.stringify(reply?.text ?? null)}`);
  } else {
    evidence.push(`c1: ${when}, ${t.c1} is the person's turn${timing === "" ? "" : ` (${timing})`}, ${JSON.stringify(reply.text)} under it`);
  }
}

function gradeC2(messages: Message[], most: number, t: Tokens, when: string, fail: Fail, evidence: string[], timing: string): void {
  const turns = messages.filter((m) => m.role === "user" && m.text.includes(t.c2)).length;
  const reply = replyTo(messages, t.c2);
  const earlier = [t.a, ...t.b].filter((token) => reply?.text.includes(token) === true);
  if (turns !== 1 || most > 1) {
    fail("c2", `${when}: ${t.c2} is the person's turn ${turns} times, at most ${most} in one reading (want once); roles drawn: ${messages.map((m) => m.role).join(", ") || "none"}`);
  } else if (reply === undefined || !reply.text.includes(M.recallReply)) {
    fail("c2", `${when}: no ${M.recallReply} reply under ${t.c2}; under it: ${JSON.stringify(reply?.text ?? null)}`);
  } else if (!reply.text.includes(t.c1)) {
    fail("c2", `${when}: the recall reply ${JSON.stringify(reply.text)} does not name ${t.c1}, the conversation's earlier turn`);
  } else if (earlier.length > 0) {
    fail("c2", `${when}: the recall reply names ${earlier.join(", ")}, from the channel: ${JSON.stringify(reply.text)}`);
  } else {
    evidence.push(`c2: ${when}, ${t.c2} is the person's turn${timing === "" ? "" : ` (${timing})`}, ${JSON.stringify(reply.text)} under it`);
  }
}

/**
 * The channel's panel once its lines have loaded: once the person's posts
 * from legs a and b are drawn. Waiting only; what it shows is graded by the caller.
 */
const loaded = (page: Page, t: Tokens) =>
  readUntil(() => readChannel(page), (r) => [t.a, ...t.b].every((token) => postsOf(r.lines, token).length > 0), 10_000);

/** `support` shows nothing of the direct talk. */
function gradeChannelQuiet(lines: Line[], t: Tokens, when: string, fail: Fail, evidence: string[]): void {
  const leaks = lines.filter((l) => [t.c1, t.c2, M.talkReply, M.recallReply].some((x) => l.body.includes(x)));
  if (leaks.length > 0) fail("c2:channel", `${when}: ${CHANNEL} shows the direct talk: ${JSON.stringify(leaks.map((l) => `${l.label}: ${l.body}`))}`);
  else evidence.push(`c2: ${when}, ${CHANNEL} shows nothing of it (${lines.length} lines)`);
}

/** Part 2, the escalation: the specialist files the case onto the board and says so. */
async function partTwo(page: Page, origin: string, t: Tokens, fail: Fail, evidence: string[]): Promise<void> {
  const seat = SEATS[fixture.escalatesTo].id;
  const board = fixture.channel.board;
  await showChannel(page);
  const rowsBefore = (await boardRows(page)).length;
  const sentAt = await postLine(
    page,
    `${route(fixture.escalatesTo)} ${M.needsAPerson} ${t.e} I was charged three times this month and need a person to reverse it`,
  );
  const f = await follow(page, sentAt, (r) => (answersTo(r.lines, t.e)?.length ?? 0) > 0, fixture.lineWithinMs);
  const answers = answersTo(f.readings.at(-1)!.lines, t.e) ?? [];
  if (answers.length !== 1 || answers[0]!.label !== seat || !answers[0]!.body.includes(M.filedReply)) {
    fail("e:line", `open page: the lines answering ${t.e} are ${JSON.stringify(answers.map((l) => `${l.label}: ${l.body}`))} (want one, by ${seat}, carrying ${M.filedReply}), line ${secs(sentAt, f.lineAt)}`);
  } else {
    evidence.push(`e: open page, ${seat}'s line ${secs(sentAt, f.lineAt)}: ${JSON.stringify(answers[0]!.body)}`);
  }
  // The row, on the open page: the list shows it without a reload.
  const openRows = await readUntil(() => boardRows(page), (rs) => rs.some((r) => r.includes(t.e)), fixture.lineWithinMs);
  const openMine = openRows.filter((r) => r.includes(t.e));
  if (openMine.length !== 1) {
    fail("e:row-open", `open page: the team panel's ${board} list holds ${openMine.length} rows carrying ${t.e} within ${fixture.lineWithinMs / 1000}s of its line, with no reload (want 1); it shows ${openRows.length} rows, ${rowsBefore} when the leg began`);
  } else {
    evidence.push(`e: open page, the ${board} list shows ${JSON.stringify(openMine[0])}`);
  }
  // The row is written by the channel's own request, a moment after the
  // dispatch. Let it land before the reload; nothing here is graded.
  await readUntil(
    async () => (await page.request.get(`${origin}/api/flows/sessions/${CHANNEL}/resources/${CHANNEL}.${board}`)).text(),
    (body) => body.includes(t.e),
    10_000,
  );

  await reload(page);
  await showChannel(page);
  const after = await readUntil(
    () => readChannel(page),
    (r) => (answersTo(r.lines, t.e)?.length ?? 0) > 0,
    10_000,
  );
  const kept = answersTo(after.lines, t.e) ?? [];
  if (kept.length !== 1 || kept[0]!.label !== seat || !kept[0]!.body.includes(M.filedReply)) {
    fail("e:line", `after the reload, the lines answering ${t.e} are ${JSON.stringify(kept.map((l) => `${l.label}: ${l.body}`))} (want one, by ${seat}, carrying ${M.filedReply})`);
  }
  const rows = await readUntil(() => boardRows(page), (rs) => rs.some((r) => r.includes(t.e)), 10_000);
  const mine = rows.filter((r) => r.includes(t.e));
  if (mine.length !== 1) {
    fail("e:row", `after the reload, the team panel's ${board} list holds ${mine.length} rows carrying ${t.e} (want 1); it shows ${rows.length} rows`);
  } else {
    evidence.push(`e: after the reload, the ${board} list shows ${JSON.stringify(mine[0])}`);
  }
}

// ---------------------------------------------------------------------------
// One journey: a fresh server and a fresh browser context, every leg in order
// ---------------------------------------------------------------------------

interface Journey {
  name: string;
  failures: string[];
  evidence: string[];
}

/** Stop the server and wait until its port is free, so the next one can start. */
async function stop(server: KitchenSinkServer): Promise<void> {
  const gone = async (withinMs: number) => {
    for (const end = Date.now() + withinMs; Date.now() < end; await sleep(250)) {
      try {
        await fetch(`${server.origin}/api/flows`);
      } catch {
        return true;
      }
    }
    return false;
  };
  server.stop();
  if (await gone(30_000)) return;
  // `next start` can hold the port long after SIGTERM, and the next journey refuses to start while it answers.
  console.log(`  (${server.origin} still answered 30s after SIGTERM; killing what holds the port)`);
  try {
    execFileSync("fuser", ["-k", "-KILL", `${new URL(server.origin).port}/tcp`], { stdio: "ignore" });
  } catch {
    // nothing held it by the time fuser looked
  }
  if (!(await gone(15_000))) throw new Error(`${server.origin} still answers after it was killed`);
}

async function journey(browser: Browser, control: string): Promise<Journey> {
  const spec = control === "" ? undefined : CONTROLS[control];
  const run = randomUUID().replace(/-/g, "").slice(0, 10);
  const t: Tokens = {
    a: `ask-token-a${run}`,
    b: [`reply-token-b1${run}`, `reply-token-b2${run}`, `reply-token-b3${run}`],
    c1: `talk-token-c${run}`,
    c2: `recall-token-c${run}`,
    e: `case-token-e${run}`,
  };
  const failures: string[] = [];
  failuresSoFar = failures;
  const evidence: string[] = [];
  const fail: Fail = (leg, line) => failures.push(`[${leg}] ${line}`);

  // Keyless, and only a server-side control reaches the server.
  const server = await startKitchenSink(fixture.port, {
    AI_GATEWAY_API_KEY: "",
    GOAL_CONTROL: spec?.how === "server" ? control : "",
  });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  if (spec?.how === "network") await context.addInitScript({ content: DROP_USER_MESSAGES });
  const page = await context.newPage();
  lastDrawn = "";
  const legs: Array<[string, () => Promise<void>]> = [
    ["a", () => legA(page, t, fail, evidence)],
    ["b", () => legB(page, t, fail, evidence)],
    ["c1", () => legC(page, t, spec?.how === "network", fail, evidence)],
    ["e:line", () => partTwo(page, server.origin, t, fail, evidence)],
  ];
  try {
    await page.goto(`${server.origin}/${spec?.how === "page" ? `?goalControl=${control}` : ""}`);
    await ready(page);
    for (const [leg, walk] of legs) {
      try {
        await walk();
      } catch (error) {
        // A leg that cannot be walked is red, and says it failed at setup, not at its signal.
        fail(leg, `could not be walked (setup): ${error instanceof Error ? error.message.split("\n")[0] : String(error)}`);
        await page.goto(`${server.origin}/${spec?.how === "page" ? `?goalControl=${control}` : ""}`).catch(() => {});
        await ready(page).catch(() => {});
      }
    }
  } finally {
    await context.close();
    await stop(server);
  }

  // Nobody drains escalations: the boot still warns about it, and about no other board.
  const unattended = [...new Set([...server.log().matchAll(/channel "([^"]+)" holds board "([^"]+)"/g)].map((m) => `${m[1]}.${m[2]}`))];
  if (JSON.stringify(unattended) !== JSON.stringify([`${CHANNEL}.${fixture.channel.board}`])) {
    fail("e:warning", `the boot warns these boards are unattended: ${JSON.stringify(unattended)} (want only ${CHANNEL}.${fixture.channel.board})`);
  } else {
    evidence.push(`e: the boot still warns that ${CHANNEL}.${fixture.channel.board} is unattended, and no other board`);
  }
  return { name: control === "" ? "plain" : control, failures, evidence };
}

/** The leg a failure names: `c1`, `b`, `e` for `e:row`. */
const legOf = (failure: string) => (/^\[([^\]:]+)/.exec(failure)?.[1] ?? "");

/** Print a journey's verdict per leg, as it ran. */
function report(j: Journey): void {
  console.log(`\n==== ${j.name} ====`);
  for (const line of j.evidence) console.log(`  ok    ${line}`);
  for (const line of j.failures) console.log(`  FAIL  ${line}`);
}

/** The assertion a failure names: `a:working`, `c1`, `e:row`. */
const assertionOf = (failure: string) => (/^\[([^\]]+)\]/.exec(failure)?.[1] ?? "");

/**
 * A control's verdict: it reddens each leg it names and none it keeps green.
 *
 * A control reddens a leg only at an assertion the plain journey passed, on
 * the same build. An assertion red in both is the build's, not the control's,
 * and is reported as inherited. Run alone (`GOAL_CONTROL=<name>`) there is no
 * plain journey, so every red assertion counts.
 */
function gradeControl(j: Journey, plain: Journey | undefined, failures: string[], evidence: string[]): void {
  const spec = CONTROLS[j.name]!;
  const inherited = new Set((plain?.failures ?? []).map(assertionOf));
  const red = new Map<string, string>();
  for (const f of j.failures) {
    if (inherited.has(assertionOf(f)) || red.has(legOf(f))) continue;
    red.set(legOf(f), f);
  }
  for (const leg of spec.fail) {
    if (!red.has(leg)) failures.push(`[control ${j.name}] left ${leg} green, so that leg cannot fail under it`);
    else if (red.get(leg)!.includes("could not be walked")) failures.push(`[control ${j.name}] failed ${leg} at setup, not at its signal: ${red.get(leg)}`);
  }
  for (const leg of spec.green) {
    if (red.has(leg)) failures.push(`[control ${j.name}] also reddened ${leg}: ${red.get(leg)}`);
  }
  const loose = ["a", "b", "c1", "c2", "seg", "e"].filter((l) => !spec.fail.includes(l) && !spec.green.includes(l));
  const carried = [...new Set(j.failures.map(assertionOf).filter((a) => inherited.has(a)))];
  evidence.push(
    `${j.name}: FAIL at ${spec.fail.filter((l) => red.has(l)).map((l) => assertionOf(red.get(l)!)).join(", ") || "nothing"}; ${spec.green.filter((l) => !red.has(l)).join(", ")} green; not graded: ${loose.map((l) => `${l} ${red.has(l) ? "red" : "green"}`).join(", ")}${carried.length > 0 ? `; inherited from the plain journey: ${carried.join(", ")}` : ""}`,
  );
}

// ---------------------------------------------------------------------------
// The smoke: a real model, out of test mode
// ---------------------------------------------------------------------------

async function smoke(browser: Browser, failures: string[], evidence: string[]): Promise<void> {
  const fail: Fail = (leg, line) => failures.push(`[${leg}] ${line}`);
  if ((process.env.AI_GATEWAY_API_KEY ?? "") === "") {
    fail("smoke", "GOAL_LIVE=1 needs AI_GATEWAY_API_KEY");
    return;
  }
  const run = randomUUID().replace(/-/g, "").slice(0, 10);
  const server = await startKitchenSink(fixture.port, { KITCHEN_SINK_TEST_MODE: "", GOAL_CONTROL: "" });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  const posts = fixture.smoke.posts.map((p, i) => ({ ...p, mark: `(ref smoke-token-${i}${run})` }));
  const answeredBy: Array<Line | undefined> = [];
  try {
    await page.goto(`${server.origin}/`);
    await ready(page);
    await showChannel(page);
    for (const [i, post] of posts.entries()) {
      const want = post.want === undefined ? undefined : SEATS[post.want].id;
      await readUntil(() => readChannel(page), (r) => r.working.length === 0, fixture.smoke.withinMs);
      const before = await readChannel(page);
      const sentAt = await postLine(page, `${post.text} ${post.mark}`);
      // Every run the post started ends before the answers are counted, so a second answer is not missed.
      const f = await follow(page, sentAt, (r) => (answersTo(r.lines, post.mark)?.length ?? 0) > 0, fixture.smoke.withinMs, fixture.smoke.withinMs);
      const answers = answersTo(f.readings.at(-1)!.lines, post.mark) ?? [];
      const worked = [...new Set(f.readings.flatMap((r) => r.working).filter((w) => !before.working.includes(w)).map(seatOf))];
      answeredBy.push(answers[0]);
      const said = `post ${i + 1} ${JSON.stringify(post.text)}: ${answers.length} line(s) ${secs(sentAt, f.lineAt)}, ${answers.map((l) => `${l.label}: ${JSON.stringify(l.body)}`).join(" | ") || "none"}; working seen: ${worked.join(", ") || "none"}`;
      console.log(`  smoke ${said}`);
      evidence.push(said);
      if (f.lineAt === undefined) fail("smoke", `post ${i + 1}: no answer within ${fixture.smoke.withinMs / 1000}s of Send, with no reload`);
      else if (answers.length !== 1) fail("smoke", `post ${i + 1}: ${answers.length} answer lines (want exactly one)`);
      else if (want !== undefined && answers[0]!.label !== want) fail("smoke", `post ${i + 1} ${JSON.stringify(post.text)} was answered by ${answers[0]!.label} (want ${want})`);
      if (worked.filter((s) => s !== undefined && s !== answers[0]?.label).length > 0) {
        fail("smoke", `post ${i + 1}: the panel showed ${worked.join(", ")} working (want the answering specialist alone)`);
      }
      if (post.followUpOf !== undefined && answers.length === 1) {
        const antecedent = posts[post.followUpOf]!;
        const theirs = answeredBy[post.followUpOf];
        const subject = (post.subject ?? []).filter((word) => answers[0]!.body.toLowerCase().includes(word));
        evidence.push(`follow-up: ${JSON.stringify(antecedent.text)} answered by ${theirs?.label ?? "nobody"}: ${JSON.stringify(theirs?.body ?? "")}; ${JSON.stringify(post.text)} answered by ${answers[0]!.label}: ${JSON.stringify(answers[0]!.body)}`);
        if (theirs === undefined || answers[0]!.label !== theirs.label) {
          fail("smoke", `the follow-up was answered by ${answers[0]!.label}, not ${theirs?.label ?? "its antecedent's specialist"}`);
        }
        if (subject.length === 0) fail("smoke", `the follow-up's answer names none of ${JSON.stringify(post.subject)}: ${JSON.stringify(answers[0]!.body)}`);
      }
    }
    await reload(page);
    await showChannel(page);
    const after = await readUntil(
      () => readChannel(page),
      (r) => posts.every((p) => postsOf(r.lines, p.mark).length > 0),
      15_000,
    );
    for (const [i, post] of posts.entries()) {
      const kept = answersTo(after.lines, post.mark) ?? [];
      if (kept.length !== 1 || kept[0]!.label !== answeredBy[i]?.label) {
        fail("smoke", `after the reload, post ${i + 1} is answered by ${JSON.stringify(kept.map((l) => l.label))} (want the one line it showed, by ${answeredBy[i]?.label ?? "its specialist"})`);
      }
    }
  } finally {
    await context.close();
    await stop(server);
  }
}

// ---------------------------------------------------------------------------

await runGoal(async () => {
  const failures: string[] = [];
  const evidence: string[] = [];

  // Keyless: a provider key here could be what answers a gated leg.
  if (!LIVE) {
    const keys = fixture.providerKeys.filter((name) => (process.env[name] ?? "") !== "");
    if (keys.length > 0) return { failures: [`[key] a provider key is set (${keys.join(", ")}); the gated legs run keyless`], evidence: "" };
  }

  buildKitchenSink();
  const browser = await launchChromium();
  try {
    if (LIVE) {
      await smoke(browser, failures, evidence);
      return { failures, evidence: evidence.join("; ") };
    }
    const names = CONTROL !== "" ? [CONTROL] : ["", ...Object.keys(CONTROLS).filter((n) => CONTROLS[n]!.how !== "checkout")];
    let plain: Journey | undefined;
    for (const name of names) {
      const j = await journey(browser, name);
      report(j);
      if (name === "") {
        plain = j;
        failures.push(...j.failures.map((f) => f.replace(/^\[/, "[plain · ")));
        evidence.push(...j.evidence.map((e) => `plain · ${e}`));
      } else {
        gradeControl(j, plain, failures, evidence);
      }
    }
  } finally {
    await browser.close();
  }
  return { failures, evidence: evidence.join("; ") };
});
