/**
 * Goal check: with `support.help` open, a person sees the specialist their
 * post was routed to, `support.devices`, working on it and then its reply,
 * without reloading.
 *
 * Real path, scripted model, out of CI. See goal.md for the contract.
 *
 * One real browser against the app's PRODUCTION build (built here, never
 * assumed), on its scripted model, keyless. Each post names its specialist
 * (`[route:support.devices]`), which the scripted route picks; the second,
 * sent before the first is answered, goes to the same specialist. The
 * scripted specialist holds its answer about three seconds, so "working" has
 * time to show. Two posts from the mailbox's panel, the second while the
 * specialist works on the first; then a third, with the specialist's own
 * conversation for the mailbox open in a second tab. The page
 * is never reloaded until the last leg. Four legs, graded per post:
 *
 *   working  `support.devices is working` shows in the mailbox's panel
 *            before its line for the post does, and before the next post is sent
 *            (a Send re-reads the runs on any page); for the second post,
 *            after its line for the first is in, since the row is the same.
 *   line     within 15 s of Send, the open panel shows the specialist's line
 *            carrying the post's token and the line marker, labelled
 *            `support.devices`
 *            (a second copy is graded under once); the working row is gone
 *            once its run ends.
 *            For the third post, the specialist's open conversation shows the
 *            post heard and its answer after it, in the second tab.
 *   once     no line shows twice while the page is open, and after the one
 *            reload each post and each reply shows exactly once.
 *   no-poll  at most two snapshot reads by the page between Send and the line.
 *
 * Everything graded is read off the page. The server is read only to know
 * when to reload, and nothing it says is graded.
 *
 * Run:      PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers pnpm tsx goals/kitchen-sink-talk/shows-the-reply-without-a-reload/run.mts
 * Controls: GOAL_CONTROL=no-live  (must FAIL at working and line, and nothing else)
 *           GOAL_CONTROL=main     (the app before the live view, from a checkout of it: the same)
 */
import { randomUUID } from "node:crypto";
import type { Page } from "playwright";
import { loadFixture, runGoal } from "../../lib/index.mts";
import {
  buildKitchenSink,
  conversation,
  open,
  panel,
  rail,
  readUntil,
  row,
  startKitchenSink,
  type KitchenSinkServer,
} from "../../lib/kitchen-sink.mts";
import { launchChromium } from "../../lib/playwright.mts";

interface Seat {
  kind: string;
  id: string;
}

interface Fixture {
  port: number;
  mailbox: Seat;
  replier: Seat;
  /** What a post carries to be routed to `replier`. */
  route: string;
  marker: string;
  lineMarker: string;
  lineWithinMs: number;
  maxSnapshotReads: number;
}

const fixture = loadFixture<Fixture>(import.meta.url);
const CONTROL = process.env.GOAL_CONTROL ?? "";

/** The legs each control must redden, and only those. */
const EXPECTED: Record<string, string[]> = {
  // The panels don't ask to follow their session: the page stays silent
  // until a reload, so "working" never shows and neither does the line.
  "no-live": ["working", "line"],
  // The app before the live view, run from a checkout of it with these files
  // copied in. The app knows no control by this name; it tells this run which
  // legs must fail.
  main: ["working", "line"],
};
if (CONTROL !== "" && EXPECTED[CONTROL] === undefined) {
  throw new Error(`unknown GOAL_CONTROL "${CONTROL}"; known: ${Object.keys(EXPECTED).join(", ")}`);
}

/**
 * The page's query. `no-live` lives in the browser, and a client component
 * cannot read `GOAL_CONTROL`, so the page is opened with it instead; the app
 * honours it only in a test-mode build.
 */
const PAGE_QUERY = CONTROL === "no-live" ? "?goalControl=no-live" : "";

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Load the page, with the control's query, and wait until it can be used. */
async function openPage(page: Page, origin: string): Promise<void> {
  await page.goto(`${origin}/${PAGE_QUERY}`);
  await page.locator('[data-testid="message-input"]:visible').waitFor({ state: "visible", timeout: 30_000 });
}

/** Open the mailbox's panel. */
async function openMailbox(page: Page, origin: string): Promise<void> {
  await openPage(page, origin);
  await open(page, fixture.mailbox.kind);
  await row(page, fixture.mailbox.id).click();
  await panel(page).getByTestId("mailbox-transcript").waitFor({ timeout: 15_000 });
}

/** When the page read a session's snapshot (`GET …/sessions/<id>/state`). */
function snapshotReads(page: Page): number[] {
  const at: number[] = [];
  page.on("request", (request) => {
    if (request.method() !== "GET") return;
    if (/^\/api\/flows\/sessions\/[^/]+\/state$/.test(new URL(request.url()).pathname)) at.push(Date.now());
  });
  return at;
}

interface Line {
  label: string;
  text: string;
}

/** The mailbox's panel as drawn: whether the specialist shows as working, and every line. */
async function readMailbox(page: Page): Promise<{ at: number; working: boolean; lines: Line[] }> {
  const drawn = panel(page);
  const [working, lines] = await Promise.all([
    drawn.getByTestId("working-row").filter({ hasText: `${fixture.replier.id} is working` }).count(),
    drawn.getByTestId("mailbox-line").evaluateAll((els) =>
      els.map((el) => ({
        label: el.querySelector('[data-testid="mailbox-line-label"]')?.textContent ?? "",
        text: el.textContent ?? "",
      })),
    ),
  ]);
  return { at: Date.now(), working: working > 0, lines };
}

interface Post {
  token: string;
  line: string;
  sentAt: number;
  /** The first reading that showed the specialist working, with this post's line not yet in. */
  workingAt?: number;
  /** The first reading that showed the specialist's line for this post. */
  lineAt?: number;
  label?: string;
  /** The most copies of the post, and of the specialist's line for it, any one reading showed. */
  mostPosts: number;
  mostReplies: number;
}

const replies = (lines: Line[], token: string) =>
  lines.filter((l) => l.text.includes(token) && l.text.includes(fixture.lineMarker));
const postsOf = (lines: Line[], token: string) =>
  lines.filter((l) => l.text.includes(token) && !l.text.includes(fixture.lineMarker));

/**
 * Fold one reading of the mailbox into what each sent post has seen so far.
 *
 * A reading counts as the specialist working on a post only when nothing else
 * could have put the row there. The specialist working on an earlier post
 * shows the same row, so every earlier post's line must be in: for the second post, the row
 * must still show after it has answered the first. And a Send re-reads the runs
 * even on a page that doesn't follow its session, so the reading must come
 * before the next post is sent.
 */
function observe(posts: Post[], reading: { at: number; working: boolean; lines: Line[] }): void {
  for (const [i, post] of posts.entries()) {
    if (post.sentAt === 0 || reading.at < post.sentAt) continue;
    const mine = replies(reading.lines, post.token);
    post.mostReplies = Math.max(post.mostReplies, mine.length);
    post.mostPosts = Math.max(post.mostPosts, postsOf(reading.lines, post.token).length);
    const earlierAnswered = posts.slice(0, i).every((p) => replies(reading.lines, p.token).length > 0);
    const beforeNextSend = posts.slice(i + 1).every((p) => p.sentAt === 0 || reading.at < p.sentAt);
    if (post.lineAt === undefined && mine.length > 0) {
      post.lineAt = reading.at;
      post.label = mine[0]!.label;
    } else if (
      post.lineAt === undefined &&
      post.workingAt === undefined &&
      reading.working &&
      earlierAnswered &&
      beforeNextSend
    ) {
      post.workingAt = reading.at;
    }
  }
}

/** Post a line from the mailbox's panel once its composer is free, reading the panel meanwhile. */
async function send(page: Page, posts: Post[], post: Post): Promise<void> {
  const box = panel(page).getByLabel("Post to this mailbox");
  for (let waited = 0; waited < 10_000; waited += 100) {
    observe(posts, await readMailbox(page));
    if ((await box.isEnabled()) && (await box.inputValue()) === "") break;
    await sleep(100);
  }
  await box.fill(post.line);
  await panel(page).getByRole("button", { name: "Send" }).click();
  post.sentAt = Date.now();
}

// ---------------------------------------------------------------------------

await runGoal(async (failures) => {
  const evidence: string[] = [];
  const fail = (leg: string, line: string) => failures.push(`[${leg}] ${line}`);
  const run = randomUUID().replace(/-/g, "").slice(0, 10);
  const posts: Post[] = [
    `when do refunds post?`,
    `and exchanges, the same day?`,
    `and store credit?`,
  ].map((ask, i) => {
    const token = `reply-token-${"abc"[i]}${run}`;
    return { token, line: `${fixture.route} ${fixture.marker} ${token} ${ask}`, sentAt: 0, mostPosts: 0, mostReplies: 0 };
  });
  const [first, second, third] = posts as [Post, Post, Post];
  const secs = (from: number, to: number | undefined) => (to === undefined ? "never" : `+${((to - from) / 1000).toFixed(1)}s`);

  buildKitchenSink();

  const browser = await launchChromium();
  let server: KitchenSinkServer | undefined;
  try {
    // Keyless: the scripted model answers, and no key is there to fall back on.
    server = await startKitchenSink(fixture.port, { AI_GATEWAY_API_KEY: "" });
    const origin = server.origin;
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    const reads = snapshotReads(page);
    await openMailbox(page, origin);

    // ---- two posts, the second while the specialist works on the first -----
    await send(page, posts, first);
    for (let r = await readMailbox(page); ; r = await readMailbox(page)) {
      observe(posts, r);
      if (first.workingAt !== undefined || first.lineAt !== undefined || Date.now() - first.sentAt > 2_000) break;
      await sleep(100);
    }
    await send(page, posts, second);
    const mailboxPosts = [first, second];
    const lastDeadline = second.sentAt + fixture.lineWithinMs;
    while (Date.now() < lastDeadline && mailboxPosts.some((p) => p.lineAt === undefined)) {
      observe(posts, await readMailbox(page));
      await sleep(100);
    }
    // The specialist's run ends right after its line; give the row a few seconds to go.
    let clearedAt: number | undefined;
    const lastLine = Math.max(...mailboxPosts.map((p) => p.lineAt ?? 0));
    if (mailboxPosts.every((p) => p.lineAt !== undefined)) {
      while (Date.now() < lastLine + 5_000) {
        const r = await readMailbox(page);
        observe(posts, r);
        if (!r.working) {
          clearedAt = r.at;
          break;
        }
        await sleep(100);
      }
    }

    for (const [i, post] of mailboxPosts.entries()) {
      const name = `post ${i + 1} (${post.token})`;
      if (post.workingAt === undefined) {
        const after = i === 0 ? ", before the next post was sent" : `, once ${fixture.replier.id} had answered the earlier post`;
        fail("working", `${name}: the panel never showed "${fixture.replier.id} is working" before its line${after} (line ${secs(post.sentAt, post.lineAt)})`);
      }
      if (post.lineAt === undefined || post.lineAt > post.sentAt + fixture.lineWithinMs) {
        fail("line", `${name}: no line carrying the token and ${fixture.lineMarker} within ${fixture.lineWithinMs / 1000}s of Send, with no reload (seen ${secs(post.sentAt, post.lineAt)})`);
      } else if (post.label !== fixture.replier.id) {
        fail("line", `${name}: the line is labelled "${post.label}", not ${fixture.replier.id}`);
      }
      const window = reads.filter((at) => at >= post.sentAt && at <= (post.lineAt ?? post.sentAt + fixture.lineWithinMs)).length;
      if (window > fixture.maxSnapshotReads) {
        fail("no-poll", `${name}: the page read a snapshot ${window} times between Send and the line (at most ${fixture.maxSnapshotReads})`);
      }
      evidence.push(`${name}: working ${secs(post.sentAt, post.workingAt)}, line ${secs(post.sentAt, post.lineAt)} under ${post.label ?? "nobody"}, ${window} snapshot reads`);
    }
    if (mailboxPosts.every((p) => p.lineAt !== undefined)) {
      if (clearedAt === undefined) {
        fail("line", `"${fixture.replier.id} is working" still showed 5s after its last line`);
      } else {
        evidence.push(`working gone ${secs(lastLine, clearedAt)} after the last line`);
      }
    }

    // ---- a third post, heard in the specialist's own conversation in a second tab
    const seatPage = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    const seatReads = snapshotReads(seatPage);
    await openPage(seatPage, origin);
    await open(seatPage, fixture.replier.kind);
    await open(seatPage, fixture.replier.id);
    const runOfMailbox = rail(seatPage)
      .locator(`ul[data-leaf="${fixture.replier.id}"]`)
      .locator(`[data-dispatch-run-of="${fixture.mailbox.id}"]`);
    await runOfMailbox.first().waitFor({ timeout: 15_000 });
    await runOfMailbox.first().click();
    await readUntil(() => conversation(seatPage), (ms) => ms.length > 0, 10_000);

    await send(page, posts, third);
    let heardAt: number | undefined;
    while (Date.now() < third.sentAt + fixture.lineWithinMs) {
      const drawn = await conversation(seatPage);
      const heard = drawn.findIndex((m) => m.role === "user" && m.text.includes(third.token));
      if (heard >= 0 && drawn.slice(heard + 1).some((m) => m.role === "assistant" && m.text.includes(fixture.lineMarker))) {
        heardAt = Date.now();
        break;
      }
      await sleep(100);
    }
    const seatWindow = seatReads.filter((at) => at >= third.sentAt && at <= (heardAt ?? third.sentAt + fixture.lineWithinMs)).length;
    if (heardAt === undefined) {
      fail("line", `post 3 (${third.token}): ${fixture.replier.id}'s open conversation never showed the post heard and its answer, with no reload`);
    }
    if (seatWindow > fixture.maxSnapshotReads) {
      fail("no-poll", `post 3 (${third.token}): the second tab read a snapshot ${seatWindow} times between Send and ${fixture.replier.id}'s answer (at most ${fixture.maxSnapshotReads})`);
    }
    evidence.push(`post 3 (${third.token}): heard and answered in ${fixture.replier.id}'s open conversation ${secs(third.sentAt, heardAt)}, ${seatWindow} snapshot reads`);

    // ---- once: nothing twice while open, then each line once after a reload
    for (const post of posts) {
      if (post.mostPosts > 1 || post.mostReplies > 1) {
        fail("once", `${post.token}: while the page was open, one reading showed the post ${post.mostPosts} times and ${fixture.replier.id}'s line ${post.mostReplies} times`);
      }
    }
    // Let the server hold every answer before the reload, so the reload grades
    // what was kept and not how fast. Not graded.
    await readUntil(
      async () => {
        const res = await page.request.get(
          `${origin}/api/flows/sessions/${fixture.mailbox.id}/state?include_items=true&item_types=component&limit=1000`,
        );
        const text = await res.text();
        return posts.every((p) => text.split(p.token).length - 1 >= 2);
      },
      (done) => done,
      20_000,
    );
    await page.reload();
    await openMailbox(page, origin);
    const drawn = await readUntil(
      async () => (await readMailbox(page)).lines,
      (ls) => posts.every((p) => replies(ls, p.token).length > 0),
      10_000,
    );
    for (const post of posts) {
      const mine = postsOf(drawn, post.token).length;
      const theirs = replies(drawn, post.token).length;
      if (mine !== 1 || theirs !== 1) {
        fail("once", `after the reload, ${post.token} shows as a post ${mine} times and as ${fixture.replier.id}'s line ${theirs} times (want 1 and 1)`);
      }
    }
    evidence.push(`after the reload, each of the ${posts.length} posts and its reply shows once`);
  } finally {
    await browser.close();
    server?.stop();
  }

  // A control must redden each leg it names, and only those.
  if (CONTROL !== "") {
    const want = EXPECTED[CONTROL]!;
    const legs = new Set(failures.map((f) => /^\[([^\]]+)\]/.exec(f)?.[1] ?? ""));
    for (const leg of want) {
      if (!legs.has(leg)) failures.push(`[control] GOAL_CONTROL=${CONTROL} left the ${leg} leg green, so that leg cannot fail`);
    }
    for (const leg of legs) {
      if (!want.includes(leg) && leg !== "control") failures.push(`[control] GOAL_CONTROL=${CONTROL} also reddened the ${leg} leg`);
    }
  }
  return { failures, evidence: evidence.join("; ") };
});
