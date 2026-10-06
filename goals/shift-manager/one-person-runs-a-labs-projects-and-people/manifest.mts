/**
 * Part 3's manifest (S4): every child's check on its green path, each as its
 * own subprocess, with the controls this run still owes it. A control part 1
 * already failed on this commit stands for the child's "control must fail" and
 * is not run again (the closure rule, item 3).
 *
 * A control here passes only when its run exits 1 with a `FAIL —` list that
 * names the assertions its goal.md says it must fail ({@link EXPECTED}), and,
 * where that goal says "only", nothing else. A timeout, a crash, or a red at
 * some other assertion is not the control going red; one that exits 0 never
 * went red. Both are findings like any other.
 */
import { spawn, spawnSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { REPO_ROOT } from "../../lib/index.mts";

export interface Entry {
  id: string;
  path: string;
  /** Controls still run here. `"own"`: every control the goal names. */
  controls: string[] | "own";
  /** Covered by part 1, and not run again. */
  covered?: string;
  /** Extra environment for a control run (a model-free leg, say). */
  controlEnv?: Record<string, string>;
}

/** Every check that boots the DevTeam tree, other than the closure's own and the three named above. */
function devteamBooters(): string[] {
  const named = new Set([
    "goals/hire-plane/repairs-a-seat-whose-kind-was-cut",
    "goals/org-seats/cos-changes-the-roster",
    "goals/shift-manager/it-groups-workstreams-under-their-projects",
    "goals/shift-manager/one-person-runs-a-labs-projects-and-people",
    // FIX-1737's closure goal: another epic's, matched only by naming devteam, and its part 3 reruns checks listed here.
    "goals/shift-manager/a-lab-is-worked-through-one-skinned-shell",
  ]);
  const out: string[] = [];
  for (const describe of ["devforce-lab", "hire-plane", "shift-manager"]) {
    for (const it of readdirSync(join(REPO_ROOT, "goals", describe)).sort()) {
      const path = `goals/${describe}/${it}`;
      const run = join(REPO_ROOT, path, "run.mts");
      if (named.has(path) || !existsSync(run)) continue;
      // shift-manager checks count only when they serve the DevTeam profile.
      if (describe === "shift-manager" && !/devteam/.test(readFileSync(run, "utf8"))) continue;
      out.push(path);
    }
  }
  return out;
}

/**
 * What each child control must fail, by name, as its own goal.md declares it:
 * every pattern in `legs` must match one of the child's `FAIL —` bullets, and
 * where the goal says the control fails there "only" (or "nowhere else"),
 * every bullet must match `only`. A control with no entry here is a finding:
 * a new one must be added with the assertion it names.
 */
type Expect = { legs: RegExp[]; only?: RegExp };
const EXPECTED: Record<string, Record<string, Expect>> = {
  // "Must FAIL `team-list:retired-row-gone` only."
  "goals/hire-plane/repairs-a-seat-whose-kind-was-cut": {
    "fire-keeps-inventory": { legs: [/^\[team-list:retired-row-gone\]/], only: /^\[team-list:retired-row-gone\]/ },
  },
  // "**discover** only: ... every later leg stays green"
  "goals/org-seats/cos-changes-the-roster": {
    "drop-member-from-discover": { legs: [/^\[control drop-member-from-discover\] discover:/], only: /^\[control drop-member-from-discover\] discover:/ },
  },
  "goals/shift-manager/it-groups-workstreams-under-their-projects": {
    unread: { legs: [/^\[control unread\] PROJECTS equals the store's rows:/] },
    "gap-tabs": { legs: [/^\[control gap-tabs\] a project's four tabs:/] },
    "no-gate": { legs: [/^\[control no-gate\] the outsider is refused:/] },
    "no-retry": { legs: [/^\[control no-retry\] a burst of joins leaves one session per member:/, /^\[control no-retry\] a burst of posts lands whole:/] },
  },
  // "must FAIL on leg 2, *the mailbox's board returned no rows* (legs 3, 4 and 5 go red with it)"
  "goals/devforce-lab/it-keeps-its-rows-on-the-mailboxes-board": {
    "kind-ledger": { legs: [/^\[control kind-ledger\] the mailbox's board returned no rows/] },
  },
  // leg 1, "a row existed before any approval" (and legs 3 and 4c)
  "goals/devforce-lab/it-waits-for-a-person-before-it-files": {
    "no-gate": { legs: [/^leg 1: a row existed before any approval/] },
  },
  "goals/devforce-lab/it-wakes-the-seat-a-file-declared": {
    // "the dispatch record names the seat that must never be reached" (its goal.md)
    "address-the-reviewer": { legs: [/^\[control address-the-reviewer\] the drain dispatched to \[[^\]]*"eng\.reviewer"/] },
    // the row does not settle done
    "no-commit": { legs: [/^\[control no-commit\] the row settled "[^"]+" after a run that finished cleanly; wanted "completed"/] },
    "stopped-at-limit": { legs: [/^\[control stopped-at-limit\] the row settled "[^"]+" .*wanted "completed" — the run stopped at its limit/] },
    // its own brief's token cannot reach the prompt
    "swap-documents": { legs: [/^\[control swap-documents\] the prompt does not carry FEATURE-BRIEF-/] },
    // set equality, and the skill's token in the prompt
    "drop-own-skill": { legs: [/^\[control drop-own-skill\] eng\.coder: holds skills .*wanted exactly/, /^\[control drop-own-skill\] the prompt does not carry BRANCH-NAMING-/] },
  },
  // Each "and nowhere else": the child prints the legs it failed, and every bullet is one of them.
  "goals/shift-manager/it-draws-v2s-look": {
    drift: { legs: [/^\[control drift\] legs failing: surface, type$/], only: /^\[control drift\] (legs failing: surface, type$|surface |type )/ },
    unclassified: { legs: [/^\[control unclassified\] legs failing: totality$/, /^\[control unclassified\] totality .*"A line no row covers"/], only: /^\[control unclassified\] (legs failing: totality$|totality )/ },
    missing: { legs: [/^\[control missing\] legs failing: totality$/, /^\[control missing\] totality .*Tasks ID: 0 element\(s\) match, 1 expected/], only: /^\[control missing\] (legs failing: totality$|totality )/ },
  },
  "goals/shift-manager/it-hands-a-run-the-work-it-approved": {
    "drop-task": {
      legs: [
        /^leg a1: \[control drop-task\] the prompt does not carry the approved goal/,
        /^leg a2: \[control drop-task\] the prompt does not carry the posted goal/,
        /^leg a3: \[control drop-task\] the prompt does not carry the approved goal/,
        /^leg b: \[control drop-task\] the commit does not carry the goal's token/,
      ],
    },
  },
  "goals/shift-manager/it-opens-a-lab": {
    "static-names": { legs: [/^\[control static-names\] \[multi-seat-collab\] TEAMS equals the store's seats: missing \[[^\]]+\]/] },
    "optimistic-post": { legs: [/^\[control optimistic-post\] \[devteam\] the post is in the stored transcript:/, /^\[control optimistic-post\] \[multi-seat-collab\] the post is in the stored transcript:/] },
    "queued-shown": { legs: [/^\[control queued-shown\] \[devteam\] Tasks equals the store's open rows: .*extra \[[^\]]+\]/, /^\[control queued-shown\] \[devteam\] Tasks equals the store's open rows: the Queued toggle says/] },
    "unanswerable-asks": { legs: [/^\[control unanswerable-asks\] \[devteam\] an answer from the Stream lands in the store:/] },
  },
  "goals/shift-manager/it-sends-a-turn-into-a-seat-session": {
    "optimistic-turn": { legs: [/^\[control optimistic-turn\] \[[^\]]+\] delivered:/] },
    "fresh-session": { legs: [/^\[control fresh-session\] \[[^\]]+\] continued: .*resume id/] },
  },
};

/** The bullets of a run's `FAIL —` list (runGoal's format), or `undefined` when it printed none. */
export function failBullets(out: string): string[] | undefined {
  const at = out.lastIndexOf("FAIL —\n");
  if (at < 0) return undefined;
  return out
    .slice(at + "FAIL —\n".length)
    .split(/\n {2}- /)
    .map((b, i) => (i === 0 ? b.replace(/^ {2}- /, "") : b).trim())
    .filter((b) => b.length > 0);
}

/** Whether a control's run went red where its goal says it must, and why not when it didn't. */
export function gradeControl(path: string, control: string, exit: number | null, out: string): { ok: boolean; why: string } {
  const want = EXPECTED[path]?.[control];
  if (want === undefined) return { ok: false, why: `no expected assertion is declared for ${control} (add it to EXPECTED from the goal's Controls)` };
  if (exit !== 1) return { ok: false, why: `exited ${exit === null ? "by signal (timeout?)" : exit}, not 1 with a FAIL list` };
  const bullets = failBullets(out);
  if (bullets === undefined) return { ok: false, why: "printed no FAIL — list" };
  const missing = want.legs.filter((re) => !bullets.some((b) => re.test(b)));
  const stray = want.only === undefined ? [] : bullets.filter((b) => !want.only!.test(b));
  if (missing.length === 0 && stray.length === 0) return { ok: true, why: "" };
  return {
    ok: false,
    why: [missing.length > 0 ? `never failed ${missing.map((m) => m.source).join(" and ")}` : "", stray.length > 0 ? `also failed: ${stray.map((b) => b.slice(0, 160)).join(" | ")}` : ""].filter(Boolean).join("; "),
  };
}

export function manifest(): Entry[] {
  return [
    { id: "P3.1", path: "goals/hire-plane/repairs-a-seat-whose-kind-was-cut", controls: ["fire-keeps-inventory"] },
    { id: "P3.2", path: "goals/org-seats/cos-changes-the-roster", controls: ["drop-member-from-discover"], covered: "deny-fire (b3)" },
    {
      id: "P3.3",
      path: "goals/shift-manager/it-groups-workstreams-under-their-projects",
      controls: ["unread", "gap-tabs", "no-gate", "no-retry"],
      covered: "no-tool (a1)",
      controlEnv: { GOAL_LEG: "model-free" },
    },
    ...devteamBooters().map((path) => ({ id: "P3.4", path, controls: "own" as const })),
  ];
}

/** The controls a goal names: in its goal.md, and in what `GOAL_CONTROL=list` prints when it takes it. */
export function ownControls(path: string): string[] {
  const names = new Set<string>();
  const doc = readFileSync(join(REPO_ROOT, path, "goal.md"), "utf8").split("## Verdict log")[0]!;
  for (const m of doc.matchAll(/GOAL_CONTROL=([a-z0-9][a-z0-9-]*)/g)) if (m[1] !== "list") names.add(m[1]!);
  if (/GOAL_CONTROL=list/.test(doc)) {
    const listed = spawnSync(join(REPO_ROOT, "node_modules", ".bin", "tsx"), [join(REPO_ROOT, path, "run.mts")], {
      cwd: REPO_ROOT,
      env: { ...process.env, GOAL_CONTROL: "list" },
      encoding: "utf8",
      timeout: 120_000,
    });
    const line = /controls?:\s*(.+)/i.exec(`${listed.stdout}\n${listed.stderr}`)?.[1] ?? "";
    for (const n of line.split(/[,\s]+/)) if (/^[a-z0-9][a-z0-9-]*$/.test(n)) names.add(n);
  }
  return [...names].sort();
}

export interface RunResult {
  id: string;
  path: string;
  control: string | null;
  exit: number | null;
  ms: number;
  verdict: "PASS" | "FAIL" | "FAIL (expected)" | "FAIL (not at its named assertion)" | "PASS (control NOT red)" | "BLOCKED";
  tail: string;
  log: string;
}

/** Run one goal (or one of its controls) to its end. */
function runOne(entry: Entry, control: string | null, logDir: string, env: Record<string, string>): Promise<RunResult> {
  const started = Date.now();
  const log = join(logDir, `${entry.path.replaceAll("/", "__")}${control === null ? "" : `--${control}`}.log`);
  return new Promise((resolve) => {
    let out = "";
    const child = spawn(join(REPO_ROOT, "node_modules", ".bin", "tsx"), [join(REPO_ROOT, entry.path, "run.mts")], {
      cwd: REPO_ROOT,
      env: { ...process.env, ...env, ...(control === null ? { GOAL_CONTROL: "" } : { GOAL_CONTROL: control, ...(entry.controlEnv ?? {}) }) },
      stdio: ["ignore", "pipe", "pipe"],
      detached: true,
    });
    child.stdout!.on("data", (d) => (out += String(d)));
    child.stderr!.on("data", (d) => (out += String(d)));
    const timer = setTimeout(() => {
      try {
        process.kill(-child.pid!, "SIGKILL");
      } catch {
        /* gone */
      }
    }, 45 * 60_000);
    child.on("exit", (code) => {
      clearTimeout(timer);
      writeFileSync(log, out);
      const verdictLine = out.split("\n").filter((l) => /^(PASS|FAIL) —/.test(l) || /^\s+- /.test(l)).join("\n");
      const blocked = /precondition|not signed in|no credential|ANTHROPIC_API_KEY|authentication/i.test(verdictLine) && code !== 0;
      const graded = control === null || code === 0 || blocked ? undefined : gradeControl(entry.path, control, code, out);
      const verdict: RunResult["verdict"] =
        control === null
          ? code === 0
            ? "PASS"
            : blocked
              ? "BLOCKED"
              : "FAIL"
          : code === 0
            ? "PASS (control NOT red)"
            : blocked
              ? "BLOCKED"
              : graded!.ok
                ? "FAIL (expected)"
                : "FAIL (not at its named assertion)";
      const tail = `${graded !== undefined && !graded.ok ? `${graded.why}\n` : ""}${verdictLine || out.slice(-800)}`;
      resolve({ id: entry.id, path: entry.path, control, exit: code, ms: Date.now() - started, verdict, tail: tail.slice(0, 1500), log });
    });
  });
}

/** Run the whole manifest, `parallel` at a time. */
export async function runManifest(entries: Entry[], logDir: string, env: Record<string, string>, parallel = 3): Promise<RunResult[]> {
  const jobs: Array<{ entry: Entry; control: string | null }> = [];
  for (const entry of entries) {
    jobs.push({ entry, control: null });
    for (const control of entry.controls === "own" ? ownControls(entry.path) : entry.controls) jobs.push({ entry, control });
  }
  const results: RunResult[] = [];
  let next = 0;
  await Promise.all(
    Array.from({ length: parallel }, async () => {
      while (next < jobs.length) {
        const job = jobs[next++]!;
        const result = await runOne(job.entry, job.control, logDir, env);
        console.error(`[part 3] ${job.entry.id} ${job.entry.path}${job.control === null ? "" : ` GOAL_CONTROL=${job.control}`}: ${result.verdict} (${Math.round(result.ms / 1000)} s)`);
        results.push(result);
      }
    }),
  );
  return results.sort((a, b) => `${a.id}${a.path}${a.control ?? ""}`.localeCompare(`${b.id}${b.path}${b.control ?? ""}`));
}
