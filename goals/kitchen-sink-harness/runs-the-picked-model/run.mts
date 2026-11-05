/**
 * Goal check for `goal.md` beside this file. Real harnesses, `next dev`, one
 * real browser. Out of CI.
 *
 * Run:      PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers pnpm tsx goals/kitchen-sink-harness/runs-the-picked-model/run.mts
 * Control:  GOAL_CONTROL=ignore-model (must FAIL at every <mode>.m and <mode>.x, and nothing else)
 */
import { spawn, type ChildProcess } from "node:child_process";
import { randomBytes } from "node:crypto";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { createRequire } from "node:module";
import { homedir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import type { Page } from "playwright";
import { KITCHEN_SINK, REPO_ROOT, runGoal } from "../../lib/index.mts";
import { launchChromium } from "../../lib/playwright.mts";
import { refuseIfAnswering, stopProcessGroup } from "../../lib/server.mts";
import { locateSessionWorktree } from "../../../apps/kitchen-sink/lib/harness-worktree.ts";
import { KITCHEN_SINK_USER_ID } from "../../../apps/kitchen-sink/lib/kitchen-sink-principal.ts";
import { HARNESS_SESSION_FAILED_OUTCOME } from "@flow-state-dev/harness-manager";

const PORT = 3051;
const ORIGIN = `http://127.0.0.1:${PORT}`;
const CONTROL = process.env.GOAL_CONTROL ?? "";
/** How long one real turn may take. */
const TURN_MS = 240_000;
const MODES = ["claude-code", "codex", "cursor"] as const;
type ModeId = (typeof MODES)[number];
const GRADED: ModeId[] = (process.env.GOAL_MODES ?? MODES.join(","))
  .split(",")
  .map((m) => m.trim())
  .filter((m): m is ModeId => (MODES as readonly string[]).includes(m));

/** The legs each control must redden, and only those. */
const EXPECTED: Record<string, string[]> = {
  "ignore-model": GRADED.flatMap((mode) => [`${mode}.m`, `${mode}.x`]),
};
if (CONTROL !== "" && EXPECTED[CONTROL] === undefined) {
  throw new Error(`unknown GOAL_CONTROL "${CONTROL}"; known: ${Object.keys(EXPECTED).join(", ")}`);
}

const CLAUDE_HOME = process.env.CLAUDE_CONFIG_DIR || join(homedir(), ".claude");
const CODEX_HOME = process.env.CODEX_HOME || join(homedir(), ".codex");

/** `next dev`, so the unset workspace setting means "the checkout the server runs in". */
async function startDev(): Promise<{ stop: () => void; log: () => string }> {
  await refuseIfAnswering(ORIGIN);
  let log = "";
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    NODE_ENV: "development",
    KITCHEN_SINK_TEST_MODE: "1",
    NEXT_PUBLIC_KITCHEN_SINK_TEST_MODE: "1",
    KITCHEN_SINK_REAL_HARNESS: "1",
    STORE_TYPE: "filesystem",
    ...(CONTROL === "" ? {} : { GOAL_CONTROL: CONTROL }),
  };
  delete env.KITCHEN_SINK_HARNESS_WORKSPACE;
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
    if (status === 200) return { stop: () => stopProcessGroup(child), log: () => log };
    if (child.exitCode !== null) throw new Error(`next dev exited (${child.exitCode}):\n${log}`);
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  stopProcessGroup(child);
  throw new Error(`next dev never served ${ORIGIN}/api/flows:\n${log}`);
}

/** Every file under `dir`, or none when it doesn't exist. */
function filesUnder(dir: string): string[] {
  let names: string[];
  try {
    names = readdirSync(dir);
  } catch {
    return [];
  }
  return names.flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? filesUnder(path) : [path];
  });
}

/** The JSON lines of every file under `dir` matching `pick`. */
function jsonLines(dir: string, pick: (path: string) => boolean): Array<Record<string, unknown>> {
  return filesUnder(dir)
    .filter(pick)
    .flatMap((path) => readFileSync(path, "utf8").split("\n"))
    .filter((line) => line.trim() !== "")
    .flatMap((line) => {
      try {
        return [JSON.parse(line) as Record<string, unknown>];
      } catch {
        return [];
      }
    });
}

/** What the harness itself recorded of a conversation: one entry per model-bearing record, in order. */
interface HarnessRecord {
  /** The model each record names. */
  readonly models: string[];
  /** Whether the harness recorded the model writing anything (a reply, a run that finished). */
  readonly answered: boolean;
}

/** Claude Code's transcript of `conversation`: the model the API answered with, per assistant entry. */
function claudeRecord(conversation: string): HarnessRecord {
  const lines = jsonLines(join(CLAUDE_HOME, "projects"), (p) => p.endsWith(`${conversation}.jsonl`));
  const models = lines
    .filter((l) => l.type === "assistant")
    .map((l) => String((l.message as { model?: unknown } | undefined)?.model ?? ""))
    // Claude Code writes its own error notices as assistant entries under this name. No model wrote them.
    .filter((m) => m !== "<synthetic>");
  return { models, answered: models.length > 0 };
}

/** Codex's session file of `thread`: the model each turn asked for (see goal.md: requested, not served). */
function codexRecord(thread: string): HarnessRecord {
  const lines = jsonLines(join(CODEX_HOME, "sessions"), (p) => p.endsWith(".jsonl") && p.includes(thread));
  const models = lines
    .filter((l) => l.type === "turn_context")
    .map((l) => String((l.payload as { model?: unknown } | undefined)?.model ?? ""));
  const answered = lines.some((l) => {
    const payload = l.payload as { type?: unknown } | undefined;
    return payload?.type === "agent_message" || (l.type === "response_item" && (payload as { role?: unknown } | undefined)?.role === "assistant");
  });
  return { models, answered };
}

/** Cursor's local run records of `agent`, read the way Cursor reads them, in the session's worktree. */
async function cursorRecord(agent: string, sessionId: string): Promise<HarnessRecord> {
  const require = createRequire(join(KITCHEN_SINK, "package.json"));
  const { Agent } = (await import(pathToFileURL(require.resolve("@cursor/sdk")).href)) as {
    Agent: {
      listRuns(id: string, options: { runtime: "local"; cwd: string }): Promise<{ items: Array<{ model?: { id?: string }; status?: string }> }>;
    };
  };
  const cwd = locateSessionWorktree(REPO_ROOT, { flowKind: "cursor-session", sessionId });
  type RunRow = { model?: { id?: string }; status?: string };
  const runs: RunRow[] = await Agent.listRuns(agent, { runtime: "local", cwd }).then(
    (listed) => listed.items,
    () => [],
  );
  const models = runs.map((run) => run.model?.id ?? "").filter((id) => id !== "");
  return { models, answered: runs.some((run) => String(run.status ?? "").toLowerCase() === "finished") };
}

async function recordOf(mode: ModeId, conversation: string, sessionId: string): Promise<HarnessRecord> {
  if (conversation === "" || conversation === "none yet") return { models: [], answered: false };
  if (mode === "claude-code") return claudeRecord(conversation);
  if (mode === "codex") return codexRecord(conversation);
  return cursorRecord(conversation, sessionId);
}

const stopButton = (page: Page) => page.getByRole("button", { name: "Stop" });
const notice = (page: Page) => page.getByTestId("turn-notice");

async function boundId(page: Page): Promise<string> {
  return ((await page.getByTestId("bound-conversation").textContent()) ?? "").trim();
}

async function headerModel(page: Page): Promise<string | null> {
  await page.getByTestId("session-model").waitFor({ timeout: 30_000 }).catch(() => undefined);
  return page.getByTestId("session-model").getAttribute("data-model-id").catch(() => null);
}

/** Send a turn and wait for it to end. Returns the notice's kind and text. */
async function turn(page: Page, prompt: string): Promise<{ kind: string | null; text: string }> {
  const input = page.getByTestId("message-input");
  await input.fill(prompt);
  await input.press("Enter");
  await stopButton(page).waitFor({ state: "visible", timeout: 30_000 }).catch(() => undefined);
  const deadline = Date.now() + TURN_MS;
  while (Date.now() < deadline && (await stopButton(page).isVisible())) await page.waitForTimeout(500);
  await notice(page).waitFor({ state: "visible", timeout: 30_000 });
  return { kind: await notice(page).getAttribute("data-kind"), text: ((await notice(page).textContent()) ?? "").trim() };
}

/**
 * The harness's own words in an error notice (`This turn failed: <words> The
 * session stays on…`), or `null` when there are none: no words at all, or only
 * the line Kitchen Sink records when a harness reports a failed run without
 * saying why. That line is Kitchen Sink's, so it never counts as the harness's.
 */
function harnessWords(text: string): string | null {
  const words = /^This turn failed:\s*([\s\S]*?)\s*(?:The session stays on conversation [\s\S]*)?$/.exec(text)?.[1]?.trim() ?? "";
  return words === "" || words === HARNESS_SESSION_FAILED_OUTCOME ? null : words;
}

async function openedSession(page: Page): Promise<string> {
  await page.waitForFunction(() => document.querySelector('[data-testid="stream"]')?.getAttribute("data-session-id"));
  return (await page.getByTestId("stream").getAttribute("data-session-id"))!;
}

await runGoal(async (failures) => {
  const evidence: string[] = [];
  const fail = (leg: string, message: string) => failures.push(`[${leg}] ${message}`);

  const server = await startDev();
  const browser = await launchChromium();
  try {
    const page = await browser.newPage();
    for (const mode of GRADED) {
      // ---- host
      await page.goto(`${ORIGIN}/`);
      const card = page.locator(`[data-mode-id="${mode}"]`);
      await card.waitFor({ timeout: 60_000 });
      if ((await card.getAttribute("data-available")) !== "true") {
        fail(`${mode}.host`, `unavailable here: ${await card.getByTestId("mode-reason").textContent()}`);
        continue;
      }

      // ---- pick the second model, never the preselected one
      await page.goto(`${ORIGIN}/${mode}`);
      const picker = page.getByTestId("model-picker");
      await picker.waitFor({ timeout: 30_000 });
      const options = await picker.locator("option").evaluateAll((os) => os.map((o) => (o as HTMLOptionElement).value));
      const preselected = await picker.inputValue();
      const picked = options.find((id) => id !== preselected);
      if (picked === undefined) {
        fail(`${mode}.m`, `the picker offers no model besides the default (${JSON.stringify(options)})`);
        continue;
      }
      await picker.selectOption(picked);
      await page.getByTestId("new-session").click();
      const sessionId = await openedSession(page);
      evidence.push(`${mode}: session ${sessionId}, picked ${picked} (default ${preselected})`);

      // ---- m and h: turns 1, 2, reload, 3
      let seen = 0;
      const check = async (step: string) => {
        const conversation = await boundId(page);
        const record = await recordOf(mode, conversation, sessionId);
        if (record.models.length <= seen) fail(`${mode}.m`, `after ${step} the harness recorded nothing new for ${conversation || "no conversation"}`);
        const others = [...new Set(record.models.filter((m) => m !== picked))];
        if (others.length > 0) fail(`${mode}.m`, `after ${step} the harness recorded ${others.join(", ")} (picked ${picked})`);
        seen = record.models.length;
        const header = await headerModel(page);
        if (header !== picked) fail(`${mode}.h`, `after ${step} the header names ${JSON.stringify(header)} (picked ${picked})`);
        evidence.push(`${mode} ${step}: ${record.models.length} record(s) [${[...new Set(record.models)].join(", ")}] on ${conversation}`);
      };
      await turn(page, "Reply with one short sentence saying hello.");
      await check("turn 1");
      await turn(page, "Reply with one short sentence saying hello again.");
      await check("turn 2");
      await page.reload();
      await page.waitForFunction((id) => document.querySelector('[data-testid="stream"]')?.getAttribute("data-session-id") === id, sessionId, {
        timeout: 30_000,
      });
      await turn(page, "One more short sentence, please.");
      await check("reload + turn 3");

      // ---- x: an id the harness never had
      const bogus = `no-such-model-${randomBytes(4).toString("hex")}`;
      const created = await fetch(`${ORIGIN}/api/flows/${mode}-session/sessions`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ userId: KITCHEN_SINK_USER_ID, state: { model: bogus } }),
      });
      const body = (await created.json().catch(() => ({}))) as { id?: string; session?: { id?: string } };
      const refusedId = body.session?.id ?? body.id;
      if (!created.ok || refusedId === undefined) {
        fail(`${mode}.x`, `the session API refused a session with model ${bogus}: ${created.status} ${JSON.stringify(body)}`);
        continue;
      }
      await page.goto(`${ORIGIN}/${mode}?session=${encodeURIComponent(refusedId)}`);
      await openedSession(page);
      const refused = await turn(page, "Reply with one short sentence saying hello.");
      const record = await recordOf(mode, await boundId(page), refusedId);
      const others = [...new Set(record.models.filter((m) => m !== bogus))];
      if (refused.kind !== "error") fail(`${mode}.x`, `the turn on ${bogus} ended as ${JSON.stringify(refused.kind)} (want error): ${refused.text}`);
      else if (harnessWords(refused.text) === null) fail(`${mode}.x`, `the turn failed with no words from the harness: ${refused.text}`);
      if (others.length > 0) fail(`${mode}.x`, `a session born with ${bogus} ran ${others.join(", ")}`);
      // Codex names the requested slug, so an answer under it would be a model serving an id it never had.
      if (record.answered && others.length === 0) fail(`${mode}.x`, `the harness answered a turn on ${bogus}`);
      evidence.push(`${mode} x: ${bogus} → ${refused.kind}: ${refused.text.slice(0, 160)}`);
    }
  } finally {
    await browser.close();
    server.stop();
  }

  if (CONTROL !== "") {
    const want = EXPECTED[CONTROL]!;
    const legs = new Set(failures.map((f) => /^\[([^\]]+)\]/.exec(f)?.[1] ?? ""));
    for (const leg of want) {
      if (!legs.has(leg)) failures.push(`[control] GOAL_CONTROL=${CONTROL} left the ${leg} leg green, so that leg cannot fail`);
    }
    for (const leg of legs) {
      if (!want.includes(leg) && leg !== "control" && !leg.endsWith(".host")) {
        failures.push(`[control] GOAL_CONTROL=${CONTROL} also reddened the ${leg} leg`);
      }
    }
  }
  return { failures, evidence: evidence.join("; ") };
});
