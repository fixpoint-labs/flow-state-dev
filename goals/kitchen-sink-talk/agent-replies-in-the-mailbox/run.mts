/**
 * Goal check: a person posts to `support.help`, and the specialist the
 * coordinator's best fit picks, `support.devices`, answers in the person's
 * conversation under its own name. The line is still there after a reload,
 * and wakes nobody.
 *
 * Real path, scripted model, out of CI. See goal.md for the contract.
 *
 * One real browser against the app's PRODUCTION build (built here, never
 * assumed), on its scripted model, keyless. Two posts from the coordinator's
 * panel, each naming `support.devices` (`[route:support.devices]`) and each
 * with a fresh token; then one reload, after which everything is read off
 * the page:
 *
 *   line        for each token, the conversation shows exactly one line
 *               carrying it and the line marker: the specialist's answer.
 *   author      that line is labelled `support.devices`, not `devuser`.
 *   woken-once  `support.devices` has one session for the conversation, and in
 *               it each token is in exactly one turn, the person's post.
 *               support.accounts, support.fsd and support.general hold no
 *               session with either token.
 *
 * Which sessions are a specialist's is read from the server, by the session's
 * `workerId`, as an index; what each holds is read off the page.
 *
 * Run:      PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers pnpm tsx goals/kitchen-sink-talk/agent-replies-in-the-mailbox/run.mts
 * Controls: GOAL_CONTROL=answers-go-on   (the coordinator read with `rounds: 1`: must FAIL at woken-once, and nothing else)
 *           GOAL_CONTROL=no-author-name  (the page served each line without its writer's name: must FAIL at author, and nothing else)
 */
import { randomUUID } from "node:crypto";
import type { Page } from "playwright";
import { loadFixture, runGoal } from "../../lib/index.mts";
import {
  buildKitchenSink,
  conversation,
  coordinatorConversation,
  openShell,
  openWorkerCopy,
  panel,
  readUntil,
  showCoordinator,
  startKitchenSink,
  workerSessions,
  type KitchenSinkServer,
} from "../../lib/kitchen-sink.mts";
import { launchChromium } from "../../lib/playwright.mts";

interface Seat {
  kind: string;
  id: string;
}

interface Fixture {
  port: number;
  coordinator: Seat;
  replier: Seat;
  /** The delegates best fit passes over. */
  others: Seat[];
  /** The tag the scripted evaluation reads to pick who answers. */
  route: string;
  marker: string;
  lineMarker: string;
}

const fixture = loadFixture<Fixture>(import.meta.url);
const CONTROL = process.env.GOAL_CONTROL ?? "";

/** The legs each control must redden, and only those. */
const EXPECTED: Record<string, string[]> = {
  // Each answer goes back out, never to its writer: best fit places it on the
  // fallback, which is handed the specialist's words, token and all.
  "answers-go-on": ["woken-once"],
  // The page reads each line's writer off what the server keeps; served
  // without it, the answer is drawn under no specialist's name.
  "no-author-name": ["author"],
};
if (CONTROL !== "" && EXPECTED[CONTROL] === undefined) {
  throw new Error(`unknown GOAL_CONTROL "${CONTROL}"; known: ${Object.keys(EXPECTED).join(", ")}`);
}

/**
 * `no-author-name`, at the page's `fetch`: every session read, action stream
 * and live session stream reaches the page with each message's `agentName`
 * taken off, before and after the reload alike. What the page sees when the
 * server keeps no writer on a line. The server is untouched: the control
 * graded here is that the page draws the writer the server kept.
 *
 * At the page's `fetch`, not with Playwright's routing: the live session
 * stream never ends, and a routed response is read whole before the page gets
 * any of it. Plain JavaScript in a string: a function handed to Playwright is
 * compiled by tsx first, which adds helpers the page does not have.
 */
const STRIP_AUTHOR = `(() => {
  const strip = (item) => {
    if (item != null && item.type === "message" && "agentName" in item) delete item.agentName;
    return item;
  };
  const original = window.fetch.bind(window);
  window.fetch = async (input, init) => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url, location.href);
    const method = String((init && init.method) || (input instanceof Request ? input.method : "GET")).toUpperCase();
    const read = method === "GET" && /^\\/api\\/flows\\/sessions\\/[^/]+\\/(state|stream)$/.test(url.pathname);
    const action = method === "POST" && /\\/actions\\/[^/]+$/.test(url.pathname);
    const response = await original(input, init);
    if (!read && !action) return response;
    const type = response.headers.get("content-type") || "";
    if (type.includes("application/json")) {
      const json = await response.json();
      if (json && Array.isArray(json.items)) json.items.forEach(strip);
      return new Response(JSON.stringify(json), { status: response.status, statusText: response.statusText, headers: response.headers });
    }
    if (!type.includes("text/event-stream") || response.body === null) return response;
    const decoder = new TextDecoder();
    const encoder = new TextEncoder();
    let buffer = "";
    const rewrite = (frame) => frame.split("\\n").map((line) => {
      if (!line.startsWith("data:")) return line;
      try {
        const parsed = JSON.parse(line.slice(5).trim());
        if (parsed && parsed.item) strip(parsed.item);
        return "data: " + JSON.stringify(parsed);
      } catch { return line; }
    }).join("\\n");
    const filtered = response.body.pipeThrough(new TransformStream({
      transform(chunk, controller) {
        buffer += decoder.decode(chunk, { stream: true });
        for (let at = buffer.indexOf("\\n\\n"); at !== -1; at = buffer.indexOf("\\n\\n")) {
          const frame = buffer.slice(0, at);
          buffer = buffer.slice(at + 2);
          controller.enqueue(encoder.encode(rewrite(frame) + "\\n\\n"));
        }
      },
      flush(controller) { if (buffer !== "") controller.enqueue(encoder.encode(rewrite(buffer))); },
    }));
    return new Response(filtered, { status: response.status, statusText: response.statusText, headers: response.headers });
  };
})();`;

/** Open the person's conversation with the coordinator in the panel. */
async function openHelpDesk(page: Page, origin: string): Promise<void> {
  await openShell(page, origin);
  await showCoordinator(page, fixture.coordinator.id);
}

/** Post a line from the conversation's panel, and wait until it shows. */
async function post(page: Page, line: string): Promise<void> {
  await panel(page).getByLabel("Post to this coordinator").fill(line);
  await panel(page).getByRole("button", { name: "Send" }).click();
  await readUntil(
    () => panel(page).getByTestId("coordinator-line").filter({ hasText: line }).count(),
    (n) => n > 0,
    10_000,
  );
}

/**
 * Let the specialist's line land and its turn finish before the reload, then
 * give a wrongly woken delegate time to run. Not graded: whatever did not
 * happen fails on the page below.
 */
async function settle(page: Page, origin: string, token: string): Promise<void> {
  const conversationHolds = async () => {
    const id = await coordinatorConversation(page, origin, fixture.coordinator.id);
    if (id === undefined) return false;
    const res = await page.request.get(`${origin}/api/flows/sessions/${id}/state?include_items=true&item_types=message&limit=1000`);
    const text = await res.text();
    return text.includes(fixture.lineMarker) && text.includes(token);
  };
  const answered = async (seat: string) => {
    for (const session of await workerSessions(page, origin, seat, { runs: true })) {
      const state = await page.request.get(`${origin}/api/flows/sessions/${session.id}/state?include_items=true&item_types=message&limit=1000`);
      if ((await state.text()).includes(token)) return true;
    }
    return false;
  };
  await readUntil(
    async () => (await conversationHolds()) && (await answered(fixture.replier.id)),
    (done) => done,
    20_000,
  );
  await page.waitForTimeout(1_500);
}

/** A delegate's sessions for the person's conversation, each read as drawn. The page is already reloaded. */
async function delegateRunsOf(page: Page, origin: string, seat: Seat): Promise<Array<Array<{ role: string; text: string }>>> {
  await openShell(page, origin);
  const parent = await coordinatorConversation(page, origin, fixture.coordinator.id);
  const runs = (await workerSessions(page, origin, seat.id, { runs: true })).filter((s) => s.parentSessionId === parent);
  if (runs.length === 0) return [];
  const leaf = await openWorkerCopy(page);
  const out: Array<Array<{ role: string; text: string }>> = [];
  let last = "";
  for (const { id } of runs) {
    const button = leaf.locator(`[data-session-id="${id}"]`);
    await button.waitFor({ timeout: 10_000 });
    await button.click();
    const messages = await readUntil(() => conversation(page), (ms) => ms.length > 0 && JSON.stringify(ms) !== last, 5_000);
    last = JSON.stringify(messages);
    out.push(messages);
  }
  return out;
}

// ---------------------------------------------------------------------------

await runGoal(async (failures) => {
  const evidence: string[] = [];
  const fail = (leg: string, line: string) => failures.push(`[${leg}] ${line}`);
  const run = randomUUID().replace(/-/g, "").slice(0, 10);
  const tokens = [`reply-token-a${run}`, `reply-token-b${run}`];
  const lines = [
    `${fixture.route} ${fixture.marker} ${tokens[0]} the office printer shows offline again`,
    `${fixture.route} ${fixture.marker} ${tokens[1]} and the one on the second floor, the same fix?`,
  ];

  buildKitchenSink();

  const browser = await launchChromium();
  let server: KitchenSinkServer | undefined;
  try {
    // Keyless: the scripted model answers, and no key is there to fall back on.
    server = await startKitchenSink(fixture.port, { AI_GATEWAY_API_KEY: "" });
    const origin = server.origin;
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    if (CONTROL === "no-author-name") await page.addInitScript({ content: STRIP_AUTHOR });

    await openHelpDesk(page, origin);
    for (const [i, line] of lines.entries()) {
      await post(page, line);
      await settle(page, origin, tokens[i]!);
    }

    // ---- after one reload, the conversation as drawn ------------------------
    await page.reload();
    await openHelpDesk(page, origin);
    const drawn = await readUntil(
      () =>
        panel(page)
          .getByTestId("coordinator-line")
          .evaluateAll((els) =>
            els.map((el) => ({
              label: el.querySelector('[data-testid="coordinator-line-label"]')?.textContent ?? "",
              text: el.textContent ?? "",
            })),
          ),
      (ls) => tokens.every((t) => ls.some((l) => l.text.includes(t))),
      10_000,
    );
    for (const token of tokens) {
      const replies = drawn.filter((l) => l.text.includes(token) && l.text.includes(fixture.lineMarker));
      if (replies.length !== 1) {
        fail("line", `after the reload, the conversation with ${fixture.coordinator.id} shows ${replies.length} lines carrying ${token} and ${fixture.lineMarker} (want 1)`);
        continue;
      }
      if (replies[0]!.label !== fixture.replier.id) {
        fail("author", `the reply line for ${token} is labelled "${replies[0]!.label}", not ${fixture.replier.id}`);
        continue;
      }
      evidence.push(`the conversation with ${fixture.coordinator.id}: one line for ${token}, labelled ${replies[0]!.label}: ${JSON.stringify(replies[0]!.text)}`);
    }

    // ---- the specialist heard each post once, and nobody heard its line ----
    const runs = await delegateRunsOf(page, origin, fixture.replier);
    if (runs.length !== 1) {
      fail("woken-once", `${fixture.replier.id} has ${runs.length} sessions for the conversation with ${fixture.coordinator.id} (want 1)`);
    } else {
      let once = true;
      for (const token of tokens) {
        const heard = runs[0]!.filter((m) => m.role === "user" && m.text.includes(token));
        if (heard.length !== 1 || !heard[0]!.text.includes(fixture.marker)) {
          once = false;
          fail(
            "woken-once",
            `${fixture.replier.id} heard ${token} in ${heard.length} turns (want 1, the person's post): ${JSON.stringify(heard.map((m) => m.text))}`,
          );
        }
      }
      if (once) evidence.push(`${fixture.replier.id}: one session for the conversation, each token heard once, in the person's post`);
    }
    for (const seat of fixture.others) {
      const theirs = await delegateRunsOf(page, origin, seat);
      const holding = theirs.filter((ms) => ms.some((m) => tokens.some((t) => m.text.includes(t))));
      if (holding.length > 0) {
        fail("woken-once", `${seat.id} holds ${holding.length} session(s) for the conversation with a post's token: the specialist's line woke it`);
      } else {
        evidence.push(`${seat.id}: none of its ${theirs.length} sessions for the conversation holds either token`);
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
