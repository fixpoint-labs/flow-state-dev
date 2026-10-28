/**
 * Goal check: a Kitchen Sink session lists the pull requests it opened, live,
 * once each, and catches one opened by a call the recorder does not read.
 *
 * Real path: real harnesses, `next dev`, one real browser, a scratch GitHub
 * repository and the host's signed-in `gh`. Out of CI. See goal.md for the
 * contract.
 *
 * Legs, per mode:
 *
 *   host        the mode is available here and `gh` reaches the repository; otherwise the reason, and nothing else is graded.
 *   r1:live     each pull request the turn opens is on the panel while the turn still runs.
 *   r2:matches  the panel's set equals `gh pr list` over the run's branches, with no repeats; the viewed pull request shows once, as `tool`.
 *   b:caught    (harness modes) a pull request opened by a raw `gh api` call is on the panel after the turn, as `branch`.
 *
 * Run:      PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers GOAL_PR_REPO=<owner/name> GOAL_PR_CHECKOUT=<clone> \
 *             pnpm tsx goals/kitchen-sink-harness/session-lists-its-pull-requests/run.mts
 * Controls: GOAL_CONTROL=no-pr-record (must FAIL at r1, and may FAIL at r2; nothing else)
 *           GOAL_CONTROL=no-backstop  (must FAIL at b, and nothing else)
 */
import { execFileSync, spawn, type ChildProcess } from "node:child_process";
import { randomBytes } from "node:crypto";
import type { Page } from "playwright";
import { KITCHEN_SINK, runGoal } from "../../lib/index.mts";
import { launchChromium } from "../../lib/playwright.mts";
import { refuseIfAnswering, stopProcessGroup } from "../../lib/server.mts";

const PORT = 3052;
const ORIGIN = `http://127.0.0.1:${PORT}`;
const CONTROL = process.env.GOAL_CONTROL ?? "";
const REPO = process.env.GOAL_PR_REPO ?? "";
const CHECKOUT = process.env.GOAL_PR_CHECKOUT ?? "";
/** How long one real turn may take. */
const TURN_MS = 300_000;

const HARNESS_MODES = ["codex", "claude-code", "cursor"] as const;
const ALL_MODES = [...HARNESS_MODES, "flow-state"] as const;
type Mode = (typeof ALL_MODES)[number];
const MODES = (process.env.GOAL_MODES?.split(",").filter(Boolean) ?? [...ALL_MODES]) as Mode[];

/** The legs each control must redden, and the ones it may. */
const EXPECTED: Record<string, { must: string[]; may: string[] }> = {
  "no-pr-record": { must: ["r1"], may: ["r2"] },
  "no-backstop": { must: ["b"], may: [] },
};
if (CONTROL !== "" && EXPECTED[CONTROL] === undefined) {
  throw new Error(`unknown GOAL_CONTROL "${CONTROL}"; known: ${Object.keys(EXPECTED).join(", ")}`);
}
if (!/^[^/\s]+\/[^/\s]+$/.test(REPO) || CHECKOUT === "") {
  throw new Error("set GOAL_PR_REPO=<owner/name> (a scratch repository with a main branch) and GOAL_PR_CHECKOUT=<a local clone of it>");
}

function gh(args: string[]): string {
  return execFileSync("gh", args, { encoding: "utf8", env: { ...process.env, GH_PROMPT_DISABLED: "1" } });
}

/** GitHub's pull requests on these branches, as `owner/name#n`, open or closed. */
function listedOnGitHub(branches: string[]): string[] {
  const out = new Set<string>();
  for (const branch of branches) {
    const listed = JSON.parse(
      gh(["pr", "list", "--repo", REPO, "--author", "@me", "--head", branch, "--state", "all", "--json", "number"]),
    ) as { number: number }[];
    for (const { number } of listed) out.add(`${REPO.toLowerCase()}#${number}`);
  }
  return [...out].sort();
}

/** Close what the run opened and delete its branches. */
function cleanUp(branches: string[]): void {
  for (const branch of branches) {
    try {
      const listed = JSON.parse(gh(["pr", "list", "--repo", REPO, "--head", branch, "--state", "open", "--json", "number"])) as {
        number: number;
      }[];
      for (const { number } of listed) gh(["pr", "close", String(number), "--repo", REPO, "--delete-branch"]);
      gh(["api", "-X", "DELETE", `repos/${REPO}/git/refs/heads/${branch}`]);
    } catch {
      // Already gone.
    }
  }
}

/** `next dev`, working in the scratch repository's clone. */
async function startDev(): Promise<{ stop: () => void }> {
  await refuseIfAnswering(ORIGIN);
  let log = "";
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    NODE_ENV: "development",
    KITCHEN_SINK_TEST_MODE: "1",
    NEXT_PUBLIC_KITCHEN_SINK_TEST_MODE: "1",
    KITCHEN_SINK_REAL_HARNESS: "1",
    KITCHEN_SINK_HARNESS_WORKSPACE: CHECKOUT,
    STORE_TYPE: "filesystem",
    ...(CONTROL === "" ? {} : { GOAL_CONTROL: CONTROL }),
  };
  const child: ChildProcess = spawn("pnpm", ["exec", "next", "dev", "--port", String(PORT)], {
    cwd: KITCHEN_SINK,
    env,
    stdio: ["ignore", "pipe", "pipe"],
    detached: true,
  });
  child.stdout?.on("data", (chunk: Buffer) => (log += chunk.toString()));
  child.stderr?.on("data", (chunk: Buffer) => (log += chunk.toString()));
  for (let i = 0; i < 240; i += 1) {
    const status = await fetch(`${ORIGIN}/api/flows`).then((r) => r.status, () => undefined);
    if (status === 200) return { stop: () => stopProcessGroup(child) };
    if (child.exitCode !== null) throw new Error(`next dev exited (${child.exitCode}):\n${log}`);
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  stopProcessGroup(child);
  throw new Error(`next dev never served ${ORIGIN}/api/flows:\n${log}`);
}

type Row = { key: string; source: string };

/** The panel's rows, as drawn. */
async function panelRows(page: Page): Promise<Row[]> {
  return page.getByTestId("pull-request-row").evaluateAll((lis) =>
    lis.map((li) => ({
      key: `${(li.getAttribute("data-repository") ?? "").toLowerCase()}#${li.getAttribute("data-number") ?? ""}`,
      source: li.getAttribute("data-source") ?? "",
    })),
  );
}

const stopButton = (page: Page) => page.getByRole("button", { name: "Stop" });

/** Send a turn and wait for it to end. Returns the rows seen on the panel while it ran. */
async function turn(page: Page, prompt: string): Promise<Set<string>> {
  const input = page.getByTestId("message-input");
  await input.fill(prompt);
  await input.press("Enter");
  await stopButton(page).waitFor({ state: "visible", timeout: 30_000 });
  const seenLive = new Set<string>();
  const deadline = Date.now() + TURN_MS;
  while (Date.now() < deadline) {
    const rows = await panelRows(page);
    if (!(await stopButton(page).isVisible())) break;
    for (const row of rows) seenLive.add(row.key);
    await page.waitForTimeout(500);
  }
  await stopButton(page).waitFor({ state: "hidden", timeout: 30_000 });
  return seenLive;
}

/** The commands that open a pull request with `gh pr create`, view it, and keep the turn running a little longer. */
function openAndView(branch: string, inFreshClone: boolean): string {
  const steps = [
    ...(inFreshClone ? [`cd "$(mktemp -d)"`, `gh repo clone ${REPO} .`] : []),
    `git checkout -b ${branch}`,
    `echo ${branch} > ${branch}.txt`,
    `git add ${branch}.txt`,
    `git commit -m "${branch}"`,
    `git push -u origin ${branch}`,
    `gh pr create --repo ${REPO} --base main --head ${branch} --title "${branch}" --body "goal check"`,
  ];
  return (
    `Run this as one shell command and show me its output: \`${steps.join(" && ")}\`. ` +
    `Then run \`gh pr view ${branch} --repo ${REPO}\`. Then run \`sleep 20\`. Reply "done".`
  );
}

/** The commands that open a pull request through the REST API, which the recorder does not read. */
function openByApi(branch: string): string {
  const steps = [
    `git checkout -b ${branch}`,
    `echo ${branch} > ${branch}.txt`,
    `git add ${branch}.txt`,
    `git commit -m "${branch}"`,
    `git push -u origin ${branch}`,
    `gh api repos/${REPO}/pulls -f title="${branch}" -f head=${branch} -f base=main --jq .number`,
  ];
  return `Run this as one shell command and show me its output: \`${steps.join(" && ")}\`. Don't use \`gh pr create\`. Reply "done".`;
}

async function grade(page: Page, mode: Mode, token: string, fail: (leg: string, message: string) => void, evidence: string[]) {
  const harness = (HARNESS_MODES as readonly string[]).includes(mode);
  const opened = `goal-${token}-${mode}-a`;
  const byApi = `goal-${token}-${mode}-b`;
  const branches = harness ? [opened, byApi] : [opened];
  try {
    // ---- host
    await page.goto(`${ORIGIN}/`);
    const card = page.locator(`[data-mode-id="${mode}"]`);
    await card.waitFor({ timeout: 60_000 });
    if ((await card.getAttribute("data-available")) !== "true") {
      fail("host", `${mode} is unavailable here: ${await card.getByTestId("mode-reason").textContent()}`);
      return;
    }
    await page.goto(`${ORIGIN}/${mode}`);
    if (harness) await page.getByTestId("new-session").click();
    await page.getByTestId("message-input").waitFor({ timeout: 60_000 });

    // ---- r1: the opened pull request is on the panel while the turn runs
    const seenLive = await turn(page, openAndView(opened, !harness));
    const openedOnGitHub = listedOnGitHub([opened]);
    if (openedOnGitHub.length === 0) {
      fail("host", `${mode}: the turn opened no pull request on ${opened}; the model did not run the commands`);
      return;
    }
    for (const key of openedOnGitHub) if (!seenLive.has(key)) fail("r1", `${mode}: ${key} was not on the panel while the turn ran`);

    // ---- b: a pull request opened by a raw API call shows after the turn, as found on the branch
    if (harness) {
      await turn(page, openByApi(byApi));
      const apiOnGitHub = listedOnGitHub([byApi]);
      if (apiOnGitHub.length === 0) {
        fail("host", `${mode}: the turn opened no pull request on ${byApi}; the model did not run the commands`);
      } else {
        await page.waitForTimeout(5_000);
        const rows = await panelRows(page);
        for (const key of apiOnGitHub) {
          const row = rows.find((r) => r.key === key);
          if (row === undefined || row.source !== "branch") fail("b", `${mode}: ${key} reads ${JSON.stringify(row)} after the turn (want source branch)`);
        }
      }
    }

    // ---- r2: the panel's set equals GitHub's, once each; the viewed one is the turn's own
    await page.waitForTimeout(2_000);
    const rows = await panelRows(page);
    const keys = rows.map((r) => r.key).sort();
    const want = listedOnGitHub(branches);
    if (new Set(keys).size !== keys.length) fail("r2", `${mode}: the panel repeats a pull request: ${JSON.stringify(keys)}`);
    if (JSON.stringify([...new Set(keys)].sort()) !== JSON.stringify(want)) {
      fail("r2", `${mode}: the panel shows ${JSON.stringify(keys)}; GitHub lists ${JSON.stringify(want)}`);
    }
    for (const key of openedOnGitHub) {
      if (rows.find((r) => r.key === key)?.source !== "tool") fail("r2", `${mode}: ${key} is not marked as opened by the turn`);
    }
    evidence.push(`${mode}: panel ${JSON.stringify(rows)}; GitHub ${JSON.stringify(want)}; live ${JSON.stringify([...seenLive])}`);
  } finally {
    cleanUp(branches);
  }
}

await runGoal(async (failures) => {
  const evidence: string[] = [];
  const fail = (leg: string, message: string) => failures.push(`[${leg}] ${message}`);
  const token = randomBytes(4).toString("hex");

  try {
    gh(["repo", "view", REPO, "--json", "name"]);
  } catch (err) {
    fail("host", `gh can't reach ${REPO}: ${err instanceof Error ? err.message : String(err)}`);
    return { failures, evidence: "" };
  }

  const server = await startDev();
  const browser = await launchChromium();
  try {
    for (const mode of MODES) {
      const page = await browser.newPage();
      await grade(page, mode, token, fail, evidence);
      await page.close();
    }
  } finally {
    await browser.close();
    server.stop();
  }

  if (CONTROL !== "") {
    const { must, may } = EXPECTED[CONTROL]!;
    const legs = new Set(failures.map((f) => /^\[([^\]]+)\]/.exec(f)?.[1] ?? ""));
    for (const leg of must) {
      if (!legs.has(leg)) failures.push(`[control] GOAL_CONTROL=${CONTROL} left the ${leg} leg green, so that leg cannot fail`);
    }
    for (const leg of legs) {
      if (!must.includes(leg) && !may.includes(leg) && leg !== "control") failures.push(`[control] GOAL_CONTROL=${CONTROL} also reddened the ${leg} leg`);
    }
  }
  return { failures, evidence: evidence.join("; ") };
});
