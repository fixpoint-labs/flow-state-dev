/**
 * Goal check: the closure of epic FIX-1870 (FIX-1887). On one `main` commit,
 * with every other child merged, the hand-off checks pass as they did before
 * with workers that can use only `dispatchTask`, their diff since the epic
 * began is names only, and the retired tools and the delivery ledger are gone
 * from the public surface. See goal.md.
 *
 * A thin runner over checks it does not own, plus two scripts of its own
 * (`rename-map.mjs`, `surface-sweep.mjs`), shaped like FIX-1820's closure
 * runner (`goals/hand-offs/survives-a-restart-and-runs-once/run.mts`):
 *
 * - P1.m, P1.s: the two scripts, first, since they need no model.
 * - P1.r: FIX-1820's closure runner, composed whole.
 * - P1.k: FIX-1610's check, plain and under each control its goal.md lists.
 * - P1.c: the controls of FIX-1791's and FIX-1794's checks P1.r runs plain.
 * - P3.a to P3.c: each child's own check, plain and under its controls.
 *
 * It refuses a dirty tree, records `HEAD`, re-checks both before each check,
 * and runs each check as its own process with its own `GOAL_CONTROL`, one
 * after another. A script passes on its documented exit code; a plain check
 * on exit 0; a control only when the tags its FAIL verdict lists are exactly
 * the tags it must fail plus the co-failures its check documents (CR-7). A
 * check that cannot start (blocked) stops the run. It writes nothing to any
 * store, and each check's full output is kept in a log file it names.
 *
 * Run:   pnpm tsx goals/dispatching-work/runs-on-dispatch-task-alone/run.mts
 * Parts: GOAL_PARTS=P1.m,P1.s,P1.r,P1.k,P1.c,P3.a,P3.b,P3.c (default: all, in that order)
 */
import { execFileSync, spawn } from "node:child_process";
import { createWriteStream, mkdirSync } from "node:fs";
import { join } from "node:path";
import { REPO_ROOT, RUN_STAMP, goalTmpDir, runGoal } from "../../lib/index.mts";

const HERE = "goals/dispatching-work/runs-on-dispatch-task-alone";

/** One check, run as its own process. */
interface Check {
  part: string;
  /** What runs it: a node script, a tsx goal, or a package's vitest. */
  bin: "node" | "tsx" | "pnpm";
  args: string[];
  cwd?: string;
  /** Set to a value, or `null` to remove it from the child's environment. */
  env?: Record<string, string | null>;
  /** A script graded on its exit code alone. */
  exit?: number;
  control?: string;
  /** A control's must-fail tags, by name. */
  mustFail?: string[];
  /** The co-failures its check documents: the red set must equal `mustFail` ∪ `alsoRed`. */
  alsoRed?: string[];
}

const git = (...args: string[]) => execFileSync("git", args, { cwd: REPO_ROOT, encoding: "utf8" }).trim();

/** The control commit: the first parent of the merge of FIX-1875's first PR (CR-9). */
function controlCommit(): string {
  const merges = git("log", "--first-parent", "--merges", "--format=%H%x09%B%x00", "HEAD").split("\0");
  const first = merges
    .map((m) => m.trim())
    .filter((m) => /FIX-1875 P1\b/.test(m))
    .at(-1);
  if (first === undefined) throw new Error("no merge of FIX-1875's first PR under HEAD, so there is no control commit");
  return git("rev-parse", `${first.split("\t")[0]}^1`);
}

const goal = (part: string, script: string, more: Partial<Check> = {}): Check => ({ part, bin: "tsx", args: [script], ...more });
const control = (part: string, script: string, name: string, mustFail: string[], alsoRed: string[], more: Partial<Check> = {}): Check => ({
  part,
  bin: "tsx",
  args: [script],
  control: name,
  mustFail,
  alsoRed,
  ...more,
});

function checks(ctrl: string): Check[] {
  const FIX_1610 = "goals/workforce-mailboxes/a-routed-post-gets-one-answer/run.mts";
  const FIX_1791 = "goals/coordinators/hands-each-post-to-its-delegates/run.mts";
  const FIX_1794 = "goals/coordinators/files-tasks-down-the-owners-chain/run.mts";
  const FIX_1875 = "goals/dispatching-work/a-recorded-task-waits-for-dispatch/run.mts";
  const FIX_1872 = "goals/coordinators/one-fence-answers-each-post-once/run.mts";
  const browsers = { PLAYWRIGHT_BROWSERS_PATH: "/opt/pw-browsers" };
  return [
    // P1.m: --sources agrees (0), --control catches every plant (2), the diff is explained (0).
    { part: "P1.m", bin: "node", args: [`${HERE}/rename-map.mjs`, "--sources"], exit: 0 },
    { part: "P1.m", bin: "node", args: [`${HERE}/rename-map.mjs`, "--control"], exit: 2 },
    { part: "P1.m", bin: "node", args: [`${HERE}/rename-map.mjs`, "--rerun-base", ctrl], exit: 0 },
    // P1.s: 0 live lines at HEAD (0), live lines at the control commit (1), every rule catches its plant (2).
    { part: "P1.s", bin: "node", args: [`${HERE}/surface-sweep.mjs`, "--assert"], exit: 0 },
    { part: "P1.s", bin: "node", args: [`${HERE}/surface-sweep.mjs`, "--assert", "--at", ctrl], exit: 1 },
    { part: "P1.s", bin: "node", args: [`${HERE}/surface-sweep.mjs`, "--control"], exit: 2 },
    // P1.r: FIX-1820's closure runner, whole; it grades its own controls on their exact red sets.
    goal("P1.r", "goals/hand-offs/survives-a-restart-and-runs-once/run.mts"),
    // P1.k: FIX-1610, its goal.md's controls. Its tags are `[leg]`; the check also grades itself.
    goal("P1.k", FIX_1610, { cwd: "goals" }),
    control("P1.k", FIX_1610, "no-route", ["one", "lands", "followup", "held", "context", "fallback"], [], { cwd: "goals" }),
    control("P1.k", FIX_1610, "no-landing", ["lands"], ["one", "followup", "context", "fallback", "everyone"], { cwd: "goals" }),
    control("P1.k", FIX_1610, "no-recent", ["followup"], [], { cwd: "goals" }),
    control("P1.k", FIX_1610, "no-context", ["context"], [], { cwd: "goals" }),
    control("P1.k", FIX_1610, "no-org", ["org"], [], { cwd: "goals" }),
    // P1.c: FIX-1791's controls (controls/patches.mts), each on the one leg it targets.
    control("P1.c", FIX_1791, "no-roster-check", ["f:bobs-worker-refused"], ["f:missing-refused", "f:tool-refused"]),
    control("P1.c", FIX_1791, "no-round-limit", ["e:four-then-none"], []),
    control("P1.c", FIX_1791, "no-delegate-read", ["d:reply-equals-list"], ["d:read-equals-list"]),
    control("P1.c", FIX_1791, "no-self-choice", ["h:hire-turn"], []),
    control("P1.c", FIX_1791, "no-floor", ["e:below-floor"], []),
    control("P1.c", FIX_1791, "turn-after-route", ["a:no-turn"], []),
    // P1.c: FIX-1794's controls.
    control("P1.c", FIX_1794, "unpartitioned", ["c:runs-its-own"], ["c:lists-its-own", "c:found-its-own", "c:drain-returns"]),
    control("P1.c", FIX_1794, "no-follow-up", ["a:one-notice", "e:one-notice"], ["e:refiled", "e:reply-names"]),
    // P3.a: FIX-1875's check and its control; leg e of files-and-splits, where a real model picks dispatchTask.
    goal("P3.a", FIX_1875),
    control("P3.a", FIX_1875, "add-starts", ["rec:not-started"], ["disp:ref-runs"]),
    goal("P3.a", "goals/workers/files-and-splits-down-the-chain/run.mts", { env: { GOAL_LEGS: "e" } }),
    // P3.b: FIX-1872's check and its control; the V9 reruns P1 does not already run.
    goal("P3.b", FIX_1872),
    control("P3.b", FIX_1872, "no-ending-dedupe", ["b:one-line"], []),
    goal("P3.b", "goals/projects/a-shared-project-has-one-owner-per-workstream/run.mts"),
    goal("P3.b", "goals/workforce-privacy/two-users-share-a-project-and-nothing-else/run.mts", { env: { ...browsers, GOAL_ONLY: "milestone" } }),
    goal("P3.b", "goals/pentest-lab/a-post-reaches-both-declared-seats/run.mts"),
    goal("P3.b", "goals/pentest-lab/a-seat-answers-from-its-own-document/run.mts"),
    // Kitchen-sink's `no-landing` control: this check runs its plain journey and every control itself, keyless.
    goal("P3.b", "goals/kitchen-sink-talk/a-person-talks-to-a-seat-a-mailbox-and-back/run.mts", { env: { ...browsers, AI_GATEWAY_API_KEY: null } }),
    // P3.c: FIX-1876's sweep (its run also runs --control) and its leg 2 scenario.
    goal("P3.c", "goals/vocabulary/one-word-per-thing/run.mts"),
    { part: "P3.c", bin: "node", args: ["goals/vocabulary/one-word-per-thing/sweep.mjs", "--control"], exit: 0 },
    {
      part: "P3.c",
      bin: "pnpm",
      args: ["--filter", "@flow-state-dev/integration-tests", "exec", "vitest", "run", "--root", ".", "src/scenarios/wait-parked-before-the-rename.test.ts"],
    },
  ];
}

const LOGS = join(goalTmpDir("runs-on-dispatch-task-alone"), "logs", RUN_STAMP);
const say = (s: string) => console.error(`[closure ${new Date().toISOString().slice(11, 19)}] ${s}`);

/** The commit every check runs on, or why there is none: a dirty tree has no one commit. */
function cleanHead(): string {
  const dirty = git("status", "--porcelain");
  if (dirty !== "") throw new Error(`the tree is dirty, so no one commit is under test:\n${dirty}`);
  return git("rev-parse", "HEAD");
}

/** Run one check as its own process; its output goes to the terminal and to its log. Read on `close`, so no output is cut short. */
function run(check: Check, log: string): Promise<{ code: number; output: string }> {
  const env: Record<string, string | undefined> = { ...process.env, GOAL_CONTROL: check.control ?? "" };
  for (const [k, v] of Object.entries(check.env ?? {})) {
    if (v === null) delete env[k];
    else env[k] = v;
  }
  const args = check.bin === "tsx" ? check.args.map((a) => join(REPO_ROOT, a)) : check.args;
  return new Promise((resolve) => {
    const file = createWriteStream(log);
    let output = "";
    const bin = check.bin === "tsx" ? join(REPO_ROOT, "node_modules", ".bin", "tsx") : check.bin;
    const child = spawn(bin, args, { cwd: join(REPO_ROOT, check.cwd ?? "."), env, stdio: ["ignore", "pipe", "pipe"] });
    const take = (chunk: Buffer) => {
      output += String(chunk);
      file.write(chunk);
      process.stderr.write(chunk);
    };
    child.stdout.on("data", take);
    child.stderr.on("data", take);
    child.on("close", (code) => file.end(() => resolve({ code: code ?? 1, output })));
  });
}

/**
 * What the last FAIL verdict in `output` lists: each failure's tag (`- b:one-line — …` or
 * FIX-1610's `- [context] …`), and every bullet that names no tag, which no control may have.
 * FIX-1610's own `[control]` bullets (a leg left green, or another reddened) are untagged here.
 */
function failedTags(output: string): { tags: string[]; untagged: string[] } {
  const at = output.lastIndexOf("FAIL —");
  if (at < 0) return { tags: [], untagged: [] };
  const bullets = [...output.slice(at).matchAll(/^ {2}- (.*)$/gm)].map((m) => m[1]!).filter((b) => !b.startsWith("control "));
  const tagOf = (b: string) => /^\[([^\]]+)\]/.exec(b)?.[1] ?? /^(\S+) —/.exec(b)?.[1];
  const tags = bullets.map(tagOf).filter((t): t is string => t !== undefined && t !== "control");
  return { tags: [...new Set(tags)], untagged: bullets.filter((b) => tagOf(b) === undefined || tagOf(b) === "control") };
}

await runGoal(async (failures) => {
  const sha = cleanHead();
  const ctrl = controlCommit();
  const parts = (process.env.GOAL_PARTS ?? "").split(",").map((p) => p.trim()).filter(Boolean);
  const list = checks(ctrl).filter((c) => parts.length === 0 || parts.includes(c.part));
  mkdirSync(LOGS, { recursive: true });
  say(`one commit for every check: ${sha}; the control commit: ${ctrl}; logs in ${LOGS}`);
  const rows: string[] = [];
  for (const [index, check] of list.entries()) {
    const shown = check.bin === "tsx" ? check.args[0]!.split("/").slice(-2).join("/") : check.args.map((a) => (a === ctrl ? ctrl.slice(0, 9) : a.split("/").at(-1))).join(" ");
    const extra = Object.entries(check.env ?? {}).filter(([k]) => k.startsWith("GOAL_")).map(([k, v]) => ` ${k}=${v}`).join("");
    const name = `${check.part} ${shown}${check.control ? ` GOAL_CONTROL=${check.control}` : ""}${extra}`;
    const now = cleanHead();
    if (now !== sha) throw new Error(`HEAD moved from ${sha} to ${now} before ${name}; the checks would not share a commit`);
    const log = join(LOGS, `${String(index + 1).padStart(2, "0")}-${check.part}${check.control ? `-${check.control}` : ""}.log`);
    say(`${sha.slice(0, 9)} · ${name} · starting`);
    const { code, output } = await run(check, log);
    if (/^\s+- blocked:/m.test(output)) {
      rows.push(`${sha.slice(0, 9)} · ${name} · BLOCKED · ${log}`);
      failures.push(`${name}: blocked, so the run stops here (${log})`);
      break;
    }
    let verdict: string;
    const failed = failedTags(output);
    if (check.exit !== undefined) {
      verdict = code === check.exit ? `exit ${code}, as it must` : `exit ${code}, wanted ${check.exit}`;
      if (code !== check.exit) failures.push(`${name}: ${verdict} — a finding (${log})`);
    } else if (check.control === undefined) {
      verdict = code === 0 ? "PASS" : `FAIL (${[...failed.tags, ...failed.untagged.map((u) => u.slice(0, 80))].join(", ")})`;
      if (code !== 0) failures.push(`${name}: FAIL — a finding (${log})`);
    } else {
      // Exact, per CR-7: the red tags equal must-fail ∪ the documented co-failures, no more and no fewer.
      const expected = new Set([...check.mustFail!, ...check.alsoRed!]);
      const missed = [...expected].filter((tag) => !failed.tags.includes(tag));
      const unexpected = [...failed.tags.filter((tag) => !expected.has(tag)), ...failed.untagged.map((u) => u.slice(0, 120))];
      const problems = [
        code === 0 ? "it passed" : "",
        missed.length > 0 ? `expected red but green: ${missed.join(", ")}` : "",
        unexpected.length > 0 ? `red outside its expected set: ${unexpected.join(", ")}` : "",
      ].filter((p) => p !== "");
      verdict =
        problems.length === 0
          ? `FAIL as it must at ${check.mustFail!.join(", ")}; red exactly its expected set: ${failed.tags.join(", ")}`
          : `control did not fail as it must: ${problems.join("; ")}`;
      if (problems.length > 0) failures.push(`${name}: ${verdict} — a finding (${log})`);
    }
    rows.push(`${sha.slice(0, 9)} · ${name} · ${verdict} · ${log}`);
    say(rows.at(-1)!);
  }
  console.error(`\nverdicts on ${sha} (control commit ${ctrl}):\n${rows.map((r) => `  ${r}`).join("\n")}`);
  return { failures, evidence: `every check on ${sha} (control commit ${ctrl}):\n${rows.map((r) => `  ${r}`).join("\n")}` };
});
