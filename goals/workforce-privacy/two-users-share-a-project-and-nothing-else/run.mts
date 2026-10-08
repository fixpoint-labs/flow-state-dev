/**
 * Goal check: two users each run a private roster and share a project through
 * workstreams they own (FIX-1797, the closure of epic FIX-1786). See goal.md.
 *
 * A thin orchestrator over one commit. Today it builds the milestone
 * (FIX-1805): Shift Manager's DevTeam install served from the commit, Alice and
 * Bob through the shipped clients with their own bearers and in their own
 * browser contexts, m1 to m5 on a fresh store, then the same steps under the
 * control `org-scoped-workers` on another, and the report.
 *
 * The final run adds its parts beside the milestone's, each in its own module
 * and each named in {@link FINAL_PARTS}: legs a to c (`legs`), the leg-b
 * controls, the pre-epic baseline, J1, part 3's manifest and part 4's seam
 * assertions. They share `install.mts` (the served commit and its people),
 * `people.mts` (the shipped clients), `controls/patches.mts`, `record.mts` and
 * `report.mts`.
 *
 * Run:    PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers GOAL_ONLY=milestone pnpm tsx goals/workforce-privacy/two-users-share-a-project-and-nothing-else/run.mts
 * Rerun on another commit (QR-15): add GOAL_COMMIT=<sha>; the commit is served from its own worktree.
 * Parts:  GOAL_ONLY=milestone (both runs), milestone-plain, milestone-org-scoped-workers
 */
import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { REPO_ROOT, RUN_STAMP, goalTmpDir, runGoal } from "../../lib/index.mts";
import { launchChromium } from "../../lib/playwright.mts";
import { buildShiftManagerPages } from "../../lib/shift-manager.mts";
import { orgScopedWorkers, probeOrgScopedWorkers, profileOf, scratchProfile, secondOrg, SECOND_ORG } from "./controls/patches.mts";
import { checkoutFor, Install, storesDir, type Checkout } from "./install.mts";
import { milestone, type MilestoneControl } from "./milestone.mts";
import { loadShipped, type Person } from "./people.mts";
import { RunRecord, messageOf } from "./record.mts";
import { writeReport, type StepsRun } from "./report.mts";

const MILESTONE_PARTS = ["milestone-plain", "milestone-org-scoped-workers"] as const;
/** The final run's parts, added by the closure once QR-1 holds. Not built yet. */
const FINAL_PARTS = ["legs", "unpartitioned", "no-follow-up", "no-delegate-check", "no-roster-check", "baseline", "j1", "p3", "p4"] as const;

/** Unset runs every part built so far: the milestone, until the final run lands. */
const ONLY = (process.env.GOAL_ONLY || "milestone").split(",").map((s) => s.trim()).filter(Boolean).flatMap((s) => (s === "milestone" ? [...MILESTONE_PARTS] : [s]));
const MODEL_KEYS = ["AI_GATEWAY_API_KEY", "OPENAI_API_KEY", "OPENROUTER_API_KEY"];

const SCRATCH = goalTmpDir("closure-fix-1797");
const SHOTS = join(SCRATCH, "screenshots");
const say = (s: string) => console.error(`[closure ${new Date().toISOString().slice(11, 19)}] ${s}`);

await runGoal(async () => {
  for (const part of ONLY) {
    if ((FINAL_PARTS as readonly string[]).includes(part)) return { failures: [`part "${part}" belongs to the final run, which is not built yet`], evidence: "" };
    if (!(MILESTONE_PARTS as readonly string[]).includes(part)) throw new Error(`unknown GOAL_ONLY part "${part}"; known: milestone, ${MILESTONE_PARTS.join(", ")}`);
  }
  const provider = MODEL_KEYS.filter((k) => (process.env[k] ?? "") !== "");
  if (provider.length === 0) return { failures: [`blocked (QR-6): no model key; none of ${MODEL_KEYS.join(", ")} is set`], evidence: "" };

  const started = Date.now();
  const cost: string[] = [];
  const setup: string[] = [];
  const timed = async <T,>(what: string, fn: () => Promise<T>): Promise<T> => {
    const t = Date.now();
    try {
      return await fn();
    } finally {
      cost.push(`${what}: ${Math.round((Date.now() - t) / 1000)} s`);
    }
  };

  const checkout: Checkout = await timed("checkout", async () => checkoutFor(process.env.GOAL_COMMIT, SCRATCH));
  say(`serving ${checkout.describe}; scratch ${SCRATCH}`);
  const removeLater: Array<() => void> = [() => checkout.remove()];
  const runs: StepsRun[] = [];
  const controls: Array<{ control: string; ok: boolean; line: string }> = [];
  const failures: string[] = [];
  let chromium = "not launched";
  let model = "the install's default";
  try {
    const shipped = await loadShipped(checkout.root);
    const host = (await import(pathToFileURL(join(profileOf(checkout.root), "host.mts")).href)) as { LAB_USERS?: Record<string, { userId: string; bearer: string }> };
    const users = host.LAB_USERS;
    if (users?.owner === undefined || users.member === undefined) throw new Error("setup: the DevTeam host exports no LAB_USERS owner and member");
    const people: { alice: Person; bob: Person; alice2: Person } = {
      alice: { label: "Alice", ...users.owner },
      bob: { label: "Bob", ...users.member },
      alice2: { label: "Alice (second org)", userId: users.owner.userId, bearer: SECOND_ORG.bearer },
    };
    setup.push(`Alice is the DevTeam owner \`${people.alice.userId}\`, Bob its second member \`${people.bob.userId}\`, each with their own bearer; Alice's second org \`${SECOND_ORG.orgId}\` comes from the \`second-org\` patch, since the install has no second-org principal`);
    const pages = await timed("build Shift Manager's pages", () => buildShiftManagerPages(join(SCRATCH, "pages"), join(checkout.root, "packages", "shift-manager")));
    const second = scratchProfile(checkout.root, RUN_STAMP.replace(/\D/g, "").slice(-6), [secondOrg]);
    removeLater.push(() => second.remove());
    const shippedConfig = join(profileOf(checkout.root), "fsdev.config.mts");
    const browser = await launchChromium().catch((error) => {
      throw new Error(`blocked (QR-6): no Chromium starts: ${messageOf(error)}`);
    });
    chromium = browser.version();
    try {
      const runMilestone = async (label: string, control: MilestoneControl, env: Record<string, string>, patches: string[]) => {
        const record = new RunRecord(label, SHOTS);
        const store = join(storesDir(SCRATCH, label), "devteam.sqlite");
        const install = new Install(browser, shipped, checkout, { pages, scratch: SCRATCH, store, record });
        const run: StepsRun = { label, record, patches: [...patches, second.diff], stores: [{ file: store.slice(SCRATCH.length + 1), steps: "m1 to m4 (boot 1), m5 (boot 2)" }], ms: 0 };
        const t = Date.now();
        try {
          run.facts = await milestone({ install, record, people, configs: { first: shippedConfig, second: second.config }, env, control, say });
        } catch (error) {
          record.fail("reach", (error as Error).stack?.slice(0, 1500) ?? String(error));
          await install.stop().catch(() => undefined);
        }
        run.ms = Date.now() - t;
        cost.push(`${label}: ${Math.round(run.ms / 1000)} s, ${record.turns.length} model turns, ${record.boots.length} boots`);
        runs.push(run);
        return run;
      };

      if (ONLY.includes("milestone-plain")) {
        say("the milestone, as shipped");
        const run = await runMilestone("milestone", null, {}, []);
        for (const red of run.record.reds()) failures.push(`milestone ${red.id} ${red.verdict}: ${red.notes.join(" / ")}`);
      }

      if (ONLY.includes("milestone-org-scoped-workers")) {
        say("the control org-scoped-workers");
        let line: string;
        let ok = false;
        try {
          const patch = orgScopedWorkers(checkout.root);
          const probe = probeOrgScopedWorkers(checkout.root, patch, checkout.tsx, SCRATCH);
          if (probe.scope !== "org") throw new Error(`the patch did not reach the module the install loads: a process with it reads scope ${probe.scope} (${probe.output})`);
          setup.push(`\`org-scoped-workers\` reaches the served code: a process started with its environment reads the worker collection at \`${probe.scope}\` scope, and one without it at \`user\``);
          const run = await runMilestone("org-scoped-workers", "org-scoped-workers", patch.env, [patch.diff]);
          // It must fail m3 on its merits and leave m5 green (PLAN → The milestone).
          const m3 = run.record.steps.get("m3");
          const m5 = run.record.verdict("m5");
          const at = m3?.verdict === "FAIL" ? m3.notes.find((n) => /^FAIL: Bob reads Alice's worker/.test(n)) : undefined;
          ok = at !== undefined && m5 === "PASS";
          const others = run.record.reds().filter((x) => x.id !== "m3").map((x) => `${x.id} ${x.verdict}`);
          line =
            at !== undefined
              ? `failed m3: ${at.slice(6, 300)}; m5 ${m5}${others.length > 0 ? `; also red: ${others.join(", ")}` : ""}`
              : `never failed m3 on *Bob reads Alice's worker* (m3 ${m3?.verdict ?? "missing"}: ${(m3?.notes ?? []).filter((n) => /^(FAIL|NOT RUN)/.test(n)).join(" / ").slice(0, 300)}); m5 ${m5}${run.record.verdict("m1") !== "PASS" ? ". It failed at setup (m1), so it shows nothing on this commit" : ""}`;
        } catch (error) {
          line = `could not apply to the commit: ${messageOf(error)}`;
        }
        controls.push({ control: "org-scoped-workers", ok, line });
        if (!ok) failures.push(`control org-scoped-workers: ${line}`);
      }
    } finally {
      await browser.close();
      // Read while the checkout is still there.
      model = modelOf(checkout.root, runs.find((x) => x.facts?.standard !== undefined)?.facts?.standard?.id);
    }
  } finally {
    for (const remove of removeLater) {
      try {
        remove();
      } catch {
        // a scratch copy that is already gone
      }
    }
    // Every store this run owned is deleted, pass or fail (QR-8).
    const stores = join(SCRATCH, "stores");
    for (const f of existsSync(stores) ? readdirSync(stores) : []) rmSync(join(stores, f), { recursive: true, force: true });
  }

  cost.unshift(`whole run: ${Math.round((Date.now() - started) / 1000)} s, one command, fresh stores, nothing to set up by hand`);
  const merges = execFileSync("git", ["-C", REPO_ROOT, "log", "--first-parent", "--merges", "--format=%h %s", "-n", "400", checkout.commit], { encoding: "utf8" })
    .split("\n")
    .filter((l) => /FIX-1788/i.test(l));
  const report = writeReport(SCRATCH, {
    kind: "milestone",
    run: RUN_STAMP,
    served: checkout.describe,
    commit: checkout.commit,
    merges,
    model,
    provider: provider.map((k) => k.replace(/_API_KEY$/, "")).join(" / "),
    chromium,
    runs,
    controls,
    setup,
    cost,
    failures,
  });
  say(`report: ${report}`);
  return { failures, evidence: `the milestone only (the final run is not built yet); report at ${report}` };
});

/** The model the forked standard worker's file names, or the DevTeam's chief of staff's when none was forked. */
function modelOf(root: string, worker: string | undefined): string {
  const tree = join(profileOf(root), "workforce");
  const found = execFileSync("find", [tree, "-name", "WORKER.md"], { encoding: "utf8" }).split("\n").filter(Boolean);
  const file = found.find((f) => f.endsWith(`/${worker ?? "chief-of-staff"}/WORKER.md`)) ?? found.find((f) => f.endsWith("/chief-of-staff/WORKER.md"));
  const model = file === undefined ? undefined : /^model:\s*(\S+)/m.exec(readFileSync(file, "utf8"))?.[1];
  return model ?? "the install's default";
}
