/**
 * What opening each host costs: `openTeammates` until the server has
 * initialized (its first `GET /api/flows` answered), on a fresh store. A kit's
 * install does the same work today's host does by hand, plus ordering and
 * merging, so the question is only whether that shows. Retained POC evidence;
 * `run.sh` copies it into `labs/teammates/test/` for the run.
 *
 * Each round opens every host once, in an order rotated by one per round, so
 * each host runs equally often in each position. Every host is opened once
 * first, untimed, so module loading is out of the figures. The figure per
 * variant is the median of its per-round difference from today's host in the
 * same round, which cancels drift across the run.
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { performance } from "node:perf_hooks";
import { it, vi } from "vitest";
import { createInProcessFetch } from "@flow-state-dev/engine";
import { scriptedModels } from "../../test-support/contract";

// Every host starts its harnesses' readiness checks in the background, which spawn processes and
// compete with whatever start-up work comes after them. With `FIX2622_STUB_READINESS=1` each check
// answers ready at once, so the figures are the install alone.
vi.mock("@flow-state-dev/harness-manager", async (original) => {
  const actual = await original<typeof import("@flow-state-dev/harness-manager")>();
  if (process.env.FIX2622_STUB_READINESS !== "1") return actual;
  return {
    ...actual,
    harnessReadiness: (slots: Parameters<typeof actual.harnessReadiness>[0]) =>
      actual.harnessReadiness(Object.fromEntries(Object.entries(slots).map(([name, slot]) => [name, { ...slot, check: async () => ({ ready: true as const }) }]))),
  };
});

const HOSTS = (process.env.FIX2622_HOSTS ?? "today").split(",").filter((name) => name !== "");
const ROUNDS = Number(process.env.FIX2622_COST_ROUNDS ?? 20);

/** A one-commit repository and a fresh data folder. */
function fixture() {
  const data = mkdtempSync(join(tmpdir(), "fix2622-cost-"));
  const repo = join(data, "repo");
  const git = { ...process.env, GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t" };
  execFileSync("git", ["init", "-q", "-b", "main", repo]);
  writeFileSync(join(repo, ".gitignore"), "**/.fsdev/\n");
  execFileSync("git", ["-C", repo, "add", "-A"], { env: git });
  execFileSync("git", ["-C", repo, "commit", "-q", "-m", "init"], { env: git });
  return { data, repo };
}

/** Milliseconds from `openTeammates` to the first answered `GET /api/flows`. */
async function openOnce(name: string): Promise<number> {
  const { data, repo } = fixture();
  const { openTeammates } = (await import(`../host.zz-${name}.mts`)) as { openTeammates: (options: Record<string, unknown>) => Promise<unknown> };
  const started = performance.now();
  const state = await openTeammates({
    store: join(data, "teammates.sqlite"),
    model: "test/scripted",
    userId: "you",
    workdir: repo,
    runsRoot: join(data, "runs"),
    scriptedHarnessStepMs: 20,
    modelResolver: scriptedModels({}) as never,
  });
  const response = await (createInProcessFetch(state as never) as unknown as typeof fetch)("/api/flows", { headers: { "x-user-id": "you" } });
  const took = performance.now() - started;
  if (response.status !== 200) throw new Error(`${name}: GET /api/flows answered ${response.status}`);
  await (state as { dispose?: () => Promise<void> }).dispose?.();
  rmSync(data, { recursive: true, force: true });
  return took;
}

const median = (values: number[]) => {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
};

it("costs of opening each host", async () => {
  for (const name of HOSTS) await openOnce(name);
  const times = new Map<string, number[]>(HOSTS.map((name) => [name, []]));
  for (let round = 0; round < ROUNDS; round++) {
    const order = HOSTS.map((_, i) => HOSTS[(i + round) % HOSTS.length]!);
    for (const name of order) times.get(name)!.push(await openOnce(name));
  }
  const today = times.get("today")!;
  const readiness = process.env.FIX2622_STUB_READINESS === "1" ? "readiness checks stubbed" : "real readiness checks";
  const lines = [`COST · ${ROUNDS} rounds, ${HOSTS.length} hosts, rotated, ${readiness}`, "host | median open, ms | paired median vs today, ms | rounds slower than today"];
  for (const name of HOSTS) {
    const own = times.get(name)!;
    const diffs = own.map((t, i) => t - today[i]!);
    lines.push(`${name} | ${median(own).toFixed(1)} | ${name === "today" ? "—" : (median(diffs) >= 0 ? "+" : "") + median(diffs).toFixed(1)} | ${name === "today" ? "—" : `${diffs.filter((d) => d > 0).length}/${ROUNDS}`}`);
  }
  const a = times.get("a-kit");
  const b = times.get("b-api");
  if (a !== undefined && b !== undefined) {
    const diffs = a.map((t, i) => t - b[i]!);
    lines.push(`a-kit vs b-api, paired median: ${(median(diffs) >= 0 ? "+" : "") + median(diffs).toFixed(1)} ms, a-kit slower in ${diffs.filter((d) => d > 0).length}/${ROUNDS}`);
  }
  lines.push("END COST");
  console.log(lines.join("\n"));
}, 600_000);
