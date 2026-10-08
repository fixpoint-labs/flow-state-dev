/**
 * The install a run grades: Shift Manager's DevTeam profile from one commit,
 * served by its own command over a store the run owns, with each person's
 * shipped clients and a browser context per person.
 *
 * - {@link checkoutFor}: the commit under test. By default the checkout this
 *   goal runs from; with `GOAL_COMMIT=<sha>`, a detached worktree of that
 *   commit, installed on its own, so the milestone reruns on a fix's merge
 *   commit (QR-15) without merging anything into it.
 * - {@link Install}: one store, booted and restarted, the people connected to
 *   whatever is serving it, and the screens they read.
 */
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import type { Browser, Page } from "playwright";
import { REPO_ROOT } from "../../lib/index.mts";
import { openShiftManager, personPage, startShiftManager, type ServedShiftManager } from "../../lib/shift-manager.mts";
import { connect, type Connected, type Person, type Shipped } from "./people.mts";
import { messageOf, type RunRecord } from "./record.mts";

const git = (...args: string[]) => execFileSync("git", ["-C", REPO_ROOT, ...args], { encoding: "utf8" }).trim();

/** The commit a run serves, and where its tree is. */
export interface Checkout {
  root: string;
  /** The tsx that runs this checkout's Shift Manager command. */
  tsx: string;
  commit: string;
  /** How the report describes where the tree came from. */
  describe: string;
  remove(): void;
}

/**
 * The commit under test. Unset: this checkout's `HEAD`, with the files it
 * changes outside `goals/` named (none, when it is `main` plus this goal). Set:
 * a worktree of that commit under `scratch`, installed offline from the store.
 */
export function checkoutFor(commit: string | undefined, scratch: string): Checkout {
  if (commit === undefined || commit === "") {
    const head = git("rev-parse", "HEAD");
    const base = git("merge-base", "HEAD", "origin/main");
    const served = git("diff", "--name-only", base, "HEAD", "--", ".", ":(exclude)goals").split("\n").filter(Boolean);
    return {
      root: REPO_ROOT,
      tsx: join(REPO_ROOT, "node_modules", ".bin", "tsx"),
      commit: head,
      describe: `this checkout's HEAD \`${head}\`, on \`origin/main\` \`${base}\`; outside \`goals/\` it changes ${served.length === 0 ? "nothing" : served.join(", ")}`,
      remove: () => undefined,
    };
  }
  const sha = git("rev-parse", `${commit}^{commit}`);
  const root = join(scratch, `checkout-${sha.slice(0, 12)}`);
  if (!existsSync(root)) git("worktree", "add", "--detach", root, sha);
  const install = spawnSync("pnpm", ["install", "--frozen-lockfile", "--prefer-offline"], { cwd: root, encoding: "utf8", timeout: 900_000 });
  if (install.status !== 0) throw new Error(`setup: ${sha} did not install: ${(install.stdout + install.stderr).slice(-1500)}`);
  return {
    root,
    tsx: join(root, "node_modules", ".bin", "tsx"),
    commit: sha,
    describe: `\`${sha}\` (GOAL_COMMIT=${commit}), its own worktree and install`,
    remove: () => {
      spawnSync("git", ["-C", REPO_ROOT, "worktree", "remove", "--force", root], { encoding: "utf8" });
    },
  };
}

/** What a served install's screen drew for one person. */
export interface Drawn {
  /** The page's visible text and every `data-*-id` attribute on it. */
  text: string;
  /** How many worker rows the Roster drew. */
  rows: number;
  errors: string[];
}

/** One store, the install serving it, and the people using it. */
export class Install {
  served: ServedShiftManager | undefined;
  constructor(
    readonly browser: Browser,
    readonly shipped: Shipped,
    readonly checkout: Checkout,
    readonly opts: { pages: string; scratch: string; store: string; record: RunRecord; env?: Record<string, string> },
  ) {}

  get origin(): string {
    if (this.served === undefined) throw new Error("the install is not serving");
    return this.served.origin;
  }

  /** Start (or restart, on the same store) the install from `config`. */
  async boot(label: string, config: string, env: Record<string, string> = {}): Promise<void> {
    const started = Date.now();
    this.served = await startShiftManager({
      scratch: this.opts.scratch,
      label: label.replace(/\W+/g, "-"),
      config,
      pages: this.opts.pages,
      env: { DEVTEAM_STORE: this.opts.store, ...(this.opts.env ?? {}), ...env },
      root: join(this.checkout.root, "packages", "shift-manager"),
      tsx: this.checkout.tsx,
      timeoutMs: 180_000,
    });
    this.opts.record.boots.push({ label, config: config.slice(this.checkout.root.length + 1), ms: Date.now() - started });
  }

  async stop(): Promise<void> {
    await this.served?.stop();
    this.served = undefined;
  }

  /** `person`, connected to what is serving now. */
  as(person: Person): Connected {
    return connect(this.shipped, this.origin, person);
  }

  /**
   * Open `path` in a browser context as `person`, and read what it drew.
   * `owner` leaves the page as served (it names the Lab's owner, with the
   * shipped bearer); anyone else gets their own user id and bearer.
   */
  async screen(step: string, person: Person, owner: boolean, path: string, shot: string): Promise<Drawn> {
    const opened = await personPage(this.browser, this.origin, { userId: person.userId, bearer: person.bearer }, owner);
    try {
      await openShiftManager(opened.page, this.origin, path);
      await opened.page.locator("[data-testid=roster-worker]").first().waitFor({ timeout: 15_000 }).catch(() => undefined);
      const drawn = await readDrawn(opened.page);
      await this.opts.record.shot(opened.page, `${step}-${shot}`);
      return { ...drawn, errors: opened.errors };
    } catch (error) {
      return { text: "", rows: 0, errors: [...opened.errors, messageOf(error)] };
    } finally {
      await opened.context.close().catch(() => undefined);
    }
  }
}

async function readDrawn(page: Page): Promise<{ text: string; rows: number }> {
  return page.evaluate(() => {
    const ids = [...document.querySelectorAll("*")].flatMap((el) =>
      [...el.attributes].filter((a) => a.name.startsWith("data-") && a.name.endsWith("-id")).map((a) => a.value),
    );
    return { text: `${document.body.innerText}\n${ids.join("\n")}`, rows: document.querySelectorAll("[data-testid=roster-worker]").length };
  });
}

/**
 * Where one run of steps keeps its store: a directory of its own, since the
 * DevTeam install keeps Storefront's repository beside its store file.
 */
export function storesDir(scratch: string, label: string): string {
  const dir = join(scratch, "stores", label);
  mkdirSync(dir, { recursive: true });
  return dir;
}
