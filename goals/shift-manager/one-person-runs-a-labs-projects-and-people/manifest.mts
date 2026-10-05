/**
 * Part 3's manifest (S4): every child's check on its green path, each as its
 * own subprocess, with the controls this run still owes it. A control part 1
 * already failed on this commit stands for the child's "control must fail" and
 * is not run again (the closure rule, item 3).
 *
 * A control here passes when its run exits non-zero; one that exits 0 never
 * went red, which is a finding like any other.
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
  /**
   * Its green path run one `GOAL_PART` per process, as the goal's own verdicts run it: a goal
   * whose whole run outlasts one subprocess's time cap and heap.
   */
  parts?: string[];
}

/** Every check that boots the DevTeam tree, other than the closure's own and the three named above. */
function devteamBooters(): string[] {
  const named = new Set([
    "goals/hire-plane/repairs-a-seat-whose-kind-was-cut",
    "goals/org-seats/cos-changes-the-roster",
    "goals/shift-manager/it-groups-workstreams-under-their-projects",
    "goals/shift-manager/one-person-runs-a-labs-projects-and-people",
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

/** Goals whose green path runs one part per process (see `Entry.parts`). */
const PER_PART: Record<string, string[]> = {
  "goals/shift-manager/a-lab-is-worked-through-one-skinned-shell": ["a", "b0", "b", "c", "d", "controls", "part2", "part3", "part4"],
};

const partOrder = (r: RunResult) => (r.part === null ? -1 : (PER_PART[r.path] ?? []).indexOf(r.part));

export function manifest(): Entry[] {
  return [
    { id: "P3.1", path: "goals/hire-plane/repairs-a-seat-whose-kind-was-cut", controls: ["fire-keeps-inventory"] },
    { id: "P3.2", path: "goals/org-seats/cos-changes-the-roster", controls: [], covered: "deny-fire (b3)" },
    {
      id: "P3.3",
      path: "goals/shift-manager/it-groups-workstreams-under-their-projects",
      controls: ["unread", "gap-tabs", "no-gate", "no-retry"],
      covered: "no-tool (a1)",
      controlEnv: { GOAL_LEG: "model-free" },
    },
    ...devteamBooters().map((path) => ({ id: "P3.4", path, controls: "own" as const, ...(PER_PART[path] === undefined ? {} : { parts: PER_PART[path] }) })),
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
  /** The `GOAL_PART` this run was, for an entry run per part. */
  part: string | null;
  exit: number | null;
  ms: number;
  verdict: "PASS" | "FAIL" | "FAIL (expected)" | "PASS (control NOT red)" | "BLOCKED";
  tail: string;
  log: string;
}

/** Run one goal (or one of its controls) to its end. */
function runOne(entry: Entry, control: string | null, part: string | null, logDir: string, env: Record<string, string>): Promise<RunResult> {
  const started = Date.now();
  const log = join(logDir, `${entry.path.replaceAll("/", "__")}${control === null ? "" : `--${control}`}${part === null ? "" : `--part-${part}`}.log`);
  return new Promise((resolve) => {
    let out = "";
    const child = spawn(join(REPO_ROOT, "node_modules", ".bin", "tsx"), [join(REPO_ROOT, entry.path, "run.mts")], {
      cwd: REPO_ROOT,
      env: { ...process.env, ...env, ...(control === null ? { GOAL_CONTROL: "" } : { GOAL_CONTROL: control, ...(entry.controlEnv ?? {}) }), ...(part === null ? {} : { GOAL_PART: part }) },
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
      const verdict: RunResult["verdict"] =
        control === null ? (code === 0 ? "PASS" : blocked ? "BLOCKED" : "FAIL") : code === 0 ? "PASS (control NOT red)" : blocked ? "BLOCKED" : "FAIL (expected)";
      resolve({ id: entry.id, path: entry.path, control, part, exit: code, ms: Date.now() - started, verdict, tail: (verdictLine || out.slice(-800)).slice(0, 1500), log });
    });
  });
}

/** Run the whole manifest, `parallel` at a time. */
export async function runManifest(entries: Entry[], logDir: string, env: Record<string, string>, parallel = 3): Promise<RunResult[]> {
  const jobs: Array<{ entry: Entry; control: string | null; part: string | null }> = [];
  for (const entry of entries) {
    for (const part of entry.parts ?? [null]) jobs.push({ entry, control: null, part });
    for (const control of entry.controls === "own" ? ownControls(entry.path) : entry.controls) jobs.push({ entry, control, part: null });
  }
  const results: RunResult[] = [];
  let next = 0;
  await Promise.all(
    Array.from({ length: parallel }, async () => {
      while (next < jobs.length) {
        const job = jobs[next++]!;
        const result = await runOne(job.entry, job.control, job.part, logDir, env);
        console.error(`[part 3] ${job.entry.id} ${job.entry.path}${job.control === null ? "" : ` GOAL_CONTROL=${job.control}`}${job.part === null ? "" : ` GOAL_PART=${job.part}`}: ${result.verdict} (${Math.round(result.ms / 1000)} s)`);
        results.push(result);
      }
    }),
  );
  return results.sort((a, b) => `${a.id}${a.path}${a.control ?? ""}`.localeCompare(`${b.id}${b.path}${b.control ?? ""}`) || partOrder(a) - partOrder(b));
}
