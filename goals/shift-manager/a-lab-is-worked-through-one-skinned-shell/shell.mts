/**
 * The closure check's scaffolding: building Shift Manager (as written, with a
 * scratch patch, or with a control module swapped in), serving it over a Lab
 * with its own start script, reading the Lab's store through its HTTP routes,
 * and reading what Chromium paints.
 *
 * Every piece is lifted from the child checks under `goals/shift-manager/`
 * (`it-opens-a-lab` for the swap build, the start script and the store reads;
 * `it-takes-its-look-from-the-design-system` for the scratch-copy build and
 * the colour sweep; `it-sends-a-turn-into-a-seat-session` for watching a
 * composer settle). Their run files execute on import, so the helpers are
 * lifted here rather than imported. The grading lives in `legs.mts`.
 */
import { execFileSync, spawn, type ChildProcess } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, symlinkSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import type { Page } from "playwright";
import { readDeclaredRoster } from "@flow-state-dev/workforce/loader";
import { REPO_ROOT, intentFreeEnv } from "../../lib/index.mts";

/** Shift Manager's package, in this checkout. */
export const SHIFT_MANAGER = join(REPO_ROOT, "labs", "shift-manager");
const TSX = join(REPO_ROOT, "node_modules", ".bin", "tsx");

export const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
const sorted = (values: Iterable<string>) => [...values].sort();
/** Whether two lists hold the same values, order aside. */
export const same = (a: Iterable<string>, b: Iterable<string>) => JSON.stringify(sorted(a)) === JSON.stringify(sorted(b));
/** What `got` lacks and adds against `want`. */
export const diff = (want: Iterable<string>, got: Iterable<string>) => {
  const w = new Set(want);
  const g = new Set(got);
  return `missing [${[...w].filter((x) => !g.has(x)).join(", ")}], extra [${[...g].filter((x) => !w.has(x)).join(", ")}]`;
};

// ---- building ----------------------------------------------------------------

/** One edit to a scratch copy of Shift Manager. A patch that matches nothing fails the setup. */
export type Patch = { file: string; from: string | RegExp; to: string; why: string };
/** A source module swapped for a control module at build time (a child check's control). */
export type Swap = { target: string | string[]; with: string };
/** A build: where its pages are, and the full diff of every patch applied to it. */
export type Built = { pages: string; diff: string };

async function vite() {
  return (await import(pathToFileURL(createRequire(join(SHIFT_MANAGER, "package.json")).resolve("vite")).href)) as {
    build(config: Record<string, unknown>): Promise<unknown>;
  };
}

/**
 * Build Shift Manager's pages into `scratch/<name>`.
 *
 * - With `patches`, Shift Manager is copied to scratch and patched there,
 *   never in the checkout (Tailwind reads class names off the files on disk,
 *   so a patch has to land in a copy). The diff of every patched file is
 *   returned in full, for the report.
 * - With `swap`, the build runs from the checkout and one module is swapped
 *   for a control module, as the child checks' controls do. The build fails
 *   if the swap never fired.
 * - `staticSeats` feeds the `static-names` control module its written-in list.
 */
export async function buildPages(
  scratch: string,
  name: string,
  options: { patches?: Patch[]; swap?: Swap; staticSeats?: Array<{ id: string; kind: string }> } = {},
): Promise<Built> {
  const pages = join(scratch, name, "pages");
  const define = { __STATIC_SEATS__: JSON.stringify(options.staticSeats ?? []) };
  const patches = options.patches ?? [];
  if (patches.length === 0) {
    let swapped = 0;
    const hit = new Set<string>();
    const swap = options.swap;
    await (await vite()).build({
      root: SHIFT_MANAGER,
      configFile: join(SHIFT_MANAGER, "vite.config.ts"),
      logLevel: "error",
      build: { outDir: pages, emptyOutDir: true },
      define,
      plugins:
        swap === undefined
          ? []
          : [
              {
                name: "goal-control-swap",
                enforce: "pre",
                async resolveId(this: any, source: string, importer: string | undefined, opts: Record<string, unknown>) {
                  if (importer === undefined || importer === swap.with) return null;
                  const resolved = await this.resolve(source, importer, { ...opts, skipSelf: true });
                  if (resolved?.id === undefined || ![swap.target].flat().includes(resolved.id)) return null;
                  hit.add(resolved.id);
                  swapped += 1;
                  return swap.with;
                },
              },
            ],
    });
    const missed = swap === undefined ? [] : [swap.target].flat().filter((t) => !hit.has(t));
    if (swapped === 0 && swap !== undefined || missed.length > 0) throw new Error(`setup [${name}]: the build never imported ${missed.join(", ")}, so nothing was swapped`);
    return { pages, diff: "" };
  }

  const root = join(scratch, name, "shift-manager");
  cpSync(SHIFT_MANAGER, root, { recursive: true, filter: (src) => !/[/\\](node_modules|dist)$/.test(src) });
  symlinkSync(join(SHIFT_MANAGER, "node_modules"), join(root, "node_modules"));
  // The copy sits outside the workspace; its tsconfig still extends the workspace's.
  const tsconfig = join(root, "tsconfig.json");
  writeFileSync(tsconfig, readFileSync(tsconfig, "utf8").replace('"../../tsconfig.base.json"', JSON.stringify(join(REPO_ROOT, "tsconfig.base.json"))));
  const diffs: string[] = [];
  for (const patch of patches) {
    const path = join(root, patch.file);
    const before = readFileSync(path, "utf8");
    const after = before.replace(patch.from, patch.to);
    if (after === before) throw new Error(`setup [${name}]: ${patch.why}, but ${patch.file} has nothing to patch (looked for ${String(patch.from)})`);
    writeFileSync(path, after);
    diffs.push(`# ${patch.why}\n${unifiedDiff(join(SHIFT_MANAGER, patch.file), path, `labs/shift-manager/${patch.file}`)}`);
  }
  await (await vite()).build({ root, configFile: join(root, "vite.config.ts"), logLevel: "error", build: { outDir: pages, emptyOutDir: true }, define });
  return { pages, diff: diffs.join("\n") };
}

/** `diff -u` of the checkout's file against its patched copy, labelled with the repo path. */
function unifiedDiff(original: string, patched: string, label: string): string {
  try {
    execFileSync("diff", ["-u", "--label", `a/${label}`, "--label", `b/${label}`, original, patched], { encoding: "utf8" });
    return "";
  } catch (error) {
    return String((error as { stdout?: string }).stdout ?? "");
  }
}

// ---- serving -----------------------------------------------------------------

/** A Shift Manager process serving one Lab. */
export type Running = { origin: string; devtool: string | null; child: ChildProcess; exited: Promise<void>; log: () => string; stop: () => Promise<void> };

/**
 * Shift Manager's start script over a Lab, from a fresh scratch working
 * directory: `--team <name>` or `--config <path>`, plus `--shift` when given.
 */
export async function startShiftManager(
  scratch: string,
  label: string,
  options: { team?: string; config?: string; pages: string; shift?: "day" | "night"; env?: Record<string, string> },
): Promise<Running> {
  mkdirSync(join(scratch, "labs"), { recursive: true });
  const workDir = mkdtempSync(join(scratch, "labs", `${label}-`));
  const lab = options.team !== undefined ? ["--team", options.team] : ["--config", options.config!];
  const args = [join(SHIFT_MANAGER, "bin", "start.mts"), ...lab, "--port", "0", "--assets", options.pages, ...(options.shift === undefined ? [] : ["--shift", options.shift])];
  let log = "";
  const child = spawn(TSX, args, {
    cwd: workDir,
    // GOAL_CONTROL is this script's, never the Lab's.
    env: intentFreeEnv(process.env, { INIT_CWD: workDir, GOAL_CONTROL: "", SHIFT_MANAGER_SHIFT: "", ...(options.env ?? {}) }),
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.stdout!.on("data", (d) => (log += String(d)));
  child.stderr!.on("data", (d) => (log += String(d)));
  let gone = false;
  const exited = new Promise<void>((resolve) =>
    child.on("exit", () => {
      gone = true;
      resolve();
    }),
  );
  const stop = async () => {
    if (!gone) child.kill("SIGTERM");
    await exited;
  };
  for (let waited = 0; waited < 180_000; waited += 250) {
    const match = /Shift Manager: (http:\/\/\S+)/.exec(log);
    if (match !== null) {
      const devtool = /Devtool: (http:\/\/\S+)/.exec(log);
      return { origin: match[1]!, devtool: devtool?.[1] ?? null, child, exited, log: () => log, stop };
    }
    if (gone) break;
    await sleep(250);
  }
  await stop();
  throw new Error(`Shift Manager's start script never served ${label}. Log tail:\n${log.slice(-2000)}`);
}

// ---- the store, read by this script -----------------------------------------

/** GET/POST against the Lab's routes, with the page's bearer when the Lab has one. */
export function labApi(origin: string, bearer: string | undefined) {
  const enc = encodeURIComponent;
  const call = async (method: string, path: string, body?: unknown): Promise<{ status: number; body: any }> => {
    const response = await fetch(`${origin}/api/flows${path}`, {
      method,
      headers: { "content-type": "application/json", ...(bearer === undefined ? {} : { authorization: `Bearer ${bearer}` }) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const text = await response.text();
    if (text.length === 0) return { status: response.status, body: null };
    try {
      return { status: response.status, body: JSON.parse(text) };
    } catch {
      throw new Error(`${method} ${path}: ${response.status}, and the body is not JSON: ${text.slice(0, 200)}`);
    }
  };
  const get = async (path: string): Promise<any> => {
    const { status, body } = await call("GET", path);
    if (status !== 200) throw new Error(`GET ${path}: ${status} ${JSON.stringify(body)}`);
    return body;
  };
  /** Every row of a collection, through one session, page by page. */
  const collection = async (sessionId: string, ref: string): Promise<Array<Record<string, any>>> => {
    const rows: Array<Record<string, any>> = [];
    let cursor: string | undefined;
    for (let page = 0; page < 100; page += 1) {
      const body = await get(`/sessions/${enc(sessionId)}/resources/${enc(ref)}?limit=200${cursor === undefined ? "" : `&cursor=${enc(cursor)}`}`);
      rows.push(...((body.items ?? []) as Array<{ clientData?: Record<string, any> }>).map((i) => i.clientData ?? {}));
      if (body.nextCursor === undefined || body.nextCursor === null || body.nextCursor === cursor) break;
      cursor = body.nextCursor;
    }
    return rows;
  };
  /** Every item of the given types in one session, oldest first (all types when none are given). */
  const items = async (sessionId: string, types: string[] = []): Promise<Array<Record<string, any>>> => {
    const out: Array<Record<string, any>> = [];
    for (let offset = 0, page = 0; page < 100; page += 1) {
      const filter = types.length === 0 ? "" : `&item_types=${types.join(",")}`;
      const body = await get(`/sessions/${enc(sessionId)}/state?include_items=true${filter}&offset=${offset}&limit=200`);
      out.push(...(body.items ?? []));
      if (body.pagination?.hasMore !== true) break;
      offset = body.pagination.nextOffset ?? offset + 200;
    }
    return out;
  };
  /** Whether the session holds a message of `role` whose content contains `needle`. */
  const holds = async (sessionId: string, role: string, needle: string): Promise<boolean> =>
    (await items(sessionId, ["message"])).some((m) => m.role === role && JSON.stringify(m.content ?? m.text ?? m).includes(needle));
  const ownerOf = async (sessionId: string): Promise<string> => {
    const body = await get(`/sessions/${enc(sessionId)}`);
    return String((body.session ?? body).flowId);
  };
  const requestStatus = async (flowId: string, requestId: string): Promise<string> =>
    String((await get(`/${enc(flowId)}/requests/${enc(requestId)}/status`)).status);
  return { call, get, collection, items, holds, ownerOf, requestStatus };
}
export type LabApi = ReturnType<typeof labApi>;

/** What the tree on disk declares: an oracle Shift Manager never reads. */
export type Tree = {
  root: string;
  seats: string[];
  teams: string[];
  channels: Array<{ id: string; members: string[]; boardRefs: string[] }>;
};

export async function readTree(root: string): Promise<Tree> {
  const roster = await readDeclaredRoster(root);
  if (roster.problems.length > 0) throw new Error(`the tree at ${root} did not load: ${roster.problems.map((p) => p.path).join(", ")}`);
  const seats = roster.workers.map((w) => w.id);
  return {
    root,
    seats,
    teams: [...new Set(seats.map((s) => (s.includes(".") ? s.split(".")[0]! : "Staff")))],
    channels: roster.channels.map((c) => ({
      id: c.id,
      members: Array.isArray(c.declared.members) ? (c.declared.members as string[]) : [],
      boardRefs: ((c.declared.boards as string[] | undefined) ?? []).map((b) => `${c.id}.${b}`),
    })),
  };
}

/** A stored board row, as the store returns it. */
export type StoredRow = { ref: string; id: string; status: string; title: string; run: { sessionId: string; requestId: string } | null; raw: Record<string, any> };
/** A pending ask: a suspension with no resume, on a seat's session, asking a person. */
export type StoredAsk = { suspensionId: string; sessionId: string; seat: string };

/** What the store holds, read through the Lab's routes by this script. */
export type Store = {
  seats: string[];
  channels: Array<{ id: string; kind: string; members: string[] }>;
  rows: Record<string, StoredRow[]>;
  asks: StoredAsk[];
  /** The organizations the person's sessions are bound to. */
  orgs: string[];
};

/** Suspension reasons that are a person being asked something. */
const PERSON_REASONS = new Set(["human_approval", "human_input"]);

export async function readStore(api: LabApi, tree: Tree, userId: string): Promise<Store> {
  // The inventory, through the first channel's session, by its published key patterns.
  const host = tree.channels[0]!.id;
  const manifest = await api.get(`/sessions/${encodeURIComponent(host)}/manifest`);
  const refOf = (pattern: string) =>
    (manifest.resources as Array<{ kind: string; ref: string; pattern: string }>).find((r) => r.kind === "collection" && r.pattern === pattern)?.ref;
  const seatsRef = refOf("inventory/seats/*");
  const channelsRef = refOf("inventory/channels/*");
  const seats = seatsRef === undefined ? [] : (await api.collection(host, seatsRef)).map((r) => String(r.id));
  const channels =
    channelsRef === undefined
      ? []
      : (await api.collection(host, channelsRef)).map((r) => ({ id: String(r.id), kind: String(r.kind), members: Array.isArray(r.members) ? (r.members as string[]) : [] }));

  const rows: Store["rows"] = {};
  for (const channel of tree.channels) {
    rows[channel.id] = [];
    for (const ref of channel.boardRefs) {
      for (const row of await api.collection(channel.id, ref)) {
        rows[channel.id]!.push({
          ref,
          id: String(row.id),
          status: String(row.status),
          title: String(row.title ?? row.goal ?? row.id),
          run: row.run == null ? null : { sessionId: String(row.run.sessionId), requestId: String(row.run.requestId) },
          raw: row,
        });
      }
    }
  }

  const listing = await api.get(`/sessions?userId=${encodeURIComponent(userId)}&include=dispatch-runs&limit=500`);
  const sessions = (listing.sessions ?? []) as Array<Record<string, any>>;
  const orgs = [...new Set(sessions.map((s) => s.orgId).filter((o): o is string => typeof o === "string" && o.length > 0))];
  const seatSet = new Set(seats);
  const asks: StoredAsk[] = [];
  for (const session of sessions) {
    if (!seatSet.has(String(session.flowId))) continue;
    const found = await api.items(String(session.id), ["suspension", "suspension_resume"]);
    const resumed = new Set(found.filter((i) => i.type === "suspension_resume").map((i) => String(i.suspensionId)));
    for (const item of found) {
      if (item.type === "suspension" && PERSON_REASONS.has(String(item.reason)) && !resumed.has(String(item.suspensionId))) {
        asks.push({ suspensionId: String(item.suspensionId), sessionId: String(session.id), seat: String(session.flowId) });
      }
    }
  }
  return { seats, channels, rows, asks, orgs };
}

/** Whether a session holds a resume for `suspensionId`. */
export async function resumed(api: LabApi, sessionId: string, suspensionId: string): Promise<boolean> {
  return (await api.items(sessionId, ["suspension_resume"])).some((i) => String(i.suspensionId) === suspensionId);
}

// ---- the page ----------------------------------------------------------------

/** The user and bearer the page was handed, read off the page itself. */
export async function injected(page: Page): Promise<{ userId: string; bearer: string | undefined }> {
  const config = (await page.evaluate(() => (window as any).__FSD_DEVTOOL_CONFIG__ ?? null)) as { userId?: string; bearerToken?: string } | null;
  if (config?.userId === undefined) throw new Error("the page was handed no userId");
  return { userId: config.userId, bearer: config.bearerToken };
}

/** Load a path and wait for the shell and its first read. */
export async function open(page: Page, origin: string, path: string): Promise<void> {
  await page.goto(`${origin}${path}`);
  await page.getByTestId("shell").waitFor({ timeout: 30_000 });
  await page.waitForFunction(() => !document.querySelector("[data-testid=nav-tasks-count]")?.textContent?.includes("…"), undefined, { timeout: 30_000 });
}

export async function visible(page: Page, testId: string, timeout = 10_000): Promise<boolean> {
  try {
    await page.getByTestId(testId).first().waitFor({ timeout });
    return true;
  } catch {
    return false;
  }
}

/** One attribute of every element with a test id. */
export const attr = async (page: Page, testId: string, name: string) =>
  (await page.getByTestId(testId).evaluateAll((els, n) => els.map((e) => e.getAttribute(n) ?? ""), name)) as string[];

/**
 * Click Send on a composer, then watch its status until it settles. The moment
 * it first reads *delivered*, `heldNow` reads the store: the line must already
 * be there.
 */
export async function sendAndWatch(
  page: Page,
  composer: string,
  heldNow: () => Promise<boolean>,
  withinMs = 120_000,
): Promise<{ state: string; heldAtDelivered: boolean | null; error: string | null }> {
  await page.getByTestId(`${composer}-send`).click();
  for (const until = Date.now() + withinMs; Date.now() < until; await sleep(50)) {
    const state = (await page.getByTestId(`${composer}-status`).getAttribute("data-state")) ?? "";
    if (state === "delivered") return { state, heldAtDelivered: await heldNow(), error: null };
    const error = await page.getByTestId(`${composer}-error`).textContent({ timeout: 50 }).catch(() => null);
    if (error !== null) return { state: state || "error", heldAtDelivered: null, error };
  }
  return { state: "sending", heldAtDelivered: null, error: `nothing settled within ${withinMs / 1000}s` };
}

// ---- reading what is painted ---------------------------------------------------

/** One painted value on one element. */
export type Sample = { part: string; el: string; prop: string; value: string };
export type PageRead = { counts: Record<string, number>; colours: Sample[]; fonts: Sample[]; probes: Record<string, string> };

/**
 * Runs in the page: every painted colour and font inside each part's
 * selector, plus how the page computes each probe value. A colour set by an
 * inline literal (syntax highlighting) is content, not skin, and is skipped.
 * Lifted from `it-takes-its-look-from-the-design-system`.
 */
export function readPainted(args: { parts: Record<string, string>; probeValues: string[] }): PageRead {
  const colours: Sample[] = [];
  const fonts: Sample[] = [];
  const counts: Record<string, number> = {};
  const describe = (el: Element) =>
    `${el.tagName.toLowerCase()}${el.getAttribute("class") ? "." + el.getAttribute("class")!.trim().split(/\s+/).slice(0, 3).join(".") : ""}`;
  const sample = (part: string, el: Element) => {
    const cs = getComputedStyle(el);
    const rect = el.getBoundingClientRect();
    if (cs.display === "none" || cs.visibility !== "visible" || rect.width === 0 || rect.height === 0) return false;
    const push = (prop: string, value: string) => colours.push({ part, el: describe(el), prop, value });
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
    if (hasText) fonts.push({ part, el: describe(el), prop: "font-family", value: cs.fontFamily });
    return true;
  };
  for (const [part, selector] of Object.entries(args.parts)) {
    counts[part] = 0;
    for (const root of Array.from(document.querySelectorAll(selector))) {
      for (const el of [root, ...Array.from(root.querySelectorAll("*"))]) if (sample(part, el)) counts[part] += 1;
    }
  }
  const probe = document.createElement("span");
  document.body.appendChild(probe);
  const probes: Record<string, string> = {};
  for (const value of args.probeValues) {
    probe.style.color = "";
    probe.style.color = value;
    probes[value] = getComputedStyle(probe).color;
  }
  probe.remove();
  return { counts, colours, fonts, probes };
}

/** Wait until no finite animation or transition is running, so computed colours are settled. */
export async function settled(page: Page): Promise<void> {
  await page.waitForFunction(() => document.getAnimations().every((a) => a.playState !== "running" || a.effect?.getTiming().iterations === Infinity), undefined, {
    timeout: 10_000,
  });
}
