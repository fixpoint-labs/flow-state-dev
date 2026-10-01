/**
 * Goal: every FSD component shift-manager reuses takes shift-manager's light or dark look
 * from one package, FSD ships only neutral defaults, and a component that
 * hardcodes a colour is caught.
 *
 * Model-free, real browser. The path is the one an app takes:
 *
 *   1. Build the registry from this checkout and serve it over HTTP.
 *   2. Make a fresh host app and install the sweep with one
 *      `fsdev ui add <every item>`, through the items that ship it. The token
 *      defaults arrive as a dependency, the way they do for any app. A CLI
 *      that stops to ask anything fails the run.
 *   3. Check the host's copies match the registry byte for byte, FIRST. A
 *      pass on edited copies would prove the copies, not the skin.
 *   4. Build a page rendering every swept part in every state that carries a
 *      colour, and read COMPUTED styles in headless Chromium, three ways:
 *      no theme; shift-manager light; shift-manager dark.
 *
 * Signals (see goal.md):
 *   a:neutral    with no theme, every painted colour is a registry default
 *   b:themed     under shift-manager light and dark, no painted colour is a registry
 *                default or a fixed palette colour, every one is a theme value,
 *                and fonts and corners are the theme's
 *   c:attention  under the theme, the attention colour is on every
 *                waiting-on-a-person part and on no other part
 *
 * Controls:
 *   GOAL_CONTROL=hardcoded-accent  restore one fixed colour class in the
 *                                  host's copy of the tool card; b:themed must
 *                                  FAIL naming tool:awaiting
 *   GOAL_BASELINE=<git ref>        after installing, replace the host's copies
 *                                  of the 12 fixed files with that ref's
 *                                  versions (one-time evidence that `main`
 *                                  FAILS b:themed; see goal.md for which)
 *
 * Run: pnpm tsx goals/design-system/skins-reused-components-from-one-token-set/run.mts
 *      GOAL_KEEP=1 keeps the host and prints its path.
 */
import { execFile, execFileSync } from "node:child_process";
import { promisify } from "node:util";
import {
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { createServer, type Server } from "node:http";
import { createRequire } from "node:module";
import type { AddressInfo } from "node:net";
import { extname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { hex, near, parseColour, readAppLabTheme, type AppLabTheme, type Rgb } from "../../lib/colour.mts";
import { goalTmpDir, repoPath, REPO_ROOT, runGoal } from "../../lib/index.mts";
import { launchChromium } from "../../lib/playwright.mts";

const execFileAsync = promisify(execFile);
const HERE = fileURLToPath(new URL(".", import.meta.url));
const UI = repoPath("packages/ui");
const DESIGN_SYSTEM = repoPath("labs/design-system");
const CONTROL = process.env.GOAL_CONTROL;
const BASELINE = process.env.GOAL_BASELINE;

/** The items installed, by name: the sweep's components and the stream cards the design shows. */
const SWEEP_ITEMS = [
  "message",
  "reasoning",
  "code-block",
  "tool",
  "approval",
  "task-plan",
  "audit-annotation",
  "file-tree",
  "stuck-request-banner",
  "chat-assistant",
];

/** The registry files this issue recoloured — what `GOAL_BASELINE` swaps back. */
const FIXED_FILES = [
  "approval.tsx",
  "suspension-card-shell.tsx",
  "tool.tsx",
  "task-plan.tsx",
  "audit-annotation.tsx",
  "stuck-request-banner.tsx",
  "debate.tsx",
  "evented-actors.tsx",
  "routed-specialists.tsx",
  "form.tsx",
  "question.tsx",
  "file-tree.tsx",
];

// ---------------------------------------------------------------------------
// What counts as which colour — read from the sources, never restated here.
// ---------------------------------------------------------------------------

interface Oracles {
  /** The registry `tokens` item's light and dark defaults. */
  defaults: string[];
  /** Tailwind's default palette, black and white included. */
  palette: string[];
  /** The navigator's and panels' own neutral fallbacks (`var(--fsd-*, <fallback>)`). */
  chromeFallbacks: string[];
  /** shift-manager's values per variant, and its attention colour. */
  theme: AppLabTheme;
}

function readOracles(): Oracles {
  const registry = JSON.parse(readFileSync(join(UI, "registry.json"), "utf8")) as {
    items: Array<{ name: string; css?: { "@layer base"?: Record<string, Record<string, string>> } }>;
  };
  const base = registry.items.find((i) => i.name === "tokens")?.css?.["@layer base"] ?? {};
  const defaults = [...Object.values(base[":root"] ?? {}), ...Object.values(base[".dark"] ?? {})];

  const themeCss = readFileSync(join(UI, "node_modules/tailwindcss/theme.css"), "utf8");
  const palette = [...themeCss.matchAll(/--color-[a-z]+(?:-\d+)?:\s*([^;]+);/g)].map((m) => m[1]!.trim());

  const chromeDir = repoPath("packages/react/src/components");
  const chromeFallbacks: string[] = [];
  for (const dir of ["flow-navigator", "panels"]) {
    for (const file of readdirSync(join(chromeDir, dir))) {
      const src = readFileSync(join(chromeDir, dir, file), "utf8");
      for (const m of src.matchAll(/var\(--fsd-[a-z-]+,\s*(rgba?\([^)]*\)|#[0-9a-fA-F]{3,8})/g)) chromeFallbacks.push(m[1]!);
    }
  }

  return { defaults, palette, chromeFallbacks, theme: readAppLabTheme() };
}

// ---------------------------------------------------------------------------
// The host
// ---------------------------------------------------------------------------

function serve(routes: Record<string, () => string>): Promise<{ server: Server; origin: string }> {
  const types: Record<string, string> = {
    ".json": "application/json",
    ".html": "text/html",
    ".js": "text/javascript",
    ".css": "text/css",
    ".svg": "image/svg+xml",
    ".wasm": "application/wasm",
  };
  const server = createServer((req, res) => {
    const path = decodeURIComponent(new URL(req.url ?? "/", "http://x").pathname);
    const prefix = Object.keys(routes).find((p) => path.startsWith(p)) ?? "/";
    const file = join(routes[prefix]!(), path.slice(prefix.length) || "index.html");
    if (!existsSync(file) || statSync(file).isDirectory()) {
      res.writeHead(404).end();
      return;
    }
    res.writeHead(200, { "content-type": types[extname(file)] ?? "application/octet-stream" }).end(readFileSync(file));
  });
  return new Promise((done) =>
    server.listen(0, "127.0.0.1", () => done({ server, origin: `http://127.0.0.1:${(server.address() as AddressInfo).port}` }))
  );
}

/** Every file under `dir`, relative to it. */
function walk(dir: string): string[] {
  if (!existsSync(dir)) return [];
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...walk(full).map((f) => join(entry, f)));
    else out.push(entry);
  }
  return out;
}

/**
 * Whether an installed copy is its registry source. Byte-identical, with one
 * allowance: the shadcn CLI drops the comments above the first statement of a
 * file that has no "use client" directive, and nothing else.
 */
function sameAsInstalled(copy: string, source: string): boolean {
  if (copy === source) return true;
  return !/^["']use client["']/.test(source) && copy === source.replace(/^(?:\/\*[\s\S]*?\*\/\s*)+/, "");
}

/**
 * A host app shaped the way `shadcn init` leaves one: a components.json, an
 * `@/*` alias, and a stylesheet holding nothing but Tailwind. Its package.json
 * lists every package the host can resolve, so the CLI finds its dependencies
 * already present and installs none.
 */
function makeHost(dir: string): void {
  const ui = JSON.parse(readFileSync(join(UI, "package.json"), "utf8")) as Record<string, Record<string, string>>;
  // Every package the registry's workspace has, listed so the CLI installs
  // nothing (it skips a dependency the host already lists). `cn` is what
  // upstream shadcn's primitives now import; the copies seeded below do not.
  const listed = { ...ui.dependencies, ...ui.devDependencies, ...ui.peerDependencies, "@flow-state-dev/design-system": "*", cn: "*" };
  const deps = Object.fromEntries(Object.entries(listed).map(([name, range]) => [name, range.startsWith("workspace:") ? "*" : range]));
  mkdirSync(join(dir, "app"), { recursive: true });
  writeFileSync(join(dir, "package.json"), JSON.stringify({ name: "goal-host", private: true, type: "module", dependencies: deps }, null, 2));
  writeFileSync(join(dir, "tsconfig.json"), JSON.stringify({ compilerOptions: { baseUrl: ".", paths: { "@/*": ["./*"] } } }));
  writeFileSync(
    join(dir, "components.json"),
    JSON.stringify({
      $schema: "https://ui.shadcn.com/schema.json",
      style: "new-york",
      rsc: false,
      tsx: true,
      tailwind: { config: "", css: "app/globals.css", baseColor: "neutral", cssVariables: true },
      aliases: { components: "@/components", utils: "@/lib/utils", ui: "@/components/ui" },
    })
  );
  writeFileSync(join(dir, "app/globals.css"), '@import "tailwindcss";\n');
}

/**
 * Swap the upstream shadcn primitives the CLI fetched for the ones the
 * registry's own Storybook builds against. Upstream's now import an npm
 * package (`cn`) this workspace does not have, and the primitives are not what
 * this goal is about. Seeding them before the install instead makes the CLI
 * stop at an overwrite prompt for each one.
 */
function seedPrimitives(dir: string): string[] {
  const seeds = join(UI, ".storybook/shadcn");
  cpSync(seeds, dir, { recursive: true });
  const known = new Set(readdirSync(join(seeds, "components/ui")));
  return readdirSync(join(dir, "components/ui")).filter((file) => !known.has(file));
}

/**
 * Link the host's node_modules to the packages the registry's own workspace
 * resolves, plus the design-system package. Done after the CLI has run, so a
 * CLI that decided to install something could never write through a link.
 */
function linkModules(dir: string): void {
  const from = join(UI, "node_modules");
  const to = join(dir, "node_modules");
  mkdirSync(to);
  for (const entry of readdirSync(from)) {
    if (entry.startsWith(".")) continue;
    if (entry.startsWith("@")) {
      mkdirSync(join(to, entry));
      for (const scoped of readdirSync(join(from, entry))) symlinkSync(join(from, entry, scoped), join(to, entry, scoped));
    } else {
      symlinkSync(join(from, entry), join(to, entry));
    }
  }
  mkdirSync(join(to, "@flow-state-dev"), { recursive: true });
  symlinkSync(DESIGN_SYSTEM, join(to, "@flow-state-dev", "design-system"));
}

/** Every registry file the installed items ship, as `target → registry source`, followed through dependencies. */
function shippedFiles(registryDir: string, origin: string): Map<string, string> {
  const manifest = JSON.parse(readFileSync(join(UI, "registry.json"), "utf8")) as {
    items: Array<{ name: string; files?: Array<{ path: string; target: string }> }>;
  };
  const byName = new Map(manifest.items.map((i) => [i.name, i]));
  const out = new Map<string, string>();
  const seen = new Set<string>();
  const visit = (name: string) => {
    if (seen.has(name)) return;
    seen.add(name);
    const built = JSON.parse(readFileSync(join(registryDir, `${name}.json`), "utf8")) as { registryDependencies: string[] };
    for (const file of byName.get(name)?.files ?? []) out.set(file.target, file.path);
    for (const dep of built.registryDependencies) {
      if (dep.startsWith(`${origin}/r/`)) visit(dep.slice(`${origin}/r/`.length, -".json".length));
    }
  };
  for (const item of SWEEP_ITEMS) visit(item);
  return out;
}

// ---------------------------------------------------------------------------
// Reading the page
// ---------------------------------------------------------------------------

interface Sample {
  part: string;
  component: string;
  means: string | null;
  el: string;
  prop: string;
  value: string;
}
interface PageRead {
  parts: Array<{ name: string; component: string; means: string | null; elements: number }>;
  colours: Sample[];
  fonts: Sample[];
  radii: Sample[];
  probes: Record<string, string>;
}

/** Runs in the page: every painted colour, font and corner inside a `[data-part]`, plus probe colours. */
function readPage(probeValues: string[]): PageRead {
  const colours: Sample[] = [];
  const fonts: Sample[] = [];
  const radii: Sample[] = [];
  const parts: PageRead["parts"] = [];
  const describe = (el: Element) =>
    `${el.tagName.toLowerCase()}${el.getAttribute("class") ? "." + el.getAttribute("class")!.trim().split(/\s+/).slice(0, 3).join(".") : ""}`;
  for (const part of Array.from(document.querySelectorAll<HTMLElement>("[data-part]"))) {
    const meta = { part: part.dataset.part!, component: part.dataset.component!, means: part.dataset.means ?? null };
    let elements = 0;
    for (const el of [part, ...Array.from(part.querySelectorAll("*"))]) {
      if (el === part) continue;
      const cs = getComputedStyle(el);
      const rect = el.getBoundingClientRect();
      if (cs.display === "none" || cs.visibility !== "visible" || rect.width === 0 || rect.height === 0) continue;
      elements++;
      const push = (prop: string, value: string) => colours.push({ ...meta, el: describe(el), prop, value });
      // A colour set by an inline literal is content (syntax highlighting), not skin.
      const inlineLiteral = /(^|;)\s*(color|background(-color)?)\s*:\s*(#|rgb)/i.test(el.getAttribute("style") ?? "");
      const hasText = Array.from(el.childNodes).some((n) => n.nodeType === 3 && n.textContent!.trim().length > 0);
      if (!inlineLiteral) {
        if (hasText) push("color", cs.color);
        push("background-color", cs.backgroundColor);
      }
      if (el.tagName.toLowerCase() === "svg") {
        if (cs.stroke !== "none") push("stroke", cs.stroke);
        if (cs.fill !== "none") push("fill", cs.fill);
      }
      for (const side of ["top", "right", "bottom", "left"]) {
        const style = cs.getPropertyValue(`border-${side}-style`);
        if (parseFloat(cs.getPropertyValue(`border-${side}-width`)) > 0 && style !== "none" && style !== "hidden") {
          push(`border-${side}-color`, cs.getPropertyValue(`border-${side}-color`));
        }
      }
      if (cs.outlineStyle !== "none" && parseFloat(cs.outlineWidth) > 0) push("outline-color", cs.outlineColor);
      if (hasText) fonts.push({ ...meta, el: describe(el), prop: "font-family", value: cs.fontFamily });
      for (const corner of ["top-left", "top-right", "bottom-right", "bottom-left"]) {
        const v = cs.getPropertyValue(`border-${corner}-radius`);
        if (v !== "0px") radii.push({ ...meta, el: describe(el), prop: `border-${corner}-radius`, value: v });
      }
    }
    parts.push({ name: meta.part, component: meta.component, means: meta.means, elements });
  }
  const probe = document.createElement("span");
  document.body.appendChild(probe);
  const probes: Record<string, string> = {};
  for (const value of probeValues) {
    probe.style.color = "";
    probe.style.color = value;
    probes[value] = getComputedStyle(probe).color;
  }
  probe.remove();
  return { parts, colours, fonts, radii, probes };
}

/** Open what a first render leaves closed, so the colours inside are read too. */
async function expand(page: import("playwright").Page): Promise<void> {
  // A finished debate collapses itself; its header reopens it.
  await page.locator('[data-part="debate:finished"] button').first().click();
  // The navigator lists a kind's sessions once the kind is opened.
  for (const kind of ["support", "agent"]) {
    const row = page.locator(`[data-part="navigator"] [data-kind="${kind}"]`).first();
    if ((await row.count()) > 0) await row.click();
  }
  // Tool groups and audit findings open on click.
  for (const trigger of await page.locator('[data-part^="audit"] button, [data-part^="tool:item"] button').all()) {
    await trigger.click();
  }
  // Wait until each opened part shows what it hid.
  for (const [part, text] of [
    ["debate:finished", "Pro made the stronger case."],
    ["navigator", "Refund for order 118"],
    ["audit:critical", "The sentence it saw it in."],
    ["tool:item", /parameters/i],
  ] as const) {
    await page.locator(`[data-part="${part}"]`).getByText(text).first().waitFor({ state: "visible", timeout: 10_000 });
  }
}

// ---------------------------------------------------------------------------
// The run
// ---------------------------------------------------------------------------

await runGoal(async () => {
  const failures: string[] = [];
  const scratch = goalTmpDir("design-system");
  const registryDir = join(scratch, "r");
  const host = join(scratch, "host");
  const dist = join(host, "dist");
  const { server, origin } = await serve({ "/r/": () => registryDir, "/": () => dist });

  try {
    // 1. The registry, as this checkout builds it, served where its own URLs point.
    execFileSync("pnpm", ["exec", "tsx", "scripts/build-registry.ts", "--base-url", `${origin}/r`, "--out", registryDir], {
      cwd: UI,
      stdio: "ignore",
    });

    // 2. A fresh host, installed the way an app installs.
    makeHost(host);
    // Through `fsdev ui add`, every item in one command, the way an app adds
    // several at once. Its stdin is closed, so a CLI that stops to ask
    // anything fails here instead of waiting. Asynchronous on purpose: the
    // registry is served from this process, and a synchronous child would
    // block the server it is fetching from.
    try {
      const install = execFileAsync("pnpm", ["fsdev", "ui", "add", ...SWEEP_ITEMS, "--registry", `${origin}/r`, "--cwd", host], {
        cwd: REPO_ROOT,
        timeout: 180_000,
        maxBuffer: 64 * 1024 * 1024,
      });
      install.child.stdin?.end();
      const { stdout, stderr } = await install;
      // A closed stdin answers a prompt "no" and the command still exits 0,
      // so the prompt itself is the failure: at a terminal it stops the user.
      const asked = `${stdout}${stderr}`.match(/[^\n]*Would you like to[^\n?]*\?/g);
      if (asked) {
        const questions = [...new Set(asked.map((line) => line.replace(/\u001b\[[0-9;?]*[A-Za-z]/g, "").trim()))];
        return { failures: [`setup: fsdev ui add stopped to ask: ${questions.join(" | ")}`], evidence: "" };
      }
    } catch (error) {
      const e = error as { stdout?: string; stderr?: string; message: string };
      const out = `${e.stdout ?? ""}${e.stderr ?? ""}`.trim().split("\n").slice(-15).join("\n");
      return { failures: [`setup: the install failed: ${e.message}\n${out}`], evidence: "" };
    }
    if (existsSync(join(host, "node_modules"))) {
      return { failures: ["setup: the CLI installed dependencies; the host's package.json is missing one"], evidence: "" };
    }
    const unseeded = seedPrimitives(host);
    if (unseeded.length > 0) failures.push(`setup: the CLI fetched primitives the Storybook set lacks: ${unseeded.join(", ")}`);
    const globals = readFileSync(join(host, "app/globals.css"), "utf8");
    if (!/--attention:/.test(globals)) failures.push("setup: installing the sweep did not add the tokens item to the host's stylesheet");

    // 3. Byte-identical copies, before anything reads them.
    const shipped = shippedFiles(registryDir, origin);
    const copies = walk(join(host, "components/flow-state"));
    for (const [target, source] of shipped) {
      const copy = join(host, target);
      if (!existsSync(copy)) failures.push(`copies: ${target} was not installed`);
      else if (!sameAsInstalled(readFileSync(copy, "utf8"), readFileSync(join(UI, source), "utf8"))) failures.push(`copies: ${target} differs from ${source}`);
    }
    for (const copy of copies) {
      if (![...shipped.keys()].includes(join("components/flow-state", copy))) failures.push(`copies: ${copy} has no registry source`);
    }
    for (const file of FIXED_FILES) {
      if (!copies.includes(file)) failures.push(`copies: the sweep did not install ${file}`);
    }
    if (failures.length > 0) return { failures, evidence: "" };

    // Controls: edit the host's copies only after they were proven identical.
    if (CONTROL === "hardcoded-accent") {
      const toolPath = join(host, "components/flow-state/tool.tsx");
      const src = readFileSync(toolPath, "utf8");
      writeFileSync(toolPath, src.replace('ClockIcon className="size-4 text-attention"', 'ClockIcon className="size-4 text-yellow-600"'));
    } else if (CONTROL !== undefined) {
      return { failures: [`unknown GOAL_CONTROL=${CONTROL}`], evidence: "" };
    }
    if (BASELINE !== undefined) {
      for (const file of FIXED_FILES) {
        const old = execFileSync("git", ["show", `${BASELINE}:packages/ui/registry/components/${file}`], { cwd: REPO_ROOT, encoding: "utf8" });
        writeFileSync(join(host, "components/flow-state", file), old);
      }
    }

    // 4. The page. Its stylesheet is the host's own, plus shift-manager's for the themed passes.
    for (const file of ["index.html", "main.tsx", "fixtures.ts"]) cpSync(join(HERE, "host", file), join(host, file));
    writeFileSync(join(host, "app/themed.css"), '@import "./globals.css";\n@import "@flow-state-dev/design-system/shift-manager.css";\n');
    for (const css of ["app/globals.css", "app/themed.css"]) {
      const text = readFileSync(join(host, css), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
      const aimed = text.match(/(?:^|[\s,}])\.(?!dark\b)[a-zA-Z_-][\w-]*/gm);
      if (aimed) failures.push(`anti-game: host stylesheet ${css} aims a rule at a component: ${aimed.join(" ")}`);
    }
    linkModules(host);

    const req = createRequire(join(UI, "package.json"));
    const load = async (name: string) => (await import(pathToFileURL(req.resolve(name)).href)) as Record<string, any>;
    const vite = await load("vite");
    const react = (await load("@vitejs/plugin-react")).default;
    const tailwind = (await load("@tailwindcss/vite")).default;
    await vite.build({
      root: host,
      configFile: false,
      logLevel: "error",
      plugins: [react(), tailwind()],
      resolve: { alias: { "@": host } },
      build: { outDir: dist, target: "es2022", emptyOutDir: true, chunkSizeWarningLimit: 100_000 },
    });

    // 5. Read computed styles, three ways (plus dark with no theme, for a:neutral).
    const oracles = readOracles();
    const probeValues = [
      ...oracles.defaults,
      ...oracles.palette,
      ...oracles.chromeFallbacks,
      ...oracles.theme.light,
      ...oracles.theme.dark,
    ];
    const browser = await launchChromium();
    const reads: Record<string, PageRead> = {};
    try {
      for (const [pass, query] of [
        ["neutral-light", ""],
        ["neutral-dark", "?dark=1"],
        ["themed-light", "?theme=shift-manager"],
        ["themed-dark", "?theme=shift-manager&dark=1"],
      ] as const) {
        const page = await browser.newPage({ viewport: { width: 800, height: 1200 } });
        const errors: string[] = [];
        page.on("pageerror", (e) => errors.push(e.message));
        // tsx compiles this file with esbuild's keepNames, which wraps the
        // nested functions in readPage with a `__name` helper the page lacks.
        await page.addInitScript("globalThis.__name = (fn) => fn;");
        await page.goto(`${origin}/index.html${query}`);
        await page.waitForSelector('[data-part="seat-detail"] [data-state="text"]', { timeout: 30_000 });
        await page.waitForSelector('[data-part="code-block"] pre', { timeout: 30_000 });
        await expand(page);
        reads[pass] = await page.evaluate(readPage, probeValues);
        await page.screenshot({ path: join(scratch, `${pass}.png`), fullPage: true });
        await page.close();
        if (errors.length > 0) failures.push(`${pass}: the page threw: ${errors.join(" | ")}`);
      }
    } finally {
      await browser.close();
    }

    // 6. Grade.
    const rgbOf = (read: PageRead, value: string) => parseColour(read.probes[value] ?? value)?.rgb ?? null;
    const setOf = (read: PageRead, values: string[]) => values.map((v) => rgbOf(read, v)).filter((v): v is Rgb => v !== null);
    const any = (set: Rgb[], rgb: Rgb) => set.some((c) => near(c, rgb));
    // A fixed colour renders exactly as its probe does, so it is matched to
    // within rounding. The looser match would call shift-manager's own near-blacks
    // Tailwind's stone palette.
    const exactly = (set: Rgb[], rgb: Rgb) => set.some((c) => c.every((v, i) => Math.abs(v - rgb[i]!) <= 1));
    const where = (s: Sample) => `${s.part} (${s.component}) ${s.el} ${s.prop}`;

    for (const [pass, read] of Object.entries(reads)) {
      for (const part of read.parts) {
        if (part.elements === 0) failures.push(`${pass}: ${part.name} rendered nothing`);
      }
    }

    // a:neutral — every painted colour is a registry default (or the chrome's own fallback).
    for (const pass of ["neutral-light", "neutral-dark"]) {
      const read = reads[pass]!;
      const allowed = setOf(read, [...oracles.defaults, ...oracles.chromeFallbacks]);
      for (const s of read.colours) {
        const c = parseColour(s.value);
        if (c && !any(allowed, c.rgb)) failures.push(`a:neutral [${pass}] ${where(s)} → ${hex(c.rgb)} is not a registry default`);
      }
    }

    // b:themed — nothing on a default or a palette colour, everything on a theme value; fonts and corners.
    const bFails: string[] = [];
    for (const [pass, variant] of [
      ["themed-light", "light"],
      ["themed-dark", "dark"],
    ] as const) {
      const read = reads[pass]!;
      const forbiddenValues = [...oracles.defaults, ...oracles.palette, ...oracles.chromeFallbacks];
      // A palette colour shift-manager happens to use itself (its dark card is
      // Tailwind's olive-900 to within rounding) cannot be told apart by what
      // the page computes, so it is not forbidden here. The source census in
      // packages/ui is what keeps palette classes out of the components.
      const themeExact = setOf(read, oracles.theme[variant]);
      const forbidden = [
        ...setOf(read, [...oracles.defaults, ...oracles.chromeFallbacks]),
        ...setOf(read, oracles.palette).filter((rgb) => !exactly(themeExact, rgb)),
      ];
      const named = (rgb: Rgb) =>
        forbiddenValues.find((v) => {
          const probe = rgbOf(read, v);
          return probe !== null && probe.every((x, i) => Math.abs(x - rgb[i]!) <= 1);
        }) ?? "?";
      const theme = setOf(read, oracles.theme[variant]);
      for (const s of read.colours) {
        const c = parseColour(s.value);
        if (!c) continue;
        if (exactly(forbidden, c.rgb)) bFails.push(`b:themed [${variant}] ${where(s)} → ${hex(c.rgb)} is a registry default or palette colour (${named(c.rgb)})`);
        else if (!any(theme, c.rgb)) bFails.push(`b:themed [${variant}] ${where(s)} → ${hex(c.rgb)} is not an shift-manager value`);
      }
      for (const s of read.fonts) {
        const first = s.value.split(",")[0]!.trim().replace(/^["']|["']$/g, "");
        if (!oracles.theme.families.includes(first)) bFails.push(`b:themed [${variant}] ${where(s)} → font ${first}`);
      }
      for (const s of read.radii) {
        if (parseFloat(s.value) < 1000) bFails.push(`b:themed [${variant}] ${where(s)} → corner ${s.value}`);
      }
    }
    failures.push(...bFails);

    // c:attention — the highlighter on every must-act part, and on no other.
    for (const [pass, attention] of [
      ["themed-light", oracles.theme.attentionLight],
      ["themed-dark", oracles.theme.attentionDark],
    ] as const) {
      const read = reads[pass]!;
      const target = rgbOf(read, attention)!;
      const onAttention = new Map<string, boolean>();
      for (const part of read.parts) onAttention.set(part.name, false);
      for (const s of read.colours) {
        const c = parseColour(s.value);
        if (!c || !near(c.rgb, target)) continue;
        onAttention.set(s.part, true);
        if (s.means !== "attention") failures.push(`c:attention [${pass}] ${where(s)} carries the attention colour, and nobody is asked to act`);
      }
      for (const part of read.parts) {
        if (part.means === "attention" && !onAttention.get(part.name)) {
          failures.push(`c:attention [${pass}] ${part.name} (${part.component}) waits on a person but shows no attention colour`);
        }
      }
    }

    if (bFails.length > 0) {
      const byComponent = new Map<string, number>();
      for (const line of bFails) {
        const component = line.match(/\(([^)]+)\)/)?.[1] ?? "?";
        byComponent.set(component, (byComponent.get(component) ?? 0) + 1);
      }
      failures.push(`b:themed summary — ${byComponent.size} components: ${[...byComponent].map(([c, n]) => `${c} ×${n}`).join(", ")}`);
    }

    const r = reads["themed-light"]!;
    return {
      failures,
      evidence:
        `${r.parts.length} parts, ${r.parts.reduce((n, p) => n + p.elements, 0)} elements; ` +
        `${Object.entries(reads).map(([p, x]) => `${p}: ${x.colours.length} colours`).join(", ")}; ` +
        `${shipped.size} copies byte-identical; screenshots in ${scratch}`,
    };
  } finally {
    server.close();
    if (process.env.GOAL_KEEP === "1") console.log(`kept: ${scratch}`);
    else rmSync(scratch, { recursive: true, force: true });
  }
});
