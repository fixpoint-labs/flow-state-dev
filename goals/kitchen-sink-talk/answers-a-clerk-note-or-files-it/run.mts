/**
 * Goal check: a person who opens kitchen-sink finds one support channel and
 * four specialists named for what they handle. A question gets one
 * specialist's answer in the channel; a case that needs a person is filed onto
 * `escalations` and the specialist says so.
 *
 * Real path, scripted model, out of CI. See goal.md for the contract.
 *
 * Three legs, in one real browser against the app's PRODUCTION build (built
 * here, never assumed), on its scripted model, keyless:
 *
 *   roster  the rail lists one channel and the four specialists, each of the
 *           one seat kind and with its description; no other channel, seat or
 *           kind, and no "Hire another" anywhere.
 *   answer  post a question routed to the seat, with a fresh token; after a
 *           reload the channel shows one line under the seat's name answering
 *           it, carrying the answer marker and not the token.
 *   file    post a case that needs a person; after a reload the channel shows
 *           one line under the seat's name saying it filed (`file:line`), and
 *           the team panel's board shows exactly one row carrying the token
 *           (`file:row`).
 *
 * And the boot still warns that `escalations` is unattended, as the only
 * such board (`warning`).
 *
 * `GOAL_LIVE=1`, with a key: the same build on real models. Three posts that
 * plainly need a person are each filed once, two that don't file nothing, and
 * each gets one answer line.
 *
 * Run:      PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers pnpm tsx goals/kitchen-sink-talk/answers-a-clerk-note-or-files-it/run.mts
 * Controls: GOAL_CONTROL=no-landing  (must FAIL at answer and file:line, and nothing else)
 *           GOAL_CONTROL=no-filing   (must FAIL at file:row, and nothing else)
 * Held-out: GOAL_SEAT=<another specialist>
 * Live:     GOAL_LIVE=1 with AI_GATEWAY_API_KEY
 */
import { randomUUID } from "node:crypto";
import type { Page } from "playwright";
import { loadFixture, runGoal } from "../../lib/index.mts";
import {
  buildKitchenSink,
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

interface Specialist {
  id: string;
  description: string;
}

interface Fixture {
  port: number;
  channel: { kind: string; id: string; board: string };
  seatKind: string;
  specialists: Specialist[];
  seat: string;
  answer: { marker: string; replyMarker: string };
  file: { marker: string; replyMarker: string };
  live: { needsAPerson: string[]; answerable: string[] };
}

const fixture = loadFixture<Fixture>(import.meta.url);
const SEAT = process.env.GOAL_SEAT ?? fixture.seat;
const CONTROL = process.env.GOAL_CONTROL ?? "";
const LIVE = process.env.GOAL_LIVE === "1";
const CHANNEL = fixture.channel.id;

/**
 * The assertions each control must redden, and only those. `answer`, `roster`
 * and `warning` are legs; the file leg is two assertions, graded apart:
 * `file:line` (the seat's line says it filed) and `file:row` (the row).
 */
const EXPECTED: Record<string, string[]> = {
  // A text answer no longer lands: the answer, and the line that says "filed".
  // The row still lands, so the filing itself is not what the leg measures.
  "no-landing": ["answer", "file:line"],
  // The tool says it filed and files nothing: the row only.
  "no-filing": ["file:row"],
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

/** Open the channel's panel. */
async function openChannel(page: Page, origin: string): Promise<void> {
  await openShellAt(page, origin);
  await open(page, fixture.channel.kind);
  await row(page, CHANNEL).click();
  await panel(page).getByTestId("channel-transcript").waitFor({ timeout: 15_000 });
}

/** Post a line from the channel's panel, and wait until it shows. */
async function post(page: Page, line: string): Promise<void> {
  await panel(page).getByLabel("Post to this channel").fill(line);
  await panel(page).getByRole("button", { name: "Send" }).click();
  await readUntil(() => panel(page).getByTestId("channel-line").filter({ hasText: line }).count(), (n) => n > 0, 10_000);
}

type Line = { author?: string; body: string };

/** The channel's lines as the server keeps them. Not graded: used only to wait. */
async function keptLines(page: Page, origin: string): Promise<Line[]> {
  const res = await page.request.get(`${origin}/api/flows/sessions/${CHANNEL}/state?include_items=true&item_types=component&limit=1000`);
  const items = ((await res.json()) as { items?: Array<{ component?: string; data?: Line }> }).items ?? [];
  return items.filter((item) => item.component === "channel-post").map((item) => item.data!);
}

/** Wait until a seat's line follows the person's line carrying `mark`, or the time is up. Not graded. */
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
 * Reload, reopen the channel, and read it as drawn.
 *
 * The transcript mounts before its lines load, so this waits until the
 * person's lines carrying `marks` are drawn: every grade counts from them.
 * The wait is not graded: a line that never shows is reported by the grade
 * that reads it.
 */
async function drawnAfterReload(page: Page, origin: string, marks: string[]): Promise<Drawn> {
  await page.reload();
  await openChannel(page, origin);
  return await readUntil(
    () =>
      panel(page)
        .getByTestId("channel-line")
        .evaluateAll((els) =>
          els.map((el) => ({
            label: el.querySelector('[data-testid="channel-line-label"]')?.textContent ?? "",
            text: el.textContent ?? "",
          })),
        ),
    (drawn) => marks.every((mark) => drawn.some((l) => l.label === "devuser" && l.text.includes(mark))),
    10_000,
  );
}

/** The lines drawn after the person's line carrying `mark`, up to the person's next line. */
function answersTo(drawn: Drawn, mark: string): Drawn | undefined {
  const at = drawn.findIndex((l) => l.label === "devuser" && l.text.includes(mark));
  if (at === -1) return undefined;
  const rest = drawn.slice(at + 1);
  const next = rest.findIndex((l) => l.label === "devuser");
  return next === -1 ? rest : rest.slice(0, next);
}

/** The rows the team panel draws on the channel's board: each row's text. */
const boardRows = (page: Page) =>
  page
    .getByTestId(`board-${CHANNEL}.${fixture.channel.board}`)
    .locator("li[data-task-id]")
    .evaluateAll((rows) => rows.map((r) => r.textContent ?? ""));

/** A rail section's kind rows, by name. */
const sectionKinds = (page: Page, section: string) =>
  rail(page)
    .getByRole("list", { name: section })
    .locator("button[data-kind]")
    .evaluateAll((bs) => bs.map((b) => b.getAttribute("data-kind") ?? ""));

// ---------------------------------------------------------------------------
// The legs
// ---------------------------------------------------------------------------

type Fail = (leg: string, line: string) => void;

/** roster: the rail as drawn. */
async function gradeRoster(page: Page, origin: string, fail: Fail, evidence: string[]): Promise<void> {
  await openShellAt(page, origin);
  const channelKinds = await sectionKinds(page, "Channels");
  if (JSON.stringify(channelKinds) !== JSON.stringify([fixture.channel.kind])) {
    fail("roster", `the rail's Channels section lists the kinds ${JSON.stringify(channelKinds)} (want ["${fixture.channel.kind}"])`);
  }
  const channels: string[] = [];
  for (const kind of channelKinds) {
    await open(page, kind);
    const leaf = rail(page).locator(`ul[data-leaf="${kind}"]`);
    await readUntil(() => leaf.locator("[data-session-id]").count(), (n) => n > 0, 10_000);
    channels.push(...(await leaf.locator("[data-session-id]").evaluateAll((bs) => bs.map((b) => b.getAttribute("data-session-id") ?? ""))));
  }
  if (JSON.stringify(channels) !== JSON.stringify([CHANNEL])) {
    fail("roster", `the rail lists the channels ${JSON.stringify(channels)} (want ["${CHANNEL}"])`);
  }

  const seatKinds = await sectionKinds(page, "Seats");
  if (JSON.stringify(seatKinds) !== JSON.stringify([fixture.seatKind])) {
    fail("roster", `the rail's Seats section lists the kinds ${JSON.stringify(seatKinds)} (want ["${fixture.seatKind}"])`);
  }
  // Every seat kind opened, then the seats read once: the section lists them all.
  for (const kind of seatKinds) await open(page, kind);
  const listed = rail(page).getByRole("list", { name: "Seats" }).locator("button[data-instance-id]");
  await readUntil(() => listed.count(), (n) => n > 0, 10_000);
  const seats = await listed.evaluateAll((bs) => bs.map((b) => b.getAttribute("data-instance-id") ?? ""));
  const want = fixture.specialists.map((s) => s.id);
  if (JSON.stringify([...seats].sort()) !== JSON.stringify([...want].sort())) {
    fail("roster", `the rail lists the seats ${JSON.stringify(seats)} (want ${JSON.stringify(want)})`);
  }

  // Each specialist, opened: its kind and its description, as drawn under its row.
  const described: string[] = [];
  for (const specialist of fixture.specialists) {
    if (!seats.includes(specialist.id)) continue;
    await open(page, specialist.id);
    const detail = rail(page).locator(`[data-leaf-detail="${specialist.id}"]`);
    await detail.waitFor({ timeout: 10_000 });
    const kind = (await detail.locator("[data-seat-kind]").textContent()) ?? "";
    const description = (await detail.getByTestId("seat-description").count()) === 1
      ? ((await detail.getByTestId("seat-description").textContent()) ?? "")
      : "(none drawn)";
    if (kind !== fixture.seatKind) fail("roster", `${specialist.id} shows the kind "${kind}" (want "${fixture.seatKind}")`);
    if (description !== specialist.description) {
      fail("roster", `${specialist.id} shows the description ${JSON.stringify(description)} (want ${JSON.stringify(specialist.description)})`);
    } else {
      described.push(`${specialist.id}: ${JSON.stringify(description)}`);
    }
  }
  const hireButtons = await page.getByRole("button", { name: "Hire another" }).count();
  if (hireButtons > 0) fail("roster", `the page draws ${hireButtons} "Hire another" button(s) (want none)`);
  if (described.length === fixture.specialists.length && hireButtons === 0 && channels.length === 1) {
    evidence.push(`roster: the rail lists ${JSON.stringify(channels)} under "${channelKinds.join(",")}" and four "${fixture.seatKind}" seats, ${described.join("; ")}; no "Hire another"`);
  }
}

/** One answer line under the seat, after the person's line carrying `mark`. */
function oneLineBySeat(drawn: Drawn, mark: string): { line?: { label: string; text: string }; problem?: string } {
  const answers = answersTo(drawn, mark);
  if (answers === undefined) return { problem: `after the reload, no line of the person's carries ${mark}` };
  if (answers.length !== 1 || answers[0]!.label !== SEAT) {
    return { problem: `after the reload, the lines answering ${mark} are ${JSON.stringify(answers.map((l) => `${l.label}: ${l.text}`))} (want one, by ${SEAT})` };
  }
  return { line: answers[0] };
}

// ---------------------------------------------------------------------------

await runGoal(async () => {
  const failures: string[] = [];
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
    // Every other leg posts to the channel the roster names. Without that
    // roster there is nothing to post to, so the verdict is the roster's.
    if (failures.length > 0) return { failures, evidence: evidence.join("; ") };

    // ---- answer and file: two posts, one reload -----------------------------
    const answerToken = `answer-token-a${run}`;
    const fileToken = `case-token-f${run}`;
    await openChannel(page, origin);
    await post(page, `[route:${SEAT}] ${fixture.answer.marker} ${answerToken} where is my refund?`);
    await waitAnswered(page, origin, answerToken, 15_000);
    await post(page, `[route:${SEAT}] ${fixture.file.marker} ${fileToken} the charger caught fire and the desk smells of smoke`);
    await waitAnswered(page, origin, fileToken, 15_000);
    // The row is written by the channel's own request, a moment after the
    // dispatch. Let it land before the reload; nothing here is graded.
    await readUntil(
      async () => (await page.request.get(`${origin}/api/flows/sessions/${CHANNEL}/resources/${CHANNEL}.${fixture.channel.board}`)).text(),
      (body) => body.includes(fileToken),
      10_000,
    );

    const drawn = await drawnAfterReload(page, origin, [answerToken, fileToken]);

    const answered = oneLineBySeat(drawn, answerToken);
    if (answered.problem !== undefined) fail("answer", answered.problem);
    else if (!answered.line!.text.includes(fixture.answer.replyMarker)) {
      fail("answer", `${SEAT}'s line ${JSON.stringify(answered.line!.text)} does not carry ${fixture.answer.replyMarker}`);
    } else if (answered.line!.text.includes(answerToken)) {
      fail("answer", `${SEAT}'s line hands the post back: ${JSON.stringify(answered.line!.text)}`);
    } else {
      evidence.push(`answer: after a reload, ${CHANNEL} shows one line answering ${answerToken}, by ${SEAT}: ${JSON.stringify(answered.line!.text)}`);
    }

    const filed = oneLineBySeat(drawn, fileToken);
    if (filed.problem !== undefined) fail("file:line", filed.problem);
    else if (!filed.line!.text.includes(fixture.file.replyMarker)) {
      fail("file:line", `${SEAT}'s line ${JSON.stringify(filed.line!.text)} does not say it filed (${fixture.file.replyMarker})`);
    } else {
      evidence.push(`file: ${SEAT}'s line reads ${JSON.stringify(filed.line!.text)}`);
    }
    const rows = await readUntil(() => boardRows(page), (rs) => rs.some((r) => r.includes(fileToken)), 10_000);
    const mine = rows.filter((r) => r.includes(fileToken));
    if (mine.length !== 1) {
      fail("file:row", `after the reload, the team panel's ${fixture.channel.board} board holds ${mine.length} rows carrying ${fileToken} (want 1); it shows ${rows.length} rows`);
    } else {
      evidence.push(`file: after a reload, the team panel's ${fixture.channel.board} board shows ${JSON.stringify(mine[0])}`);
    }

    // ---- live: real models file what needs a person, and only that ---------
    if (LIVE) {
      if ((process.env.AI_GATEWAY_API_KEY ?? "") === "") throw new Error("GOAL_LIVE=1 needs AI_GATEWAY_API_KEY");
      server.stop();
      live = await startKitchenSink(fixture.port + 1, { KITCHEN_SINK_TEST_MODE: "" });
      const posts = [
        ...fixture.live.needsAPerson.map((text) => ({ text, files: true })),
        ...fixture.live.answerable.map((text) => ({ text, files: false })),
      ];
      await openChannel(page, live.origin);
      let before = (await boardRows(page)).length;
      for (const [i, { text, files }] of posts.entries()) {
        const mark = `(ref live-token-${i}${run})`;
        await openChannel(page, live.origin);
        await post(page, `${text} ${mark}`);
        await waitAnswered(page, live.origin, mark, 120_000);
        // Let a filing's row land before the reload; not graded.
        await page.waitForTimeout(3_000);
        const liveDrawn = await drawnAfterReload(page, live.origin, [mark]);
        const answers = answersTo(liveDrawn, mark) ?? [];
        const after = (await boardRows(page)).length;
        const who = answers.map((l) => l.label).join(", ") || "nobody";
        if (answers.length !== 1) fail("live", `post ${i + 1} has ${answers.length} answer line(s) (want 1): ${JSON.stringify(answers)}`);
        if (after - before !== (files ? 1 : 0)) {
          fail("live", `post ${i + 1} (${files ? "needs a person" : "answerable"}) added ${after - before} row(s) to ${fixture.channel.board} (want ${files ? 1 : 0}); answered by ${who}: ${JSON.stringify(answers[0]?.text ?? "")}`);
        } else {
          evidence.push(`live ${i + 1}: ${files ? "filed" : "not filed"}, answered by ${who}: ${JSON.stringify(answers[0]?.text ?? "")}`);
        }
        before = after;
      }
    }
  } finally {
    await browser.close();
    server?.stop();
    live?.stop();
  }

  // The boot still warns that escalations is unattended, as the only such board.
  const unattended = [...(server?.log() ?? "").matchAll(/channel "([^"]+)" holds board "([^"]+)"/g)].map((m) => `${m[1]}.${m[2]}`);
  const unique = [...new Set(unattended)];
  if (JSON.stringify(unique) !== JSON.stringify([`${CHANNEL}.${fixture.channel.board}`])) {
    fail("warning", `the boot warns these boards are unattended: ${JSON.stringify(unique)} (want only ${CHANNEL}.${fixture.channel.board})`);
  } else {
    evidence.push(`the boot warns that ${CHANNEL}.${fixture.channel.board} is unattended, and no other board`);
  }

  // A control must redden each assertion it names, and only those.
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
