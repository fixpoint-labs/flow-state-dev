/**
 * Goal check: a person who opens kitchen-sink finds one support coordinator
 * and four specialists named for what they handle, and a question posted to
 * the coordinator gets one specialist's answer, under the specialist's name.
 *
 * Real path, scripted model, out of CI. See goal.md for the contract.
 *
 * Two legs, in one real browser against the app's PRODUCTION build (built
 * here, never assumed), on its scripted model, keyless:
 *
 *   roster  the rail's Coordinators section lists one kind, `coordinator`,
 *           opening on the person's conversation with `support.help`; its
 *           Workers section lists one kind, `agent`. The roster panel lists
 *           exactly `support.help` on `coordinator` and the four specialists
 *           on `agent`, each with its description; no "Hire another" anywhere.
 *   answer  post a question routed to the seat, with a fresh token; after a
 *           reload the conversation shows one line under the seat's name
 *           answering it, carrying the answer marker and not the token.
 *
 * `GOAL_LIVE=1`, with a key: the same build on real models and the app's own
 * route. Each of five posts gets exactly one answer line, under one of the
 * four specialists' names.
 *
 * Run:      PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers pnpm tsx goals/kitchen-sink-talk/answers-a-clerk-note-or-files-it/run.mts
 * Controls: GOAL_CONTROL=no-landing  (must FAIL at answer, and nothing else)
 * Held-out: GOAL_SEAT=<another specialist>
 * Live:     GOAL_LIVE=1 with AI_GATEWAY_API_KEY
 */
import { randomUUID } from "node:crypto";
import type { Page } from "playwright";
import { loadFixture, runGoal } from "../../lib/index.mts";
import {
  buildKitchenSink,
  coordinatorConversation,
  open,
  openShell as openShellAt,
  panel,
  rail,
  readUntil,
  showCoordinator,
  startKitchenSink,
  type KitchenSinkServer,
} from "../../lib/kitchen-sink.mts";
import { launchChromium } from "../../lib/playwright.mts";

interface Specialist {
  id: string;
  description: string;
}

interface Fixture {
  port: number;
  coordinator: { kind: string; id: string; description: string };
  workerKind: string;
  specialists: Specialist[];
  seat: string;
  answer: { marker: string; replyMarker: string };
  live: { posts: string[] };
}

const fixture = loadFixture<Fixture>(import.meta.url);
const SEAT = process.env.GOAL_SEAT ?? fixture.seat;
const CONTROL = process.env.GOAL_CONTROL ?? "";
const LIVE = process.env.GOAL_LIVE === "1";
const COORDINATOR = fixture.coordinator.id;
/** The name the page draws the person's own lines under. */
const PERSON = "devuser";

/** The legs each control must redden, and only those. */
const EXPECTED: Record<string, string[]> = {
  // The specialist hears the post and answers, and its answer never comes
  // back to the conversation.
  "no-landing": ["answer"],
};
if (CONTROL !== "" && EXPECTED[CONTROL] === undefined) {
  throw new Error(`unknown GOAL_CONTROL "${CONTROL}"; known: ${Object.keys(EXPECTED).join(", ")}`);
}
if (!fixture.specialists.some((s) => s.id === SEAT)) {
  throw new Error(`GOAL_SEAT "${SEAT}" is not one of the specialists: ${fixture.specialists.map((s) => s.id).join(", ")}`);
}

// ---------------------------------------------------------------------------
// The page, as a person uses it
// ---------------------------------------------------------------------------

type Drawn = Array<{ label: string; text: string }>;

/** Open the person's conversation with the coordinator in the panel. */
async function openHelpDesk(page: Page, origin: string): Promise<void> {
  await openShellAt(page, origin);
  await showCoordinator(page, COORDINATOR);
}

/** Post a line from the conversation's panel, and wait until it shows. */
async function post(page: Page, line: string): Promise<void> {
  await panel(page).getByLabel("Post to this coordinator").fill(line);
  await panel(page).getByRole("button", { name: "Send" }).click();
  await readUntil(() => panel(page).getByTestId("coordinator-line").filter({ hasText: line }).count(), (n) => n > 0, 10_000);
}

type Kept = { author?: string; body: string };

/** The conversation's lines as the server keeps them. Not graded: used only to wait. */
async function keptLines(page: Page, origin: string): Promise<Kept[]> {
  const id = await coordinatorConversation(page, origin, COORDINATOR);
  if (id === undefined) return [];
  const res = await page.request.get(`${origin}/api/flows/sessions/${id}/state?include_items=true&item_types=message&limit=1000`);
  const items =
    ((await res.json()) as { items?: Array<{ role?: string; agentName?: string; content?: Array<{ text?: string }> }> }).items ?? [];
  return items.map((item) => ({
    ...(item.agentName === undefined ? {} : { author: item.agentName }),
    body: (item.content ?? []).map((part) => part.text ?? "").join(""),
  }));
}

/** Wait until a specialist's line follows the person's line carrying `mark`, or the time is up. Not graded. */
async function waitAnswered(page: Page, origin: string, mark: string, ms: number): Promise<void> {
  await readUntil(
    () => keptLines(page, origin),
    (lines) => {
      const at = lines.findIndex((l) => l.author === undefined && l.body.includes(mark));
      return at !== -1 && lines.slice(at + 1).some((l) => l.author !== undefined);
    },
    ms,
  );
}

/**
 * Reload, reopen the conversation, and read it as drawn.
 *
 * The transcript mounts before its lines load, so this waits until the
 * person's lines carrying `marks` are drawn: every grade counts from them.
 * The wait is not graded: a line that never shows is reported by the grade
 * that reads it.
 */
async function drawnAfterReload(page: Page, origin: string, marks: string[]): Promise<Drawn> {
  await page.reload();
  await openHelpDesk(page, origin);
  return await readUntil(
    () =>
      panel(page)
        .getByTestId("coordinator-line")
        .evaluateAll((els) =>
          els.map((el) => ({
            label: el.querySelector('[data-testid="coordinator-line-label"]')?.textContent ?? "",
            text: el.querySelector('[data-testid="coordinator-line-body"]')?.textContent ?? "",
          })),
        ),
    (drawn) => marks.every((mark) => drawn.some((l) => l.label === PERSON && l.text.includes(mark))),
    10_000,
  );
}

/** The lines drawn after the person's line carrying `mark`, up to the person's next line. */
function answersTo(drawn: Drawn, mark: string): Drawn | undefined {
  const at = drawn.findIndex((l) => l.label === PERSON && l.text.includes(mark));
  if (at === -1) return undefined;
  const rest = drawn.slice(at + 1);
  const next = rest.findIndex((l) => l.label === PERSON);
  return next === -1 ? rest : rest.slice(0, next);
}

/** A rail section's kind rows, by name. */
const sectionKinds = (page: Page, section: string) =>
  rail(page)
    .getByRole("list", { name: section })
    .locator("button[data-kind]")
    .evaluateAll((bs) => bs.map((b) => b.getAttribute("data-kind") ?? ""));

/** The roster panel as drawn: each worker's id, its flow and its description. */
const rosterRows = (page: Page) =>
  page
    .locator('[data-testid="roster"]:visible [data-testid="roster-worker"]')
    .evaluateAll((rows) =>
      rows.map((row) => ({
        id: row.getAttribute("data-worker-id") ?? "",
        flow: row.querySelector(":scope > div > span:nth-of-type(2)")?.textContent ?? "",
        description: row.querySelector(":scope > p:not([role])")?.textContent ?? "(none drawn)",
      })),
    );

// ---------------------------------------------------------------------------
// The legs
// ---------------------------------------------------------------------------

type Fail = (leg: string, line: string) => void;

/** roster: the rail and the roster panel as drawn. */
async function gradeRoster(page: Page, origin: string, failLeg: Fail, evidence: string[]): Promise<void> {
  await openShellAt(page, origin);
  let clean = true;
  const fail: Fail = (leg, line) => {
    clean = false;
    failLeg(leg, line);
  };

  const coordinatorKinds = await sectionKinds(page, "Coordinators");
  if (JSON.stringify(coordinatorKinds) !== JSON.stringify([fixture.coordinator.kind])) {
    fail("roster", `the rail's Coordinators section lists the kinds ${JSON.stringify(coordinatorKinds)} (want ["${fixture.coordinator.kind}"])`);
  }
  const conversations: string[] = [];
  for (const kind of coordinatorKinds) {
    await open(page, kind);
    const section = rail(page).getByRole("list", { name: "Coordinators" });
    await readUntil(() => section.locator("[data-session-id]").count(), (n) => n > 0, 10_000);
    conversations.push(...(await section.locator("[data-session-id]").evaluateAll((bs) => bs.map((b) => b.textContent ?? ""))));
  }
  if (JSON.stringify(conversations) !== JSON.stringify([COORDINATOR])) {
    fail("roster", `the rail's Coordinators section opens on the conversations ${JSON.stringify(conversations)} (want ["${COORDINATOR}"])`);
  }

  const workerKinds = await sectionKinds(page, "Workers");
  if (JSON.stringify(workerKinds) !== JSON.stringify([fixture.workerKind])) {
    fail("roster", `the rail's Workers section lists the kinds ${JSON.stringify(workerKinds)} (want ["${fixture.workerKind}"])`);
  }

  const rows = await readUntil(() => rosterRows(page), (rs) => rs.length > 0, 10_000);
  const want = [
    { id: COORDINATOR, flow: fixture.coordinator.kind, description: fixture.coordinator.description },
    ...fixture.specialists.map((s) => ({ id: s.id, flow: fixture.workerKind, description: s.description })),
  ];
  const ids = rows.map((r) => r.id);
  if (JSON.stringify([...ids].sort()) !== JSON.stringify(want.map((w) => w.id).sort())) {
    fail("roster", `the roster panel lists ${JSON.stringify(ids)} (want ${JSON.stringify(want.map((w) => w.id))})`);
  }
  for (const w of want) {
    const drawn = rows.find((r) => r.id === w.id);
    if (drawn === undefined) continue;
    if (drawn.flow !== w.flow) fail("roster", `${w.id} shows the flow "${drawn.flow}" (want "${w.flow}")`);
    if (drawn.description !== w.description) {
      fail("roster", `${w.id} shows the description ${JSON.stringify(drawn.description)} (want ${JSON.stringify(w.description)})`);
    }
  }

  const hireButtons = await page.getByRole("button", { name: "Hire another" }).count();
  if (hireButtons > 0) fail("roster", `the page draws ${hireButtons} "Hire another" button(s) (want none)`);
  if (clean) {
    evidence.push(
      `roster: the rail lists "${coordinatorKinds.join(",")}" opening on ${JSON.stringify(conversations)} and "${workerKinds.join(",")}"; ` +
        `the roster panel lists ${rows.map((r) => `${r.id} (${r.flow}): ${JSON.stringify(r.description)}`).join("; ")}; no "Hire another"`,
    );
  }
}

// ---------------------------------------------------------------------------

await runGoal(async (failures) => {
  const evidence: string[] = [];
  const fail: Fail = (leg, line) => failures.push(`[${leg}] ${line}`);
  const run = randomUUID().replace(/-/g, "").slice(0, 10);

  buildKitchenSink();

  const browser = await launchChromium();
  let server: KitchenSinkServer | undefined;
  let live: KitchenSinkServer | undefined;
  try {
    // Keyless: the scripted model answers, and no key is there to fall back on.
    server = await startKitchenSink(fixture.port, { AI_GATEWAY_API_KEY: "" });
    const origin = server.origin;
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });

    // ---- roster ------------------------------------------------------------
    await gradeRoster(page, origin, fail, evidence);
    // The answer leg posts to the coordinator the roster names. Without that
    // roster there is nothing to post to, so the verdict is the roster's.
    if (failures.length > 0) return { failures, evidence: evidence.join("; ") };

    // ---- answer: one post, one reload ----------------------------------------
    const answerToken = `answer-token-a${run}`;
    await openHelpDesk(page, origin);
    await post(page, `[route:${SEAT}] ${fixture.answer.marker} ${answerToken} where is my refund?`);
    await waitAnswered(page, origin, answerToken, 15_000);

    const drawn = await drawnAfterReload(page, origin, [answerToken]);
    const answers = answersTo(drawn, answerToken);
    if (answers === undefined) {
      fail("answer", `after the reload, no line of the person's carries ${answerToken}`);
    } else if (answers.length !== 1 || answers[0]!.label !== SEAT) {
      fail("answer", `after the reload, the lines answering ${answerToken} are ${JSON.stringify(answers.map((l) => `${l.label}: ${l.text}`))} (want one, by ${SEAT})`);
    } else if (!answers[0]!.text.includes(fixture.answer.replyMarker)) {
      fail("answer", `${SEAT}'s line ${JSON.stringify(answers[0]!.text)} does not carry ${fixture.answer.replyMarker}`);
    } else if (answers[0]!.text.includes(answerToken)) {
      fail("answer", `${SEAT}'s line hands the post back: ${JSON.stringify(answers[0]!.text)}`);
    } else {
      evidence.push(`answer: after a reload, ${COORDINATOR}'s conversation shows one line answering ${answerToken}, by ${SEAT}: ${JSON.stringify(answers[0]!.text)}`);
    }

    // ---- live: real models and the app's own route, one answer per post -----
    if (LIVE) {
      if ((process.env.AI_GATEWAY_API_KEY ?? "") === "") throw new Error("GOAL_LIVE=1 needs AI_GATEWAY_API_KEY");
      server.stop();
      live = await startKitchenSink(fixture.port + 1, { KITCHEN_SINK_TEST_MODE: "" });
      const specialists = fixture.specialists.map((s) => s.id);
      for (const [i, text] of fixture.live.posts.entries()) {
        const mark = `(ref live-token-${i}${run})`;
        await openHelpDesk(page, live.origin);
        await post(page, `${text} ${mark}`);
        await waitAnswered(page, live.origin, mark, 120_000);
        // Let a second, wrong answer land before the reload, if one is coming; not graded.
        await page.waitForTimeout(3_000);
        const liveAnswers = answersTo(await drawnAfterReload(page, live.origin, [mark]), mark) ?? [];
        const who = liveAnswers.map((l) => l.label).join(", ") || "nobody";
        if (liveAnswers.length !== 1 || !specialists.includes(liveAnswers[0]!.label)) {
          fail("live", `post ${i + 1} has ${liveAnswers.length} answer line(s) by ${who} (want one, by a specialist): ${JSON.stringify(liveAnswers)}`);
        } else {
          evidence.push(`live ${i + 1}: answered by ${who}: ${JSON.stringify(liveAnswers[0]!.text)}`);
        }
      }
    }
  } finally {
    await browser.close();
    server?.stop();
    live?.stop();
  }

  // A control must redden each leg it names, and only those.
  if (CONTROL !== "") {
    const want = EXPECTED[CONTROL]!;
    const legs = new Set(failures.map((f) => /^\[([^\]]+)\]/.exec(f)?.[1] ?? ""));
    for (const leg of want) {
      if (!legs.has(leg)) failures.push(`[control] GOAL_CONTROL=${CONTROL} left ${leg} green, so it cannot fail`);
    }
    for (const leg of legs) {
      if (!want.includes(leg) && leg !== "control") failures.push(`[control] GOAL_CONTROL=${CONTROL} also reddened ${leg}`);
    }
  }
  return { failures, evidence: evidence.join("; ") };
});
