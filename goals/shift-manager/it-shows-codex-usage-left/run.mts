/**
 * Goal check for FIX-2141. See goal.md.
 *
 * Run:      PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers pnpm tsx goals/shift-manager/it-shows-codex-usage-left/run.mts
 * Controls: GOAL_CONTROL=ignore-age | unavailable-as-zero | last-write-wins | throttle-ignores-failures | key-by-account
 */
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { findCodexProgram } from "@flow-state-dev/codex";
import { REPO_ROOT, RUN_STAMP, goalTmpDir, runGoal } from "../../lib/index.mts";
import { assertPatched, describePatches, modulePatchEnv } from "../../lib/module-patch.mts";
import { launchChromium } from "../../lib/playwright.mts";
import { buildShiftManagerPages, labRoutes, openShiftManager, personPage, startShiftManager, type LabUser } from "../../lib/shift-manager.mts";
import { LAB_CROWD, LAB_USERS, PROJECTS_FLOW } from "../../../packages/shift-manager/teams/devteam/host.mts";
import { CONTROL_NAMES, CONTROLS, type Control } from "./controls.mts";

const SCRATCH = goalTmpDir("codex-usage");
const say = (s: string) => console.error(`[usage ${new Date().toISOString().slice(11, 19)}] ${s}`);
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const controlName = process.env.GOAL_CONTROL ?? "";
if (controlName !== "" && !(CONTROL_NAMES as readonly string[]).includes(controlName)) {
  console.error(`unknown GOAL_CONTROL "${controlName}"; known: ${CONTROL_NAMES.join(", ")}`);
  process.exit(2);
}
const control: Control | undefined = controlName === "" ? undefined : CONTROLS[controlName as keyof typeof CONTROLS];

/** One person per leg, so each leg reads a row only it wrote. */
const PEOPLE = {
  a: { label: "a", ...LAB_USERS.owner },
  aOlder: { label: "a-older", ...LAB_CROWD[0]! },
  b: { label: "b", ...LAB_USERS.member },
  c: { label: "c", ...LAB_CROWD[4]! },
  d: { label: "d", ...LAB_CROWD[5]! },
  e: { label: "e", ...LAB_CROWD[1]! },
  g: { label: "g", ...LAB_CROWD[2]! },
  h: { label: "h", ...LAB_CROWD[3]! },
} satisfies Record<string, LabUser & { label: string }>;

type Row = {
  harness: string;
  status: string;
  reason: string | null;
  plan: string | null;
  windows: Array<{ id: string; minutes: number | null; usedPercent: number; resetsAt: number | null; checkedAt: number; ageMs: number; rolledOver: boolean }>;
  checkedAt: number | null;
  ageMs: number | null;
  refreshError: string | null;
};

await runGoal(async () => {
  const started = Date.now();
  const mark = join(SCRATCH, `patch-mark-${RUN_STAMP}`);
  const patchEnv = control === undefined ? {} : modulePatchEnv(control.patches, REPO_ROOT, mark);
  if (control !== undefined) say(`control ${control.name}: ${control.does}\n${describePatches(control.patches, REPO_ROOT)}`);

  // The Codex homes the real CLI reads: nobody signed in, and an API key.
  const emptyHome = mkdtempSync(join(SCRATCH, "codex-empty-"));
  const keyHome = mkdtempSync(join(SCRATCH, "codex-key-"));
  const codex = await findCodexProgram({ PATH: process.env.PATH ?? "" });
  const login = spawnSync(codex.path, ["login", "--with-api-key"], {
    input: "sk-goal-not-a-real-key\n",
    env: { PATH: process.env.PATH ?? "", HOME: process.env.HOME ?? "", CODEX_HOME: keyHome },
    encoding: "utf8",
  });
  if (login.status !== 0) throw new Error(`setup: codex login --with-api-key failed: ${login.stderr}`);
  say(`real Codex CLI: ${codex.path}`);

  const setupFile = join(SCRATCH, "setup.json");
  const startLog = join(SCRATCH, "app-server.log");
  writeFileSync(startLog, "");
  const setup = (value: { scripted: boolean; codexHome?: string; mode?: string; rateLimits?: unknown }) =>
    writeFileSync(setupFile, JSON.stringify({ codexHome: value.codexHome ?? emptyHome, log: startLog, mode: "signed-in", ...value }));
  const starts = () => readFileSync(startLog, "utf8").split("\n").filter((l) => l.startsWith("START")).length;
  setup({ scripted: true });

  // Stored readings the Lab boots with.
  const now = Date.now();
  const stored = (checkedAt: number, usedPercent: number, resetsAt: number) => ({
    status: "windows",
    reason: null,
    account: "0123456789abcdef",
    plan: "pro",
    windows: [{ id: "codex:primary", label: null, minutes: 300, usedPercent, resetsAt, checkedAt, origin: "read" }],
    checkedAt,
    lastAttemptAt: null,
    refreshError: null,
  });
  const seeds = [
    // Fresher than any read this run makes: a refresh must leave it.
    { userId: PEOPLE.aOlder.userId, state: stored(now + 10 * 60_000, 77, now + 4 * 3_600_000) },
    // Three hours old, its window not yet reset.
    { userId: PEOPLE.e.userId, state: stored(now - 3 * 3_600_000, 55, now + 2 * 3_600_000) },
    // Two minutes old: the row a failed refresh keeps.
    { userId: PEOPLE.g.userId, state: stored(now - 2 * 60_000, 33, now + 3 * 3_600_000) },
  ];

  say("building Shift Manager's pages");
  const pages = await buildShiftManagerPages(join(SCRATCH, "pages"));
  const storeDir = join(SCRATCH, "store");
  mkdirSync(storeDir, { recursive: true });
  const served = await startShiftManager({
    scratch: SCRATCH,
    label: "usage",
    config: fileURLToPath(new URL("./lab/fsdev.config.mts", import.meta.url)),
    pages,
    env: {
      USAGE_GOAL_STORE: join(storeDir, "lab.sqlite"),
      USAGE_GOAL_SETUP: setupFile,
      USAGE_GOAL_SEEDS: JSON.stringify(seeds),
      ...patchEnv,
    },
    timeoutMs: 180_000,
  });
  say(`Lab at ${served.origin}`);

  const failures: string[] = [];
  const notes: string[] = [];
  const query = async (person: LabUser, refresh: boolean): Promise<Row[]> => {
    const routes = labRoutes(served.origin, person);
    const done = await routes.act(PROJECTS_FLOW, `${PROJECTS_FLOW}-own-${person.userId}`, "harnessUsage", refresh ? { refresh: true } : {});
    if (done.status !== "completed") throw new Error(`harnessUsage as ${person.userId} ended ${done.status}: ${done.error ?? ""}`);
    return (done.output as { harnesses: Row[] }).harnesses;
  };
  const codexRow = (rows: Row[]) => rows.find((row) => row.harness === "codex");
  const browser = await launchChromium();
  /** The Usage view as `person` sees it: each harness card's status, its windows and its text. */
  const view = async (person: LabUser, owner: boolean) => {
    const { context, page } = await personPage(browser, served.origin, person, owner);
    try {
      await openShiftManager(page, served.origin, "/usage");
      await page.getByTestId("usage-harness").first().waitFor({ timeout: 30_000 });
      return await page.$$eval("[data-testid=usage-harness]", (cards) =>
        cards.map((card) => ({
          harness: card.getAttribute("data-harness"),
          status: card.getAttribute("data-status"),
          text: card.textContent ?? "",
          age: card.querySelector("[data-testid=usage-age]")?.textContent ?? "",
          windows: [...card.querySelectorAll("[data-testid=usage-window]")].map((w) => ({
            id: w.getAttribute("data-window-id"),
            rolledOver: w.getAttribute("data-rolled-over") === "true",
            percent: w.querySelector("[data-testid=usage-percent]")?.textContent ?? null,
            text: w.textContent ?? "",
          })),
        })),
      );
    } finally {
      await context.close();
    }
  };

  try {
    // Leg h, first half: a signed-in reading, a minute before the API key.
    setup({ scripted: true, rateLimits: rateLimits(Date.now(), "acct_h_first", 61, 12) });
    const hFirst = codexRow(await query(PEOPLE.h, true));
    const hReadAt = Date.now();
    if (hFirst?.status !== "windows" || hFirst.windows.length !== 2) failures.push(`h:setup — the signed-in read gave ${JSON.stringify(hFirst)}`);

    // Leg a: signed in, through the view first (it refreshes), then the query.
    const aLimits = rateLimits(Date.now(), "acct_a", 42, 7);
    setup({ scripted: true, rateLimits: aLimits });
    const before = Date.now();
    const aView = await view(PEOPLE.a, true);
    const aRow = codexRow(await query(PEOPLE.a, false));
    const after = Date.now();
    const aCard = aView.find((card) => card.harness === "codex");
    const expected = [
      { id: "codex:primary", minutes: 300, usedPercent: 42, resetsAt: aLimits.rateLimits.primary.resetsAt * 1000 },
      { id: "codex:secondary", minutes: 10_080, usedPercent: 7, resetsAt: aLimits.rateLimits.secondary.resetsAt * 1000 },
    ];
    const got = (aRow?.windows ?? []).map((w) => ({ id: w.id, minutes: w.minutes, usedPercent: w.usedPercent, resetsAt: w.resetsAt }));
    if (JSON.stringify(got) !== JSON.stringify(expected)) failures.push(`a:windows — the query returned ${JSON.stringify(got)}, not ${JSON.stringify(expected)}`);
    if (aRow?.checkedAt == null || aRow.checkedAt < before || aRow.checkedAt > after) failures.push(`a:checked-in-run — checkedAt ${aRow?.checkedAt} is not within the run (${before}..${after})`);
    if (aCard === undefined || aCard.windows.length !== 2) failures.push(`a:view — the view shows ${JSON.stringify(aCard)}, not two Codex windows`);
    else {
      if (!aCard.age.includes("from Codex")) failures.push(`a:view-source — the card says "${aCard.age}", not where its numbers came from`);
      for (const [i, w] of expected.entries()) {
        if (aCard.windows[i]?.percent !== `${w.usedPercent}% used`) failures.push(`a:view-percent — ${w.id} shows "${aCard.windows[i]?.percent}", not "${w.usedPercent}% used"`);
      }
    }
    notes.push(`a: ${JSON.stringify(got)}; view "${aCard?.age}"`);

    // Leg a, the older reading: a refresh over a fresher stored row leaves it.
    setup({ scripted: true, rateLimits: rateLimits(Date.now(), "acct_a_older", 5, 5) });
    const older = codexRow(await query(PEOPLE.aOlder, true));
    if (older?.windows[0]?.usedPercent !== 77 || older.checkedAt !== seeds[0]!.state.checkedAt) {
      failures.push(`a:leaves-the-stored-one — a refresh older than the stored reading replaced it: ${JSON.stringify(older)}`);
    }

    // Legs b and c: the real CLI, signed out and on an API key.
    for (const [leg, person, home, status] of [
      ["b", PEOPLE.b, emptyHome, "signed-out"],
      ["c", PEOPLE.c, keyHome, "api-key"],
    ] as const) {
      setup({ scripted: false, codexHome: home });
      const cards = await view(person, false);
      const row = codexRow(await query(person, false));
      const card = cards.find((entry) => entry.harness === "codex");
      if (row?.status !== status) failures.push(`${leg}:status — the query says ${row?.status} (${row?.reason}), not ${status}`);
      if ((row?.windows.length ?? 0) > 0) failures.push(`${leg}:no-percent — the query returned windows: ${JSON.stringify(row?.windows)}`);
      if (card === undefined || card.status !== status || card.text.includes("%")) failures.push(`${leg}:no-percent — the view's card reads "${card?.text}"`);
      if (card !== undefined && row?.reason != null && !card.text.includes(row.reason)) failures.push(`${leg}:reason — the view doesn't say why: "${card.text}"`);
      notes.push(`${leg}: ${row?.status}, "${card?.text}"`);
    }

    // Leg d: a window whose reset has passed.
    const dLimits = rateLimits(Date.now(), "acct_d", 91, 20);
    dLimits.rateLimits.primary.resetsAt = Math.floor((Date.now() - 60_000) / 1000);
    setup({ scripted: true, rateLimits: dLimits });
    const dCards = await view(PEOPLE.d, false);
    const dRow = codexRow(await query(PEOPLE.d, false));
    const dPrimary = dRow?.windows.find((w) => w.id === "codex:primary");
    const dShown = dCards.find((card) => card.harness === "codex")?.windows.find((w) => w.id === "codex:primary");
    if (dPrimary?.rolledOver !== true) failures.push(`d:rolled-over — the query says ${JSON.stringify(dPrimary)}`);
    if (dShown === undefined || dShown.percent !== null || !dShown.text.includes("not checked since")) failures.push(`d:rolled-over — the view shows "${dShown?.text}"`);
    notes.push(`d: "${dShown?.text}"`);

    // Leg e: a stored row three hours old, read without refresh.
    const eStarts = starts();
    const eRow = codexRow(await query(PEOPLE.e, false));
    if (eRow?.ageMs == null || eRow.ageMs < 3 * 3_600_000) failures.push(`e:age — the query says ageMs ${eRow?.ageMs} for a reading three hours old`);
    if (starts() !== eStarts) failures.push(`e:no-vendor-call — a read without refresh started ${starts() - eStarts} Codex process(es)`);
    notes.push(`e: ageMs ${eRow?.ageMs}`);

    // Leg g: a reader that hangs, looked at from two tabs at once, then again.
    setup({ scripted: true, mode: "hang" });
    const gStarts = starts();
    const [g1, g2] = await Promise.all([query(PEOPLE.g, true), query(PEOPLE.g, true)]);
    const g3 = await query(PEOPLE.g, true);
    const children = starts() - gStarts;
    if (children !== 1) failures.push(`g:one-child — three looks in a minute started ${children} Codex processes`);
    for (const [i, rows] of [g1, g2, g3].entries()) {
      const row = codexRow(rows);
      if (row?.windows[0]?.usedPercent !== 33) failures.push(`g:keeps-stored — look ${i + 1} returned ${JSON.stringify(row)}`);
      if (row?.refreshError !== "Codex did not answer within 10 s") failures.push(`g:refresh-error — look ${i + 1} says "${row?.refreshError}"`);
    }
    notes.push(`g: ${children} child, refreshError "${codexRow(g3)?.refreshError}"`);

    // Leg h, second half: a minute after the signed-in read, Codex is on an API key.
    const wait = hReadAt + 61_000 - Date.now();
    if (wait > 0) {
      say(`h: waiting ${Math.ceil(wait / 1000)} s for the minute to pass`);
      await sleep(wait);
    }
    setup({ scripted: true, mode: "api-key" });
    const hRows = await query(PEOPLE.h, true);
    if (hRows.length !== 1 || hRows[0]!.status !== "api-key" || hRows.some((row) => row.windows.length > 0)) {
      failures.push(`h:no-earlier-percent — after a move to an API key the query returns ${JSON.stringify(hRows)}`);
    }
    notes.push(`h: ${JSON.stringify(hRows.map((row) => [row.harness, row.status, row.windows.length]))}`);
  } finally {
    await browser.close();
    await served.stop();
  }

  if (control !== undefined) assertPatched(control.patches, REPO_ROOT, mark);
  if (process.env.GOAL_KEEP_STORE === undefined) rmSync(storeDir, { recursive: true, force: true });
  for (const note of notes) say(note);
  say("f: owed by a person — Jake's own ChatGPT sign-in, compared with codex /status in the same minute");

  if (control !== undefined) {
    const red = control.assertions.filter((name) => failures.some((f) => f.startsWith(`${name} `)));
    const missed = control.assertions.filter((name) => !red.includes(name));
    failures.unshift(
      missed.length === 0
        ? `control ${control.name}: failed on ${red.join(", ")}, as it must`
        : `control ${control.name}: did NOT fail on ${missed.join(", ")}, so the check can't see what the control removes`,
    );
  }
  return {
    failures,
    evidence: `legs a, b, c, d, e, g, h PASS in ${Math.round((Date.now() - started) / 1000)} s (leg f owed by a person: goal met except leg f)`,
  };
});

/** An `account/rateLimits/read` answer as the pinned CLI publishes it: a 5-hour and a weekly window. */
function rateLimits(now: number, accountId: string, primary: number, secondary: number) {
  return {
    rateLimits: {
      limitId: "codex",
      limitName: null,
      primary: { usedPercent: primary, windowDurationMins: 300, resetsAt: Math.floor(now / 1000) + 2 * 3600 },
      secondary: { usedPercent: secondary, windowDurationMins: 10_080, resetsAt: Math.floor(now / 1000) + 4 * 86_400 },
      credits: null,
      individualLimit: null,
      spendControlReached: null,
      planType: "pro",
      rateLimitReachedType: null,
    },
    rateLimitsByLimitId: null,
    rateLimitResetCredits: null,
    accountId,
    rateLimitUpsell: null,
  };
}
