/**
 * Goal check: `pnpm shift-manager:dev` with no flags opens on FSD and Shift
 * Manager, and with no Claude credential it refuses to start, naming what to set.
 *
 * Each leg starts the checkout's own script (`packages/shift-manager/scripts/checkout.mts`)
 * with no `--config`, as `start` runs it, on pages built once into scratch
 * (`--assets`, so the script doesn't rebuild the checkout's). The only thing a
 * leg sets is the store location (a temp file), and in c it takes credentials away.
 *
 *   a  the projects a person sees: through the Lab's own routes, as the page's
 *      user, the organization's projects are exactly `fsd` and `shift-manager`,
 *      shared, naming this repository's remote, each brief naming its focus; and
 *      the user holds no private project. Needs a Claude credential (the
 *      default coder checks for one at start); spends no model.
 *   b  one item on each project, through the chief of staff, worked in a
 *      worktree of this checkout. Needs the checkout mapping, which this build
 *      does not have yet: it is reported as not built, so the goal can't pass
 *      whole until it is.
 *   c  no credential (no ANTHROPIC_API_KEY, no CLAUDE_CODE_OAUTH_TOKEN, an empty
 *      home), as `start` and as `dev` (`--dev`) run it: the process exits
 *      non-zero before it listens, and its output names `ANTHROPIC_API_KEY`
 *      and `DEVFORCE_LAB_HARNESS=stub`.
 *
 * `GOAL_LEG=a,c` runs only those legs (default: all three).
 *
 * Controls:
 *   GOAL_CONTROL=silent-stub  `harness.mts` patched, in the process under test only,
 *                             to fall back to the scripted coder when there is no
 *                             account, saying nothing. Leg c must FAIL on
 *                             `c:exit-before-listening`, in both forms.
 *
 * Run:   pnpm tsx goals/shift-manager/it-opens-on-fsd-and-shift-manager/run.mts
 */
import { spawn } from "node:child_process";
import { mkdirSync, mkdtempSync } from "node:fs";
import { join } from "node:path";
import { goalTmpDir, intentFreeEnv, modulePatchEnv, assertPatched, describePatches, runGoal, REPO_ROOT, repoPath, type ModulePatch } from "../../lib/index.mts";
import { buildShiftManagerPages, labApi, servedAddresses } from "../../lib/shift-manager.mts";

const CONTROL = process.env.GOAL_CONTROL ?? "";
const LEGS = new Set((process.env.GOAL_LEG ?? "a,b,c").split(",").map((l) => l.trim()));
const SCRATCH = goalTmpDir("it-opens-on-fsd-and-shift-manager");
const SCRIPT = repoPath("packages", "shift-manager", "scripts", "checkout.mts");
const TSX = repoPath("node_modules", ".bin", "tsx");
const REPOSITORY = "https://github.com/fixpoint-labs/flow-state-dev.git";

/** The silent-stub control: no account falls back to the scripted coder, and says nothing. */
const SILENT_STUB: ModulePatch[] = [
  {
    module: "packages/shift-manager/teams/devteam/harness.mts",
    from: 'if \\(account\\.status !== "account"\\) throw new Error\\(refusalOf\\(account\\)\\);',
    to: 'if (account.status !== "account") return selectHarness("stub", stepMs);',
  },
];

if (CONTROL !== "" && CONTROL !== "silent-stub") throw new Error(`unknown GOAL_CONTROL "${CONTROL}"; this goal knows silent-stub`);

type Started = { log: () => string; exited: Promise<number | null>; origin?: string; stop: () => Promise<void> };

/**
 * Start the checkout's script with no `--config` and wait until it serves or exits.
 * Resolves with the origin once its banner prints, or with none if it exits first.
 */
async function startScript(env: Record<string, string>, form: "start" | "dev" = "start", timeoutMs = 120_000): Promise<Started> {
  const cwd = mkdtempSync(join(SCRATCH, "cwd-"));
  const pagesArgs = form === "dev" ? ["--dev"] : ["--assets", pages!];
  const child = spawn(TSX, [SCRIPT, "--port", "0", "--no-open", ...pagesArgs], {
    cwd,
    env: { ...env, INIT_CWD: cwd },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let log = "";
  child.stdout!.on("data", (d) => (log += String(d)));
  child.stderr!.on("data", (d) => (log += String(d)));
  let code: number | null | undefined;
  const exited = new Promise<number | null>((resolve) => child.on("exit", (c) => resolve((code = c))));
  const stop = async () => {
    if (code === undefined) child.kill("SIGTERM");
    await exited;
  };
  for (const until = Date.now() + timeoutMs; Date.now() < until; await new Promise((r) => setTimeout(r, 250))) {
    const served = servedAddresses(log);
    if (served !== undefined) return { log: () => log, exited, origin: served.origin, stop };
    if (code !== undefined) return { log: () => log, exited, stop };
  }
  await stop();
  throw new Error(`the script neither served nor exited in ${timeoutMs} ms. Log tail:\n${log.slice(-2000)}`);
}

/** A fresh store and nothing else changed: the environment a leg starts the script with. */
function legEnv(name: string, extra: Record<string, string> = {}): Record<string, string> {
  const dir = join(SCRATCH, `store-${name}`);
  mkdirSync(dir, { recursive: true });
  return intentFreeEnv(process.env, { FSD_STORE: join(dir, "fsd.sqlite"), GOAL_CONTROL: "", ...extra });
}

let pages: string | undefined;

await runGoal(async (failures) => {
  const evidence: string[] = [];
  const note = (assertion: string, why: string) => failures.push(`${CONTROL === "" ? "" : `[control ${CONTROL}] `}${assertion} — ${why}`);
  if (LEGS.has("a") || LEGS.has("c")) pages = await buildShiftManagerPages(join(SCRATCH, "pages"));

  // ---- (a) the projects a person sees ------------------------------------
  if (LEGS.has("a")) {
    const started = await startScript(legEnv("a"));
    try {
      if (started.origin === undefined) {
        throw new Error(`setup: leg a needs a Claude credential (sign in, or set ANTHROPIC_API_KEY); the script exited:\n${started.log().slice(-1500)}`);
      }
      const html = await (await fetch(started.origin)).text();
      const injected = /window\.__FSD_DEVTOOL_CONFIG__ = (\{.*?\});<\/script>/.exec(html)?.[1];
      if (injected === undefined) throw new Error("setup: the page was handed no user");
      const user = JSON.parse(injected) as { userId: string; bearerToken?: string };
      const api = labApi(started.origin, user.bearerToken);
      const roster = await api.call("POST", "/workforce-roster/sessions", { userId: user.userId });
      if (roster.status !== 201) throw new Error(`setup: no roster session: ${roster.status}`);
      const sessionId = String(roster.body.session.id);
      const manifest = await api.get(`/sessions/${encodeURIComponent(sessionId)}/manifest`);
      const declared = manifest.resources as Array<{ kind: string; ref: string; pattern: string; scope?: string }>;
      const at = (scope: string) => declared.find((r) => r.kind === "collection" && r.pattern === "projects/*" && r.scope === scope)?.ref;
      const shared = at("org") === undefined ? [] : await api.collection(sessionId, at("org")!);
      const own = at("user") === undefined ? [] : await api.collection(sessionId, at("user")!);
      const ids = shared.map((p) => String(p.id)).sort();
      if (JSON.stringify(ids) !== JSON.stringify(["fsd", "shift-manager"]) || own.length > 0) {
        note("a:exactly-fsd-and-shift-manager", `the person sees shared ${JSON.stringify(ids)} and ${own.length} private`);
      }
      for (const p of shared) {
        if (p.repository !== REPOSITORY) note("a:names-this-repository", `${p.id} names ${JSON.stringify(p.repository)}`);
      }
      const brief = (id: string) => String(shared.find((p) => p.id === id)?.brief ?? "");
      if (!/packages\//.test(brief("fsd")) || /packages\/shift-manager/.test(brief("fsd"))) note("a:briefs-name-their-focus", `fsd's brief: ${brief("fsd")}`);
      if (!/packages\/shift-manager/.test(brief("shift-manager"))) note("a:briefs-name-their-focus", `shift-manager's brief: ${brief("shift-manager")}`);
      const coderLine = started.log().split("\n").find((l) => l.startsWith("Coder:"));
      if (coderLine === undefined || !coderLine.includes("Claude Code")) note("a:start-line-names-the-coder", `start line: ${coderLine ?? "none"}`);
      evidence.push(`a: shared ${ids.join(", ")} on ${REPOSITORY}, none private; "${coderLine}"`);
    } finally {
      await started.stop();
    }
  }

  // ---- (b) one item on each project, in a worktree of this checkout -------
  if (LEGS.has("b")) {
    note("b:not-built", "this build has no checkout mapping for the two projects, so an item on either is refused, not worked in this checkout");
  }

  // ---- (c) no credential: refused before it listens, as `start` and as `dev` --
  if (LEGS.has("c")) {
    for (const form of ["start", "dev"] as const) {
      const home = mkdtempSync(join(SCRATCH, "empty-home-"));
      const mark = join(SCRATCH, `silent-stub-${form}.mark`);
      const env = legEnv(`c-${form}`, { HOME: home, ...(CONTROL === "silent-stub" ? modulePatchEnv(SILENT_STUB, REPO_ROOT, mark) : {}) });
      delete env.ANTHROPIC_API_KEY;
      delete env.CLAUDE_CODE_OAUTH_TOKEN;
      if (CONTROL === "silent-stub" && form === "start") console.error(describePatches(SILENT_STUB, REPO_ROOT));
      const started = await startScript(env, form);
      const code = started.origin === undefined ? await started.exited : undefined;
      await started.stop();
      if (CONTROL === "silent-stub") assertPatched(SILENT_STUB, REPO_ROOT, mark);
      const log = started.log();
      if (started.origin !== undefined || code === 0) {
        note(`c:exit-before-listening (${form})`, started.origin !== undefined ? `it listened at ${started.origin}` : "it exited 0");
      }
      const missing = ["ANTHROPIC_API_KEY", "DEVFORCE_LAB_HARNESS=stub"].filter((v) => !log.includes(v));
      if (missing.length > 0) note(`c:names-the-variable (${form})`, `the output does not name ${missing.join(" or ")}`);
      const said = log.split("\n").find((l) => l.includes("ANTHROPIC_API_KEY")) ?? "";
      evidence.push(`c (${form}): exited ${code} before listening: ${said.trim().slice(0, 200)}`);
    }
  }

  return { failures, evidence: evidence.join(" · ") };
});
