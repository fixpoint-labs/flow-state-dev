/**
 * Goal check: when a person posts to `support.desk` from the kitchen-sink page,
 * each agent seat in that channel runs once on the post and no other seat
 * runs, and each run is there in that seat's conversation after a reload.
 *
 * Real path, scripted model, out of CI. See goal.md for the contract.
 *
 * One real browser against the app's PRODUCTION build (built here, never
 * assumed), on its scripted model, keyless. Three legs:
 *
 *   support.iris, support.otto  post a line carrying a fresh token from the
 *         channel's panel; reload; open every conversation the seat lists.
 *         Exactly one holds the token: the post heard once, as the seat's
 *         turn, with one reply carrying the wake marker under it. Then a
 *         second line, different text; reload; it is in that same
 *         conversation, heard once, answered once.
 *   others  support.ada, support.grace and support.wren hold nothing with
 *         either token.
 *
 * Everything graded is read off the page after a reload, from the seats' own
 * conversations, so only a run the server kept can pass.
 *
 * Run:      PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers pnpm tsx goals/kitchen-sink-talk/a-post-runs-each-member-agent-once/run.mts
 * Controls: GOAL_CONTROL=name-only-notify  (today's stub: must FAIL at support.iris and support.otto, and nothing else)
 *           GOAL_CONTROL=no-author-filter  (leg c's control: must leave every leg here green)
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
  agents: Seat[];
  others: Seat[];
  marker: string;
  replyMarker: string;
}

const fixture = loadFixture<Fixture>(import.meta.url);
const CONTROL = process.env.GOAL_CONTROL ?? "";

/** The legs each control must redden, and only those. */
const EXPECTED: Record<string, string[]> = {
  "name-only-notify": fixture.agents.map((seat) => seat.id),
  // Leg c's control (a seat's own post wakes nobody). A post from the page has
  // no author, so here it must change nothing.
  "no-author-filter": [],
};
if (CONTROL !== "" && EXPECTED[CONTROL] === undefined) {
  throw new Error(`unknown GOAL_CONTROL "${CONTROL}"; known: ${Object.keys(EXPECTED).join(", ")}`);
}

type Conversation = { sessionId: string; runOf: string | null; messages: Array<{ role: string; text: string }> };

/** Post a line to the channel from its panel, and wait until it shows. */
async function post(page: Page, origin: string, line: string): Promise<void> {
  await openShell(page, origin);
  await open(page, fixture.channel.kind);
  await row(page, fixture.channel.id).click();
  await panel(page).getByLabel("Post to this channel").fill(line);
  await panel(page).getByRole("button", { name: "Send" }).click();
  await readUntil(
    () => panel(page).getByTestId("channel-line").filter({ hasText: line }).count(),
    (n) => n > 0,
    10_000,
  );
}

/**
 * Let every agent seat answer `token` before the reload. Not graded: a seat
 * that never ran simply times out here and fails on the page below.
 */
async function letAgentsAnswer(page: Page, origin: string, token: string, replies: number): Promise<void> {
  const answered = async (seat: string): Promise<boolean> => {
    const listed = await page.request.get(`${origin}/api/flows/sessions?flowId=${seat}&include=dispatch-runs&limit=100`);
    const { sessions } = (await listed.json()) as { sessions: Array<{ id: string }> };
    for (const session of sessions) {
      const state = await page.request.get(`${origin}/api/flows/sessions/${session.id}/state?include_items=true&item_types=message&limit=1000`);
      const text = await state.text();
      if (text.includes(token) && text.split(fixture.replyMarker).length - 1 >= replies) return true;
    }
    return false;
  };
  await readUntil(
    async () => (await Promise.all(fixture.agents.map((seat) => answered(seat.id)))).every(Boolean),
    (done) => done,
    20_000,
  );
}

/** Reload, then open every conversation `seat` lists and read each as drawn. */
async function conversationsOf(page: Page, origin: string, seat: Seat): Promise<Conversation[]> {
  await page.reload();
  await openShell(page, origin);
  await open(page, seat.kind);
  await open(page, seat.id);
  const leaf = rail(page).locator(`ul[data-leaf="${seat.id}"]`);
  await leaf.waitFor({ timeout: 15_000 });
  // The list is loaded once it shows a row or says it has none.
  await readUntil(
    async () => (await leaf.locator("[data-session-id]").count()) + (await leaf.getByText("No sessions yet").count()),
    (n) => n > 0,
    10_000,
  );
  const rows = await leaf.locator("[data-session-id]").evaluateAll((buttons) =>
    buttons.map((button) => ({
      sessionId: button.getAttribute("data-session-id") ?? "",
      runOf: button.getAttribute("data-dispatch-run-of"),
    })),
  );
  const out: Conversation[] = [];
  for (const listed of rows) {
    await leaf.locator(`[data-session-id="${listed.sessionId}"]`).click();
    const messages = await readUntil(() => conversation(page), (ms) => ms.length > 0, 5_000);
    out.push({ ...listed, messages });
  }
  return out;
}

// ---------------------------------------------------------------------------

await runGoal(async () => {
  const failures: string[] = [];
  const evidence: string[] = [];
  const fail = (leg: string, line: string) => failures.push(`[${leg}] ${line}`);
  const run = randomUUID().replace(/-/g, "").slice(0, 10);
  const firstToken = `wake-token-a${run}`;
  const secondToken = `wake-token-b${run}`;
  const firstLine = `${fixture.marker} ${firstToken} can someone look at the refund queue?`;
  const secondLine = `${fixture.marker} ${secondToken} and the shipping one, while you are there`;

  buildKitchenSink();

  const browser = await launchChromium();
  let server: KitchenSinkServer | undefined;
  try {
    // Keyless: the scripted model answers, and no key is there to fall back on.
    server = await startKitchenSink(fixture.port, { AI_GATEWAY_API_KEY: "" });
    const origin = server.origin;
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });

    /** One agent seat's conversations holding `token`, graded: one, heard once, one reply under it. */
    const gradeAgent = (seat: Seat, convs: Conversation[], token: string, label: string): Conversation | undefined => {
      const holding = convs.filter((c) => c.messages.some((m) => m.text.includes(token)));
      if (holding.length !== 1) {
        fail(seat.id, `after the reload, ${holding.length} of ${seat.id}'s ${convs.length} conversations hold the ${label} post (want 1): it never ran on it, or ran in more than one`);
        return undefined;
      }
      const [conv] = holding;
      const heard = conv!.messages.findIndex((m) => m.role === "user" && m.text.includes(token));
      const heardCount = conv!.messages.filter((m) => m.role === "user" && m.text.includes(token)).length;
      if (heard === -1 || heardCount !== 1) {
        fail(seat.id, `${seat.id}'s conversation holds the ${label} post as its turn ${heardCount} times (want 1); roles on screen: ${conv!.messages.map((m) => m.role).join(", ")}`);
        return undefined;
      }
      const next = conv!.messages[heard + 1];
      if (next === undefined || next.role !== "assistant" || !next.text.includes(fixture.replyMarker)) {
        fail(seat.id, `no reply carrying ${fixture.replyMarker} sits under the ${label} post in ${seat.id}'s conversation; under it: ${JSON.stringify(next ?? null)}`);
        return undefined;
      }
      return conv;
    };

    // ---- the first post ---------------------------------------------------
    await post(page, origin, firstLine);
    await letAgentsAnswer(page, origin, firstToken, 1);
    const firstConversation = new Map<string, Conversation>();
    for (const seat of fixture.agents) {
      const conv = gradeAgent(seat, await conversationsOf(page, origin, seat), firstToken, "first");
      if (conv !== undefined) firstConversation.set(seat.id, conv);
    }

    // ---- a second post, different text: the same conversation --------------
    await post(page, origin, secondLine);
    await letAgentsAnswer(page, origin, secondToken, 2);
    for (const seat of fixture.agents) {
      const convs = await conversationsOf(page, origin, seat);
      const conv = gradeAgent(seat, convs, secondToken, "second");
      const first = firstConversation.get(seat.id);
      if (conv === undefined || first === undefined) continue;
      if (conv.sessionId !== first.sessionId) {
        fail(seat.id, `the second post landed in ${conv.sessionId}, not in the conversation the first one did (${first.sessionId})`);
      } else if (!conv.messages.some((m) => m.role === "user" && m.text.includes(firstToken))) {
        fail(seat.id, `the conversation holding the second post no longer shows the first`);
      } else {
        evidence.push(
          `${seat.id}: after a reload, one conversation ${conv.sessionId} (listed as a run of ${conv.runOf ?? "nothing"}) holds both posts as its turns, ` +
            `${JSON.stringify(conv.messages.find((m) => m.role === "user" && m.text.includes(firstToken))!.text)} with a ${fixture.replyMarker} reply under each`,
        );
      }
    }

    // ---- nobody else ran ----------------------------------------------------
    for (const seat of fixture.others) {
      const convs = await conversationsOf(page, origin, seat);
      const holding = convs.filter((c) => c.messages.some((m) => m.text.includes(firstToken) || m.text.includes(secondToken)));
      if (holding.length > 0) {
        fail("others", `${seat.id} holds ${holding.length} conversation(s) with the posts' tokens: a post ran a seat that is not an agent`);
      } else {
        evidence.push(`${seat.id}: none of its ${convs.length} conversations holds either token`);
      }
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
