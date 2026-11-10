/**
 * Goal check, FIX-2518: in a composer built from the registry, a person
 * attaches images by paste and by the + picker, sees each one before Send,
 * hears a plain reason for every file refused, and Send's request carries
 * references, not bytes. See goal.md.
 *
 *   Registry: `fsdev ui add prompt-input message` into a fresh host, every
 *             copy byte-equal to its source; the page (`pages/composer.tsx`)
 *             built by Vite.
 *   Server:   `../survive-a-restart-by-reference/host.mts`, a local server on
 *             on-disk SQLite with the engine's default blob folder, run in a
 *             scratch folder. A small proxy serves the page and passes `/api`
 *             to it, so the page and the server share an origin.
 *   Browser:  headless Chromium. Everything graded is read off the page and
 *             the requests it makes, never the hook's state.
 *
 * Control (same command): `GOAL_CONTROL=main-registry` puts the host's
 * `prompt-input` and `message` back as on `main` before this change. Must
 * fail `references` and `thumbnails`.
 *
 * `GOAL_REGISTRY=copy` copies the items in place of the install, where the
 * shadcn registry can't be reached; the verdict says so.
 *
 * Run: PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers pnpm tsx goals/attachments/composer-attaches-and-refuses/run.mts
 */
import { execFileSync, spawn, spawnSync, type ChildProcess } from "node:child_process";
import { randomBytes, randomInt } from "node:crypto";
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { dirname, extname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { deflateSync } from "node:zlib";
import type { Page, Request } from "playwright";
import { REPO_ROOT, goalTmpDir, refuseIfAnswering, repoPath, runGoal, stopProcessGroup } from "../../lib/index.mts";
import { launchChromium } from "../../lib/playwright.mts";
import { copyRegistryHost, installRegistryHost } from "../../lib/registry-host.mts";

const CONTROL = process.env.GOAL_CONTROL ?? "";
if (!["", "main-registry"].includes(CONTROL)) throw new Error(`unknown GOAL_CONTROL "${CONTROL}"; known: main-registry`);
/** `main` before this change: what the control installs. */
const BEFORE = "8e82e8ced";
const MUST_FAIL_UNDER_CONTROL = ["references", "thumbnails"];
/** `GOAL_REGISTRY=copy`: copy the items in place of `fsdev ui add`, on a machine that can't reach shadcn's registry. Said in the verdict. */
const COPY = process.env.GOAL_REGISTRY === "copy";

const HERE = dirname(fileURLToPath(import.meta.url));
const SCRATCH = goalTmpDir("composer-attaches-and-refuses");
const PORT = 5_000 + randomInt(1_000);
const API = `http://127.0.0.1:${PORT}`;
const HOST = repoPath("goals", "attachments", "survive-a-restart-by-reference", "host.mts");
const TSX = repoPath("node_modules", ".bin", "tsx");
const MAX_EDGE = 1568;

// ---- fixtures ---------------------------------------------------------------------

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc32 = (bytes: Buffer) => {
  let c = 0xffffffff;
  for (const b of bytes) c = CRC_TABLE[(c ^ b) & 0xff]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
const chunk = (type: string, data: Buffer) => {
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const out = Buffer.alloc(12 + data.length);
  out.writeUInt32BE(data.length, 0);
  body.copy(out, 4);
  out.writeUInt32BE(crc32(body), 8 + data.length);
  return out;
};

/** A fresh, decodable PNG of `width` × `height`: a random colour, with a random stripe so no two runs share one. */
function freshPng(width: number, height: number): Buffer {
  const [r, g, b] = [randomInt(256), randomInt(256), randomInt(256)];
  const stripe = randomInt(height);
  const row = Buffer.alloc(1 + width * 3);
  for (let x = 0; x < width; x += 1) row.set([r, g, b], 1 + x * 3);
  const noisy = Buffer.concat([Buffer.from([0]), randomBytes(width * 3)]);
  const raw = Buffer.concat(Array.from({ length: height }, (_, y) => (y === stripe ? noisy : row)));
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr.set([8, 2, 0, 0, 0], 8);
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk("IHDR", ihdr), chunk("IDAT", deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]);
}

/** A PNG's width and height, from its header. */
const pngSize = (bytes: Buffer) => ({ width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) });

type Fixture = { name: string; mimeType: string; buffer: Buffer };
const png = (name: string, width = 320 + randomInt(400), height = 240 + randomInt(300)): Fixture => ({ name, mimeType: "image/png", buffer: freshPng(width, height) });

// ---- setup ------------------------------------------------------------------------

/** The registry installed into a fresh host and the page built there; under the control, `main`'s items. */
async function buildPage(): Promise<string> {
  const items = ["prompt-input", "message"];
  const { host } = COPY ? copyRegistryHost(join(SCRATCH, "registry"), items) : await installRegistryHost(join(SCRATCH, "registry"), items);
  if (CONTROL === "main-registry") {
    for (const file of ["prompt-input.tsx", "message.tsx"]) {
      const old = execFileSync("git", ["show", `${BEFORE}:packages/ui/registry/components/${file}`], { cwd: REPO_ROOT, encoding: "utf8" });
      writeFileSync(join(host, "components", "flow-state", file), old);
    }
  }
  mkdirSync(join(host, "goal"), { recursive: true });
  cpSync(join(HERE, "pages", "composer.tsx"), join(host, "goal", "composer.tsx"));
  writeFileSync(join(host, "index.html"), '<!doctype html>\n<html lang="en">\n  <body>\n    <div id="root"></div>\n    <script type="module" src="/goal/composer.tsx"></script>\n  </body>\n</html>\n');
  const pages = join(SCRATCH, "pages");
  const built = spawnSync(TSX, [join(HERE, "build.mts"), JSON.stringify({ root: host, outDir: pages, client: repoPath("packages", "client", "src", "index.ts") })], {
    cwd: host,
    encoding: "utf8",
    env: { ...process.env, NODE_ENV: "production" },
  });
  if (built.status !== 0) throw new Error(`setup: the page build failed: ${(built.stderr || built.stdout).slice(-2500)}`);
  return pages;
}

/** The FSD server, in the scratch folder so its default blob folder lands there. */
async function startApi(): Promise<ChildProcess> {
  await refuseIfAnswering(API);
  const child = spawn(TSX, [HOST], {
    cwd: SCRATCH,
    env: { ...process.env, PORT: String(PORT), GOAL_DB: join(SCRATCH, "store.sqlite") },
    stdio: ["ignore", "inherit", "inherit"],
    detached: true,
  });
  for (let i = 0; i < 120; i += 1) {
    try {
      if ((await fetch(`${API}/healthz`)).ok) return child;
    } catch {
      // not up yet
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  stopProcessGroup(child, "SIGKILL");
  throw new Error("setup: the server never answered /healthz");
}

const TYPES: Record<string, string> = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css" };

/** The built page, with `/api` passed through to the server: one origin, as an app serves it. */
async function servePage(pages: string): Promise<{ origin: string; server: Server }> {
  const server = createServer((req, res) => {
    const url = req.url ?? "/";
    if (url.startsWith("/api/")) {
      const body: Buffer[] = [];
      req.on("data", (part: Buffer) => body.push(part));
      req.on("end", () => {
        const headers = Object.fromEntries(Object.entries(req.headers).filter(([k]) => !["host", "connection"].includes(k))) as Record<string, string>;
        fetch(`${API}${url}`, { method: req.method, headers, body: body.length > 0 ? Buffer.concat(body) : undefined })
          .then(async (answer) => {
            res.writeHead(answer.status, Object.fromEntries([...answer.headers].filter(([k]) => !["content-encoding", "transfer-encoding", "content-length"].includes(k))));
            res.end(Buffer.from(await answer.arrayBuffer()));
          })
          .catch((error: unknown) => res.writeHead(502).end(String(error)));
      });
      return;
    }
    const path = join(pages, decodeURIComponent(url.split("?")[0]!));
    const file = existsSync(path) && statSync(path).isFile() ? path : join(pages, "index.html");
    res.writeHead(200, { "content-type": TYPES[extname(file)] ?? "application/octet-stream" }).end(readFileSync(file));
  });
  await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
  return { origin: `http://127.0.0.1:${(server.address() as AddressInfo).port}`, server };
}

// ---- reading the page ---------------------------------------------------------------

/** Paste `files` into the composer's text box as a browser does: a paste event with files on its clipboard. */
async function paste(page: Page, files: Fixture[]): Promise<void> {
  await page.evaluate(
    (list) => {
      const box = document.querySelector('[data-testid="message-input"]')!;
      const dt = new DataTransfer();
      for (const f of list) dt.items.add(new File([Uint8Array.from(atob(f.b64), (c) => c.charCodeAt(0))], f.name, { type: f.mimeType }));
      box.dispatchEvent(new ClipboardEvent("paste", { clipboardData: dt, bubbles: true, cancelable: true }));
    },
    files.map((f) => ({ name: f.name, mimeType: f.mimeType, b64: f.buffer.toString("base64") })),
  );
}

/**
 * Pick `files` through the picker the + button opens. Files are written to the
 * scratch folder and picked from disk, as a person picks them: a 25 MB file
 * handed to the browser as a buffer doesn't arrive within Playwright's timeout.
 */
async function pick(page: Page, files: Fixture[]): Promise<void> {
  const paths = files.map((f) => {
    const path = join(SCRATCH, "picked", f.name);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, f.buffer);
    return path;
  });
  const chooser = page.waitForEvent("filechooser", { timeout: 10_000 });
  await page.getByRole("button", { name: "Attach files" }).click();
  await (await chooser).setFiles(paths);
}

/**
 * Pick `files` into the input the + button opens, without opening it again.
 * In headless Chromium the + button's click reaches the input every time (seen
 * by a click listener), but after the first chooser in a page no second
 * `filechooser` event came within 30 s, so leg c sets the same input
 * directly; leg a's `pick` is what proves + opens it.
 */
async function pickAgain(page: Page, files: Fixture[]): Promise<void> {
  const paths = files.map((f) => {
    const path = join(SCRATCH, "picked", f.name);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, f.buffer);
    return path;
  });
  await page.locator('input[type="file"]').setInputFiles(paths);
}

/** The images drawn inside the composer that have loaded, by name. */
const thumbnails = (page: Page): Promise<string[]> =>
  page.evaluate(() => [...document.querySelectorAll("form img")].filter((img) => (img as HTMLImageElement).naturalWidth > 0).map((img) => img.getAttribute("alt") ?? ""));

/** Poll `read` until `done` holds or two seconds pass; the last reading either way. */
async function until<T>(read: () => Promise<T>, done: (value: T) => boolean): Promise<T> {
  let value = await read();
  for (let i = 0; i < 40 && !done(value); i += 1) {
    await new Promise((resolve) => setTimeout(resolve, 50));
    value = await read();
  }
  return value;
}

// ---- the check ----------------------------------------------------------------------

let api: ChildProcess | undefined;
let site: Server | undefined;
const failed = new Set<string>();
await runGoal(async (failures, tell) => {
  const miss = (signal: string, message: string) => {
    failed.add(signal);
    failures.push(`${signal}: ${message}`);
  };
  const browser = await launchChromium();
  try {
    const pages = await buildPage();
    api = await startApi();
    const served = await servePage(pages);
    site = served.server;
    const page = await browser.newPage();
    const uploads = new Map<string, Buffer>();
    // What each upload stored, read back from the server's blob folder by the id its answer names.
    page.on("response", (response) => {
      const url = new URL(response.url());
      if (response.request().method() !== "POST" || !url.pathname.endsWith("/blobs")) return;
      if (response.status() !== 201) {
        // A refusal the composer should name; printed so a red run says what the server answered.
        response.text().then(
          (text) => console.error(`upload of ${url.searchParams.get("filename")} answered ${response.status()}: ${text}`),
          () => undefined,
        );
        return;
      }
      // An answer still being read when the browser closes is no reading: the signal it feeds reports that.
      response.json().then((answer: { attachment: { data: string } }) => {
        const id = answer.attachment.data.replace(/^fsd-blob:/, "");
        const stored = readdirSync(SCRATCH, { recursive: true, encoding: "utf8" }).find((file) => file.endsWith(`${id}.bin`));
        if (stored !== undefined) uploads.set(url.searchParams.get("filename") ?? "", readFileSync(join(SCRATCH, stored)));
      }, () => undefined);
    });
    const requested = new Set<string>();
    page.on("request", (request: Request) => {
      const url = new URL(request.url());
      if (request.method() === "POST" && url.pathname.endsWith("/blobs")) requested.add(url.searchParams.get("filename") ?? "");
    });
    await page.goto(`${served.origin}/`);
    await page.getByTestId("message-input").waitFor();

    // --- Leg a: paste one image, pick a second, send with no text --------------------
    const big = png(`wide-${randomInt(1e6)}.png`, 3000 + randomInt(1000), 2000 + randomInt(500));
    const small = png(`small-${randomInt(1e6)}.png`);
    console.error("step: paste one, pick one");
    await paste(page, [big]);
    await pick(page, [small]);
    const shown = tell.over("thumbnails · images drawn before Send", await until(() => thumbnails(page), (names) => names.length >= 2), {
      emptyIs: "nothing drawn is the failure this signal reports",
    });
    for (const name of [big.name, small.name]) if (!shown.includes(name)) miss("thumbnails", `${name} is not drawn above the text before Send (drawn: ${shown.join(", ") || "none"})`);

    // downscale: the wide image went up at most 1,568 px on its longest side.
    const wideUpload = await until(async () => uploads.get(big.name), (b) => b !== undefined);
    if (wideUpload === undefined || wideUpload.length < 24) miss("downscale", `${big.name} was never stored on attach`);
    else {
      const { width, height } = pngSize(wideUpload);
      if (Math.max(width, height) > MAX_EDGE) miss("downscale", `${big.name} went up at ${width}×${height}`);
    }

    // keyboard: + and both remove buttons are Tab stops, with labels.
    await page.locator("body").focus();
    console.error("step: keyboard");
    const stops: string[] = [];
    for (let i = 0; i < 10; i += 1) {
      await page.keyboard.press("Tab");
      stops.push(await page.evaluate(() => document.activeElement?.getAttribute("aria-label") ?? document.activeElement?.tagName ?? ""));
    }
    for (const label of ["Attach files", `Remove ${big.name}`, `Remove ${small.name}`]) if (!stops.includes(label)) miss("keyboard", `Tab never reaches "${label}" (stops: ${stops.join(" · ")})`);

    const send = page.locator('button[type="submit"]');
    if (await send.isDisabled()) miss("send-enabled", "Send is disabled with no text and two files");
    const sending = page.waitForRequest((r) => r.method() === "POST" && r.url().includes("/actions/send"), { timeout: 15_000 });
    console.error("step: send");
    await send.click({ force: true });
    const body = (await sending).postData() ?? "";
    const refs = tell.over("references · fsd-blob references in the send", body.match(/fsd-blob:b_[A-Za-z0-9]+/g) ?? [], {
      emptyIs: "no reference is the failure this signal reports",
    });
    if (refs.length !== 2) miss("references", `the send carries ${refs.length} references, not 2`);
    const run = body.match(/[A-Za-z0-9+/=]{1024,}/);
    if (run !== null) miss("references", `the send carries a base64 run of ${run[0].length} characters`);
    tell.over("references · the send's body", [body]);
    await until(() => page.getByTestId("sent-count").textContent(), (t) => t === "1");

    // --- Leg c: three pasted at once, seven picked, then an 11th, a 25 MB file, a HEIC -
    const ten = Array.from({ length: 10 }, (_, i) => png(`p${i}-${randomInt(1e6)}.png`));
    console.error("step: paste three, pick seven");
    await paste(page, ten.slice(0, 3));
    const three = await until(() => thumbnails(page), (names) => names.length >= 3);
    if (three.length !== 3) miss("thumbnails", `three images pasted at once draw ${three.length}`);
    await pickAgain(page, ten.slice(3));
    await until(() => thumbnails(page), (names) => names.length >= 10);
    const huge: Fixture = { name: `huge-${randomInt(1e6)}.png`, mimeType: "image/png", buffer: Buffer.concat([freshPng(8, 8), randomBytes(25 * 1024 * 1024)]) };
    const heic: Fixture = { name: `photo-${randomInt(1e6)}.heic`, mimeType: "image/heic", buffer: Buffer.concat([Buffer.from("\0\0\0\x18ftypheic", "binary"), randomBytes(4096)]) };
    console.error("step: pick the 11th, a 25 MB file, a HEIC");
    await pickAgain(page, [png(`eleventh-${randomInt(1e6)}.png`), huge, heic]);
    const lines = ["Only 10 images per message", `${huge.name} is over 20 MB`, `${heic.name} isn't supported`];
    const announced = await until(
      () => page.evaluate(() => [...document.querySelectorAll('[aria-live="polite"], [aria-live="assertive"]')].map((el) => el.textContent ?? "").join("\n")),
      (text) => lines.every((line) => text.includes(line)),
    );
    for (const line of tell.over("refusals · the three lines", lines)) if (!announced.includes(line)) miss("refusals", `"${line}" is not shown in a live region (shown: ${JSON.stringify(announced)})`);
    const kept = await thumbnails(page);
    if (kept.length !== 10) miss("refusals", `${kept.length} images kept after the refusals, not 10`);
    if (requested.has(huge.name) || requested.has(heic.name)) miss("refusals", "a refused file was uploaded");

    if (CONTROL !== "") {
      const green = MUST_FAIL_UNDER_CONTROL.filter((signal) => !failed.has(signal));
      if (green.length > 0) failures.push(`WRONG: under ${CONTROL}, ${green.join(", ")} passed`);
    }
    return { failures, evidence: `${COPY ? "[registry copied, not installed] " : ""}two thumbnails before Send; the send held ${refs.length} references and no base64 run; ${big.name} uploaded within ${MAX_EDGE}px; three refusals announced; Tab reached + and both removes` };
  } finally {
    await browser.close();
    site?.close();
    stopProcessGroup(api, "SIGKILL");
  }
});
