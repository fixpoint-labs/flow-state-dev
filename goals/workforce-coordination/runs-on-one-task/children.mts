/**
 * Plan row 3: every child's own goal or check, with its controls, on the closure's commit. The
 * set is every child of FIX-2056 blocking FIX-2087 when the run starts, read from Linear (with
 * `LINEAR_API_KEY`; without it, the set below, said so), and printed as read. A child with no
 * entry in {@link CHECKS} is a failure: the closure can't grade what it can't run.
 *
 * Plus every goal under `goals/coordinators/` and `goals/hand-offs/`, and FIX-2005's leg of
 * `goals/workforce-privacy/`, which the closure rule names. No child goal is skipped as walked
 * by row 1: none has every leg asserted there (each is printed with the leg it was walked in).
 *
 * A control passes when its run FAILs (exit 1) and the output names at least one of its
 * must-fail tags as its goal documents them, or, where the goal names a leg rather than tags,
 * a failure tagged with that leg.
 */
import { spawnSync } from "node:child_process";
import { REPO_ROOT } from "../../lib/index.mts";

/** One run: a goal (`goals/<path>/run.mts`) or a package's vitest files. */
export interface Check {
  goal?: string;
  vitest?: { filter: string; files: string[] };
  env?: Record<string, string>;
  /** Each control by name, and the tags (or `<leg>:` prefixes) one of which must go red. */
  controls?: Record<string, string[]>;
  /** What row 1 walks of it, printed beside it. */
  walked?: string;
}

/** Each child's checks, by issue id. */
export const CHECKS: Record<string, Check[]> = {
  "FIX-2076": [
    { goal: "task-board/a-worker-plans-its-own-steps", controls: { "no-plan": ["a1:steps-in-task-session", "a1:no-child-session"] }, walked: "a: writer's plan step" },
    { goal: "task-board/refuses-a-board-built-wrong", controls: { "no-fence": ["b:refused"] } },
  ],
  "FIX-2077": [{ goal: "task-board/settles-when-its-work-is-over", controls: { "settle-at-return": ["a:after-the-side-chains", "c:settles-first", "c:outside-the-task", "c:output"] }, walked: "a: writer's task stays running on its research" }],
  "FIX-2078": [{ goal: "task-board/every-ending-reaches-its-filer", controls: { "no-sweeper-payment": ["b:the filer hears within due time"] }, walked: "b, and a's once" }],
  "FIX-2080": [{ goal: "task-board/runs-by-its-filing-settings", controls: { "no-cascade": ["d:"] }, walked: "c: the dependent cancelled" }],
  "FIX-2081": [{ goal: "task-tools/five-tools-one-rule-per-field", controls: { "roster-reach": ["c:a piece for a non-delegate is refused"], "edit-any-state": ["b:"] }, walked: "a: Alice's list; j1's tools" }],
  "FIX-2082": [{ goal: "task-board/waits-on-a-task-it-filed", controls: { "deadline-cancels": ["c:"], "drain-moves-on": ["d:"] }, walked: "a: the drain waits on a dispatched step; j1" }],
  "FIX-2083": [{ goal: "coordinators/routes-each-message-as-a-task", controls: { "round-timer": ["b:restart"], "post-map-off": ["e:legacy"] }, walked: "a: the routed task" }],
  "FIX-2084": [{ goal: "workers/roles-checked-at-hire", controls: { "no-role-check": ["a:refused"] } }],
  "FIX-2085": [{ goal: "scheduled-work/recurring-work-files-a-task", controls: { "memory-dedupe": ["b:exactly-one-task", "b:early-files-nothing"] } }],
  "FIX-2086": [{ goal: "task-tools/steer-and-follow-up", controls: { "drop-late-steer": ["b:"], reopen: ["d:"] }, walked: "a: the follow-up; j2: the steer" }],
  "FIX-2088": [
    {
      goal: "task-board/background-error-fails-the-attempt",
      controls: { "drop-background-failures": ["a:done-on-attempt-2", "b:failed-after-1-attempt"], "no-conversation-carve-out": ["k:conversation-done-on-attempt-1"] },
    },
  ],
  "FIX-2090": [
    { vitest: { filter: "@flow-state-dev/harness-manager", files: ["test/claim-board-refused.spec.ts"] } },
    { vitest: { filter: "@flow-state-dev/orchestration", files: ["test/task-board/record-error-ends-for-good.test.ts", "test/collection/advisory-fail-no-retry.test.ts"] } },
  ],
  "FIX-2096": [
    { vitest: { filter: "@flow-state-dev/orchestration", files: ["test/task-board/drain-pays-owed-cascade.test.ts", "test/collection/owes-a-touch.test.ts", "test/collection/filing-settings.test.ts", "test/skills/task-tools-capability.test.ts"] } },
    { vitest: { filter: "@flow-state-dev/workforce", files: ["test/conversation-board-filing-settings.test.ts", "test/worker-plans-its-steps.test.ts"] } },
  ],
};

/** The goals the closure rule names besides the children's: coordinators, hand-offs, FIX-2005's privacy leg, and the goal-seek loop (journey j3). */
export const NAMED: Check[] = [
  { goal: "coordinators/every-coordinator-is-a-worker-file", controls: { "mailbox-left": ["a:no-mailbox-file", "b:after"] } },
  { goal: "coordinators/files-tasks-down-the-owners-chain", controls: { unpartitioned: ["c:runs-its-own", "c:lists-its-own"], "no-follow-up": ["a:one-notice", "e:one-notice"] } },
  { goal: "coordinators/hands-each-post-to-its-delegates" },
  { goal: "coordinators/routes-a-follow-up-by-its-conversation", controls: { "no-recent": ["followup:delegate", "followup:evaluated", "followup:answered"] } },
  { goal: "coordinators/task-session-stays-open", controls: { "new-session": ["a:names-ticket", "c:names-ticket"], "drop-answer": ["a:names-region"] } },
  { goal: "hand-offs/ask-survives-a-restart", controls: { "no-waker": ["a:completed", "a:word", "b:once"] } },
  { goal: "hand-offs/survives-a-restart-and-runs-once" },
  { goal: "workforce-privacy/two-users-share-a-project-and-nothing-else", env: { GOAL_ONLY: "milestone", PLAYWRIGHT_BROWSERS_PATH: "/opt/pw-browsers" } },
  { goal: "workforce/split-to-roster", controls: { "first-answer": ["1:report-is-output"], "wake-coordinator": ["4:desk-hears-tasks-only"] } },
  { goal: "goal-seek-loop/replans-until-done", walked: "j3: a goal-seek loop that replans; refuses-a-board-built-wrong holds its delegation-board refusal" },
];

/** The children blocking FIX-2087, read from Linear. */
async function childrenFromLinear(): Promise<Array<{ id: string; title: string }> | undefined> {
  const key = process.env.LINEAR_API_KEY ?? "";
  if (key === "") return undefined;
  const response = await fetch("https://api.linear.app/graphql", {
    method: "POST",
    headers: { authorization: key, "content-type": "application/json" },
    body: JSON.stringify({ query: 'query { issue(id: "FIX-2087") { inverseRelations(first: 100) { nodes { type issue { identifier title parent { identifier } } } } } }' }),
  });
  const body = (await response.json()) as any;
  return (body.data?.issue?.inverseRelations?.nodes ?? [])
    .filter((n: any) => n.type === "blocks" && n.issue.parent?.identifier === "FIX-2056")
    .map((n: any) => ({ id: n.issue.identifier, title: n.issue.title }));
}

/** Run one check (and its controls); push a failure per red run or control that stayed green. */
function runCheck(owner: string, check: Check, failures: string[], report: string[], say: (s: string) => void): void {
  const runs: Array<{ control?: string; args: string[]; cmd: string }> = [];
  if (check.goal !== undefined) {
    const args = ["tsx", `goals/${check.goal}/run.mts`];
    runs.push({ args, cmd: "pnpm" });
    for (const name of Object.keys(check.controls ?? {})) runs.push({ control: name, args, cmd: "pnpm" });
  } else if (check.vitest !== undefined) {
    runs.push({ cmd: "pnpm", args: ["--filter", check.vitest.filter, "exec", "vitest", "run", ...check.vitest.files] });
  }
  for (const run of runs) {
    const label = `${owner} ${check.goal ?? `${check.vitest!.filter} ${check.vitest!.files.join(" ")}`}${run.control === undefined ? "" : ` GOAL_CONTROL=${run.control}`}`;
    say(`row 3: ${label}`);
    const started = Date.now();
    const out = spawnSync(run.cmd, run.args, {
      cwd: REPO_ROOT,
      encoding: "utf8",
      timeout: 3_600_000,
      maxBuffer: 256 * 1024 * 1024,
      env: { ...process.env, ...check.env, GOAL_CONTROL: run.control ?? "" },
    });
    const text = `${out.stdout}${out.stderr}`;
    const verdict = /^(PASS|FAIL|CAN'T TELL)\b.*$/m.exec(text)?.[0]?.slice(0, 160) ?? `exit ${out.status}`;
    const secs = Math.round((Date.now() - started) / 1000);
    if (run.control === undefined) {
      report.push(`  ${out.status === 0 ? "PASS" : "FAIL"} ${label} (${secs}s)${check.walked ? ` · row 1 walks ${check.walked}` : ""}: ${verdict}`);
      if (out.status !== 0) failures.push(`children:${owner} — ${label} ${verdict}: ${(/FAIL —[\s\S]{0,1200}/.exec(text)?.[0] ?? text.slice(-1200)).replace(/\n/g, " | ")}`);
    } else {
      const tags = check.controls![run.control]!;
      const red = out.status === 1 && tags.some((t) => text.includes(t.endsWith(":") ? `- ${t}` : t) || text.includes(t));
      report.push(`  ${red ? "FAIL (expected)" : "CONTROL BROKEN"} ${label} (${secs}s): wanted one of ${tags.join(", ")} red; ${verdict}`);
      if (!red) failures.push(`children:${owner} — control ${run.control} of ${check.goal} did not fail as documented (exit ${out.status}): ${text.slice(-800).replace(/\n/g, " | ")}`);
    }
  }
}

/** Run row 3. */
export async function runChildren(failures: string[], report: string[], say: (s: string) => void): Promise<void> {
  const read = await childrenFromLinear().catch(() => undefined);
  const set = read ?? Object.keys(CHECKS).map((id) => ({ id, title: "(not read: LINEAR_API_KEY unset)" }));
  report.push(`row 3: ${set.length} children blocking FIX-2087${read === undefined ? ", the built-in set (Linear not read)" : ", read from Linear"}:`);
  for (const c of set) report.push(`  ${c.id} ${c.title}`);
  report.push(`row 3 skips: none (no child goal has every leg asserted by row 1)`);
  for (const c of set) {
    const checks = CHECKS[c.id];
    if (checks === undefined) {
      failures.push(`children:${c.id} — a child blocking the closure has no check here`);
      continue;
    }
    for (const check of checks) runCheck(c.id, check, failures, report, say);
  }
  for (const check of NAMED) runCheck("named", check, failures, report, say);
}
