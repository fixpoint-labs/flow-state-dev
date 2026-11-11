/**
 * What the closure's app runners share (FIX-2565), so each `<app>/run.mts`
 * holds only how its app is served and where its chats are:
 *
 * - {@link draw}: the run's held-out input. Two PNGs, each with one word drawn
 *   from a list (`../reach-the-model/png.mts`), and a three-page PDF whose
 *   only code word is on page 3 (the engine's test PDF writer). No prompt
 *   names a word.
 * - {@link refuseStubs}: the run refuses to start on a stubbed model or
 *   harness: a test-mode flag in the environment, or `GOAL_SCRIPTED`.
 * - {@link missingModel}, {@link harnessReadiness}: what this host can run.
 *   A surface whose model has no key, or whose harness isn't signed in, is
 *   named as not run, which FAILs the closure (DECISIONS, "A harness not
 *   signed in").
 * - {@link plantControl}: `GOAL_CONTROL=strip-file-parts` planted into the
 *   checkout for the run and put back after: the model message build keeps a
 *   user line's text only, and every harness turn reads no file.
 * - {@link walkSurface}: legs a, b and c in one chat, read off the page.
 *
 * Every leg reads what the person sees: the composer, the reply on the page,
 * the line drawn after a reload and after a real restart. The wire and the
 * session read are read for the "references, never bytes" half (ER-2).
 */
import { randomInt } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Locator, Page, Request } from "playwright";
import { checkClaudeCodeReadiness } from "@flow-state-dev/claude-code";
import { checkCodexReadiness } from "@flow-state-dev/codex";
import { checkCursorReadiness } from "@flow-state-dev/cursor";
import { makePdf } from "../../../packages/engine/test/blobs/pdf-fixture.ts";
import { keysServing, repoPath, sleep, type Tell } from "../../lib/index.mts";
import { plant, type Plant } from "../../lib/plant.mts";
import { wordPng } from "../reach-the-model/png.mts";

/** How long one real turn may take before its reply is read as missing. */
export const TURN_MS = Number(process.env.GOAL_TURN_MS ?? 300_000);
export const PROMPT_IMAGES = "Two images are attached. What word is written on each image? Answer with the two words only. Do not run any commands.";
export const PROMPT_PDF = "A PDF is attached. What is the code word in it? Answer with the code word only. Do not run any commands.";

/** Held out: any distinct A–Z words pass a correct implementation. */
const WORDS = [
  "MANGO", "TIGER", "PLANET", "CASTLE", "RIVER", "FALCON", "LEMON", "ORBIT", "WALNUT", "BISON",
  "CANYON", "HARBOR", "VELVET", "JUNGLE", "PEPPER", "QUARTZ", "SUMMIT", "TULIP", "ZEBRA", "KETTLE",
];
const CODE_WORDS = ["AMBERLINE", "COBALTFERN", "DRIFTWOOD", "EMBERGATE", "FROSTPINE", "GLASSHOUSE", "HOLLOWAY", "IRONBARK", "JUNIPERO", "KESTRELLA", "LANTERNFLY", "MOSSGROVE"];

/** One run's input. */
export interface Draw {
  words: [string, string];
  first: Uint8Array;
  second: Uint8Array;
  codeWord: string;
  pdf: Uint8Array;
}

/** Two distinct words, their PNGs, and a PDF whose code word is on its last page only. */
export function draw(): Draw {
  const a = WORDS[randomInt(WORDS.length)]!;
  let b = a;
  while (b === a) b = WORDS[randomInt(WORDS.length)]!;
  const codeWord = CODE_WORDS[randomInt(CODE_WORDS.length)]!;
  const filler = "This page is filler. It names no code word and asks nothing of the reader.";
  return { words: [a, b], first: wordPng(a), second: wordPng(b), codeWord, pdf: makePdf([filler, filler, `The code word is ${codeWord}.`]) };
}

/** A fresh draw of two words only, for a journey that must not reuse leg a's (a task's runs). */
export function drawWords(not: readonly string[] = []): [string, string] {
  const pool = WORDS.filter((w) => !not.includes(w));
  const a = pool[randomInt(pool.length)]!;
  let b = a;
  while (b === a) b = pool[randomInt(pool.length)]!;
  return [a, b];
}

/** Environment that turns an app's model or harness into a scripted one. */
const STUB_FLAGS = ["GOAL_SCRIPTED", "KITCHEN_SINK_TEST_MODE", "NEXT_PUBLIC_KITCHEN_SINK_TEST_MODE", "CLAUDE_CODE_STYLE_HARNESS", "GOAL_HARNESS"];

/** Exit 2, before anything starts, when the run would grade a stubbed model or harness. */
export function refuseStubs(): void {
  const set = STUB_FLAGS.filter((name) => (process.env[name] ?? "") !== "");
  if (set.length > 0) {
    console.error(`refused: ${set.join(", ")} set; the closure never runs on a stubbed model or harness (FIX-2565, "Not done if")`);
    process.exit(2);
  }
  const harness = process.env.DEVFORCE_LAB_HARNESS;
  if (harness !== undefined && harness !== "" && harness !== "claude-code") {
    console.error(`refused: DEVFORCE_LAB_HARNESS=${harness}; Shift Manager's coder must run a real harness`);
    process.exit(2);
  }
}

/** Why an app's generator can't run here (no key serves `model`), or `undefined`. */
export function missingModel(model = "openai/gpt-6-luna"): string | undefined {
  const keys = keysServing(model);
  return keys.some((k) => (process.env[k] ?? "") !== "") ? undefined : `no key serves the app's model: none of ${keys.join(", ")} is set`;
}

export type Harness = "claude-code" | "codex" | "cursor";

/** Each harness's readiness on this host: `undefined` when it can run, else why not. */
export async function harnessReadiness(): Promise<Record<Harness, string | undefined>> {
  const env = process.env as Record<string, string>;
  const reason = (r: { ready: boolean; reason?: string; remedy?: string }) => (r.ready ? undefined : `not signed in here: ${r.reason ?? "no reason given"}${r.remedy ? ` (${r.remedy})` : ""}`);
  const root = process.getuid?.() === 0 ? "the runner is root, and Claude Code refuses to run as root" : undefined;
  return {
    "claude-code": root ?? reason(await checkClaudeCodeReadiness({ env })),
    codex: reason(await checkCodexReadiness({ env })),
    cursor: reason(await checkCursorReadiness(env)),
  };
}

// ---------------------------------------------------------------------------
// The control
// ---------------------------------------------------------------------------

/**
 * `strip-file-parts`: on the final commit, a planted strip of file parts.
 * Legs a and b must FAIL on `names-both` and `code-word` in every surface;
 * leg c, the wire and the reloads are unchanged.
 */
const CONTROL_PLANTS: Record<string, Plant[]> = {
  "strip-file-parts": [
    { file: repoPath("packages", "engine", "src", "context", "history.ts"), from: "if (files.length > 0) {", to: "if (false && files.length > 0) {" },
    {
      file: repoPath("packages", "core", "src", "types", "harness-attachments.ts"),
      from: "const read = await readHarnessAttachments(ctx, attachments);",
      to: "const read = await readHarnessAttachments(ctx, []);",
    },
  ],
};

/** The control this run plants (`GOAL_CONTROL`), or "". Exits 2 on an unknown one. */
export function controlName(): string {
  const name = process.env.GOAL_CONTROL ?? "";
  if (name !== "" && CONTROL_PLANTS[name] === undefined) {
    console.error(`unknown GOAL_CONTROL "${name}"; known: ${Object.keys(CONTROL_PLANTS).join(", ")}`);
    process.exit(2);
  }
  return name;
}

/** Plant the control into the checkout; the returned function puts every file back. Put back on exit too. */
export function plantControl(name: string): () => void {
  const undo = plant(CONTROL_PLANTS, name);
  let done = false;
  const putBack = () => {
    if (done) return;
    done = true;
    undo();
  };
  process.once("exit", putBack);
  for (const signal of ["SIGINT", "SIGTERM"] as const) process.once(signal, () => (putBack(), process.exit(130)));
  return putBack;
}

// ---------------------------------------------------------------------------
// One chat, as a person uses it
// ---------------------------------------------------------------------------

/** One chat surface. Each app's runner builds its own. */
export interface Surface {
  /** Short tag every failure carries: `<tag>:<leg>`. */
  tag: string;
  label: string;
  /** Open a fresh conversation, its composer ready for a line. */
  open(page: Page): Promise<void>;
  /** The message box the person types in. */
  box(page: Page): Locator;
  /** Where the reply is drawn: the text the reply legs read. Default: the page's body. */
  replyScope?(page: Page): Locator;
  /** The server's origin now: a restart may move it. */
  origin(): string;
  /** Stop the server and start it again on the same stores. Default: no restart (a FAIL at `restart`). */
  restart?(): Promise<void>;
  /** The page path that reopens the conversation leg a sent into, after a restart. Default: the page's own URL. */
  reopenPath?(page: Page): string;
  /**
   * Open the coding task the hand-off filed and return the part of its view the
   * coding run writes (its work or result, never the title or goal the filer
   * wrote); null when no task shows within `timeout`.
   * Without it, the hand-off has nothing of the coding run's to read: a FAIL.
   */
  openCodingTask?(page: Page, timeout: number): Promise<Locator | null>;
}

const visible = (page: Page, selector: string) => page.locator(`${selector}:visible`);

/** Paste `bytes` as `name` into the box, as a browser's clipboard does. */
export async function paste(box: Locator, name: string, type: string, bytes: Uint8Array): Promise<void> {
  await box.evaluate(
    (el, { name, type, data }) => {
      const transfer = new DataTransfer();
      transfer.items.add(new File([Uint8Array.from(atob(data), (c) => c.charCodeAt(0))], name, { type }));
      el.dispatchEvent(new ClipboardEvent("paste", { clipboardData: transfer, bubbles: true, cancelable: true }));
    },
    { name, type, data: Buffer.from(bytes).toString("base64") },
  );
}

type PickedFile = { name: string; mimeType: string; buffer: Buffer };

/** One folder for every pick in this process, removed on exit: the browser may read a picked file after `setFiles`. */
let pickRoot: string | undefined;
function pickDir(): string {
  if (!pickRoot) {
    const root = mkdtempSync(join(tmpdir(), "closure-pick-"));
    process.once("exit", () => rmSync(root, { recursive: true, force: true }));
    pickRoot = root;
  }
  // Its own folder per pick, so a later pick never overwrites a file an earlier one handed over.
  return mkdtempSync(join(pickRoot, "p-"));
}

/** Pick files with the composer's + button. */
export async function pick(page: Page, files: PickedFile[]): Promise<void> {
  const chooser = page.waitForEvent("filechooser", { timeout: 15_000 });
  await visible(page, 'button[aria-label="Attach files"]').first().click();
  // Written to disk first: a large file handed over as a buffer is what times out `setFiles`.
  const dir = pickDir();
  const paths = files.map((file) => {
    const path = join(dir, file.name);
    writeFileSync(path, file.buffer);
    return path;
  });
  await (await chooser).setFiles(paths);
}

/** Whether `name` is drawn as a loaded image inside `scope`. */
async function drawn(page: Page, scope: string, name: string): Promise<boolean> {
  const img = visible(page, `${scope} img[alt="${name}"]`).first();
  if (!(await img.waitFor({ timeout: 30_000 }).then(() => true, () => false))) return false;
  for (let i = 0; i < 40; i += 1) {
    if ((await img.evaluate((el) => (el as HTMLImageElement).naturalWidth).catch(() => 0)) > 0) return true;
    await page.waitForTimeout(250);
  }
  return false;
}

/** A send: a POST to an action whose body carries `line`. */
const isSendOf = (line: string) => (request: Request) => request.method() === "POST" && /\/actions\/[^/]+$/.test(new URL(request.url()).pathname) && (request.postData() ?? "").includes(line.slice(0, 40));
/** Any POST to an action: what leg c must not see while files are only attached. */
const isAnyAction = (request: Request) => request.method() === "POST" && /\/actions\/[^/]+$/.test(new URL(request.url()).pathname);

/** The session a send went to: from its path (`/api/flows/<kind>/<session>/actions/<action>`) or its body. */
function sessionOf(request: Request): string | undefined {
  const path = /\/api\/flows\/[^/]+\/([^/]+)\/actions\//.exec(new URL(request.url()).pathname)?.[1];
  if (path !== undefined) return decodeURIComponent(path);
  try {
    return (JSON.parse(request.postData() ?? "{}") as { sessionId?: string }).sessionId;
  } catch {
    return undefined;
  }
}

/** Type `line` and send it with Enter; the send request, or null when none went out. */
export async function sendLine(page: Page, surface: Surface, line: string): Promise<Request | null> {
  await visible(page, '[aria-label="Uploading"]').first().waitFor({ state: "detached", timeout: 120_000 }).catch(() => undefined);
  const sent = page.waitForRequest(isSendOf(line), { timeout: 30_000 }).catch(() => null);
  await surface.box(page).fill(line);
  await surface.box(page).press("Enter");
  return sent;
}

/** Poll the reply's text until every one of `words` is in it, or {@link TURN_MS} passes; the text last read. */
export async function readUntilNamed(scope: Locator, words: readonly string[], since = ""): Promise<string> {
  let fresh = "";
  for (const end = Date.now() + TURN_MS; Date.now() < end; await sleep(1_000)) {
    const text = (await scope.innerText().catch(() => "")).toUpperCase();
    // Past the person's own line, so nothing drawn before it can count.
    const at = since === "" ? -1 : text.lastIndexOf(since.toUpperCase());
    fresh = at < 0 ? text : text.slice(at + since.length);
    if (words.every((w) => fresh.includes(w))) return fresh;
  }
  return fresh;
}

/** The session read as the page's own connection reads it (its bearer when the app has one), as text on the wire. */
async function sessionReadText(page: Page, origin: string, sessionId: string): Promise<string> {
  return page.evaluate(
    async ({ url }) => {
      const config = (window as unknown as { __FSD_DEVTOOL_CONFIG__?: { bearerToken?: string } }).__FSD_DEVTOOL_CONFIG__;
      const headers: Record<string, string> = config?.bearerToken ? { authorization: `Bearer ${config.bearerToken}` } : {};
      const response = await fetch(url, { headers, credentials: "include" });
      return `${response.status}\n${await response.text()}`;
    },
    { url: `${origin}/api/flows/sessions/${encodeURIComponent(sessionId)}/state?include_items=true&limit=200` },
  );
}

const BASE64_RUN = /[A-Za-z0-9+/=]{1024,}/;

/** What a surface's walk hands its runner. */
export interface Walked {
  /** The reply text leg a read: a runner's later leg reads past it. */
  replyA: string;
}

/**
 * Legs a, b and c in one chat. Each failure is `<tag>:<assertion>`:
 * a — `shown`, `wire`, `names-both`, `session-read`, `reload`, `restart`, `local-storage`;
 * b — `code-word`; c — `refused`.
 */
export async function walkSurface(page: Page, surface: Surface, d: Draw, failures: string[], tell: Tell, evidence: string[]): Promise<Walked> {
  const fail = (leg: string, message: string) => failures.push(`[${surface.tag}:${leg}] ${message}`);
  const reply = (p: Page) => (surface.replyScope ?? ((q: Page) => q.locator("body")))(p);
  const [first, second] = d.words;

  // ---- leg a: one image pasted, one picked, sent
  await surface.open(page);
  await paste(surface.box(page), "first.png", "image/png", d.first);
  await pick(page, [{ name: "second.png", mimeType: "image/png", buffer: Buffer.from(d.second) }]);
  for (const name of ["first.png", "second.png"]) {
    if (!(await drawn(page, "", name))) fail("shown", `${name} is not drawn in the composer before Send`);
  }
  const sent = await sendLine(page, surface, PROMPT_IMAGES);
  let replyA = "";
  if (sent === null) {
    fail("wire", "no send request went out for leg a");
  } else {
    const body = sent.postData() ?? "";
    let refs: string[] = [];
    try {
      refs = ((JSON.parse(body) as { attachments?: { data?: string }[] }).attachments ?? []).map((f) => f.data ?? "");
    } catch {
      // Not JSON: no references.
    }
    if (refs.length !== 2 || !refs.every((ref) => ref.startsWith("fsd-blob:"))) fail("wire", `the send's attachments are ${JSON.stringify(refs).slice(0, 200)}, not two references`);
    if (BASE64_RUN.test(body)) fail("wire", "the send carries a base64 run of 1 KB or more");

    replyA = await readUntilNamed(reply(page), [first, second], PROMPT_IMAGES.slice(0, 30));
    const named = tell.over(`${surface.tag}:names-both`, [first, second]).filter((w) => replyA.includes(w));
    if (named.length !== 2) fail("names-both", `the reply names ${named.length} of ${first}, ${second}: ${JSON.stringify(replyA.slice(-400))}`);

    const sessionId = sessionOf(sent);
    if (sessionId === undefined) fail("session-read", "the send named no session");
    else {
      const read = await sessionReadText(page, surface.origin(), sessionId);
      const held = refs.filter((ref) => read.includes(ref)).length;
      if (!read.startsWith("200")) fail("session-read", `the session read answered ${read.slice(0, 60)}`);
      else {
        if (held !== 2) fail("session-read", `the session read holds ${held} of the line's 2 references`);
        if (BASE64_RUN.test(read)) fail("session-read", "the session read carries a base64 run over 1 KB");
      }
    }
  }

  // ---- reload, then a real restart on the same stores
  const reopen = surface.reopenPath?.(page) ?? new URL(page.url()).pathname + new URL(page.url()).search;
  await page.reload();
  for (const name of ["first.png", "second.png"]) {
    if (!(await drawn(page, '[aria-label="Attached files"]', name))) fail("reload", `${name} is not drawn on the user line after a reload`);
  }
  if (surface.restart === undefined) fail("restart", "this surface has no restart: not walked");
  else {
    await surface.restart();
    await page.goto(`${surface.origin()}${reopen}`, { timeout: 300_000 });
    for (const name of ["first.png", "second.png"]) {
      if (!(await drawn(page, '[aria-label="Attached files"]', name))) fail("restart", `${name} is not drawn on the user line after the server restarted`);
    }
  }
  const stored = await page.evaluate(() => {
    try {
      return JSON.stringify(Object.entries(window.localStorage));
    } catch {
      return "";
    }
  });
  if (BASE64_RUN.test(stored)) fail("local-storage", "the page's localStorage holds a base64 run over 1 KB");

  // ---- leg b: a PDF whose code word is only on its last page
  await surface.open(page);
  await pick(page, [{ name: "report.pdf", mimeType: "application/pdf", buffer: Buffer.from(d.pdf) }]);
  const notices = visible(page, '[aria-label="Attachment notices"]').first();
  const refusedPdf = (await notices.textContent({ timeout: 2_000 }).catch(() => null)) ?? "";
  if (/report\.pdf/.test(refusedPdf)) fail("code-word", `the composer refused the PDF: ${JSON.stringify(refusedPdf)}`);
  const sentB = await sendLine(page, surface, PROMPT_PDF);
  if (sentB === null) fail("code-word", "no send request went out for leg b");
  else {
    const replyB = await readUntilNamed(reply(page), [d.codeWord], PROMPT_PDF.slice(0, 30));
    if (!tell.over(`${surface.tag}:code-word`, [d.codeWord]).every((w) => replyB.includes(w))) fail("code-word", `the reply doesn't carry ${d.codeWord}: ${JSON.stringify(replyB.slice(-300))}`);
  }

  // ---- leg c: an 11th image, a 25 MB file and a HEIC, each refused by name, nothing sent
  await surface.open(page);
  const actions: string[] = [];
  const watch = (request: Request) => void (isAnyAction(request) && actions.push(new URL(request.url()).pathname));
  page.on("request", watch);
  const small = (i: number): PickedFile => ({ name: `tiny-${i}.png`, mimeType: "image/png", buffer: Buffer.from(wordPng("A")) });
  const refusedWith = async (line: string, attach: () => Promise<void>) => {
    await attach();
    const said = await notices.filter({ hasText: line }).waitFor({ timeout: 10_000 }).then(() => true, () => false);
    if (!said) fail("refused", `the composer's notices don't say "${line}": ${JSON.stringify(await notices.textContent().catch(() => ""))}`);
  };
  await pick(page, Array.from({ length: 10 }, (_, i) => small(i)));
  await refusedWith("Only 10 images per message", () => pick(page, [small(10)]));
  await refusedWith("huge.png is over 20 MB", () => pick(page, [{ name: "huge.png", mimeType: "image/png", buffer: Buffer.alloc(25 * 1024 * 1024) }]));
  await refusedWith("photo.heic isn't supported", () => paste(surface.box(page), "photo.heic", "image/heic", new Uint8Array(64)));
  page.off("request", watch);
  if (actions.length > 0) fail("refused", `${actions.length} action request(s) went out while only attaching: ${actions.join(", ")}`);
  // Leave the box empty: a leg run after this one on the same composer attaches its own files.
  for (let i = 0; i < 20; i += 1) {
    const remove = page.getByRole("button", { name: /^Remove / }).first();
    if (!(await remove.isVisible().catch(() => false))) break;
    await remove.click();
  }
  if (await page.getByRole("button", { name: /^Remove / }).first().isVisible().catch(() => false)) fail("refused", "the attached files couldn't be taken off the box after leg c");

  evidence.push(`${surface.tag}: a ${JSON.stringify(replyA.slice(-60))}`);
  return { replyA };
}

/** The line that asks a worker to hand the turn's two images to a coding run. `worker` names the coder as the app knows it. */
export const handOffLine = (worker: string) =>
  `Start a coding task for ${worker} with the two attached images. The task: report the word written on each image, and change no file. Tell me what it reports.`;

/**
 * A coding worker sees a line's images through the task its worker files
 * (FIX-2522): two fresh images, the hand-off line, and the coding task's own
 * view (opened by the surface's `openCodingTask`) naming both words.
 * Failures are `<tag>:coding`.
 */
export async function walkCodingHandOff(page: Page, surface: Surface, worker: string, failures: string[], tell: Tell, avoid: readonly string[]): Promise<[string, string]> {
  const words = drawWords(avoid);
  await surface.open(page);
  await paste(surface.box(page), "bug-1.png", "image/png", wordPng(words[0]));
  await pick(page, [{ name: "bug-2.png", mimeType: "image/png", buffer: Buffer.from(wordPng(words[1])) }]);
  const line = handOffLine(worker);
  const sent = await sendLine(page, surface, line);
  if (sent === null) {
    failures.push(`[${surface.tag}:coding] no send request went out`);
    return words;
  }
  // The coding run's own view, never the conversation: the worker that files the task sees the images itself.
  const view = surface.openCodingTask === undefined ? null : await surface.openCodingTask(page, TURN_MS);
  if (view === null) {
    failures.push(`[${surface.tag}:coding] no coding task was filed from the line`);
    return words;
  }
  const text = await readUntilNamed(view, words);
  const named = tell.over(`${surface.tag}:coding`, words).filter((w) => text.includes(w));
  if (named.length !== 2) failures.push(`[${surface.tag}:coding] the coding run's report names ${named.length} of ${words.join(", ")}: ${JSON.stringify(text.slice(-400))}`);
  return words;
}
