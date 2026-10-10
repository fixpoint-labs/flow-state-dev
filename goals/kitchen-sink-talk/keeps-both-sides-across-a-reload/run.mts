/**
 * Goal check: from the kitchen-sink page, a person talks to a specialist and
 * posts to the support desk's coordinator, and after a reload both
 * conversations are still there, showing who said what.
 *
 * Real path, scripted model, out of CI. See goal.md for the contract.
 *
 * Two legs, in one real browser against the app's PRODUCTION build (built
 * here, never assumed), on its scripted model:
 *
 *   coordinator  post a unique line to `support.help` from its panel; reload;
 *                the line is in the person's conversation with the
 *                coordinator, labelled with the app's one user.
 *   seat         "Talk" on `support.devices` in the roster, send a unique
 *                message; reload and reopen that conversation from the rail;
 *                the message is there as the person's turn and the scripted
 *                reply is under it.
 *
 * The third leg this check once had, a seat whose kind takes no messages, has
 * no seat to run on: every seat in this roster is an `agent`, and the rail
 * lists only the kinds the shell names. It is checked on the panel itself, in
 * `apps/kitchen-sink/test/picked-session-panel.test.tsx`.
 *
 * Everything graded is read after the reload, so only what the server kept can
 * pass. The page draws no optimistic copy of either side.
 *
 * Run:      PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers pnpm tsx goals/kitchen-sink-talk/keeps-both-sides-across-a-reload/run.mts
 * Controls: GOAL_CONTROL=drop-coordinator-post  (must FAIL at the coordinator leg only)
 *           GOAL_CONTROL=drop-user-message      (must FAIL at the seat leg only)
 * Held-out: GOAL_SEAT=<another specialist>
 */
import { randomUUID } from "node:crypto";
import type { Page } from "playwright";
import { loadFixture, runGoal } from "../../lib/index.mts";
import {
  buildKitchenSink,
  conversation,
  COORDINATOR_FLOW,
  openShell as openShellAt,
  openWorkerCopy,
  panel,
  readUntil,
  showCoordinator,
  startKitchenSink,
  talkTo,
  workerSessions,
  WORKER_FLOW,
  type KitchenSinkServer,
} from "../../lib/kitchen-sink.mts";
import { launchChromium } from "../../lib/playwright.mts";

interface Fixture {
  port: number;
  coordinator: { kind: string; id: string; label: string };
  seat: { kind: string; id: string; marker: string; replyMarker: string };
}

const fixture = loadFixture<Fixture>(import.meta.url);
const ORIGIN = `http://127.0.0.1:${fixture.port}`;
// The roster has one coordinator, so only the seat has a held-out override.
const COORDINATOR = fixture.coordinator.id;
const SEAT = process.env.GOAL_SEAT ?? fixture.seat.id;
const CONTROL = process.env.GOAL_CONTROL ?? "";

/** The one leg each control must redden, and only that one. */
const EXPECTED: Record<string, string> = {
  "drop-coordinator-post": "coordinator",
  "drop-user-message": "seat",
};
if (CONTROL !== "" && EXPECTED[CONTROL] === undefined) {
  throw new Error(`unknown GOAL_CONTROL "${CONTROL}"; known: ${Object.keys(EXPECTED).join(", ")}`);
}

/** The flow whose sessions each control strips the person's messages from. */
const STRIPPED_FLOW: Record<string, string> = {
  "drop-coordinator-post": COORDINATOR_FLOW,
  "drop-user-message": WORKER_FLOW,
};

// ---------------------------------------------------------------------------
// The controls: what the page is served, with one kept side taken out
// ---------------------------------------------------------------------------

/**
 * Runs in the page before its own scripts, under a control. Every session read,
 * every action stream and every live session stream of the control's flow
 * reaches the page without the person's messages, before and after the reload
 * alike: what the page sees when the server keeps none on that side. The
 * person's post to the coordinator and their message to the seat are both
 * `user` messages, so each control names the flow it strips them from.
 *
 * An action's flow is in its path. A session read or stream carries only the
 * session's id, so its flow is learned from the session's state, which names
 * it (read once per session, unfiltered).
 *
 * At the page's `fetch`, not with Playwright's routing: the live session
 * stream (`GET /api/flows/sessions/:id/stream`) never ends, and a routed
 * response is read whole before the page gets any of it. So each stream is
 * filtered frame by frame as it arrives, and an item's later frames go with it.
 *
 * Plain JavaScript in a string: a function handed to Playwright is compiled by
 * tsx first, which adds helpers the page does not have.
 */
const STRIP_ITEMS = `(() => {
  const flow = ${JSON.stringify(STRIPPED_FLOW[CONTROL] ?? "")};
  const stripped = (item) => item != null && item.type === "message" && item.role === "user";
  const original = window.fetch.bind(window);
  const flows = new Map();
  const flowOf = (sessionId) => {
    if (!flows.has(sessionId)) {
      flows.set(sessionId, original("/api/flows/sessions/" + encodeURIComponent(sessionId) + "/state?limit=1")
        .then((res) => res.json())
        .then((json) => json.flowKind)
        .catch(() => undefined));
    }
    return flows.get(sessionId);
  };
  window.fetch = async (input, init) => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url, location.href);
    const method = String((init && init.method) || (input instanceof Request ? input.method : "GET")).toUpperCase();
    const read = method === "GET" ? /^\\/api\\/flows\\/sessions\\/([^/]+)\\/(state|stream)$/.exec(url.pathname) : null;
    const action = method === "POST" ? /^\\/api\\/flows\\/([^/]+)\\/actions\\/[^/]+$/.exec(url.pathname) : null;
    if (read === null && action === null) return original(input, init);
    const kind = action !== null ? decodeURIComponent(action[1]) : await flowOf(decodeURIComponent(read[1]));
    const response = await original(input, init);
    if (kind !== flow) return response;
    const type = response.headers.get("content-type") || "";
    if (type.includes("application/json")) {
      const json = await response.json();
      if (json && Array.isArray(json.items)) json.items = json.items.filter((item) => !stripped(item));
      return new Response(JSON.stringify(json), { status: response.status, statusText: response.statusText, headers: response.headers });
    }
    if (!type.includes("text/event-stream") || response.body === null) return response;
    const dropped = new Set();
    const decoder = new TextDecoder();
    const encoder = new TextEncoder();
    let buffer = "";
    const keep = (frame) => {
      const data = frame.split("\\n").filter((line) => line.startsWith("data:")).map((line) => line.slice(5).trim()).join("\\n");
      if (data === "") return true;
      let parsed;
      try { parsed = JSON.parse(data); } catch { return true; }
      if (parsed && stripped(parsed.item)) {
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

/** Under a control, filter what the page is served (`STRIP_ITEMS`). With no control nothing is added. */
async function applyControl(page: Page): Promise<void> {
  if (CONTROL === "") return;
  await page.addInitScript({ content: STRIP_ITEMS });
}

// ---------------------------------------------------------------------------
// The page, as a person uses it
// ---------------------------------------------------------------------------

const openShell = (page: Page) => openShellAt(page, ORIGIN);

/** The coordinator conversation's transcript as drawn: each line's label and body. */
const transcript = (page: Page) =>
  panel(page)
    .locator('[data-testid="coordinator-line"]')
    .evaluateAll((lines) =>
      lines.map((line) => ({
        label: line.querySelector('[data-testid="coordinator-line-label"]')?.textContent ?? "",
        body: line.querySelector('[data-testid="coordinator-line-body"]')?.textContent ?? "",
      })),
    );

// ---------------------------------------------------------------------------

await runGoal(async (failures) => {
  const evidence: string[] = [];
  const fail = (leg: string, line: string) => failures.push(`[${leg}] ${line}`);
  const run = randomUUID().slice(0, 8);
  const line = `goal line ${run}`;
  const message = `${fixture.seat.marker} goal message ${run}`;

  buildKitchenSink();

  const browser = await launchChromium();
  let server: KitchenSinkServer | undefined;
  try {
    // Keyless: the scripted model answers, and no key is there to fall back on.
    server = await startKitchenSink(fixture.port, { AI_GATEWAY_API_KEY: "" });
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    await applyControl(page);

    // ---- coordinator: post, reload, read ---------------------------------
    await openShell(page);
    await showCoordinator(page, COORDINATOR);
    await panel(page).getByLabel("Post to this coordinator").fill(line);
    await panel(page).getByRole("button", { name: "Send" }).click();
    // Let the post settle before the reload; nothing here is graded.
    await readUntil(() => panel(page).getByLabel("Post to this coordinator").inputValue(), (v) => v === "", 10_000);

    await page.reload();
    await openShell(page);
    await showCoordinator(page, COORDINATOR);
    const lines = await readUntil(() => transcript(page), (ls) => ls.some((l) => l.body === line));
    const found = lines.filter((l) => l.body === line);
    if (found.length !== 1) {
      fail("coordinator", `after the reload, ${COORDINATOR}'s conversation holds ${found.length} copies of the posted line "${line}" (want 1); it shows ${lines.length} lines`);
    } else if (found[0]!.label !== fixture.coordinator.label) {
      fail("coordinator", `the posted line reads as "${found[0]!.label}", not "${fixture.coordinator.label}"`);
    } else {
      evidence.push(`coordinator: after a reload, ${COORDINATOR}'s conversation shows "${line}" labelled ${found[0]!.label}, once`);
    }

    // ---- seat: Talk, a message, reload, reopen from the rail, read ---------
    await talkTo(page, SEAT);
    await panel(page).getByLabel("Message this seat").fill(message);
    await panel(page).getByRole("button", { name: "Send" }).click();
    await readUntil(() => conversation(page), (ms) => ms.some((m) => m.text.includes(fixture.seat.replyMarker)));
    // Which session "Talk" opened, from the server's index by worker. Not graded.
    const [talked, ...more] = await workerSessions(page, ORIGIN, SEAT);

    if (talked === undefined || more.length > 0) {
      fail("seat", `"Talk" on ${SEAT} left the person ${more.length + (talked === undefined ? 0 : 1)} conversations with it (want 1)`);
    } else {
      await page.reload();
      await openShell(page);
      const leaf = await openWorkerCopy(page);
      await leaf.locator(`[data-session-id="${talked.id}"]`).click();
      const messages = await readUntil(
        () => conversation(page),
        (ms) => ms.some((m) => m.text.includes(message)) && ms.some((m) => m.text.includes(fixture.seat.replyMarker)),
      );
      const asked = messages.findIndex((m) => m.role === "user" && m.text.includes(message));
      const answered = messages.findIndex((m) => m.role === "assistant" && m.text.includes(fixture.seat.replyMarker));
      if (asked === -1) {
        fail("seat", `after the reload, ${SEAT}'s conversation does not hold the person's message "${message}" as their turn (roles on screen: ${messages.map((m) => m.role).join(", ") || "none"})`);
      }
      if (answered === -1) {
        fail("seat", `after the reload, ${SEAT}'s conversation holds no scripted reply (${fixture.seat.replyMarker})`);
      } else if (asked !== -1 && answered < asked) {
        fail("seat", `the reply sits above the message it answers`);
      }
      if (asked !== -1 && answered > asked) {
        evidence.push(`seat: after a reload, ${SEAT}'s conversation ${talked.id}, reopened from the rail, shows the message as the user's turn and the scripted reply under it`);
      }
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
