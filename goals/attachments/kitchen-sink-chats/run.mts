/**
 * Goal check, FIX-2521: in Kitchen Sink's Flow State chat and on each coding
 * harness page, a pasted image and a picked one reach the model or the
 * harness, and the user line shows both after a reload. See goal.md.
 *
 *   Host:   `next dev` on the in-memory store, the harness modes' worktrees
 *           cut from a scratch checkout. Outside a dry run nothing is in test
 *           mode: Flow State's model and every harness are the real ones.
 *   Input:  two PNGs, a random word drawn on each; the prompt names neither.
 *   Legs:   per mode, host · shown · wire · names-both · reload · refused.
 *
 * Run:      PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers pnpm tsx goals/attachments/kitchen-sink-chats/run.mts
 * Dry run:  GOAL_SCRIPTED=1 (scripted model and harnesses; always FAILs with a [scripted] line)
 */
import { execFileSync, spawn, type ChildProcess } from "node:child_process";
import { randomInt } from "node:crypto";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Browser, Page, Request } from "playwright";
import { KITCHEN_SINK, goalTmpDir, runGoal } from "../../lib/index.mts";
import { launchChromium } from "../../lib/playwright.mts";
import { refuseIfAnswering, stopProcessGroup } from "../../lib/server.mts";
import { wordPng } from "../reach-the-model/png.mts";

const PORT = 3054;
const ORIGIN = `http://127.0.0.1:${PORT}`;
const SCRIPTED = process.env.GOAL_SCRIPTED === "1";
/** How long one real turn may take. */
const TURN_MS = 300_000;
const PROMPT = "Two images are attached. What word is written on each image? Answer with the two words only. Do not run any commands.";
const SCRATCH = goalTmpDir("kitchen-sink-chats");

/** Held out: two of these, drawn per run. Any pair of distinct A–Z words works. */
const WORDS = [
  "MANGO", "TIGER", "PLANET", "CASTLE", "RIVER", "FALCON", "LEMON", "ORBIT", "WALNUT", "BISON",
  "CANYON", "HARBOR", "VELVET", "JUNGLE", "PEPPER", "QUARTZ", "SUMMIT", "TULIP", "ZEBRA", "KETTLE",
];

interface Mode {
  readonly id: "flow-state" | "claude-code" | "codex" | "cursor";
  readonly tag: string;
  readonly label: string;
  /** The action a turn is sent on. */
  readonly action: string;
}

const MODES: Mode[] = [
  { id: "flow-state", tag: "fs", label: "Flow State", action: "run" },
  { id: "claude-code", tag: "cc", label: "Claude Code", action: "turn" },
  { id: "codex", tag: "cx", label: "Codex", action: "turn" },
  { id: "cursor", tag: "cu", label: "Cursor", action: "turn" },
];

const say = (s: string) => console.error(`[kitchen-sink-chats ${new Date().toISOString().slice(11, 19)}] ${s}`);

/** The checkout a harness session's worktree is cut from: one commit, never this repository. */
function scratchCheckout(): string {
  const repo = join(SCRATCH, "repo");
  if (existsSync(join(repo, ".git"))) return repo;
  mkdirSync(repo, { recursive: true });
  writeFileSync(join(repo, "README.md"), "A throwaway repository for the kitchen-sink-chats goal.\n");
  const git = (...args: string[]) => execFileSync("git", ["-c", "user.name=goal", "-c", "user.email=goal@example.com", ...args], { cwd: repo });
  git("init", "-q", "-b", "main");
  git("add", ".");
  git("commit", "-q", "-m", "Start");
  return repo;
}

async function startDev(): Promise<{ stop: () => void; log: () => string }> {
  await refuseIfAnswering(ORIGIN);
  let log = "";
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    NODE_ENV: "development",
    STORE_TYPE: "memory",
    KITCHEN_SINK_HARNESS_WORKSPACE: scratchCheckout(),
    XDG_STATE_HOME: join(SCRATCH, "state"),
  };
  delete env.KITCHEN_SINK_TEST_MODE;
  delete env.NEXT_PUBLIC_KITCHEN_SINK_TEST_MODE;
  delete env.GOAL_CONTROL;
  if (SCRIPTED) Object.assign(env, { KITCHEN_SINK_TEST_MODE: "1", NEXT_PUBLIC_KITCHEN_SINK_TEST_MODE: "1" });
  else Object.assign(env, { KITCHEN_SINK_REAL_HARNESS: "1" });
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

/** Flow State draws a mobile and a desktop copy of its composer; only the shown one is the person's. */
const shown = (page: Page, selector: string) => page.locator(`${selector}:visible`);
const box = (page: Page) => shown(page, '[data-testid="message-input"]').first();

/** Paste `bytes` as `name` into the shown message box, as a browser's clipboard does. */
async function paste(page: Page, name: string, type: string, bytes: Uint8Array): Promise<void> {
  await box(page).evaluate(
    (el, { name, type, data }) => {
      const transfer = new DataTransfer();
      transfer.items.add(new File([Uint8Array.from(atob(data), (c) => c.charCodeAt(0))], name, { type }));
      el.dispatchEvent(new ClipboardEvent("paste", { clipboardData: transfer, bubbles: true, cancelable: true }));
    },
    { name, type, data: Buffer.from(bytes).toString("base64") },
  );
}

/** Pick files with the composer's + button. */
async function pick(page: Page, files: { name: string; mimeType: string; buffer: Buffer }[]): Promise<void> {
  const chooser = page.waitForEvent("filechooser");
  await shown(page, 'button[aria-label="Attach files"]').first().click();
  await (await chooser).setFiles(files);
}

/** Whether the browser drew `name` as a loaded image inside `scope`. */
async function drawn(page: Page, scope: string, name: string): Promise<boolean> {
  const img = shown(page, `${scope} img[alt="${name}"]`).first();
  if (!(await img.waitFor({ timeout: 30_000 }).then(() => true, () => false))) return false;
  for (let i = 0; i < 40; i += 1) {
    if ((await img.evaluate((el) => (el as HTMLImageElement).naturalWidth).catch(() => 0)) > 0) return true;
    await page.waitForTimeout(250);
  }
  return false;
}

const isTurn = (mode: Mode) => (request: Request) =>
  request.method() === "POST" && new RegExp(`/api/flows/[^/]+/(?:[^/]+/)?actions/${mode.action}$`).test(new URL(request.url()).pathname);

/** Open the mode's page on a fresh session. */
async function open(page: Page, mode: Mode): Promise<void> {
  await page.goto(`${ORIGIN}/${mode.id}`, { timeout: 300_000 });
  if (mode.id !== "flow-state") await page.getByTestId("new-session").click();
  // As a person would: the box takes a line once the page has a session to send it to.
  const ready = Date.now() + 120_000;
  while (!(await box(page).isEnabled().catch(() => false))) {
    if (Date.now() > ready) throw new Error(`${mode.label}: the message box never became ready`);
    await page.waitForTimeout(250);
  }
}

/** The page's text once the turn has ended. */
async function replyText(page: Page): Promise<string> {
  const stop = shown(page, 'button[aria-label="Stop"]').first();
  await stop.waitFor({ timeout: 30_000 }).catch(() => undefined);
  const deadline = Date.now() + TURN_MS;
  while (Date.now() < deadline && (await stop.isVisible())) await page.waitForTimeout(500);
  await page.waitForTimeout(1_500);
  const texts = await shown(page, '[data-testid="conversation"] [data-testid="message"]:not([data-message-role="user"])').allTextContents();
  return texts.join("\n");
}

await runGoal(async (failures, tell) => {
  const fail = (leg: string, message: string) => failures.push(`[${leg}] ${message}`);
  if (SCRIPTED) failures.push("[scripted] GOAL_SCRIPTED=1 walked the scripted model and harnesses: a dry run, not a verdict");
  const first = WORDS[randomInt(WORDS.length)]!;
  let second = first;
  while (second === first) second = WORDS[randomInt(WORDS.length)]!;
  say(`words ${first}, ${second}`);
  const evidence: string[] = [];

  const server = await startDev();
  let browser: Browser | undefined;
  try {
    browser = await launchChromium();
    // ---- host: the picker's answer for each mode, and Flow State's model key
    const picker = await browser.newPage();
    await picker.goto(`${ORIGIN}/`, { timeout: 300_000 });
    const walked: Mode[] = [];
    for (const mode of MODES) {
      const card = picker.locator(`[data-mode-id="${mode.id}"]`);
      await card.waitFor({ timeout: 60_000 });
      if ((await card.getAttribute("data-available")) !== "true") {
        const reason = await card.getByTestId("mode-reason").textContent().catch(() => null);
        fail(`${mode.tag}:host`, `blocked: ${mode.label} mode is unavailable here: ${reason ?? "(no reason drawn)"}`);
        continue;
      }
      if (mode.id === "flow-state" && !SCRIPTED && !process.env.AI_GATEWAY_API_KEY) {
        fail(`${mode.tag}:host`, "blocked: no AI_GATEWAY_API_KEY, so Flow State's model can't run");
        continue;
      }
      walked.push(mode);
    }
    await picker.close();

    for (const mode of walked) {
      const page = await browser.newPage();
      say(`${mode.label}`);
      // ---- refused: an 11th image, a file over 20 MB and a HEIC, and no send
      await open(page, mode);
      let sends = 0;
      page.on("request", (request) => {
        if (isTurn(mode)(request)) sends += 1;
      });
      const small = (i: number) => ({ name: `tiny-${i}.png`, mimeType: "image/png", buffer: Buffer.from(wordPng("A")) });
      // The notices show the latest batch's refusals, so each is read after its own batch.
      const refusedWith = async (line: string, attach: () => Promise<void>) => {
        await attach();
        const notices = shown(page, '[aria-label="Attachment notices"]').first();
        const said = await notices.filter({ hasText: line }).waitFor({ timeout: 10_000 }).then(() => true, () => false);
        if (!said) fail(`${mode.tag}:refused`, `the composer's notices don't say "${line}": ${JSON.stringify(await notices.textContent().catch(() => ""))}`);
      };
      await pick(page, Array.from({ length: 10 }, (_, i) => small(i)));
      await refusedWith("Only 10 images per message", () => pick(page, [small(10)]));
      await refusedWith("huge.png is over 20 MB", () => pick(page, [{ name: "huge.png", mimeType: "image/png", buffer: Buffer.alloc(25 * 1024 * 1024) }]));
      await refusedWith("photo.heic isn't supported", () => paste(page, "photo.heic", "image/heic", new Uint8Array(64)));
      if (sends !== 0) fail(`${mode.tag}:refused`, `${sends} turn request(s) went out while attaching`);

      // ---- shown, wire: a fresh page, one image pasted and one picked
      await open(page, mode);
      await paste(page, "first.png", "image/png", wordPng(first));
      await pick(page, [{ name: "second.png", mimeType: "image/png", buffer: Buffer.from(wordPng(second)) }]);
      for (const name of ["first.png", "second.png"]) {
        if (!(await drawn(page, "form", name))) fail(`${mode.tag}:shown`, `${name} is not drawn in the composer before Send`);
      }
      await shown(page, '[aria-label="Uploading"]').first().waitFor({ state: "detached", timeout: 60_000 }).catch(() => undefined);
      const sent = page.waitForRequest(isTurn(mode), { timeout: 30_000 }).catch(() => null);
      await box(page).fill(PROMPT);
      await box(page).press("Enter");
      const request = await sent;
      if (request === null) {
        fail(`${mode.tag}:wire`, "no turn request went out");
        await page.close();
        continue;
      }
      const body = request.postData() ?? "";
      const refs = (JSON.parse(body) as { attachments?: { data?: string }[] }).attachments?.map((f) => f.data ?? "") ?? [];
      if (refs.length !== 2 || !refs.every((ref) => ref.startsWith("fsd-blob:"))) {
        fail(`${mode.tag}:wire`, `the request's attachments are ${JSON.stringify(refs)}, not two fsd-blob: references`);
      }
      if (/[A-Za-z0-9+/]{1024}/.test(body)) fail(`${mode.tag}:wire`, "the request carries a base64 run of 1 KB or more");

      // ---- names-both
      const reply = (await replyText(page)).toUpperCase();
      const named = tell.over(`${mode.tag}:names-both`, [first, second]).filter((word) => reply.includes(word));
      if (named.length !== 2) fail(`${mode.tag}:names-both`, `the reply names ${named.length} of ${first}, ${second}: ${JSON.stringify(reply.slice(0, 400))}`);

      // ---- reload
      await page.reload();
      for (const name of ["first.png", "second.png"]) {
        if (!(await drawn(page, '[data-testid="conversation"] [aria-label="Attached files"]', name))) {
          fail(`${mode.tag}:reload`, `${name} is not drawn on the user line after a reload`);
        }
      }
      evidence.push(`${mode.tag}: reply ${JSON.stringify(reply.slice(0, 80))}`);
      await page.close();
    }
  } finally {
    await browser?.close();
    server.stop();
  }
  return { failures, evidence: evidence.join(" · ") };
});
