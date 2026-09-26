/**
 * Goal check: from the kitchen-sink page, a person talks to an agent seat and
 * posts to a channel, and after a reload both conversations are still there,
 * showing who said what.
 *
 * Real path, scripted model, out of CI. See goal.md for the contract.
 *
 * Three legs, in one real browser against the app's PRODUCTION build (built
 * here, never assumed), on its scripted model:
 *
 *   desk  post a unique line to the channel from its panel; reload; the line is
 *         in the channel's transcript, labelled with the app's one user.
 *   otto  start a conversation on the agent seat from its row, send a unique
 *         message; reload; the message is there as the person's turn and the
 *         scripted reply is under it.
 *   wren  a seat whose kind takes no messages has no composer and says why.
 *
 * Everything graded is read after the reload, so only what the server kept can
 * pass. The page draws no optimistic copy of either side.
 *
 * Run:      PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers pnpm tsx goals/kitchen-sink-talk/keeps-both-sides-across-a-reload/run.mts
 * Controls: GOAL_CONTROL=no-post-item       (must FAIL at the desk leg only)
 *           GOAL_CONTROL=drop-user-message  (must FAIL at the otto leg only)
 * Held-out: GOAL_CHANNEL=<another built-in channel> GOAL_SEAT=<another agent seat>
 */
import { randomUUID } from "node:crypto";
import type { Page, Route } from "playwright";
import { loadFixture, runGoal } from "../../lib/index.mts";
import {
  buildKitchenSink,
  conversation,
  newConversation,
  open,
  openShell as openShellAt,
  panel,
  rail,
  readUntil,
  row,
  startKitchenSink,
  type KitchenSinkServer,
} from "../../lib/kitchen-sink.mts";
import { launchChromium } from "../../lib/playwright.mts";

interface Fixture {
  port: number;
  channel: { kind: string; id: string; label: string };
  seat: { kind: string; id: string; marker: string; replyMarker: string };
  readOnlySeat: { kind: string; id: string };
}

const fixture = loadFixture<Fixture>(import.meta.url);
const ORIGIN = `http://127.0.0.1:${fixture.port}`;
const CHANNEL = process.env.GOAL_CHANNEL ?? fixture.channel.id;
const SEAT = process.env.GOAL_SEAT ?? fixture.seat.id;
const CONTROL = process.env.GOAL_CONTROL ?? "";

/** The one leg each control must redden, and only that one. */
const EXPECTED: Record<string, string> = {
  "no-post-item": "desk",
  "drop-user-message": "otto",
};
if (CONTROL !== "" && EXPECTED[CONTROL] === undefined) {
  throw new Error(`unknown GOAL_CONTROL "${CONTROL}"; known: ${Object.keys(EXPECTED).join(", ")}`);
}

// ---------------------------------------------------------------------------
// The controls: what the page is served, with one kept side taken out
// ---------------------------------------------------------------------------

type Item = { id?: string; type?: string; component?: string; role?: string };

/** Whether an item survives the active control. */
function kept(item: Item): boolean {
  if (CONTROL === "no-post-item") return !(item.type === "component" && item.component === "channel-post");
  if (CONTROL === "drop-user-message") return !(item.type === "message" && item.role === "user");
  return true;
}

/**
 * Under a control, every session read and every action stream reaches the
 * page without the one kind of item the control names, before and after the
 * reload alike — which is what the page sees when the server keeps none. With
 * no control nothing is routed.
 */
async function applyControl(page: Page): Promise<void> {
  if (CONTROL === "") return;
  await page.route("**/api/flows/**", async (route: Route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    const isState = request.method() === "GET" && /\/sessions\/[^/]+\/state$/.test(path);
    const isAction = request.method() === "POST" && /\/actions\/[^/]+$/.test(path);
    if (!isState && !isAction) return route.fallback();
    const response = await route.fetch();
    const body = await response.text();
    const type = response.headers()["content-type"] ?? "";
    if (type.includes("application/json")) {
      const json = JSON.parse(body) as { items?: Item[] };
      if (Array.isArray(json.items)) json.items = json.items.filter(kept);
      return route.fulfill({ response, json });
    }
    if (type.includes("text/event-stream")) {
      const dropped = new Set<string>();
      const events = body.split("\n\n").filter((event) => {
        const data = event.split("\n").find((line) => line.startsWith("data:"));
        if (data === undefined) return true;
        const parsed = JSON.parse(data.slice(5).trim()) as { item?: Item; itemId?: string };
        if (parsed.item !== undefined && !kept(parsed.item)) {
          if (parsed.item.id !== undefined) dropped.add(parsed.item.id);
          return false;
        }
        return parsed.itemId === undefined || !dropped.has(parsed.itemId);
      });
      return route.fulfill({ response, body: events.join("\n\n") });
    }
    return route.fulfill({ response, body });
  });
}

// ---------------------------------------------------------------------------
// The page, as a person uses it
// ---------------------------------------------------------------------------

const openShell = (page: Page) => openShellAt(page, ORIGIN);

/** The channel's transcript as drawn: each line's label and body. */
const transcript = (page: Page) =>
  panel(page)
    .locator('[data-testid="channel-line"]')
    .evaluateAll((lines) =>
      lines.map((line) => ({
        label: line.querySelector('[data-testid="channel-line-label"]')?.textContent ?? "",
        body: line.querySelector('[data-testid="channel-line-body"]')?.textContent ?? "",
      })),
    );

// ---------------------------------------------------------------------------

await runGoal(async () => {
  const failures: string[] = [];
  const evidence: string[] = [];
  const fail = (leg: string, line: string) => failures.push(`[${leg}] ${line}`);
  const run = randomUUID().slice(0, 8);
  const line = `goal line ${run}`;
  const message = `${fixture.seat.marker} goal message ${run}`;

  buildKitchenSink();

  const browser = await launchChromium();
  let server: KitchenSinkServer | undefined;
  try {
    server = await startKitchenSink(fixture.port);
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    await applyControl(page);

    // ---- desk: post, reload, read ---------------------------------------
    await openShell(page);
    await open(page, fixture.channel.kind);
    await row(page, CHANNEL).click();
    await panel(page).getByLabel("Post to this channel").fill(line);
    await panel(page).getByRole("button", { name: "Send" }).click();
    // Let the post settle before the reload; nothing here is graded.
    await readUntil(() => panel(page).getByLabel("Post to this channel").inputValue(), (v) => v === "", 10_000);

    await page.reload();
    await openShell(page);
    await open(page, fixture.channel.kind);
    await row(page, CHANNEL).click();
    const lines = await readUntil(() => transcript(page), (ls) => ls.some((l) => l.body === line));
    const found = lines.filter((l) => l.body === line);
    if (found.length !== 1) {
      fail("desk", `after the reload, ${CHANNEL}'s transcript holds ${found.length} copies of the posted line "${line}" (want 1); it shows ${lines.length} lines`);
    } else if (found[0]!.label !== fixture.channel.label) {
      fail("desk", `the posted line reads as "${found[0]!.label}", not "${fixture.channel.label}"`);
    } else {
      evidence.push(`desk: after a reload, ${CHANNEL} shows "${line}" labelled ${found[0]!.label}, once`);
    }

    // ---- otto: a new conversation, a message, reload, read ---------------
    await open(page, fixture.seat.kind);
    await open(page, SEAT);
    await newConversation(page, SEAT);
    const sessionId = await rail(page)
      .locator(`ul[data-leaf="${SEAT}"] [aria-current="true"]`)
      .getAttribute("data-session-id");
    await panel(page).getByLabel("Message this seat").fill(message);
    await panel(page).getByRole("button", { name: "Send" }).click();
    await readUntil(() => conversation(page), (ms) => ms.some((m) => m.text.includes(fixture.seat.replyMarker)));

    if (sessionId === null) {
      fail("otto", `"New conversation" on ${SEAT} opened no conversation in the rail`);
    } else {
      await page.reload();
      await openShell(page);
      await open(page, fixture.seat.kind);
      await open(page, SEAT);
      await rail(page).locator(`[data-session-id="${sessionId}"]`).click();
      const messages = await readUntil(
        () => conversation(page),
        (ms) => ms.some((m) => m.text.includes(message)) && ms.some((m) => m.text.includes(fixture.seat.replyMarker)),
      );
      const asked = messages.findIndex((m) => m.role === "user" && m.text.includes(message));
      const answered = messages.findIndex((m) => m.role === "assistant" && m.text.includes(fixture.seat.replyMarker));
      if (asked === -1) {
        fail("otto", `after the reload, ${SEAT}'s conversation does not hold the person's message "${message}" as their turn (roles on screen: ${messages.map((m) => m.role).join(", ") || "none"})`);
      }
      if (answered === -1) {
        fail("otto", `after the reload, ${SEAT}'s conversation holds no scripted reply (${fixture.seat.replyMarker})`);
      } else if (asked !== -1 && answered < asked) {
        fail("otto", `the reply sits above the message it answers`);
      }
      if (asked !== -1 && answered > asked) {
        evidence.push(`otto: after a reload, ${SEAT}'s conversation ${sessionId} shows the message as the user's turn and the scripted reply under it`);
      }
    }

    // ---- wren: no composer, and the reason -------------------------------
    await open(page, fixture.readOnlySeat.kind);
    await open(page, fixture.readOnlySeat.id);
    await newConversation(page, fixture.readOnlySeat.id);
    // The previous seat's panel is still up until this one replaces it.
    await readUntil(
      () => rail(page).locator(`ul[data-leaf="${fixture.readOnlySeat.id}"] [aria-current="true"]`).count(),
      (n) => n === 1,
    );
    await page.waitForTimeout(500);
    const composers = await panel(page).locator('[data-testid="picked-composer"]').count();
    const reason = (await panel(page).locator('[data-testid="picked-read-only"]').textContent()) ?? "";
    if (composers !== 0 || reason.trim().length === 0) {
      fail("wren", `${fixture.readOnlySeat.id} shows ${composers} composer(s) and reason "${reason}" (want none, and a reason)`);
    } else {
      evidence.push(`wren: ${fixture.readOnlySeat.id} has no composer and says "${reason.trim()}"`);
    }
  } finally {
    await browser.close();
    server?.stop();
  }

  // A control must redden its own leg, and only that one.
  if (CONTROL !== "") {
    const want = EXPECTED[CONTROL]!;
    const legs = new Set(failures.map((f) => /^\[(\w+)\]/.exec(f)?.[1]));
    if (!legs.has(want)) failures.push(`[control] GOAL_CONTROL=${CONTROL} left the ${want} leg green, so that leg cannot fail`);
    for (const leg of legs) {
      if (leg !== want && leg !== "control") failures.push(`[control] GOAL_CONTROL=${CONTROL} also reddened the ${leg} leg`);
    }
  }
  return { failures, evidence: evidence.join("; ") };
});
