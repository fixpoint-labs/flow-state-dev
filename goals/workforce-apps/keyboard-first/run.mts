/**
 * Goal check: the workforce apps can be driven from the keyboard (FIX-2401).
 * See goal.md.
 *
 * Three legs, one browser, no model turn:
 *
 *   a  the Claude Code-style lab: ⌘K a new session and a session by its title,
 *      Alt+↑/↓, `/`, `?`, the view switch's one Tab stop, and `/ ? [` typed as text
 *   b  the Teammates lab: ⌘K a teammate, Alt+↓, hire by keys, fire by keys
 *   c  Shift Manager's Jump to on DevTeam: its combobox, every sidebar screen,
 *      a project, a workstream, a worker by id, a task by its board ref, Tab
 *      kept inside, focus put back on Esc
 *
 * Every app's pages are built from a scratch copy of its source (a control's
 * patch lands only in that copy, printed), and each app boots on a fresh data
 * folder. The run never calls `click()` and fails the step any browser dialog
 * box opens in.
 *
 * Run:     PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers pnpm tsx goals/workforce-apps/keyboard-first/run.mts
 * Control: GOAL_CONTROL=<name>, same command (goal.md → Controls). A control run
 *          FAILs at its own steps; any other red, or one of its steps green, is WRONG.
 */
import { spawnSync } from "node:child_process";
import { cpSync, mkdirSync, readFileSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Browser, Page } from "playwright";
import { parseDeclaredWorkerId } from "@flow-state-dev/workforce";
import { readDeclaredRoster } from "@flow-state-dev/workforce/loader";
import { LAB_TREE, LAB_USERS, PROJECTS_FLOW } from "../../../packages/shift-manager/teams/devteam/host.mts";
import { EM_FLOW } from "../../../packages/shift-manager/teams/devteam/workforce/flows/workers/em.mts";
import { CODER_FLOW } from "../../../packages/shift-manager/teams/devteam/workforce/flows/workers/coder.mts";
import { LAB as CLAUDE_CODE_STYLE, startLab } from "../../claude-code-style-lab/lab.mts";
import { startTeammates } from "../../teammates-lab/lab.mts";
import { REPO_ROOT, goalTmpDir, repoPath, runGoal, stopProcessGroup } from "../../lib/index.mts";
import { launchChromium } from "../../lib/playwright.mts";
import { buildShiftManagerCopy, labRoutes, openShiftManager, personPage, startShiftManager, type Patch } from "../../lib/shift-manager.mts";

const TEAMMATES = repoPath("labs", "teammates");
const DEVTEAM_CONFIG = repoPath("packages", "shift-manager", "teams", "devteam", "fsdev.config.mts");
const SCRATCH = goalTmpDir("keyboard-first");
const say = (s: string) => console.error(`[keyboard-first] ${s}`);
const NODE_ENV_AT_LOAD = process.env.NODE_ENV;

// ---- the steps, and what each control must fail --------------------------------

const STEPS = {
  a1: "a: ⌘K New session, a project by keys: a session opens and its composer is active",
  a2: "a: ⌘K part of a title: that session is selected and its composer is active",
  a3: "a: Alt+↑ / Alt+↓ select the neighbouring session",
  a4: "a: `/` from the list puts the cursor in the composer",
  a5: "a: `?` lists every bound key; Esc closes it and focus is back on the list",
  a6: "a: the view switch is one Tab stop, and → selects and focuses Projects",
  a7: "a: `/`, `?` and `[` typed into the composer stay as text",
  b1: "b: ⌘K a teammate's name: its conversation is open and its composer active",
  b2: "b: Alt+↓ opens the next teammate",
  b3: "b: a teammate hired from ⌘K by keys joins the roster, opened",
  b4: "b: Fire by keys: the inline row with Keep focused; Keep keeps it; Fire removes it",
  c1: "c: ⌘K's input is a combobox, and ↓ moves its aria-activedescendant",
  c2: "c: each sidebar screen by name opens that screen",
  c3: "c: the project's name opens it",
  c4: "c: the workstream's name opens it",
  c5: "c: the coder's id opens Roster on its team with its row focused and in view",
  c6: "c: a task's board ref opens that task",
  c7: "c: eight Tabs and eight Shift+Tabs stay inside the open palette",
  c8: "c: Esc closes the palette and puts focus back where it was",
} as const;
type StepId = keyof typeof STEPS;

/** One scratch edit to an app's source, for a control. */
type AppPatch = Patch & { app: "claude-code-style" | "teammates" | "shift-manager" };

const CONTROLS: Record<string, { patches: AppPatch[]; fails: StepId[] }> = {
  "no-composer-focus": {
    patches: [
      { app: "claude-code-style", file: "src/App.tsx", from: "else focusComposer(id);", to: "else void id;", why: "a pick no longer focuses the session's composer" },
      { app: "teammates", file: "src/App.tsx", from: "if (sessionId !== undefined) focusComposer(sessionId);", to: "void sessionId;", why: "a pick no longer focuses the teammate's composer" },
    ],
    fails: ["a1", "a2", "b1"],
  },
  "no-type-guard": {
    patches: [{ app: "claude-code-style", file: "src/lib/keys.ts", from: "isTypingTarget(event.target)) return;", to: "false) return;", why: "the typing guard answers false" }],
    fails: ["a7"],
  },
  "no-roving": {
    patches: [{ app: "claude-code-style", file: "src/components/SessionsList.tsx", from: "tabIndex={mode.id === view ? 0 : -1}", to: "tabIndex={0}", why: "every view button is its own Tab stop" }],
    fails: ["a6"],
  },
  "label-only": {
    patches: [{ app: "shift-manager", file: "src/surfaces/JumpTo.tsx", from: "[e.label, e.hint, ...e.keywords].some(", to: "[e.label].some(", why: "Jump to matches the shown label alone" }],
    fails: ["c5", "c6"],
  },
  "plain-dialog": {
    patches: [
      {
        app: "shift-manager",
        file: "src/surfaces/JumpTo.tsx",
        from: /<Dialog open onOpenChange=\{\(open\) => !open && onClose\(\)\}>\s*<DialogContent[\s\S]*?data-testid="jump-dialog"\s*>\s*<DialogTitle[^\n]*\n\s*<DialogDescription[^\n]*\n/,
        to: '<div className="fixed inset-0 z-20 flex items-start justify-center bg-background/70 pt-24" data-testid="jump-dialog"><div role="dialog" aria-label="Jump to" className="w-full max-w-lg border bg-popover" onKeyDown={(e) => { if (e.key === "Escape") onClose(); }}>\n',
        why: "Jump to is a plain div again (no focus trap, no focus restore)",
      },
      { app: "shift-manager", file: "src/surfaces/JumpTo.tsx", from: /<\/DialogContent>\s*<\/Dialog>/, to: "</div></div>", why: "…closed as a div" },
      { app: "shift-manager", file: "src/surfaces/JumpTo.tsx", from: "<CommandInput\n", to: "<CommandInput\n            autoFocus\n", why: "…whose input takes focus itself, as the old one did" },
    ],
    fails: ["c7", "c8"],
  },
  "browser-confirm": {
    patches: [
      {
        app: "teammates",
        file: "src/components/Conversation.tsx",
        from: 'onClick={() => setPanel("fire")}',
        to: "onClick={() => { if (window.confirm(`Fire ${worker.name}? It leaves your roster; this conversation stays readable.`)) void onFire(); }}",
        why: "Fire asks with a browser confirm box",
      },
    ],
    fails: ["b4"],
  },
};

const CONTROL = process.env.GOAL_CONTROL ?? "";
if (CONTROL !== "" && CONTROLS[CONTROL] === undefined) throw new Error(`unknown GOAL_CONTROL "${CONTROL}"; known: ${Object.keys(CONTROLS).join(", ")}`);
const patchesFor = (app: AppPatch["app"]) => (CONTROLS[CONTROL]?.patches ?? []).filter((p) => p.app === app);

// ---- the record ----------------------------------------------------------------

/** Each step's notes; a step with a FAIL note is red, one with only PASS is green, one never run is missing. */
const record = new Map<StepId, string[]>();
let current: StepId | undefined;
/** The page the leg drives, for a screenshot of a red step. */
let shown: Page | undefined;
const failStep = (id: StepId, why: string) => record.set(id, [...(record.get(id) ?? []), `FAIL ${why}`]);

/** Run one step: the first broken expectation fails it, and the leg goes on to the next step. */
async function step(id: StepId, body: () => Promise<string | void>) {
  current = id;
  say(`${id} ${STEPS[id]}`);
  try {
    const seen = await body();
    if (!(record.get(id) ?? []).some((n) => n.startsWith("FAIL"))) record.set(id, [`PASS${seen ? ` ${seen}` : ""}`]);
  } catch (error) {
    failStep(id, (error as Error).message.split("\n")[0]!.slice(0, 400));
  } finally {
    if ((record.get(id) ?? []).some((n) => n.startsWith("FAIL"))) await shown?.screenshot({ path: join(SCRATCH, "shots", `${id}.png`) }).catch(() => undefined);
    current = undefined;
  }
}

/** A broken expectation. */
function expect(ok: boolean, why: string): asserts ok {
  if (!ok) throw new Error(why);
}

/** Every browser dialog box fails the step it opened in; it is dismissed so the page goes on. */
function refuseDialogs(page: Page, leg: "a" | "b" | "c") {
  shown = page;
  page.on("dialog", (dialog) => {
    failStep(current ?? (`${leg}1` as StepId), `a browser ${dialog.type()} box opened: "${dialog.message()}"`);
    void dialog.dismiss().catch(() => undefined);
  });
}

// ---- the page, read ------------------------------------------------------------

/** What has focus: its tag, its attributes the steps read, and its text. */
type Focused = { tag: string; text: string; composer: string | null; sessionId: string | null; workerId: string | null; inDialog: boolean; inJump: boolean; inView: boolean };
const focused = (page: Page): Promise<Focused> =>
  page.evaluate(() => {
    const el = document.activeElement as HTMLElement | null;
    const box = el?.getBoundingClientRect();
    return {
      tag: el?.tagName.toLowerCase() ?? "none",
      text: (el?.textContent ?? "").trim().slice(0, 80),
      composer: el?.hasAttribute("data-composer") ? "yes" : null,
      sessionId: el?.getAttribute("data-session-id") ?? null,
      workerId: el?.getAttribute("data-worker-id") ?? null,
      inDialog: el?.closest('[role="dialog"]') !== null && el?.closest('[role="dialog"]') !== undefined,
      inJump: el?.closest('[data-testid="jump-dialog"]') !== null && el?.closest('[data-testid="jump-dialog"]') !== undefined,
      inView: box !== undefined && box.bottom > 0 && box.top < window.innerHeight && box.width > 0,
    };
  });
const describe = (f: Focused) => `<${f.tag}>${f.text === "" ? "" : ` "${f.text}"`}${f.sessionId === null ? "" : ` [session ${f.sessionId}]`}`;

/** Wait until `test` holds of what has focus, or say what had focus instead. */
async function focusBecomes(page: Page, test: (f: Focused) => boolean, what: string, ms = 5_000) {
  let last: Focused | undefined;
  for (const until = Date.now() + ms; Date.now() < until; await page.waitForTimeout(100)) {
    last = await focused(page);
    if (test(last)) return last;
  }
  throw new Error(`${what}; focus is on ${last === undefined ? "nothing" : describe(last)}`);
}

/** Wait for a condition the page states. */
async function until(page: Page, fn: () => boolean, what: string, ms = 10_000) {
  await page.waitForFunction(fn, undefined, { timeout: ms }).catch(() => {
    throw new Error(what);
  });
}

/** Tab (or Shift+Tab) until `test` holds of what has focus, at most `max` presses. */
async function tabTo(page: Page, test: (f: Focused) => boolean, what: string, back = false, max = 40) {
  for (let i = 0; i < max; i += 1) {
    await page.keyboard.press(back ? "Shift+Tab" : "Tab");
    if (test(await focused(page))) return;
  }
  throw new Error(`${max} ${back ? "Shift+Tabs" : "Tabs"} never reached ${what}`);
}

/** Open the page's palette from where focus is, and type `query` into it. */
async function palette(page: Page, query: string) {
  // A dialog still closing would take ⌘K as its own toggle.
  await page.waitForFunction(() => document.querySelector('[role="dialog"]') === null, undefined, { timeout: 3_000 }).catch(() => undefined);
  await page.keyboard.press("ControlOrMeta+k");
  await focusBecomes(page, (f) => f.inDialog && f.tag === "input", "⌘K opened no palette with its input focused");
  await page.keyboard.type(query);
  await page.waitForTimeout(300);
}

// ---- builds ----------------------------------------------------------------------

/** Apply `patches` to the copy at `root`; a patch that matches nothing throws. */
function applyPatches(root: string, patches: readonly Patch[], name: string): string[] {
  const diff: string[] = [];
  for (const patch of patches) {
    const path = join(root, patch.file);
    const before = readFileSync(path, "utf8");
    const after = before.replace(patch.from, patch.to);
    if (after === before) throw new Error(`setup [${name}]: ${patch.why}, but ${patch.file} has nothing to patch (looked for ${String(patch.from)})`);
    writeFileSync(path, after);
    diff.push(`${name} ${patch.file}: ${patch.why}\n    - ${String(patch.from).slice(0, 160)}\n    + ${patch.to.slice(0, 160)}`);
  }
  return diff;
}

/**
 * A lab's pages built from a scratch copy of its source with `patches` applied
 * (Tailwind reads class names off the files on disk, so a patch lands in a copy,
 * never the checkout).
 */
function buildLabCopy(lab: string, name: string, patches: readonly Patch[]): { pages: string; diff: string[] } {
  const root = join(SCRATCH, name, "source");
  cpSync(lab, root, { recursive: true, filter: (src) => !/[/\\](node_modules|dist-client|\.fsdev)$/.test(src) });
  symlinkSync(join(lab, "node_modules"), join(root, "node_modules"));
  const tsconfig = join(root, "tsconfig.json");
  writeFileSync(tsconfig, readFileSync(tsconfig, "utf8").replace('"../../tsconfig.base.json"', JSON.stringify(join(REPO_ROOT, "tsconfig.base.json"))));
  const diff = applyPatches(root, patches, name);
  const pages = join(SCRATCH, name, "pages");
  // Its own process: three Vite builds in this one run out of heap.
  const built = spawnSync(join(lab, "node_modules", ".bin", "vite"), ["build", "--config", join(root, "vite.config.ts"), "--outDir", pages, "--emptyOutDir", "--logLevel", "error"], {
    cwd: root,
    encoding: "utf8",
    env: { ...process.env, NODE_ENV: "production" },
  });
  if (built.status !== 0) throw new Error(`setup [${name}]: vite build failed: ${(built.stderr || built.stdout).slice(-1500)}`);
  return { pages, diff };
}

/** Vite leaves `NODE_ENV=production` behind, which every app this run boots would inherit. */
function restoreNodeEnv() {
  if (NODE_ENV_AT_LOAD === undefined) delete process.env.NODE_ENV;
  else process.env.NODE_ENV = NODE_ENV_AT_LOAD;
}

// ---- leg a: the Claude Code-style lab --------------------------------------------

async function legA(browser: Browser, pages: string) {
  const data = join(SCRATCH, "a", "data");
  mkdirSync(data, { recursive: true });
  // A model no gateway serves: a first line still titles its session, and no turn reaches a model.
  const lab = await startLab(data, "u_keys", { CLAUDE_CODE_STYLE_MODEL: "goal/no-model" }, pages);
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  try {
    const page = await context.newPage();
    page.setDefaultTimeout(15_000);
    refuseDialogs(page, "a");
    await page.goto(lab.origin);
    await page.getByRole("heading", { name: "Choose a project" }).waitFor({ timeout: 30_000 });
    // Setup: one project, made through the picker's form by keys.
    await page.getByLabel("Project name").focus();
    await page.keyboard.type("Keys Orchard");
    await page.keyboard.press("Tab");
    await page.keyboard.type(`file://${join(SCRATCH, "a", "repo")}`);
    await page.keyboard.press("Enter");
    await page.locator('section[aria-label="Choose a project"] li button', { hasText: "Keys Orchard" }).waitFor();

    const list = page.locator('nav[aria-label="Sessions"]');
    const newButton = list.getByRole("button", { name: "+ New session" });
    const selectedRow = () => list.locator('li button[aria-current="true"]').innerText().then((t) => t.split("\n")[0]!.trim(), () => "(none)");
    const titles = ["Amber ledger one", "Basalt ledger two"];
    const opened: string[] = [];

    await step("a1", async () => {
      for (const title of titles) {
        await newButton.focus();
        await palette(page, "New session");
        await page.keyboard.press("Enter");
        await focusBecomes(page, (f) => f.tag === "button" && f.text === "Keys Orchard", "*New session* did not put focus on the project to choose");
        await page.keyboard.press("Enter");
        // A red here still leaves the session made and titled (`/` reaches its composer), so the steps after it grade their own keys.
        const fresh = (f: Focused) => f.composer === "yes" && f.sessionId !== null && !opened.includes(f.sessionId);
        let composer = await focusBecomes(page, fresh, "picking the project opened no session with its composer active").catch((error: Error) => {
          failStep("a1", error.message);
          return undefined;
        });
        if (composer === undefined) {
          await page.keyboard.press("/");
          composer = await focusBecomes(page, fresh, "`/` found no new session's composer either");
        }
        opened.push(composer.sessionId!);
        // Its first line titles it (the turn it starts reaches no model).
        await page.keyboard.type(title);
        await page.keyboard.press("Enter");
        await list.locator("li button", { hasText: title }).waitFor({ timeout: 15_000 }).catch(() => {
          throw new Error(`the session's first line "${title}" never became its title in the list`);
        });
      }
      return `two sessions opened by keys, ${opened.join(", ")}, each with its own composer active`;
    });

    await step("a2", async () => {
      expect(opened.length === 2, "a1 opened no two sessions to switch between");
      await newButton.focus();
      await palette(page, titles[0]!.split(" ")[0]!);
      await page.keyboard.press("Enter");
      await until(page, () => document.querySelector('[role="dialog"]') === null, "the switcher stayed open after Enter");
      expect((await selectedRow()) === titles[0], `the list selects "${await selectedRow()}", not "${titles[0]}"`);
      await focusBecomes(page, (f) => f.composer === "yes" && f.sessionId === opened[0], `the composer of ${opened[0]} is not active`);
      return `"${titles[0]!.split(" ")[0]}" switched to ${opened[0]} with its composer active`;
    });

    await step("a3", async () => {
      // Newest first: the second session above the first.
      await newButton.focus();
      await page.keyboard.press("Alt+ArrowUp");
      await page.waitForFunction((t) => document.querySelector('nav[aria-label="Sessions"] li button[aria-current="true"]')?.textContent?.includes(t) === true, titles[1], { timeout: 5_000 }).catch(() => undefined);
      const up = await selectedRow();
      expect(up === titles[1], `Alt+↑ from "${titles[0]}" selects "${up}", not "${titles[1]}"`);
      await newButton.focus();
      await page.keyboard.press("Alt+ArrowDown");
      await page.waitForFunction((t) => document.querySelector('nav[aria-label="Sessions"] li button[aria-current="true"]')?.textContent?.includes(t) === true, titles[0], { timeout: 5_000 }).catch(() => undefined);
      const down = await selectedRow();
      expect(down === titles[0], `Alt+↓ from "${titles[1]}" selects "${down}", not "${titles[0]}"`);
      return "Alt+↑ and Alt+↓ moved between the two sessions";
    });

    await step("a4", async () => {
      await newButton.focus();
      await page.keyboard.press("/");
      await focusBecomes(page, (f) => f.composer === "yes", "`/` from the list did not focus the composer");
    });

    await step("a5", async () => {
      await newButton.focus();
      await page.keyboard.press("?");
      const sheet = page.locator('[role="dialog"]');
      await sheet.waitFor({ timeout: 5_000 }).catch(() => {
        throw new Error("`?` opened no key list");
      });
      const text = await sheet.innerText();
      const missing = ["⌘K", "Ctrl+K", "Alt+↑", "Alt+↓", "/", "?", "←", "→"].filter((key) => !text.includes(key));
      expect(missing.length === 0, `the key list doesn't name ${missing.join(", ")}`);
      await page.keyboard.press("Escape");
      await until(page, () => document.querySelector('[role="dialog"]') === null, "Esc left the key list open");
      await focusBecomes(page, (f) => f.tag === "button" && f.text === "+ New session", "after Esc focus is not back on the list's *New session*");
    });

    await step("a6", async () => {
      const tabs = page.locator('[role="tablist"][aria-label="View"] [role="tab"]');
      const stops = await tabs.evaluateAll((els) => els.filter((e) => e.getAttribute("tabindex") === "0").length);
      expect(stops === 1, `the view switch has ${stops} elements with tabindex="0", not one`);
      await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
      await tabTo(page, (f) => f.tag === "button" && (f.text === "Sessions" || f.text === "Projects"), "the view switch");
      await page.keyboard.press("Tab");
      const after = await focused(page);
      expect(after.text !== "Sessions" && after.text !== "Projects", `one Tab past the view switch lands on its other view, "${after.text}"`);
      await page.keyboard.press("Shift+Tab");
      await page.keyboard.press("ArrowRight");
      await focusBecomes(page, (f) => f.text === "Projects", "→ did not focus Projects");
      expect((await page.locator('[role="tab"][data-view="threads"]').getAttribute("aria-selected")) === "true", "→ focused Projects without selecting it");
      await page.keyboard.press("ArrowLeft");
      await focusBecomes(page, (f) => f.text === "Sessions", "← did not go back to Sessions");
      return "one Tab stop; → selected and focused Projects, ← came back";
    });

    await step("a7", async () => {
      await newButton.focus();
      await page.keyboard.press("/");
      await focusBecomes(page, (f) => f.composer === "yes", "`/` did not focus the composer to type into");
      await page.keyboard.type("x/?[");
      await page.waitForTimeout(300);
      const value = await page.evaluate(() => (document.activeElement as HTMLTextAreaElement | null)?.value ?? "");
      const dialogs = await page.locator('[role="dialog"]').count();
      expect(dialogs === 0, "typing `?` in the composer opened the key list");
      expect(value === "x/?[", `the composer holds ${JSON.stringify(value)}, not "x/?["`);
      await focusBecomes(page, (f) => f.composer === "yes", "typing moved focus out of the composer");
      await page.keyboard.press("ControlOrMeta+a");
      await page.keyboard.press("Backspace");
    });
  } finally {
    await context.close();
    stopProcessGroup(lab.child);
  }
}

// ---- leg b: the Teammates lab ----------------------------------------------------

async function legB(browser: Browser, pages: string) {
  const dir = join(SCRATCH, "b");
  mkdirSync(dir, { recursive: true });
  const lab = await startTeammates(dir, "u_keys", {}, join(dir, "workdir"), pages);
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  try {
    const page = await context.newPage();
    page.setDefaultTimeout(15_000);
    refuseDialogs(page, "b");
    await page.goto(lab.origin);
    const rows = page.locator('nav[aria-label="Workers"] button[data-worker]');
    await rows.first().waitFor({ timeout: 30_000 });
    await until(page, () => document.querySelector('nav[aria-label="Workers"] button[aria-current="true"]') !== null, "the lab opened on no teammate");
    const names = await rows.evaluateAll((els) => els.map((e) => e.getAttribute("data-worker") ?? ""));
    expect(names.length >= 3, `the roster lists ${names.length} teammates; the leg needs three`);
    const heading = () => page.locator('main[aria-label="Conversation"] h1').innerText().catch(() => "(none)");
    const headingIs = (name: string) => page.waitForFunction((n) => document.querySelector('main[aria-label="Conversation"] h1')?.textContent === n, name, { timeout: 5_000 }).catch(() => undefined);

    await step("b1", async () => {
      const target = names[1]!;
      await rows.first().focus();
      await palette(page, target);
      // A role can name another teammate ("asks researcher…"), so arrow down to the one asked for, as a person would.
      for (let i = 0; i < 10; i += 1) {
        const highlighted = await page.locator('[role="dialog"] [cmdk-item][data-selected="true"]').innerText().catch(() => "");
        if (highlighted.trim().startsWith(target)) break;
        await page.keyboard.press("ArrowDown");
      }
      await page.keyboard.press("Enter");
      await headingIs(target);
      expect((await heading()) === target, `⌘K "${target}" opened "${await heading()}"`);
      const f = await focusBecomes(page, (x) => x.composer === "yes" && x.sessionId !== null, `${target}'s composer is not active`);
      return `${target} opened, composer active on session ${f.sessionId}`;
    });

    await step("b2", async () => {
      await rows.first().focus();
      // From the teammate open now (names[1] when b1 passed), the next one down.
      const from = await heading();
      const want = names[names.indexOf(from) + 1];
      expect(want !== undefined, `no teammate below "${from}"`);
      await page.keyboard.press("Alt+ArrowDown");
      await headingIs(want);
      expect((await heading()) === want, `Alt+↓ from "${from}" opened "${await heading()}", not "${want}"`);
    });

    const hired = "keysgoal";
    await step("b3", async () => {
      await rows.first().focus();
      await palette(page, "Hire");
      await page.keyboard.press("Enter");
      await focusBecomes(page, (f) => f.tag === "input" && !f.inDialog, "*Hire a teammate* put focus on no hire form");
      await page.keyboard.type(hired);
      await page.keyboard.press("Tab");
      await page.keyboard.type("Checks the keys");
      await page.keyboard.press("Tab");
      await page.keyboard.type("Answer in one line.");
      await tabTo(page, (f) => f.tag === "button" && f.text === "Hire", "the Hire button");
      await page.keyboard.press("Enter");
      await page.locator(`nav[aria-label="Workers"] button[data-worker="${hired}"]`).waitFor({ timeout: 30_000 }).catch(() => {
        throw new Error(`${hired} never joined the roster`);
      });
      await headingIs(hired);
      expect((await heading()) === hired, `after the hire "${await heading()}" is open, not ${hired}`);
    });

    await step("b4", async () => {
      expect((await heading()) === hired, `${hired} is not open to fire`);
      const findFire = async () => {
        await rows.first().focus();
        await page.keyboard.press("/");
        await focusBecomes(page, (f) => f.composer === "yes", "`/` did not focus the composer");
        await tabTo(page, (f) => f.tag === "button" && f.text === "Fire" && !f.inDialog, "the header's Fire", true);
        await page.keyboard.press("Enter");
      };
      const row = page.locator(`[role="group"][aria-label="Fire ${hired}?"]`);
      await findFire();
      await row.waitFor({ timeout: 5_000 }).catch(() => {
        throw new Error("Fire showed no inline row asking first");
      });
      await focusBecomes(page, (f) => f.tag === "button" && f.text === "Keep", "the Fire row opened with focus off Keep");
      await page.keyboard.press("Enter");
      await row.waitFor({ state: "detached", timeout: 5_000 }).catch(() => {
        throw new Error("Keep left the Fire row open");
      });
      expect((await page.locator(`nav[aria-label="Workers"] button[data-worker="${hired}"]`).count()) === 1, `Keep took ${hired} off the roster`);
      await findFire();
      await row.waitFor({ timeout: 5_000 });
      await page.keyboard.press("Shift+Tab");
      await focusBecomes(page, (f) => f.tag === "button" && f.text === "Fire" && f.inDialog === false, "Shift+Tab from Keep is not the row's Fire");
      await page.keyboard.press("Enter");
      await page.locator(`nav[aria-label="Workers"] button[data-worker="${hired}"]`).waitFor({ state: "detached", timeout: 30_000 }).catch(() => {
        throw new Error(`firing left ${hired} on the roster`);
      });
      return "Keep kept it; Fire removed it; no browser box";
    });
  } finally {
    await context.close();
    stopProcessGroup(lab.child);
  }
}

// ---- leg c: Shift Manager's Jump to ----------------------------------------------

/** The sidebar's screens, by the name Jump to and the sidebar show, and the path each opens. */
const SCREENS: Array<[string, string]> = [
  ["Shift Coordinator", "/shift-coordinator"],
  ["Inbox", "/inbox"],
  ["Tasks", "/tasks"],
  ["Roster", "/roster"],
  ["Messages", "/messages"],
  ["Scheduled work", "/schedules"],
  ["Usage", "/usage"],
  ["Settings", "/settings"],
];

async function legC(browser: Browser, pages: string) {
  const served = await startShiftManager({ scratch: SCRATCH, label: "devteam", config: DEVTEAM_CONFIG, pages, env: { DEVTEAM_STORE: join(SCRATCH, "c", "devteam.sqlite") }, timeoutMs: 180_000 });
  try {
    // What the run creates, through the Lab's routes as its owner: a project, a workstream in it, a task on its board.
    const roster = await readDeclaredRoster(LAB_TREE);
    const em = roster.workers.find((w) => w.declared.flow === EM_FLOW);
    if (em === undefined) throw new Error("setup: the DevTeam tree declares no EM");
    const coder = ((em.declared.delegates as string[] | undefined) ?? []).find((id) => roster.workers.find((w) => w.id === id)?.declared.flow === CODER_FLOW);
    if (coder === undefined) throw new Error("setup: the EM names no coder delegate");
    const coderTeam = parseDeclaredWorkerId(coder)?.team;
    const api = labRoutes(served.origin, LAB_USERS.owner);
    const projects = await api.call("POST", `/${PROJECTS_FLOW}/sessions`, { userId: LAB_USERS.owner.userId });
    const projectsSession = String(projects.body?.session?.id);
    const project = { id: "keys-orchard", title: "Keys Orchard" };
    const made = await api.act(PROJECTS_FLOW, projectsSession, "createProject", { ...project, brief: "A project the keyboard goal opens.", visibility: "private" });
    if (made.status !== "completed") throw new Error(`setup: createProject ended ${made.status} ${made.error ?? ""}`);
    const workstream = { id: "lantern", title: "Lantern Sweep" };
    const ws = await api.act(PROJECTS_FLOW, projectsSession, "openWorkstream", { project: { visibility: "private", id: project.id }, ...workstream, lead: em.id });
    if (ws.status !== "completed") throw new Error(`setup: openWorkstream ended ${ws.status} ${ws.error ?? ""}`);
    const wsSession = (await api.get(`/sessions?userId=${encodeURIComponent(LAB_USERS.owner.userId)}&include=dispatch-runs&flowKind=${EM_FLOW}&state.workstreamId=${encodeURIComponent(`private/${project.id}/${workstream.id}`)}`)).sessions?.[0]?.id;
    if (typeof wsSession !== "string") throw new Error("setup: the workstream made no session");
    const filed = await api.act(EM_FLOW, wsSession, "file", { issue: "keys-quartz", goal: "Write the quartz page" });
    const task = (filed.output as { taskId?: unknown } | undefined)?.taskId;
    if (filed.status !== "completed" || typeof task !== "string") throw new Error(`setup: filing the task ended ${filed.status} ${filed.error ?? JSON.stringify(filed.output)}`);

    const { context, page, errors } = await personPage(browser, served.origin, LAB_USERS.owner, true);
    try {
      refuseDialogs(page, "c");
      await openShiftManager(page, served.origin, "/inbox");
      const sidebarEntry = page.getByTestId("nav-shift-coordinator");
      const at = () => page.evaluate(() => `${location.pathname}${location.search}`);
      const jump = async (query: string) => {
        await sidebarEntry.focus();
        await palette(page, query);
        await page.keyboard.press("Enter");
        await until(page, () => document.querySelector('[data-testid="jump-dialog"]') === null, `Enter on "${query}" left the palette open`, 5_000).catch(async (error: Error) => {
          // Closed again, so the next step starts from the page, not from this one's leftover palette.
          await page.keyboard.press("Escape");
          throw error;
        });
      };

      await step("c1", async () => {
        await sidebarEntry.focus();
        await page.keyboard.press("ControlOrMeta+k");
        const input = page.getByTestId("jump-input");
        await input.waitFor({ timeout: 5_000 });
        expect((await input.getAttribute("role")) === "combobox", `Jump to's input has role "${await input.getAttribute("role")}", not combobox`);
        await page.waitForTimeout(300);
        const before = await input.getAttribute("aria-activedescendant");
        await page.keyboard.press("ArrowDown");
        await page.waitForTimeout(150);
        const after = await input.getAttribute("aria-activedescendant");
        expect(after !== null && before !== after, `↓ moved aria-activedescendant from ${before} to ${after}`);
        await page.keyboard.press("Escape");
        await until(page, () => document.querySelector('[data-testid="jump-dialog"]') === null, "Esc left the palette open", 5_000);
      });

      await step("c2", async () => {
        const wrong: string[] = [];
        for (const [name, path] of SCREENS) {
          await jump(name).catch((e: Error) => wrong.push(e.message));
          await page.waitForTimeout(200);
          const now = await at();
          if (now !== path) wrong.push(`"${name}" opened ${now}, not ${path}`);
        }
        expect(wrong.length === 0, wrong.join("; "));
        return `${SCREENS.length} screens by name`;
      });

      await step("c3", async () => {
        await jump(project.title);
        const want = `/p/private/${project.id}/stream`;
        await page.waitForTimeout(200);
        expect((await at()) === want, `"${project.title}" opened ${await at()}, not ${want}`);
      });

      await step("c4", async () => {
        await jump(workstream.title);
        await page.waitForTimeout(200);
        const now = await at();
        expect(now.startsWith(`/p/private/${project.id}/workstreams`) && now.includes(`ws=${workstream.id}`), `"${workstream.title}" opened ${now}, not ${project.id}'s ${workstream.id} workstream`);
      });

      await step("c5", async () => {
        await jump(coder);
        await page.waitForTimeout(200);
        const want = `/roster?team=${encodeURIComponent(coderTeam ?? "")}`;
        expect((await at()) === want, `"${coder}" opened ${await at()}, not ${want}`);
        const f = await focusBecomes(page, (x) => x.workerId === coder, `${coder}'s roster row is not focused`);
        expect(f.inView, `${coder}'s row has focus but is out of view`);
        return `${coder} (read from the tree) opened ${want} with its row focused`;
      });

      await step("c6", async () => {
        // A conversation's board is `<session>.tasks`: the workstream session's, where the EM's door filed it.
        const boardRef = `${wsSession}.tasks`;
        await jump(boardRef);
        await page.waitForTimeout(200);
        const now = await at();
        const want = `/tasks/${encodeURIComponent(boardRef)}/${encodeURIComponent(task)}/`;
        expect(now.startsWith(want), `board ref "${boardRef}" opened ${now}, not ${want}…`);
        return `board ref ${boardRef} opened task ${task}`;
      });

      await step("c7", async () => {
        await sidebarEntry.focus();
        await page.keyboard.press("ControlOrMeta+k");
        await page.getByTestId("jump-input").waitFor({ timeout: 5_000 });
        const visited = new Set<string>();
        const out: string[] = [];
        for (const key of [...Array(8).fill("Tab"), ...Array(8).fill("Shift+Tab")] as string[]) {
          await page.keyboard.press(key);
          const f = await focused(page);
          visited.add(`${f.tag}:${f.text}`);
          if (!f.inJump) out.push(`${key} left the palette for ${describe(f)}`);
        }
        // Closed from its own input, so c8 starts from the page even when Tab got out.
        await page.getByTestId("jump-input").focus().catch(() => undefined);
        await page.keyboard.press("Escape");
        await page.waitForTimeout(200);
        expect(out.length === 0, out.slice(0, 2).join("; "));
        // The palette's one Tab stop is its input (results are reached by the arrows), so Tab staying put is the trap working.
        return `16 presses, focus on ${[...visited].join(", ")}, never outside`;
      });

      await step("c8", async () => {
        await page.waitForFunction(() => document.querySelector('[data-testid="jump-dialog"]') === null, undefined, { timeout: 3_000 }).catch(() => undefined);
        await sidebarEntry.focus();
        await page.keyboard.press("ControlOrMeta+k");
        await page.getByTestId("jump-input").waitFor({ timeout: 5_000 });
        await page.keyboard.press("Escape");
        await until(page, () => document.querySelector('[data-testid="jump-dialog"]') === null, "Esc left the palette open", 5_000);
        await focusBecomes(page, (f) => f.tag === "button" && f.text.includes("Shift Coordinator"), "after Esc focus is not back on the sidebar's Shift Coordinator", 3_000);
      });
      if (errors.length > 0) say(`page errors: ${errors.join(" | ").slice(0, 400)}`);
    } finally {
      await context.close();
    }
  } finally {
    await served.stop();
  }
}

// ---- the run -----------------------------------------------------------------------

await runGoal(async (failures) => {
  say(`scratch ${SCRATCH}${CONTROL === "" ? "" : `; control ${CONTROL}`}`);
  const diff: string[] = [];
  const cc = buildLabCopy(CLAUDE_CODE_STYLE, "claude-code-style", patchesFor("claude-code-style"));
  const tm = buildLabCopy(TEAMMATES, "teammates", patchesFor("teammates"));
  const sm = await buildShiftManagerCopy(SCRATCH, "shift-manager", patchesFor("shift-manager"));
  restoreNodeEnv();
  diff.push(...cc.diff, ...tm.diff, ...sm.diff.map((d) => `shift-manager ${d}`));
  if (diff.length > 0) say(`patched:\n  ${diff.join("\n  ")}`);
  const browser = await launchChromium();
  try {
    for (const [leg, run] of [["a", () => legA(browser, cc.pages)], ["b", () => legB(browser, tm.pages)], ["c", () => legC(browser, sm.pages)]] as const) {
      try {
        await run();
      } catch (error) {
        failures.push(`leg ${leg} setup: ${(error as Error).message.slice(0, 600)}`);
      }
    }
  } finally {
    await browser.close();
  }

  const lines = (Object.keys(STEPS) as StepId[]).map((id) => {
    const notes = record.get(id) ?? ["FAIL never ran"];
    return { id, red: notes.some((n) => n.startsWith("FAIL")), line: `${id} ${notes.join(" / ")}` };
  });
  const expected = new Set(CONTROLS[CONTROL]?.fails ?? []);
  for (const l of lines) {
    if (l.red && expected.has(l.id)) failures.push(`(expected under ${CONTROL}) ${l.line}`);
    else if (l.red) failures.push(`${CONTROL === "" ? "" : "WRONG: "}${l.line}`);
    else if (expected.has(l.id)) failures.push(`WRONG: ${l.id} stayed green under ${CONTROL}: ${l.line}`);
  }
  return { failures, evidence: [...lines.map((l) => l.line), ...(diff.length > 0 ? ["patched:", ...diff] : [])].join("\n") };
});
