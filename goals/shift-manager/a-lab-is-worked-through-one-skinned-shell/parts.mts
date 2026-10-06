/**
 * Parts 2 and 4 of the closure: the two teams the legs don't walk (J3, J4),
 * and the seam sweep. Part 3 is the child checks, run by subprocess from
 * `run.mts`.
 *
 * J3's host scaffolding (the registry served from this checkout, a host app
 * shaped the way `shadcn init` leaves one, the CLI's copies compared with
 * their sources) is lifted from FIX-1655's
 * `goals/design-system/skins-reused-components-from-one-token-set/run.mts`,
 * which executes on import.
 */
import { execFile, execFileSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { createRequire } from "node:module";
import type { AddressInfo } from "node:net";
import { extname, join, relative } from "node:path";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";
import type { Browser } from "playwright";
import { hex, near, parseColour } from "../../lib/colour.mts";
import { REPO_ROOT } from "../../lib/index.mts";
import { TREES, type Report } from "./legs.mts";
import { SHIFT_MANAGER, injected, labApi, open, readStore, readTree, sleep, startShiftManager, type Running } from "./shell.mts";

const execFileAsync = promisify(execFile);
const UI = join(REPO_ROOT, "packages", "ui");

// ---- J3: someone reusing FSD UI in their own app -------------------------------

/** The two status-bearing items the fresh app installs: both paint `--success`. */
const J3_ITEMS = ["tool", "approval"];

function serve(root: string): Promise<{ server: Server; origin: string }> {
  const types: Record<string, string> = { ".json": "application/json", ".html": "text/html", ".js": "text/javascript", ".css": "text/css" };
  const server = createServer((req, res) => {
    const path = decodeURIComponent(new URL(req.url ?? "/", "http://x").pathname);
    const file = join(root, path === "/" ? "index.html" : path);
    if (!existsSync(file) || statSync(file).isDirectory()) {
      res.writeHead(404).end();
      return;
    }
    res.writeHead(200, { "content-type": types[extname(file)] ?? "application/octet-stream" }).end(readFileSync(file));
  });
  return new Promise((done) => server.listen(0, "127.0.0.1", () => done({ server, origin: `http://127.0.0.1:${(server.address() as AddressInfo).port}` })));
}

/** Whether an installed copy is its registry source (the CLI drops leading comments on a file with no "use client"). */
function sameAsInstalled(copy: string, source: string): boolean {
  if (copy === source) return true;
  return !/^["']use client["']/.test(source) && copy === source.replace(/^(?:\/\*[\s\S]*?\*\/\s*)+/, "");
}

/** Every registry file the installed items ship, as `target → registry source`, followed through dependencies. */
function shippedFiles(registryDir: string, base: string): Map<string, string> {
  const manifest = JSON.parse(readFileSync(join(UI, "registry.json"), "utf8")) as { items: Array<{ name: string; files?: Array<{ path: string; target: string }> }> };
  const byName = new Map(manifest.items.map((i) => [i.name, i]));
  const out = new Map<string, string>();
  const seen = new Set<string>();
  const visit = (name: string) => {
    if (seen.has(name)) return;
    seen.add(name);
    const built = JSON.parse(readFileSync(join(registryDir, `${name}.json`), "utf8")) as { registryDependencies: string[] };
    for (const file of byName.get(name)?.files ?? []) out.set(file.target, file.path);
    for (const dep of built.registryDependencies) if (dep.startsWith(`${base}/`)) visit(dep.slice(base.length + 1, -".json".length));
  };
  for (const item of J3_ITEMS) visit(item);
  return out;
}

/** The first `css` block under the docs' "One set of tokens" heading, as written. */
function docsTokenBlock(): string {
  const page = readFileSync(join(REPO_ROOT, "apps", "docs", "docs", "workforce", "ui.md"), "utf8");
  const section = page.slice(page.indexOf("### One set of tokens"));
  const block = /```css\n([\s\S]*?)```/.exec(section)?.[1];
  if (block === undefined) throw new Error("setup: the token section of apps/docs/docs/workforce/ui.md has no css block to follow");
  return block;
}

const J3_PAGE = `import { createRoot } from "react-dom/client";
import { FlowProvider } from "@flow-state-dev/react";
import { ToolShell, ToolHeader } from "@/components/flow-state/tool";
import { Approval } from "@/components/flow-state/approval";
import "./app/globals.css";

const ask = { id: "s1", type: "suspension", status: "completed", requestId: "r1", itemIndex: 0, ts: 0,
  provenance: { blockName: "gen", blockInstanceId: "b1", phase: "main" },
  suspensionId: "s1", suspensionStatus: "pending", reason: "human_approval", message: "Ship it?" } as never;

createRoot(document.getElementById("root")!).render(
  <FlowProvider flowKind="demo" userId="demo" baseUrl="">
    <main className="app-shell bg-background text-foreground">
      <section data-part="tool"><ToolShell defaultOpen={false}><ToolHeader name="deploy" state="completed" /></ToolShell></section>
      <section data-part="approval"><Approval item={ask} /></section>
    </main>
  </FlowProvider>,
);
`;

/**
 * J3. A fresh app outside Shift Manager and kitchen-sink installs two
 * status-bearing components from this commit's registry with `fsdev ui add`,
 * follows the token section of `apps/docs/docs/workforce/ui.md` as written,
 * then changes one status token: both components follow, and the copies are
 * byte-identical to the registry.
 */
export async function j3(scratch: string, browser: Browser, report: Report): Promise<void> {
  const fail = (why: string) => report.fail("J3", why);
  const root = join(scratch, "j3");
  const registryDir = join(root, "r");
  const host = join(root, "host");
  const dist = join(host, "dist");
  mkdirSync(registryDir, { recursive: true });
  const { server, origin } = await serve(root);
  try {
    execFileSync("pnpm", ["exec", "tsx", "scripts/build-registry.ts", "--base-url", `${origin}/r`, "--out", registryDir], { cwd: UI, stdio: "ignore" });
    // The host, as `shadcn init` leaves one; it lists every package the registry's workspace has, so the CLI installs none.
    const ui = JSON.parse(readFileSync(join(UI, "package.json"), "utf8")) as Record<string, Record<string, string>>;
    const listed = { ...ui.dependencies, ...ui.devDependencies, ...ui.peerDependencies, cn: "*" };
    const deps = Object.fromEntries(Object.entries(listed).map(([name, range]) => [name, range.startsWith("workspace:") ? "*" : range]));
    mkdirSync(join(host, "app"), { recursive: true });
    writeFileSync(join(host, "package.json"), JSON.stringify({ name: "j3-host", private: true, type: "module", dependencies: deps }, null, 2));
    writeFileSync(join(host, "tsconfig.json"), JSON.stringify({ compilerOptions: { baseUrl: ".", paths: { "@/*": ["./*"] } } }));
    writeFileSync(
      join(host, "components.json"),
      JSON.stringify({
        $schema: "https://ui.shadcn.com/schema.json",
        style: "new-york",
        rsc: false,
        tsx: true,
        tailwind: { config: "", css: "app/globals.css", baseColor: "neutral", cssVariables: true },
        aliases: { components: "@/components", utils: "@/lib/utils", ui: "@/components/ui" },
      }),
    );
    writeFileSync(join(host, "app/globals.css"), '@import "tailwindcss";\n');
    const install = execFileAsync("pnpm", ["fsdev", "ui", "add", ...J3_ITEMS, "--registry", `${origin}/r`, "--cwd", host], { cwd: REPO_ROOT, timeout: 180_000, maxBuffer: 64 * 1024 * 1024 });
    install.child.stdin?.end();
    const { stdout, stderr } = await install;
    const asked = `${stdout}${stderr}`.match(/[^\n]*Would you like to[^\n?]*\?/g);
    if (asked) return fail(`fsdev ui add stopped to ask: ${asked.join(" | ")}`);
    // The upstream primitives the CLI fetched, swapped for the ones the registry's Storybook builds against (as FIX-1655's check does).
    cpSync(join(UI, ".storybook/shadcn"), host, { recursive: true });

    // The copies are byte-identical to the registry, before anything reads them.
    const shipped = shippedFiles(registryDir, `${origin}/r`);
    for (const [target, source] of shipped) {
      const copy = join(host, target);
      if (!existsSync(copy)) fail(`${target} was not installed`);
      else if (!sameAsInstalled(readFileSync(copy, "utf8"), readFileSync(join(UI, source), "utf8"))) fail(`the installed ${target} differs from ${source}`);
    }

    // Follow the docs: the navigator's and panels' properties pointed at the same tokens.
    const block = docsTokenBlock();
    writeFileSync(join(host, "app/globals.css"), `${readFileSync(join(host, "app/globals.css"), "utf8")}\n${block}`);
    const success = /:root\s*\{[^}]*?--success:\s*([^;]+);/.exec(readFileSync(join(host, "app/globals.css"), "utf8"))?.[1]?.trim();
    if (success === undefined) return fail("the installed tokens define no --success on :root to change");

    // node_modules: the registry workspace's, linked after the CLI ran.
    const from = join(UI, "node_modules");
    const to = join(host, "node_modules");
    mkdirSync(to, { recursive: true });
    for (const entry of readdirSync(from)) {
      if (entry.startsWith(".")) continue;
      if (entry.startsWith("@")) {
        mkdirSync(join(to, entry), { recursive: true });
        for (const scoped of readdirSync(join(from, entry))) if (!existsSync(join(to, entry, scoped))) symlinkSync(join(from, entry, scoped), join(to, entry, scoped));
      } else if (!existsSync(join(to, entry))) symlinkSync(join(from, entry), join(to, entry));
    }
    writeFileSync(join(host, "index.html"), '<!doctype html><html><head><meta charset="UTF-8"/></head><body><div id="root"></div><script type="module" src="./main.tsx"></script></body></html>');
    writeFileSync(join(host, "main.tsx"), J3_PAGE);

    const req = createRequire(join(UI, "package.json"));
    const load = async (name: string) => (await import(pathToFileURL(req.resolve(name)).href)) as Record<string, any>;
    const build = async () => {
      const vite = await load("vite");
      await vite.build({
        root: host,
        base: "/host/dist/",
        configFile: false,
        logLevel: "error",
        plugins: [(await load("@vitejs/plugin-react")).default(), (await load("@tailwindcss/vite")).default()],
        resolve: { alias: { "@": host } },
        build: { outDir: dist, target: "es2022", emptyOutDir: true, chunkSizeWarningLimit: 100_000 },
      });
    };
    const read = async () => {
      const page = await browser.newPage();
      try {
        await page.goto(`${origin}/host/dist/index.html`);
        await page.locator("[data-part=approval] button").first().waitFor({ timeout: 20_000 });
        return (await page.evaluate(() => ({
          tool: getComputedStyle(document.querySelector("[data-part=tool] svg.lucide-circle-check-big")!).stroke,
          approval: getComputedStyle(Array.from(document.querySelectorAll("[data-part=approval] button")).find((b) => b.textContent?.includes("Approve"))!).backgroundColor,
        }))) as { tool: string; approval: string };
      } finally {
        await page.close();
      }
    };
    await build();
    const before = await read();
    // Change one status token, in the stylesheet the docs had the app define them in.
    const changed = "#1f6feb";
    const css = readFileSync(join(host, "app/globals.css"), "utf8");
    writeFileSync(join(host, "app/globals.css"), css.replace(/(:root\s*\{[^}]*?--success:\s*)([^;]+);/, `$1${changed};`));
    await build();
    const after = await read();
    const want = [1, 3, 5].map((i) => parseInt(changed.slice(i, i + 2), 16)) as [number, number, number];
    for (const part of ["tool", "approval"] as const) {
      const was = parseColour(before[part]);
      const now = parseColour(after[part]);
      if (now === null || !near(now.rgb, want)) fail(`${part} paints ${now === null ? "nothing" : hex(now.rgb)} after --success became ${changed}`);
      if (was !== null && near(was.rgb, want)) fail(`${part} already painted ${changed} before the change, so following it proves nothing`);
    }
    report.note(
      `J3: fresh host, \`fsdev ui add ${J3_ITEMS.join(" ")}\` from this commit's registry, ${shipped.size} copies byte-identical; docs' token block applied as written; --success ${success} → ${changed}: tool ${before.tool} → ${after.tool}, approval ${before.approval} → ${after.approval}`,
    );
  } catch (error) {
    fail(`setup: ${String((error as Error).message ?? error).split("\n").slice(0, 6).join(" ")}`);
  } finally {
    server.close();
  }
}

// ---- J4: a sibling epic's owner -------------------------------------------------

/**
 * J4. Every surface in the epic's ownership table opens by its address on a
 * fresh load, and shows store rows or a named empty state that says what
 * arrives. None hidden, none blank. DevForce on the scripted harness, after
 * its ask is approved so a task exists.
 */
export async function j4(scratch: string, pages: string, browser: Browser, report: Report): Promise<void> {
  const fail = (why: string) => report.fail("J4", why);
  const tree = await readTree(TREES.devforce);
  let served: Running | undefined;
  try {
    served = await startShiftManager(scratch, "j4-devforce", {
      team: "devteam",
      pages,
      env: { DEVFORCE_LAB_HARNESS: "stub", AI_GATEWAY_API_KEY: "", OPENAI_API_KEY: "", OPENROUTER_API_KEY: "", ANTHROPIC_API_KEY: "" },
    });
    const setup = await browser.newPage();
    await open(setup, served.origin, "/inbox");
    const { userId, bearer } = await injected(setup);
    const api = labApi(served.origin, bearer);
    await setup.getByTestId("inbox-item").first().click();
    await setup.locator("[data-testid=inbox-detail]").getByRole("button", { name: "Approve" }).click();
    let row: { ref: string; id: string } | undefined;
    for (let waited = 0; waited < 60_000 && row === undefined; waited += 500) {
      row = Object.values((await readStore(api, tree, userId)).rows).flat()[0];
      if (row === undefined) await sleep(500);
    }
    await setup.close();
    if (row === undefined) return fail("DevForce filed no row after its ask was approved");
    const ch = tree.mailboxes[0]!.id;
    const task = `/tasks/${encodeURIComponent(row.ref)}/${encodeURIComponent(row.id)}`;
    const addresses: Array<{ path: string; surface: string | string[]; owner: string }> = [
      { path: "/cos", surface: "cos", owner: "Chief of Staff (FIX-1719's seat; FIX-1722's view)" },
      { path: "/roster", surface: "roster", owner: "TEAMS, workers, shift status (Workforce; FIX-1723)" },
      { path: `/roster?team=${tree.teams[0]}`, surface: "roster", owner: "a team's workers (Workforce; FIX-1723)" },
      // No project: no room and no brief, by name; its Board and Workstreams draw the workstreams no project lists, or say there are none.
      { path: "/p/unassigned/stream", surface: "project-stream-none", owner: "No project's room (FIX-1718)" },
      { path: "/p/unassigned/board", surface: ["project-board", "project-board-none"], owner: "No project's board (FIX-1718)" },
      { path: "/p/unassigned/workstreams", surface: ["project-workstreams", "project-workstreams-none"], owner: "No project's workstreams (FIX-1718)" },
      { path: "/p/unassigned/brief", surface: "project-brief-none", owner: "No project's brief (FIX-1718)" },
      { path: `/w/${encodeURIComponent(ch)}/stream`, surface: "workstream", owner: "a workstream (FIX-1650)" },
      ...["board", "brief", "results"].map((tab) => ({ path: `/w/${encodeURIComponent(ch)}/${tab}`, surface: "workstream", owner: `a workstream's ${tab} (FIX-1651)` })),
      { path: "/inbox", surface: "inbox", owner: "Inbox (FIX-1652)" },
      { path: "/tasks", surface: "tasks", owner: "Tasks, NOW, TIME and COST (FIX-1651; session data)" },
      ...["session", "diff", "checks", "brief"].map((tab) => ({ path: `${task}/${tab}`, surface: "task-frame", owner: `a task's ${tab} (FIX-1651; FIX-1652)` })),
    ];
    const named: string[] = [];
    for (const address of addresses) {
      const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
      const errors: string[] = [];
      page.on("pageerror", (e) => errors.push(e.message));
      try {
        await open(page, served.origin, address.path);
        const surface = [address.surface].flat().map((id) => `[data-testid=${id}]`).join(", ");
        if (!(await page.locator(surface).first().waitFor({ timeout: 15_000 }).then(() => true, () => false))) {
          fail(`${address.path} (${address.owner}) does not open its surface on a fresh load`);
          continue;
        }
        const centre = ((await page.getByTestId("centre").textContent().catch(() => "")) ?? "").trim();
        if (centre.length === 0) fail(`${address.path} (${address.owner}) is blank`);
        // Every empty state and gap line on the screen says something.
        const empties = (await page.locator("[data-testid$=-empty], [data-testid=empty-state], [data-testid$=-gap]").evaluateAll((els) => els.map((e) => (e.textContent ?? "").trim()))) as string[];
        if (empties.some((t) => t.length === 0)) fail(`${address.path} draws an empty state with no text`);
        named.push(...empties);
        if ((await page.getByTestId("refusal").count()) + (await page.getByTestId("unreachable").count()) > 0) fail(`${address.path} opens on a refusal`);
        if (errors.length > 0) fail(`${address.path} threw: ${errors.join(" | ")}`);
      } finally {
        await page.close();
      }
    }
    report.note(`J4: ${addresses.length} addresses opened fresh on DevForce; ${named.length} named empty states and gap lines, e.g. "${named.find((t) => /FIX-|arriv|not planned|ships/i.test(t))?.slice(0, 120) ?? named[0]?.slice(0, 120)}"`);
  } finally {
    await served?.stop();
  }
}

// ---- Part 4: the seams ---------------------------------------------------------

/** Every file under `dir` matching `keep`, skipping dependencies and build output. */
function files(dir: string, keep: (path: string) => boolean): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules" || entry === "dist") continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...files(full, keep));
    else if (keep(full)) out.push(full);
  }
  return out;
}

const stripComments = (text: string) => text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`])\/\/[^\n]*/g, "$1").replace(/\{\/\*[\s\S]*?\*\/\}/g, "");
const git = (...args: string[]) => execFileSync("git", args, { cwd: REPO_ROOT, encoding: "utf8", maxBuffer: 1 << 30 });

/**
 * Part 4: only what parts 1 to 3 don't grade. `base` is the commit before the
 * epic's first child merged (today's main as the epic's control).
 */
export function part4(base: string, report: Report): void {
  const src = join(SHIFT_MANAGER, "src");
  // Shift Manager's own source; the registry copies under components/flow-state and components/ui are FSD's.
  const own = files(src, (p) => /\.(tsx?|css)$/.test(p) && !/components[/\\](flow-state|ui)[/\\]/.test(p));

  // Token names: no literal colour in Shift Manager's own source.
  const palette = "slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose";
  const literal = new RegExp(
    `#[0-9a-fA-F]{3,8}\\b|\\b(?:rgb|rgba|hsl|hsla|oklch)\\(|\\b(?:text|bg|border|ring|fill|stroke|from|to|via|outline|decoration|divide|shadow|accent|caret)-(?:(?:${palette})-\\d{2,3}|black|white)\\b|-\\[(?:#|rgb|hsl|oklch)`,
  );
  const literals = own.flatMap((file) => {
    const m = literal.exec(stripComments(readFileSync(file, "utf8")));
    return m === null ? [] : [`${relative(REPO_ROOT, file)}: ${m[0]}`];
  });
  if (literals.length > 0) report.fail("P4:tokens", `a literal colour in Shift Manager's source: ${literals.join("; ")}`);
  report.note(`P4 token names: ${own.length} files of Shift Manager's own source, ${literals.length} literal colour(s)`);

  // The task route and the panel slot: FIX-1662's pinned shapes, as the route table parses them.
  const routes = readFileSync(join(src, "lib", "routes.ts"), "utf8");
  const pinned: Array<[string, RegExp]> = [
    ["task", /if \(head === "tasks" && a !== undefined && b !== undefined\)[\s\S]*?level: "task", boardRef: a, taskId: b, tab: oneOf\(TASK_TABS/],
    ["workstream", /if \(head === "w" && a !== undefined\) return \{ level: "workstream", mailboxId: a, tab: oneOf\(WORKSTREAM_TABS/],
    ["project", /if \(head === "p" && a !== undefined\) return \{ level: "project", projectId: a, tab: oneOf\(PROJECT_TABS/],
  ];
  for (const [name, re] of pinned) if (!re.test(routes)) report.fail("P4:routes", `the ${name} route is not FIX-1662's pinned shape`);
  const tabs = { TASK_TABS: "session, diff, checks, brief", WORKSTREAM_TABS: "stream, board, brief, results", PROJECT_TABS: "stream, board, workstreams, brief" };
  for (const [name, want] of Object.entries(tabs)) {
    const got = new RegExp(`${name} = \\[([^\\]]*)\\]`).exec(routes)?.[1]?.replace(/"/g, "").split(",").map((s) => s.trim()).join(", ");
    if (got !== want) report.fail("P4:routes", `${name} is [${got}], pinned [${want}]`);
  }
  const heads = [...routes.matchAll(/head === "([a-z]+)"/g)].map((m) => m[1]!);
  const levels = [...new Set([...routes.matchAll(/level: "([a-z]+)"/g)].map((m) => m[1]!))].sort();
  report.note(`P4 routes: task, workstream and project routes as pinned; route heads [${[...new Set(heads)].join(", ")}], levels [${levels.join(", ")}]; the task level's panel slot is graded in a3 (task-panel-slot holds the inspector)`);

  // One session write path (ER-15): every write Shift Manager makes, by call and by module.
  const allowed: Record<string, string[]> = {
    "sendAction(": ["lib/send.ts", "lib/transcript.ts", "lib/talk.ts"],
    "abortRequest(": ["lib/run.ts"],
    "resumeSuspension(": ["lib/reads.ts"],
    "createSession(": ["lib/reads.ts"],
  };
  const writes: string[] = [];
  for (const file of own) {
    const text = stripComments(readFileSync(file, "utf8"));
    const rel = relative(src, file).replace(/\\/g, "/");
    for (const call of [...Object.keys(allowed), "appendItem(", "saveItem(", "/actions/"]) {
      if (!text.includes(call)) continue;
      writes.push(`${rel} ${call}`);
      if (!(allowed[call] ?? []).includes(rel)) report.fail("P4:ER-15", `${rel} writes through ${call}, outside the doors ER-15 names`);
    }
  }
  const transcriptPost = /sendAction\("post"/.test(readFileSync(join(src, "lib", "transcript.ts"), "utf8"));
  if (!transcriptPost) report.fail("P4:ER-15", "lib/transcript.ts sends something other than the mailbox's post");
  // The project room (FIX-1718): talk.ts sends one action, through runTalkAction, and only read,
  // post or join; every caller hands its room functions the room kind. The person's own session, never a worker's.
  const talk = stripComments(readFileSync(join(src, "lib", "talk.ts"), "utf8"));
  const talkSends = talk.match(/\bsendAction\(/g)?.length ?? 0;
  const talkCalls = [...talk.matchAll(/\brunTalkAction\(\s*clients,\s*kind,\s*[^,]+,\s*("?)(\w+)\1/g)].map((m) => (m[1] === '"' ? m[2]! : `<${m[2]}>`));
  const talkRuns = (talk.match(/\brunTalkAction\(/g)?.length ?? 0) - 1; // less its definition
  if (talkSends !== 1 || !/sendAction\(action, input, \{ sessionId: session \}\)/.test(talk)) report.fail("P4:ER-15", `lib/talk.ts sends ${talkSends} action(s) outside runTalkAction's one send`);
  const offTalk = talkCalls.filter((a) => !["read", "post", "join"].includes(a));
  if (offTalk.length > 0 || talkCalls.length !== talkRuns) report.fail("P4:ER-15", `lib/talk.ts runs talk actions other than read, post and join: [${offTalk.join(", ")}]${talkCalls.length !== talkRuns ? `, ${talkRuns - talkCalls.length} unread` : ""}`);
  const roomCalls = own
    .filter((f) => !f.endsWith(join("lib", "talk.ts")))
    .flatMap((f) => [...stripComments(readFileSync(f, "utf8")).matchAll(/\b(readRoom|postToRoom|joinRoom)\(\s*clients,\s*([^,)]+)/g)].map((m) => `${relative(src, f)} ${m[1]}(${m[2]!.trim()})`));
  const offRoom = roomCalls.filter((c) => !c.endsWith("(ROOM_KIND)"));
  if (offRoom.length > 0) report.fail("P4:ER-15", `a talk action runs on a kind other than the room kind: ${offRoom.join("; ")}`);
  // The person's room session (FIX-1718, FIX-1752): reads.ts creates sessions on the room kind only.
  const reads = stripComments(readFileSync(join(src, "lib", "reads.ts"), "utf8"));
  const creates = [...reads.matchAll(/\bcreateSession\(\s*\{([^}]*)\}/g)].map((m) => m[1]!);
  const createCount = reads.match(/\bcreateSession\(/g)?.length ?? 0;
  if (createCount !== creates.length || creates.some((args) => !/\bflowKind:\s*ROOM_KIND\b/.test(args))) report.fail("P4:ER-15", "lib/reads.ts creates a session on a kind other than the room kind");
  report.note(`P4 ER-15: Shift Manager's writes are [${writes.join("; ")}]: the seat's door (send.ts), the mailbox's post (transcript.ts), the project room's ${talkCalls.join("/")} on the room kind (talk.ts; ${roomCalls.length} call(s)), the person's room session (reads.ts; ${creates.length} createSession on ROOM_KIND), Interrupt's abort (run.ts) and the one resume (reads.ts); Inbox's reply is graded by FIX-1690's check in part 3`);

  // One ask rendering: Inbox's detail and the stream's card draw through AskCard.
  for (const surface of ["Inbox.tsx", "Stream.tsx", "ChiefOfStaff.tsx"]) {
    const text = readFileSync(join(src, "surfaces", surface), "utf8");
    if (!/import \{ AskCard \} from "\.\.\/components\/AskCard"/.test(text) || !/<AskCard\b/.test(text)) report.fail("P4:ask", `${surface} does not draw its asks through AskCard`);
  }
  const askRenderers = own.filter((f) => /<Approval\b|<Question\b|SuspensionCard/.test(readFileSync(f, "utf8"))).map((f) => relative(src, f));
  if (askRenderers.some((f) => !f.endsWith("AskCard.tsx"))) report.fail("P4:ask", `an ask is drawn outside AskCard: ${askRenderers.join(", ")}`);
  report.note(`P4 one ask rendering: Inbox, Stream and Chief of Staff import AskCard; registry ask cards are drawn only in [${askRenderers.join(", ")}]; a1 compared the two cards' text on screen`);

  // Layer fence (ER-7, ER-8): the set's changes to core, engine, client and react.
  const layerDiff = git("diff", `${base}..HEAD`, "--", "packages/core/src", "packages/engine/src", "packages/client/src", "packages/react/src");
  const nouns = layerDiff
    .split("\n")
    .filter((l) => l.startsWith("+") && !l.startsWith("+++"))
    .filter((l) => /\b(?:export\s+)?(?:interface|type|class|function|const)\s+(Agent|Team|Mailbox|MessageBoard|Project)\b/.test(l));
  if (nouns.length > 0) report.fail("P4:fence", `an L1 noun added: ${nouns.slice(0, 3).join(" | ")}`);
  const ds = JSON.parse(readFileSync(join(REPO_ROOT, "labs", "design-system", "package.json"), "utf8")) as Record<string, Record<string, string> | undefined>;
  const dsDeps = Object.keys({ ...(ds.dependencies ?? {}), ...(ds.peerDependencies ?? {}) });
  if (dsDeps.some((d) => d.includes("workforce"))) report.fail("P4:fence", `the design-system package depends on ${dsDeps.join(", ")}`);
  if (/workforce/.test(readFileSync(join(REPO_ROOT, "labs", "design-system", "shift-manager.css"), "utf8"))) report.fail("P4:fence", "the design-system stylesheet names Workforce");
  const added = git("diff", "--name-only", "--diff-filter=A", `${base}..HEAD`).split("\n").filter(Boolean);
  const mailboxesMd = added.filter((f) => /(^|\/)MAILBOXES\.md$/.test(f));
  if (mailboxesMd.length > 0) report.fail("P4:fence", `MAILBOXES.md added: ${mailboxesMd.join(", ")}`);
  const kindFront = git("diff", `${base}..HEAD`, "--", "*.md")
    .split("\n")
    .filter((l) => /^\+kind:\s/.test(l));
  if (kindFront.length > 0) report.fail("P4:fence", `\`kind:\` frontmatter added: ${kindFront.slice(0, 3).join(" | ")}`);
  report.note(`P4 layer fence: ${layerDiff.split("\n").filter((l) => /^[+-][^+-]/.test(l)).length} changed lines under core/engine/client/react src since ${base.slice(0, 9)}, no Agent/Team/Mailbox/MessageBoard/Project noun; design-system deps [${dsDeps.join(", ")}]; no MAILBOXES.md, no \`kind:\` frontmatter added`);

  // Final visuals (ER-9): the theme's final values merged after the final hand-back.
  const handBack = git("log", "--diff-filter=A", "--format=%H", "HEAD", "--", "specs/epics/FIX-1649/assets/design/v2/README.md").trim().split("\n").at(-1) ?? "";
  const lastTheme = git("log", "-1", "--format=%H", "HEAD", "--", "labs/design-system/shift-manager.css").trim();
  if (handBack === "") report.fail("P4:visuals", "no final hand-back (assets/design/v2) is committed");
  else {
    try {
      execFileSync("git", ["merge-base", "--is-ancestor", handBack, lastTheme], { cwd: REPO_ROOT });
    } catch {
      report.fail("P4:visuals", `the theme's last change ${lastTheme.slice(0, 9)} does not follow the hand-back's commit ${handBack.slice(0, 9)}`);
    }
  }
  report.note(`P4 final visuals: hand-back v2 committed at ${handBack.slice(0, 9)}; shift-manager.css last changed at ${lastTheme.slice(0, 9)}, after it`);

  // Docs smoke (ER-14).
  const labs = readFileSync(join(REPO_ROOT, "labs", "README.md"), "utf8");
  if (!/\[`shift-manager\/`\]\(shift-manager\)/.test(labs)) report.fail("P4:docs", "labs/README.md does not list Shift Manager");
  const readme = readFileSync(join(SHIFT_MANAGER, "README.md"), "utf8");
  for (const heading of ["## Run it", "## What a Lab's config provides", "## What you see", "## A task", "## Roster"]) {
    if (!readme.includes(heading)) report.fail("P4:docs", `Shift Manager's README has no "${heading}"`);
  }
  report.note("P4 docs smoke: labs/README.md lists Shift Manager; its README says how to open a Lab and what each level shows (b0 and a3 followed it)");
}
