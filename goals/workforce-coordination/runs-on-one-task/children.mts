/**
 * Plan row 3: every child's own goal or check, with its controls, on the closure's commit. The
 * set is every child of FIX-2056 blocking FIX-2087 when the run starts, read from Linear (with
 * `LINEAR_API_KEY`; when it can't be read, row 3 runs the set below and fails), and printed as read. A child with no
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

/** One run: a goal (`goals/<path>/run.mts`), a package's vitest files, or a goal's model-free check script (`goals/<path>`). */
export interface Check {
  goal?: string;
  vitest?: { filter: string; files: string[] };
  script?: string;
  env?: Record<string, string>;
  /**
   * Each control by name, and every tag its goal says it must fail: all of them must go red. A
   * tag ending in `:` is a leg (`d:`), red when any failure in that leg is. Tags a goal says only
   * go red "with it" are not required.
   */
  controls?: Record<string, string[]>;
  /** What row 1 walks of it, printed beside it. */
  walked?: string;
  /**
   * The runs elsewhere in this closure that grade it end to end, for a closure finding whose fix
   * landed in a goal another entry already runs, or whose failing check was a row-1 assertion:
   * a goal path some entry here runs, a row-1 assertion tag (`a:follow-up`), or `sweep`. Printed
   * beside it; one that names no such run is a failure, so a stale reference can't pass silently.
   */
  by?: string[];
}

/** Each child's checks, by issue id. */
export const CHECKS: Record<string, Check[]> = {
  "FIX-2076": [
    { goal: "task-board/a-worker-plans-its-own-steps", controls: { "no-plan": ["a1:steps-in-task-session"] }, walked: "a: writer's plan step" },
    { goal: "task-board/refuses-a-board-built-wrong", controls: { "no-fence": ["b:refused"] } },
  ],
  "FIX-2077": [{ goal: "task-board/settles-when-its-work-is-over", controls: { "settle-at-return": ["a:after-the-side-chains"] }, walked: "a: writer's task stays running on its research" }],
  "FIX-2078": [{ goal: "task-board/every-ending-reaches-its-filer", controls: { "no-sweeper-payment": ["b:the filer hears within due time", "e:"] }, walked: "b, and a's once" }],
  "FIX-2080": [{ goal: "task-board/runs-by-its-filing-settings", controls: { "no-cascade": ["d:the open filed task is cancelled", "d:the dependent chain is cancelled"] }, walked: "c: the dependent cancelled" }],
  "FIX-2081": [{ goal: "task-tools/five-tools-one-rule-per-field", controls: { "roster-reach": ["c:a piece for a non-delegate is refused"], "edit-any-state": ["b:running:", "b:finished:"] }, walked: "a: Alice's list; j1's tools" }],
  "FIX-2082": [{ goal: "task-board/waits-on-a-task-it-filed", controls: { "deadline-cancels": ["c:at the deadline the task is in_progress on attempt 1", "c:a second wait gets it completed"], "drain-moves-on": ["d:"] }, walked: "a: the drain waits on a dispatched step; j1" }],
  "FIX-2083": [{ goal: "coordinators/routes-each-message-as-a-task", controls: { "round-timer": ["b:restart"], "post-map-off": ["e:legacy"] }, walked: "a: the routed task" }],
  "FIX-2084": [{ goal: "workers/roles-checked-at-hire", controls: { "no-role-check": ["a:refused"] } }],
  "FIX-2085": [{ goal: "scheduled-work/recurring-work-files-a-task", controls: { "memory-dedupe": ["b:exactly-one-task"] } }],
  "FIX-2086": [{ goal: "task-tools/steer-and-follow-up", controls: { "drop-late-steer": ["b:one more turn before the settle"], reopen: ["d:the original's output reads byte-identical"] }, walked: "a: the follow-up; j2: the steer" }],
  "FIX-2088": [
    {
      goal: "task-board/background-error-fails-the-attempt",
      controls: { "drop-background-failures": ["a:done-on-attempt-2", "f:done-on-attempt-2", "b:failed-after-1-attempt", "c:failed-after-1-attempt", "h:failed-after-1-attempt", "j:failed-after-1-attempt", "i:failed-after-1-attempt", "k:done-on-attempt-2"], "no-conversation-carve-out": ["k:conversation-done-on-attempt-1"] },
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
  // The closure's own findings, each a child blocking FIX-2087 once filed: its regression tests,
  // and the run that found it, which now grades it (`by`).
  "FIX-2097": [{ vitest: { filter: "@flow-state-dev/store-sqlite", files: ["test/write-after-close.test.ts"] }, by: ["workforce/split-to-roster"] }],
  "FIX-2110": [{ vitest: { filter: "@flow-state-dev/workforce", files: ["test/worker-plans-its-steps.test.ts"] }, by: ["a:answers-after-steps", "a:lands-once", "task-board/waits-on-a-task-it-filed"] }],
  "FIX-2111": [
    { vitest: { filter: "@flow-state-dev/workforce", files: ["test/task-session-stays-open.test.ts", "test/project-coordinator.test.ts"] }, by: ["a:follow-up", "a:once", "task-tools/steer-and-follow-up"] },
  ],
  "FIX-2112": [
    { vitest: { filter: "@flow-state-dev/orchestration", files: ["test/tasks/wait-on-task.test.ts", "test/tasks/task-notice.test.ts"] }, by: ["j1:read-once", "j1:heard-once", "task-board/waits-on-a-task-it-filed"] },
  ],
  "FIX-2113": [
    { vitest: { filter: "@flow-state-dev/orchestration", files: ["test/tasks/notice-defer.test.ts", "test/tasks/pass.test.ts"] } },
    { vitest: { filter: "@flow-state-dev/workforce", files: ["test/steer-while-filed-work-open.test.ts"] }, by: ["j2:steer-shows"] },
  ],
  "FIX-2114": [
    { vitest: { filter: "@flow-state-dev/orchestration", files: ["test/collection/deps-read-committed.test.ts"] } },
    { vitest: { filter: "@flow-state-dev/workforce", files: ["test/deps-read-committed.test.ts"] }, by: ["task-board/runs-by-its-filing-settings"] },
  ],
  "FIX-2115": [{ vitest: { filter: "@flow-state-dev/workforce", files: ["test/coordinator-routed-tasks.test.ts"] }, by: ["coordinators/files-tasks-down-the-owners-chain"] }],
  "FIX-2116": [{ by: ["coordinators/hands-each-post-to-its-delegates"] }],
  "FIX-2117": [{ by: ["task-board/a-worker-plans-its-own-steps"] }],
  "FIX-2118": [{ by: ["task-board/every-ending-reaches-its-filer"] }],
  "FIX-2119": [{ by: ["sweep"] }],
  "FIX-2120": [{ by: ["goal-seek-loop/replans-until-done"] }],
  "FIX-2121": [{ by: ["hand-offs/ask-survives-a-restart", "hand-offs/survives-a-restart-and-runs-once"] }],
  "FIX-2122": [{ vitest: { filter: "@flow-state-dev/orchestration", files: ["test/collection/filing-settings.test.ts"] }, by: ["a:follow-up", "task-tools/steer-and-follow-up"] }],
  "FIX-2123": [
    { vitest: { filter: "@flow-state-dev/orchestration", files: ["test/collection/notice-take.test.ts", "test/tasks/notice-claim.test.ts", "test/tasks/delivery-after-ending.test.ts", "test/tasks/notice-defer.test.ts"] } },
    { vitest: { filter: "@flow-state-dev/engine", files: ["test/wait-chain.test.ts"] } },
    { vitest: { filter: "@flow-state-dev/workforce", files: ["test/conversation-board-wait.test.ts"] }, by: ["j1:read-once", "j1:heard-once", "task-board/waits-on-a-task-it-filed"] },
  ],
  "FIX-2135": [
    { vitest: { filter: "@flow-state-dev/engine", files: ["test/wait-resume.test.ts"] } },
    { vitest: { filter: "@flow-state-dev/orchestration", files: ["test/tasks/resume-owed-isolation.test.ts"] }, by: ["j1:waits-in-request", "task-board/waits-on-a-task-it-filed"] },
  ],
  "FIX-2136": [
    { vitest: { filter: "@flow-state-dev/orchestration", files: ["test/tasks/cascade-notice-unseen-dependent.test.ts"] }, by: ["c:one-failure-notice", "task-board/runs-by-its-filing-settings"] },
  ],
  // A failure heard through the filer's own getTask wait: no leg here walks it (j1's research
  // succeeds; c hears its failure by notice), so its regression test is its whole check.
  "FIX-2138": [{ vitest: { filter: "@flow-state-dev/orchestration", files: ["test/tasks/get-task-names-cascaded.test.ts"] } }],
  // Not a product bug: the privacy goal misread a routing coordinator, whose delegate answers in a
  // request of its own after the post's. Its fix is in that goal, which NAMED runs.
  "FIX-2147": [{ script: "workforce-privacy/two-users-share-a-project-and-nothing-else/check-talk.mts", by: ["workforce-privacy/two-users-share-a-project-and-nothing-else"] }],
  // FIX-2149 and FIX-2150 are races inside the park window: a notice held or a step ended, or a
  // wait's deadline passing, in the milliseconds while a request parks. A real model's turns take
  // seconds, so no leg or goal here lands in that window: their regression tests, which inject the
  // timing, are their whole check.
  "FIX-2149": [
    { vitest: { filter: "@flow-state-dev/orchestration", files: ["test/tasks/delivery-after-ending.test.ts", "test/tasks/notice-claim.test.ts", "test/tasks/task-notice.test.ts"] } },
    { vitest: { filter: "@flow-state-dev/workforce", files: ["test/worker-plans-its-steps.test.ts"] } },
  ],
  "FIX-2150": [
    { vitest: { filter: "@flow-state-dev/engine", files: ["test/wait-resume.test.ts"] } },
    { vitest: { filter: "@flow-state-dev/orchestration", files: ["test/tasks/wait-on-task.test.ts"] } },
  ],
  // Round 4's leg b finding: a notice held for a filing request the crash left `in_progress`
  // goes out once that request is known gone. Leg b grades it end to end, in its mid-turn window.
  "FIX-2166": [
    { vitest: { filter: "@flow-state-dev/engine", files: ["test/request-recovery.test.ts", "test/wait-chain.test.ts", "test/context/liveness-gate.test.ts"] } },
    { vitest: { filter: "@flow-state-dev/orchestration", files: ["test/tasks/notice-after-crash.test.ts"] }, by: ["b:hears-in-due-time", "b:once"] },
  ],
  // A request parked on a person releases, at the park, the ending a timed-out getTask wait held.
  // No leg or goal here times a wait out and then parks on a person in the same request, so its
  // regression tests are its whole check.
  "FIX-2170": [{ vitest: { filter: "@flow-state-dev/orchestration", files: ["test/tasks/wait-lapsed-across-a-park.test.ts", "test/tasks/wait-lapsed-durable.test.ts"] } }],
};

/** The goals the closure rule names besides the children's: coordinators, hand-offs, FIX-2005's privacy leg, and the goal-seek loop (journey j3). */
export const NAMED: Check[] = [
  { goal: "coordinators/every-coordinator-is-a-worker-file", controls: { "mailbox-left": ["a:no-mailbox-file", "b:after"] } },
  { goal: "coordinators/files-tasks-down-the-owners-chain", controls: { unpartitioned: ["c:runs-its-own", "c:lists-its-own"], "no-follow-up": ["a:one-notice", "e:one-notice"] } },
  {
    goal: "coordinators/hands-each-post-to-its-delegates",
    controls: {
      "no-roster-check": ["f:bobs-worker-refused"],
      "no-round-limit": ["e:four-then-none"],
      "no-delegate-read": ["d:reply-equals-list", "d:read-equals-list"],
      // One of leg h's own-job asks, whichever best fit places on the EM (its goal.md).
      "no-self-choice": ["h:"],
      "no-floor": ["e:below-floor"],
      "turn-after-route": ["a:no-turn"],
    },
  },
  { goal: "coordinators/routes-a-follow-up-by-its-conversation", controls: { "no-recent": ["followup:delegate"] } },
  { goal: "coordinators/task-session-stays-open", controls: { "new-session": ["a:names-ticket", "c:names-ticket"], "drop-answer": ["a:names-region"] } },
  { goal: "hand-offs/ask-survives-a-restart", controls: { "no-waker": ["a:completed"] } },
  { goal: "hand-offs/survives-a-restart-and-runs-once" },
  { goal: "workforce-privacy/two-users-share-a-project-and-nothing-else", env: { GOAL_ONLY: "milestone", PLAYWRIGHT_BROWSERS_PATH: "/opt/pw-browsers" } },
  { goal: "workforce/split-to-roster", controls: { "first-answer": ["1:report-is-output"], "hold-session": ["1:waiting-while-b-works"], "wake-coordinator": ["4:desk-hears-tasks-only"] } },
  { goal: "goal-seek-loop/replans-until-done", walked: "j3: a goal-seek loop that replans; refuses-a-board-built-wrong holds its delegation-board refusal" },
];

/** The children blocking FIX-2087, read from Linear. Throws when the set can't be read: no key, a failed request, or an answer without the issue's relations. */
async function childrenFromLinear(): Promise<Array<{ id: string; title: string }>> {
  const key = process.env.LINEAR_API_KEY ?? "";
  if (key === "") throw new Error("LINEAR_API_KEY is unset");
  const response = await fetch("https://api.linear.app/graphql", {
    method: "POST",
    headers: { authorization: key, "content-type": "application/json" },
    body: JSON.stringify({ query: 'query { issue(id: "FIX-2087") { inverseRelations(first: 100) { nodes { type issue { identifier title parent { identifier } } } } } }' }),
  });
  if (!response.ok) throw new Error(`Linear answered HTTP ${response.status}`);
  const body = (await response.json()) as any;
  if (body.errors !== undefined) throw new Error(`Linear answered with errors: ${JSON.stringify(body.errors).slice(0, 300)}`);
  const nodes = body.data?.issue?.inverseRelations?.nodes;
  if (!Array.isArray(nodes)) throw new Error("Linear's answer holds no relations for FIX-2087");
  return nodes
    .filter((n: any) => n.type === "blocks" && n.issue.parent?.identifier === "FIX-2056")
    .map((n: any) => ({ id: n.issue.identifier, title: n.issue.title }));
}

/** Every goal some entry runs, for checking `by`. */
const RUN_GOALS = new Set([...Object.values(CHECKS).flat(), ...NAMED].flatMap((c) => (c.goal === undefined ? [] : [c.goal])));

/** Report a check's `by`, and fail one that names no run here (`tags` are row 1's assertions). */
function checkBy(owner: string, check: Check, tags: readonly string[], failures: string[], report: string[]): void {
  if (check.by === undefined) return;
  const stale = check.by.filter((b) => !(b === "sweep" || tags.includes(b) || RUN_GOALS.has(b)));
  report.push(`  ${owner} graded by ${check.by.join(", ")}`);
  if (stale.length > 0) failures.push(`children:${owner} — graded by ${stale.join(", ")}, which no run in this closure holds`);
}

/**
 * Each run row 3 made and whether it passed, for row 4: a goal by its path, a control as
 * `<path> GOAL_CONTROL=<name>` (passed when it went red as documented), a test file as
 * `<package> <file>`. A run made twice passes only if both did.
 */
export const RAN = new Map<string, boolean>();
const record = (key: string, ok: boolean) => RAN.set(key, (RAN.get(key) ?? true) && ok);

/**
 * The bullets of a goal's `FAIL —` list (goals/lib/verdict.mts prints each failure as a line
 * starting `  - `), each the text after its dash, a leading `[` dropped. Lines indented further
 * continue a bullet and are not bullets.
 */
function failureBullets(text: string): string[] {
  return text.split("\n").flatMap((line) => (/^ {2}- /.test(line) ? [line.slice(4).replace(/^\[/, "")] : []));
}

/** Whether a bullet is `tag`'s failure: it starts with the whole tag (`a:x — …`, `[a:x] …`); a leg tag (`d:`), any bullet in that leg. */
const bulletIs = (bullet: string, tag: string) => bullet.startsWith(tag) && (tag.endsWith(":") || /^($|[\s\]·:])/.test(bullet.slice(tag.length)));

/**
 * A control run's verdict: red only when the goal exits 1, every required tag has a failure
 * bullet of its own, and no bullet is the goal saying a control of its own didn't go red
 * (`control <name>: <tag> did NOT fail …`, or red outside its expected set). Such a bullet
 * carries the tag in its text, so reading the output for the tag anywhere would take it for red.
 */
export function controlVerdict(text: string, status: number | null, tags: readonly string[]): { red: boolean; green: string[]; broken: string[] } {
  const bullets = failureBullets(text);
  const green = tags.filter((t) => !bullets.some((b) => bulletIs(b, t)));
  const broken = bullets.filter((b) => /^control\b/i.test(b) && /did not fail|stayed green|is broken|red outside/i.test(b));
  return { red: status === 1 && green.length === 0 && broken.length === 0, green, broken };
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
  } else if (check.script !== undefined) {
    runs.push({ cmd: "pnpm", args: ["tsx", `goals/${check.script}`] });
  }
  for (const run of runs) {
    const label = `${owner} ${check.goal ?? check.script ?? `${check.vitest!.filter} ${check.vitest!.files.join(" ")}`}${run.control === undefined ? "" : ` GOAL_CONTROL=${run.control}`}`;
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
      if (check.goal !== undefined) record(check.goal, out.status === 0);
      else if (check.script !== undefined) record(check.script, out.status === 0);
      else for (const file of check.vitest!.files) record(`${check.vitest!.filter} ${file}`, out.status === 0);
    } else {
      const tags = check.controls![run.control]!;
      const { red, green, broken } = controlVerdict(text, out.status, tags);
      record(`${check.goal} GOAL_CONTROL=${run.control}`, red);
      const why = [green.length > 0 ? `green: ${green.join(", ")}` : "", ...broken.map((b) => `the goal says: ${b.slice(0, 160)}`)].filter(Boolean).join("; ");
      report.push(`  ${red ? "FAIL (expected)" : "CONTROL BROKEN"} ${label} (${secs}s): wanted every one of ${tags.join(", ")} red${why === "" ? "" : `; ${why}`}; ${verdict}`);
      if (!red) failures.push(`children:${owner} — control ${run.control} of ${check.goal} did not fail as documented (exit ${out.status}; ${why || "no failure list"}): ${text.slice(-800).replace(/\n/g, " | ")}`);
    }
  }
}

/** Run row 3. `tags` are row 1's assertions, which a check's `by` may name. */
export async function runChildren(failures: string[], report: string[], say: (s: string) => void, tags: readonly string[]): Promise<void> {
  // Without the live set, row 3 can't tell a child it has no check for: it still runs the
  // built-in set, and fails.
  const read = await childrenFromLinear().catch((error: unknown) => {
    failures.push(`children:cant-tell — the children blocking FIX-2087 weren't read from Linear (${error instanceof Error ? error.message : String(error)}), so a child with no check here would go unseen`);
    return undefined;
  });
  const blocking = read ?? Object.keys(CHECKS).map((id) => ({ id, title: "(not read from Linear)" }));
  // A child with a check here that Linear doesn't list as blocking still runs: a closure fix
  // filed without the blocking relation is still a fix the closure rests on.
  const unlisted = Object.keys(CHECKS).filter((id) => !blocking.some((c) => c.id === id));
  const set = [...blocking, ...unlisted.map((id) => ({ id, title: "(has a check here; not blocking FIX-2087 in Linear)" }))];
  report.push(`row 3: ${blocking.length} children blocking FIX-2087${read === undefined ? ", the built-in set (Linear not read)" : ", read from Linear"}, and ${unlisted.length} more with a check here:`);
  for (const c of set) report.push(`  ${c.id} ${c.title}`);
  report.push(`row 3 skips: none (no child goal has every leg asserted by row 1)`);
  for (const c of set) {
    const checks = CHECKS[c.id];
    if (checks === undefined) {
      failures.push(`children:${c.id} — a child blocking the closure has no check here`);
      continue;
    }
    for (const check of checks) {
      runCheck(c.id, check, failures, report, say);
      checkBy(c.id, check, tags, failures, report);
    }
  }
  for (const check of NAMED) runCheck("named", check, failures, report, say);
}
