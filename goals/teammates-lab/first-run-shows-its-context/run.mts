/**
 * Goal check, FIX-2403: the Teammates lab's first run shows what it works on.
 * The page's context strip names the folder, model and default harness the
 * lab was started with; its harness chips say Codex can't run and what to
 * run, and read ✓ after a real login and a Re-check; and an empty
 * conversation's starter line fills the composer without sending anything.
 * See goal.md for the contract.
 *
 * `fsdev dev --app <pages>` on a fresh store over a fresh git checkout, the
 * pages built from a scratch copy of the lab's source (a control's patch lands
 * only in that copy, and is printed). No model is called.
 *
 * Run:     PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers pnpm tsx goals/teammates-lab/first-run-shows-its-context/run.mts
 * Control: GOAL_CONTROL=fixed-chips, same command (goal.md → Controls).
 */
import { execFileSync, spawnSync } from "node:child_process";
import { randomInt } from "node:crypto";
import { cpSync, mkdirSync, readFileSync, symlinkSync, writeFileSync } from "node:fs";
import { delimiter, join } from "node:path";
import { createClient } from "@flow-state-dev/client";
import { findCodexProgram } from "@flow-state-dev/codex";
import { createWorkforceClient } from "@flow-state-dev/workforce/browser";
import { goalTmpDir, loadFixture, REPO_ROOT, repoPath, runGoal, stopProcessGroup } from "../../lib/index.mts";
import { launchChromium } from "../../lib/playwright.mts";
import { sleep, startTeammates } from "../lab.mts";

const fixture = loadFixture<{ lead: string; harness: { value: string; label: string }; remedy: string }>(import.meta.url);
const USER = "u_goal";
const LAB = repoPath("labs", "teammates");
const LEAD_ID = "teammates.chief-of-staff";
const say = (s: string) => console.error(`[tm-first-run ${new Date().toISOString().slice(11, 19)}] ${s}`);

type Patch = { file: string; from: string; to: string; why: string };
const CONTROLS: Record<string, Patch[]> = {
  "": [],
  // The chips drawn from a constant list where every harness is ready: what a strip that never reads the machine shows.
  "fixed-chips": [
    {
      file: "src/adapter.ts",
      from: "return (await client.view(READINESS_VIEW, { refresh })).value;",
      to:
        "void refresh; return [\"cursor\", \"codex\", \"claude-code\"].map((harness) => ({ harness, label: harness, ready: true, reason: null, remedy: null, unanswered: false, checkedAt: Date.now() })) as LabHarness[];",
      why: "the chips read a constant all-ready list, not harness-manager's readiness",
    },
  ],
};
const CONTROL = process.env.GOAL_CONTROL ?? "";
if (!(CONTROL in CONTROLS)) throw new Error(`unknown GOAL_CONTROL "${CONTROL}"; known: ${Object.keys(CONTROLS).filter(Boolean).join(", ")}`);

/** The lab's pages, built from a scratch copy of its source with `patches` applied. */
function buildPages(scratch: string, patches: readonly Patch[]): string {
  const root = join(scratch, "source");
  cpSync(LAB, root, { recursive: true, filter: (src) => !/[/\\](node_modules|dist-client|\.fsdev)$/.test(src) });
  symlinkSync(join(LAB, "node_modules"), join(root, "node_modules"));
  const tsconfig = join(root, "tsconfig.json");
  writeFileSync(tsconfig, readFileSync(tsconfig, "utf8").replace('"../../tsconfig.base.json"', JSON.stringify(join(REPO_ROOT, "tsconfig.base.json"))));
  for (const patch of patches) {
    const path = join(root, patch.file);
    const before = readFileSync(path, "utf8");
    const after = before.replace(patch.from, patch.to);
    if (after === before) throw new Error(`setup: ${patch.why}, but ${patch.file} has nothing to patch (looked for ${patch.from})`);
    writeFileSync(path, after);
    say(`control ${CONTROL}: ${patch.file}: ${patch.why}\n    - ${patch.from}\n    + ${patch.to}`);
  }
  const pages = join(scratch, "pages");
  const built = spawnSync(join(LAB, "node_modules", ".bin", "vite"), ["build", "--config", join(root, "vite.config.ts"), "--outDir", pages, "--emptyOutDir", "--logLevel", "error"], {
    cwd: root,
    encoding: "utf8",
    env: { ...process.env, NODE_ENV: "production" },
  });
  if (built.status !== 0) throw new Error(`setup: vite build failed: ${(built.stderr || built.stdout).slice(-1500)}`);
  return pages;
}

/** Log Codex in with a dummy key, through the SDK's own program, into `codexHome`. */
async function codexLogin(codexHome: string): Promise<void> {
  const env = { PATH: process.env.PATH ?? "", HOME: process.env.HOME ?? "", CODEX_HOME: codexHome };
  const program = await findCodexProgram(env);
  execFileSync(program.path, ["login", "--with-api-key"], {
    env: { ...env, PATH: [...program.pathDirs, env.PATH].join(delimiter) },
    input: "sk-goal-dummy\n",
    stdio: ["pipe", "ignore", "pipe"],
  });
}

await runGoal(async (failures, tell) => {
  const scratch = goalTmpDir("teammates-first-run");
  const codexHome = join(scratch, "codex-home");
  mkdirSync(codexHome, { recursive: true });
  // A folder, model and harness no lab file names, so the strip can only show them by reading them.
  const workdir = join(scratch, `site-${randomInt(1000, 9999)}`);
  const model = `openai/goal-model-${randomInt(1000, 9999)}`;
  const notes: string[] = [];
  const pages = buildPages(scratch, CONTROLS[CONTROL]!);
  const lab = await startTeammates(
    scratch,
    USER,
    { CURSOR_API_KEY: "goal-dummy-cursor-key", CODEX_API_KEY: "", CODEX_HOME: codexHome, TEAMMATES_MODEL: model, TEAMMATES_HARNESS: fixture.harness.value },
    workdir,
    pages,
  );
  const browser = await launchChromium();
  try {
    const fsd = createClient({ userId: USER, baseUrl: lab.origin });
    const page = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
    page.setDefaultTimeout(30_000);
    const pageErrors: string[] = [];
    page.on("pageerror", (e) => pageErrors.push(e.message));
    await page.goto(lab.origin);
    await page.locator(`nav[aria-label="Workers"] button[data-worker="${fixture.lead}"]`).click();
    const strip = page.getByRole("region", { name: "Working context" });

    // ── strip: the values the run set, as read from the lab.
    const text = async (id: string) => (await strip.getByTestId(id).textContent({ timeout: 15_000 }).catch(() => null)) ?? "";
    const shown = { folder: await text("context-folder"), model: await text("context-model"), harness: await text("context-harness") };
    tell.over("strip · what it shows", [JSON.stringify(shown)]);
    const missing = [
      ...(shown.folder.includes(workdir) ? [] : [`folder ${workdir}`]),
      ...(shown.model.includes(model) ? [] : [`model ${model}`]),
      ...(shown.harness.includes(fixture.harness.label) || shown.harness.includes(fixture.harness.value) ? [] : [`harness ${fixture.harness.label}`]),
    ];
    if (missing.length > 0) failures.push(`strip: the context strip doesn't show ${missing.join(", ")}; it shows ${JSON.stringify(shown)}`);
    else notes.push(`strip: ${JSON.stringify(shown)}`);

    // ── codex-chip: ✗ with what to run, then ✓ after a real login and Re-check.
    const chips = strip.getByRole("group", { name: "Coding harnesses" });
    const codex = chips.locator('[data-harness="codex"]');
    const settled = async () => {
      for (const until = Date.now() + 30_000; Date.now() < until; await sleep(500)) {
        const ready = await codex.getAttribute("data-ready").catch(() => null);
        if (ready === "true" || ready === "false") return ready;
      }
      return "unknown";
    };
    const before = { ready: await settled(), text: (await codex.textContent().catch(() => null)) ?? "" };
    if (before.ready !== "false" || !before.text.includes(fixture.remedy)) {
      failures.push(`codex-chip: before the login the Codex chip reads ready=${before.ready} ${JSON.stringify(before.text)}, not ✗ naming \`${fixture.remedy}\``);
    } else {
      await codexLogin(codexHome);
      await chips.getByRole("button", { name: /Re-check/ }).click();
      let after = "false";
      for (const until = Date.now() + 30_000; Date.now() < until && after !== "true"; await sleep(500)) after = (await codex.getAttribute("data-ready")) ?? "unknown";
      if (after !== "true") failures.push(`codex-chip: 30s after \`codex login\` and Re-check the Codex chip still reads ready=${after}`);
      else notes.push(`codex-chip: ${JSON.stringify(before.text)} then ✓ after login`);
    }

    // ── starter: a click fills the composer, and nothing is sent within 3s.
    const session = await createWorkforceClient(fsd).ensureWorkerSession({ worker: LEAD_ID });
    const requestsBefore = ((await fsd.sessions.requests(session.id, { limit: 50 })) as unknown[]).length;
    const lines = page.getByRole("list", { name: "Starter lines" });
    const first = lines.getByRole("button").first();
    const line = ((await first.textContent({ timeout: 15_000 }).catch(() => null)) ?? "").trim();
    if (line === "") failures.push("starter: the empty conversation offers no starter line");
    else {
      await first.click();
      const box = page.getByLabel(`Message ${fixture.lead}`);
      // The 3s it waits for a send is also how long the composer has to take the line.
      let value = "";
      for (const until = Date.now() + 3_000; Date.now() < until; await sleep(250)) value = await box.inputValue().catch(() => "");
      const requestsAfter = ((await fsd.sessions.requests(session.id, { limit: 50 })) as unknown[]).length;
      if (value !== line) failures.push(`starter: clicking ${JSON.stringify(line)} left the composer holding ${JSON.stringify(value)}`);
      else if (requestsAfter !== requestsBefore) failures.push(`starter: clicking ${JSON.stringify(line)} sent ${requestsAfter - requestsBefore} request(s) to ${fixture.lead}`);
      else notes.push(`starter: ${JSON.stringify(line)} in the composer, nothing sent`);
    }

    if (pageErrors.length > 0) failures.push(`page errors: ${pageErrors.join(" | ")}`);
    return { failures, evidence: notes.join("; ") };
  } finally {
    await browser.close();
    stopProcessGroup(lab.child);
  }
});
