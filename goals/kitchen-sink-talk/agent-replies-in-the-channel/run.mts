/**
 * Goal check: a person posts to `support.desk`, and `support.otto`'s reply
 * appears in that channel under its own name, is still there after a reload,
 * and wakes nobody.
 *
 * Real path, scripted model, out of CI. See goal.md for the contract.
 *
 * One real browser against the app's PRODUCTION build (built here, never
 * assumed), on its scripted model, keyless. Two posts from the channel's
 * panel, each carrying a fresh token, then one reload. Three legs, graded per
 * post:
 *
 *   line        the channel shows exactly one line carrying the post's token
 *               and the line marker: otto's reply, kept by the channel.
 *   author      that line is labelled `support.otto`.
 *   woken-once  `support.iris` and `support.otto` each list one run of the
 *               channel, holding the token in exactly one turn: the person's
 *               post. A second turn with the token is otto's line waking a seat.
 *
 * Everything graded is read off the page after a reload, so only what the
 * server kept can pass.
 *
 * Run:      PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers pnpm tsx goals/kitchen-sink-talk/agent-replies-in-the-channel/run.mts
 * Controls: GOAL_CONTROL=no-author-filter     (must FAIL at woken-once, and nothing else)
 *           GOAL_CONTROL=post-without-author  (must FAIL at author and woken-once, and nothing else)
 */
import { randomUUID } from "node:crypto";
import type { Page } from "playwright";
import { loadFixture, runGoal } from "../../lib/index.mts";
import {
  buildKitchenSink,
  conversation,
  open,
  openShell,
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
  channel: Seat;
  replier: Seat;
  agents: Seat[];
  marker: string;
  lineMarker: string;
}

const fixture = loadFixture<Fixture>(import.meta.url);
const CONTROL = process.env.GOAL_CONTROL ?? "";

/** The legs each control must redden, and only those. */
const EXPECTED: Record<string, string[]> = {
  // The wake's author filter dropped: otto's line, still signed, wakes both agents.
  "no-author-filter": ["woken-once"],
  // The tool sends no author: the line reads as the principal, and a line with
  // no author is a person's line to the fan-out, so it wakes both agents too.
  "post-without-author": ["author", "woken-once"],
};
if (CONTROL !== "" && EXPECTED[CONTROL] === undefined) {
  throw new Error(`unknown GOAL_CONTROL "${CONTROL}"; known: ${Object.keys(EXPECTED).join(", ")}`);
}

/** Open the channel's panel. */
async function openChannel(page: Page, origin: string): Promise<void> {
  await openShell(page, origin);
  await open(page, fixture.channel.kind);
  await row(page, fixture.channel.id).click();
  await panel(page).getByTestId("channel-transcript").waitFor({ timeout: 15_000 });
}

/** Post a line from the channel's panel, and wait until it shows. */
async function post(page: Page, line: string): Promise<void> {
  await panel(page).getByLabel("Post to this channel").fill(line);
  await panel(page).getByRole("button", { name: "Send" }).click();
  await readUntil(
    () => panel(page).getByTestId("channel-line").filter({ hasText: line }).count(),
    (n) => n > 0,
    10_000,
  );
}

/**
 * Let otto's line land and both agents answer before the reload, then give a
 * wrongly woken seat time to run. Not graded: whatever did not happen fails
 * on the page below.
 */
async function settle(page: Page, origin: string, token: string): Promise<void> {
  const channelHolds = async () => {
    const res = await page.request.get(
      `${origin}/api/flows/sessions/${fixture.channel.id}/state?include_items=true&item_types=component&limit=1000`,
    );
    const text = await res.text();
    return text.includes(fixture.lineMarker) && text.includes(token);
  };
  const answered = async (seat: string) => {
    const listed = await page.request.get(`${origin}/api/flows/sessions?flowId=${seat}&include=dispatch-runs&limit=100`);
    const { sessions } = (await listed.json()) as { sessions: Array<{ id: string }> };
    for (const session of sessions) {
      const state = await page.request.get(`${origin}/api/flows/sessions/${session.id}/state?include_items=true&item_types=message&limit=1000`);
      if ((await state.text()).includes(token)) return true;
    }
    return false;
  };
  await readUntil(
    async () => (await channelHolds()) && (await Promise.all(fixture.agents.map((s) => answered(s.id)))).every(Boolean),
    (done) => done,
    20_000,
  );
  await page.waitForTimeout(1_500);
}

/** A seat's runs of the channel, each read as drawn. The page is already reloaded. */
async function channelRunsOf(page: Page, origin: string, seat: Seat): Promise<Array<Array<{ role: string; text: string }>>> {
  await openShell(page, origin);
  await open(page, seat.kind);
  await open(page, seat.id);
  const leaf = rail(page).locator(`ul[data-leaf="${seat.id}"]`);
  await leaf.waitFor({ timeout: 15_000 });
  await readUntil(
    async () => (await leaf.locator("[data-session-id]").count()) + (await leaf.getByText("No sessions yet").count()),
    (n) => n > 0,
    10_000,
  );
  const runs = leaf.locator(`[data-dispatch-run-of="${fixture.channel.id}"]`);
  const ids = await runs.evaluateAll((buttons) => buttons.map((b) => b.getAttribute("data-session-id") ?? ""));
  const out: Array<Array<{ role: string; text: string }>> = [];
  for (const id of ids) {
    await leaf.locator(`[data-session-id="${id}"]`).click();
    out.push(await readUntil(() => conversation(page), (ms) => ms.length > 0, 5_000));
  }
  return out;
}

// ---------------------------------------------------------------------------

await runGoal(async () => {
  const failures: string[] = [];
  const evidence: string[] = [];
  const fail = (leg: string, line: string) => failures.push(`[${leg}] ${line}`);
  const run = randomUUID().replace(/-/g, "").slice(0, 10);
  const tokens = [`reply-token-a${run}`, `reply-token-b${run}`];
  const lines = [
    `${fixture.marker} ${tokens[0]} when do refunds post?`,
    `${fixture.marker} ${tokens[1]} and exchanges, the same day?`,
  ];

  buildKitchenSink();

  const browser = await launchChromium();
  let server: KitchenSinkServer | undefined;
  try {
    // Keyless: the scripted model answers, and no key is there to fall back on.
    server = await startKitchenSink(fixture.port, { AI_GATEWAY_API_KEY: "" });
    const origin = server.origin;
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });

    await openChannel(page, origin);
    for (const [i, line] of lines.entries()) {
      await post(page, line);
      await settle(page, origin, tokens[i]!);
    }

    // ---- after one reload, the channel as drawn ------------------------------
    await page.reload();
    await openChannel(page, origin);
    const drawn = await readUntil(
      () =>
        panel(page)
          .getByTestId("channel-line")
          .evaluateAll((els) =>
            els.map((el) => ({
              label: el.querySelector('[data-testid="channel-line-label"]')?.textContent ?? "",
              text: el.textContent ?? "",
            })),
          ),
      (ls) => tokens.every((t) => ls.some((l) => l.text.includes(t))),
      10_000,
    );
    for (const token of tokens) {
      const replies = drawn.filter((l) => l.text.includes(token) && l.text.includes(fixture.lineMarker));
      if (replies.length !== 1) {
        fail("line", `after the reload, ${fixture.channel.id} shows ${replies.length} lines carrying ${token} and ${fixture.lineMarker} (want 1)`);
        continue;
      }
      if (replies[0]!.label !== fixture.replier.id) {
        fail("author", `the reply line for ${token} is labelled "${replies[0]!.label}", not ${fixture.replier.id}`);
        continue;
      }
      evidence.push(`${fixture.channel.id}: one line for ${token}, labelled ${replies[0]!.label}: ${JSON.stringify(replies[0]!.text)}`);
    }

    // ---- each agent heard each post once, and never otto's line ------------
    for (const seat of fixture.agents) {
      const runs = await channelRunsOf(page, origin, seat);
      if (runs.length !== 1) {
        fail("woken-once", `${seat.id} lists ${runs.length} runs of ${fixture.channel.id} (want 1)`);
        continue;
      }
      let once = true;
      for (const token of tokens) {
        const heard = runs[0]!.filter((m) => m.role === "user" && m.text.includes(token));
        if (heard.length !== 1 || !heard[0]!.text.includes(fixture.marker)) {
          once = false;
          fail(
            "woken-once",
            `${seat.id} heard ${token} in ${heard.length} turns (want 1, the person's post): ${JSON.stringify(heard.map((m) => m.text))}`,
          );
        }
      }
      if (once) evidence.push(`${seat.id}: one run of ${fixture.channel.id}, each token heard once, in the person's post`);
    }
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
