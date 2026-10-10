/**
 * Goal check: a user's coordinator hands each post to delegates from that
 * user's own roster, by its own judgment, best fit, round robin or everyone;
 * the user, or the coordinator itself, changes the delegates mid-conversation;
 * each delegate answers each post once per round; answers go back out only
 * within a set number of rounds; every routing decision is recorded; and no
 * other user's worker is ever a delegate (FIX-1791). A plain ask to the
 * DevTeam chief of staff reaches its delegate by one Jev call with no turn of
 * its own, and its own jobs still reach its turn (FIX-1833). See goal.md.
 *
 * - Legs a to d, f, g and h (`devteam.mts`): Shift Manager's DevTeam install, served
 *   by its own command over a fresh store, with Alice and Bob through the
 *   shipped clients, the chief of staff's turn on the real model its file
 *   names, and best fit's route on Jev (`typesafe-ai/jev`), as the host names it.
 * - Leg e (`leg-e.mts`): a goal-local coordinator tree on the real engine and
 *   its HTTP router, with scripted delegates, evaluator and judgment, run as
 *   its own process.
 *
 * Run:      pnpm tsx goals/coordinators/hands-each-post-to-its-delegates/run.mts
 * Controls: GOAL_CONTROL=no-roster-check | no-round-limit | no-delegate-read |
 *           no-self-choice | no-floor | turn-after-route
 *           (each runs the one leg it must fail, unless GOAL_LEGS says otherwise)
 * Before:   GOAL_COMMIT=<sha> serves that commit, from its own tree and install
 * Legs:     GOAL_LEGS=a,b,c,d,e,f,g,h (default: all)
 * Attempts: GOAL_ATTEMPTS=<n> fresh Labs for the model-backed legs, each running
 *           only the legs still red (default 3; 1 under a control)
 */
import { execFileSync, spawn, spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { REPO_ROOT, RUN_STAMP, goalTmpDir, intentFreeEnv, keysServing, runGoal } from "../../lib/index.mts";
import { buildShiftManagerPages, devteamCosModel, startShiftManager } from "../../lib/shift-manager.mts";
import { CONTROL_NAMES, CONTROLS, controlEnv, describePatch, type Control } from "./controls/patches.mts";
import { boardMailboxes, COS, cosDefaults, devteamLegs, loadShipped, type Asks, type LegResult, type Person } from "./devteam.mts";

const HERE = fileURLToPath(new URL(".", import.meta.url));
const SCRATCH = goalTmpDir("coordinators-delegates");
const ALL_LEGS = ["a", "b", "c", "d", "e", "f", "g", "h"] as const;
const say = (s: string) => console.error(`[coordinators ${new Date().toISOString().slice(11, 19)}] ${s}`);

const controlName = process.env.GOAL_CONTROL ?? "";
if (controlName !== "" && !(CONTROL_NAMES as readonly string[]).includes(controlName)) {
  console.error(`unknown GOAL_CONTROL "${controlName}"; known: ${CONTROL_NAMES.join(", ")}`);
  process.exit(2);
}
const control: Control | undefined = controlName === "" ? undefined : CONTROLS[controlName as keyof typeof CONTROLS];
const legs = new Set(
  (process.env.GOAL_LEGS ?? (control === undefined ? ALL_LEGS.join(",") : control.leg))
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean),
);
for (const l of legs) if (!(ALL_LEGS as readonly string[]).includes(l)) throw new Error(`unknown leg "${l}" in GOAL_LEGS`);

const asks = JSON.parse(readFileSync(join(HERE, "fixtures", "asks.json"), "utf8")) as Asks;

/** The tree a run serves: this checkout, or another commit's own tree and install. */
function checkoutFor(commit: string | undefined): { root: string; commit: string; describe: string } {
  const git = (...args: string[]) => execFileSync("git", ["-C", REPO_ROOT, ...args], { encoding: "utf8" }).trim();
  if (commit === undefined || commit === "") {
    const head = git("rev-parse", "HEAD");
    const dirty = git("status", "--porcelain", "--", ".", ":(exclude)goals").length > 0;
    return { root: REPO_ROOT, commit: head, describe: `this checkout, \`${head.slice(0, 9)}\`${dirty ? " with uncommitted changes outside goals/" : ""}` };
  }
  const sha = git("rev-parse", `${commit}^{commit}`);
  // Kept across runs: a commit's tree and install don't change.
  const root = join(tmpdir(), "fsd-goal-coordinators-trees", sha.slice(0, 12));
  if (!existsSync(join(root, "package.json"))) {
    mkdirSync(root, { recursive: true });
    execFileSync("sh", ["-c", `git -C "${REPO_ROOT}" archive --format=tar ${sha} | tar -x -C "${root}"`]);
  }
  if (!existsSync(join(root, "node_modules"))) {
    say(`installing ${sha.slice(0, 9)} in ${root}`);
    const installed = spawnSync("pnpm", ["install", "--frozen-lockfile", "--prefer-offline"], { cwd: root, encoding: "utf8", timeout: 900_000 });
    if (installed.status !== 0) throw new Error(`setup: ${sha} did not install: ${(installed.stdout + installed.stderr).slice(-1500)}`);
  }
  return { root, commit: sha, describe: `\`${sha.slice(0, 9)}\` (GOAL_COMMIT=${commit}), its own tree and install` };
}

/** Run leg e's host in `root`'s goals, with `env`, and read its one `__GOAL__` line. */
async function runLegE(root: string, env: Record<string, string>): Promise<any> {
  let dir = HERE;
  if (root !== REPO_ROOT) {
    dir = join(root, "goals", relative(join(REPO_ROOT, "goals"), HERE));
    mkdirSync(dir, { recursive: true });
    cpSync(join(HERE, "leg-e.mts"), join(dir, "leg-e.mts"));
    cpSync(join(HERE, "fixtures"), join(dir, "fixtures"), { recursive: true });
  }
  const child = spawn(join(root, "node_modules", ".bin", "tsx"), [join(dir, "leg-e.mts")], {
    cwd: dir,
    env: intentFreeEnv(process.env, { GOAL_CONTROL: "", ...env }),
    stdio: ["ignore", "pipe", "pipe"],
  });
  let out = "";
  let err = "";
  child.stdout.on("data", (d) => (out += String(d)));
  child.stderr.on("data", (d) => (err += String(d)));
  const code = await new Promise<number | null>((resolve) => child.on("exit", resolve));
  const line = out.split("\n").find((l) => l.startsWith("__GOAL__"));
  if (line === undefined) return { setup: `leg e's host printed no result (exit ${code}): ${(err || out).slice(-1500)}` };
  return JSON.parse(line.slice("__GOAL__".length));
}

/** Grade leg e's observations. */
function gradeE(o: any): LegResult {
  const r: LegResult = { failures: [], notes: [] };
  if (o.setup !== undefined) {
    r.failures.push(`e:setup — ${o.setup}`);
    return r;
  }
  const show = (v: unknown) => JSON.stringify(v)?.slice(0, 400);
  const { ladder } = o;
  const records = ladder.graced.records as Array<Record<string, any>>;
  const lines = ladder.graced.lines as Array<{ agentName: string | null; text: string }>;
  const recordFor = (post: { requestId: string }) => records.filter((d) => d.postId === post.requestId);
  const delivered = (d: Record<string, any> | undefined, worker: string) => (d?.delegates ?? []).some((x: any) => x.worker === worker && x.outcome === "delivered");
  const one = (name: string, post: { requestId: string }, by: string, worker: string | undefined) => {
    const found = recordFor(post);
    if (found.length !== 1 || found[0]!.by !== by || (worker !== undefined && !delivered(found[0], worker))) {
      r.failures.push(`${name} — wanted one \`by: ${by}\` record${worker === undefined ? "" : ` delivering to ${worker}`}; the post has ${show(found)}`);
      return undefined;
    }
    return found[0]!;
  };
  one("e:evaluated", ladder.posts.p1, "evaluated", "desk.alpha");
  one("e:held", ladder.posts.p2, "held", "desk.alpha");
  if (ladder.evaluatorCalls.afterP2 !== ladder.evaluatorCalls.afterP1) {
    r.failures.push(`e:held — the follow-up made an evaluator call (${ladder.evaluatorCalls.afterP1} → ${ladder.evaluatorCalls.afterP2})`);
  }
  one("e:fallback", ladder.posts.p3, "fallback", "desk.beta");
  if (ladder.removed.status !== "completed" || ladder.afterRemove.fallback !== null) {
    r.failures.push(`e:fallback-removed — removing the fallback delegate ${ladder.removed.status}; the conversation's fallback is ${show(ladder.afterRemove.fallback)}`);
  }
  const judged = one("e:judgment", ladder.posts.p4, "judgment", "desk.alpha");
  const p4Answers = lines.filter((l) => l.agentName === "desk.alpha" && l.text.includes(ladder.words.p4)).length;
  const p4Ledger = (ladder.graced.ledger as any[]).filter((d) => d.postId === ladder.posts.p4.requestId);
  const skippedAgain = (judged?.delegates ?? []).some((x: any) => x.worker === "desk.alpha" && x.outcome === "skipped");
  if (!skippedAgain || p4Answers !== 1 || p4Ledger.length !== 1) {
    r.failures.push(`e:redelivery — handed desk.alpha twice, wanted the second skipped, one delivery and one answer; skipped again: ${skippedAgain}, deliveries: ${p4Ledger.length}, answers after ${o.graceMs} ms: ${p4Answers}`);
  }
  one("e:unplaced", ladder.posts.p5, "unplaced", undefined);
  if (!lines.some((l) => l.agentName === null && /^Nobody took this post/.test(l.text))) {
    r.failures.push(`e:unplaced — the conversation never said the post went unplaced`);
  }
  r.notes.push(`best fit: ${records.map((d) => `${d.by}→${(d.delegates as any[]).map((x) => `${x.worker}:${x.outcome}`).join("+") || "nobody"}`).join(", ")}; evaluator calls ${show(ladder.evaluatorCalls)}`);

  // Best fit with a floor of 0.7 and a fallback (`desk.floor`).
  const fl = o.floored;
  if (fl === undefined) {
    r.failures.push(`e:below-floor — leg e's host reported no \`desk.floor\` conversation`);
  } else {
    const flRecords = fl.read.records as Array<Record<string, any>>;
    const flFor = (name: string) => flRecords.filter((d) => d.postId === fl.posts[name].requestId);
    const fitIs = (d: Record<string, any> | undefined, want: Record<string, unknown>) =>
      d?.fit !== undefined && Object.entries(want).every(([k, v]) => d.fit[k] === v);
    const doubtful = (tag: string, name: string, want: Record<string, unknown>) => {
      const found = flFor(name);
      if (found.length !== 1 || found[0]!.by !== "fallback" || !delivered(found[0], "desk.beta") || delivered(found[0], "desk.alpha") || !fitIs(found[0], want)) {
        r.failures.push(`${tag} — wanted one \`by: fallback\` record delivering to desk.beta, not to its pick desk.alpha, with \`fit\` ${show(want)}; the post has ${show(found)}`);
      }
    };
    doubtful("e:below-floor", "below", { reason: "below-floor", choice: "desk.alpha", confidence: 0.4, minConfidence: 0.7 });
    doubtful("e:no-confidence", "none", { reason: "no-confidence", choice: "desk.alpha", minConfidence: 0.7 });
    const above = flFor("above");
    if (above.length !== 1 || above[0]!.by !== "evaluated" || !delivered(above[0], "desk.alpha")) {
      r.failures.push(`e:above-floor — a pick at 0.9 should be delivered to desk.alpha, \`by: evaluated\`; the post has ${show(above)}`);
    }
    const self = flFor("self");
    const selfLine = (fl.read.lines as Array<{ agentName: string | null; text: string }>).some((l) => l.text === "I'll take this one myself.");
    if (self.length !== 1 || self[0]!.by !== "judgment" || (self[0]!.delegates as any[]).some((x: any) => x.outcome === "delivered") || !fitIs(self[0], { reason: "coordinator", choice: "desk.floor", confidence: 0.3 }) || !selfLine) {
      r.failures.push(`e:self — a pick of the coordinator at 0.3 should run its own turn, with nothing to the fallback, recorded \`by: judgment\` with \`fit.reason: coordinator\`; the post has ${show(self)}, and its turn's line ${selfLine ? "landed" : "never landed"}`);
    }
    // The coordinator is one of the choices: each call offered both delegates and itself.
    const offered = (fl.offered as string[][]).map((keys) => [...keys].sort().join(","));
    if (offered.length !== 4 || offered.some((keys) => keys !== "desk.alpha,desk.beta,desk.floor")) {
      r.failures.push(`e:self — each of the four calls should offer desk.alpha, desk.beta and desk.floor; they offered ${show(fl.offered)}`);
    }
    r.notes.push(`best fit with a floor: ${flRecords.map((d) => `${d.by}${d.fit === undefined ? "" : `(${show(d.fit)})`}→${(d.delegates as any[]).map((x) => `${x.worker}:${x.outcome}`).join("+") || "nobody"}`).join(", ")}`);
  }

  // Round robin.
  const rr = o.roundRobin;
  const rrRecords = rr.posts.map((p: { requestId: string }) => (rr.read.records as any[]).filter((d) => d.postId === p.requestId));
  const order = rrRecords.map((found: any[]) => (found.length === 1 && found[0].by === "round-robin" ? found[0].delegates.find((x: any) => x.outcome === "delivered")?.worker : `?${found.length}`));
  if (order.join(",") !== "desk.alpha,desk.beta,desk.alpha") r.failures.push(`e:round-robin — three posts went to ${order.join(", ")}, not alpha, beta, alpha`);
  r.notes.push(`round robin: ${order.join(", ")}`);

  // Everyone, one round: each delegate exactly once in round 0 and once in
  // round 1, then nothing. Graded per delegate and per round, never as a
  // total: three answers from one and one from the other is four as well.
  const ev = o.everyone;
  const DELEGATES = ["desk.alpha", "desk.beta"];
  const linesBy = (read: any) => Object.fromEntries(DELEGATES.map((w) => [w, (read.lines as any[]).filter((l) => l.agentName === w).length]));
  const deliveredIn = (ev.graced.records as any[])
    .filter((d) => d.postId === ev.post.requestId)
    .flatMap((d) => (d.delegates as any[]).filter((x) => x.outcome === "delivered").map((x) => `${d.round}:${x.worker}`))
    .sort();
  const answeredInLedger = (ev.graced.ledger as any[])
    .filter((d) => d.postId === ev.post.requestId && d.answered === true)
    .map((d) => `${d.round}:${d.delegate.worker}`)
    .sort();
  const wanted = ["0:desk.alpha", "0:desk.beta", "1:desk.alpha", "1:desk.beta"];
  const linesIn = { quiet: linesBy(ev.quiet), graced: linesBy(ev.graced) };
  const twoEach = (counts: Record<string, number>) => DELEGATES.every((w) => counts[w] === 2);
  if (deliveredIn.join(",") !== wanted.join(",") || answeredInLedger.join(",") !== wanted.join(",") || !twoEach(linesIn.quiet) || !twoEach(linesIn.graced)) {
    r.failures.push(
      `e:four-then-none — everyone with \`rounds: 1\` should hand each delegate the post once in round 0 and once in round 1, and land one answer from each per round, then nothing; ` +
        `delivered (round:delegate) ${deliveredIn.join(", ") || "none"}, answered in the ledger ${answeredInLedger.join(", ") || "none"}, ` +
        `lines per delegate ${show(linesIn.quiet)}, and ${show(linesIn.graced)} after ${o.graceMs} ms more`,
    );
  }
  r.notes.push(`everyone, rounds 1: delivered ${deliveredIn.join(", ")}; answered ${answeredInLedger.join(", ")}; lines ${show(linesIn.quiet)}, ${show(linesIn.graced)} after the grace`);
  return r;
}

await runGoal(async () => {
  const checkout = checkoutFor(process.env.GOAL_COMMIT);
  mkdirSync(SCRATCH, { recursive: true });
  const mark = join(SCRATCH, `patch-mark-${RUN_STAMP}`);
  rmSync(mark, { force: true });
  const env = control === undefined ? {} : controlEnv(control, checkout.root, mark);
  say(`serving ${checkout.describe}; legs ${[...legs].join(", ")}${control === undefined ? "" : `; control ${control.name}`}`);
  if (control !== undefined) say(`control ${control.name}: ${control.does}\n${describePatch(control, checkout.root)}`);

  const results: Record<string, LegResult> = {};
  const evidence: string[] = [];
  const devLegs = [...legs].filter((l) => l !== "e");

  if (devLegs.length > 0) {
    const cosModel = devteamCosModel(checkout.root);
    // Best fit's route model, as the commit's DevTeam host names it.
    const routeModel =
      /routeModel:\s*"([^"]+)"/.exec(readFileSync(join(checkout.root, "packages", "shift-manager", "teams", "devteam", "host.mts"), "utf8"))?.[1] ?? "none named";
    const routeModels: string[] = [];
    for (const [what, model] of [["the chief of staff's model", cosModel], ["best fit's route model", routeModel]] as const) {
      const modelKeys = keysServing(model);
      if (!modelKeys.some((k) => (process.env[k] ?? "") !== "")) {
        return { failures: [`blocked: no key here serves ${what}, ${model}; none of ${modelKeys.join(", ")} is set`], evidence: "" };
      }
    }
    const profile = join(checkout.root, "packages", "shift-manager", "teams", "devteam");
    const host = (await import(pathToFileURL(join(profile, "host.mts")).href)) as { LAB_USERS?: Record<string, { userId: string; bearer: string }> };
    const users = host.LAB_USERS;
    if (users?.owner === undefined || users.member === undefined) throw new Error("setup: the DevTeam host exports no LAB_USERS owner and member");
    const alice: Person = { label: "Alice", ...users.owner };
    const bob: Person = { label: "Bob", ...users.member };
    const defaults = cosDefaults(checkout.root);
    say(`building Shift Manager's pages`);
    const pages = await buildShiftManagerPages(join(SCRATCH, `pages-${checkout.commit.slice(0, 9)}`), join(checkout.root, "packages", "shift-manager"));
    const shipped = await loadShipped(checkout.root);
    // Retry until a leg first passes, over the model's flakiness: each attempt
    // is a fresh store and a fresh Lab, and runs only the legs still red. Every
    // attempt is printed, and a leg's verdict names the attempt it passed on.
    const attempts = Number(process.env.GOAL_ATTEMPTS ?? (control === undefined ? 3 : 1));
    let pending = [...devLegs];
    for (let attempt = 1; attempt <= attempts && pending.length > 0; attempt += 1) {
      const label = `${control?.name ?? "plain"}-${attempt}`;
      const storeDir = join(SCRATCH, "stores", `${RUN_STAMP}-${label}`);
      const store = join(storeDir, "devteam.sqlite");
      mkdirSync(storeDir, { recursive: true });
      const served = await startShiftManager({
        scratch: SCRATCH,
        label: `devteam-${label}`,
        config: join(profile, "fsdev.config.mts"),
        pages,
        env: { DEVTEAM_STORE: store, ...env },
        root: join(checkout.root, "packages", "shift-manager"),
        tsx: join(checkout.root, "node_modules", ".bin", "tsx"),
        timeoutMs: 180_000,
      });
      try {
        say(`attempt ${attempt} of ${attempts}, legs ${pending.join(", ")}: DevTeam at ${served.origin}; the chief of staff's defaults: [${defaults.join(", ")}]`);
        const ran = await devteamLegs({ origin: served.origin, store, shipped, alice, bob, defaults, legs: new Set(pending), asks, boardMailboxes: boardMailboxes(checkout.root), routeModels, say });
        for (const t of ran.turns) say(`attempt ${attempt} turn (${t.leg}) ${t.status}: tools ${t.tools.map((x) => x.name).join(", ") || "none"}; reply: ${t.reply.slice(0, 240).replace(/\n/g, " ")}${t.providerRetry === undefined ? "" : ` (re-run after a provider error: ${t.providerRetry})`}`);
        for (const l of pending) {
          const r = ran.legs[l];
          if (r === undefined) continue;
          say(`attempt ${attempt} leg ${l}: ${r.failures.length === 0 ? "PASS" : `FAIL (${[...new Set(r.failures.map((f) => f.split(" — ")[0]))].join(", ")})`}`);
          results[l] = { ...r, notes: [`attempt ${attempt} of ${attempts}`, ...r.notes] };
        }
        pending = pending.filter((l) => (ran.legs[l]?.failures.length ?? 1) > 0);
      } finally {
        await served.stop();
        rmSync(storeDir, { recursive: true, force: true });
      }
    }
    evidence.push(
      `DevTeam's chief of staff (${COS}) on ${checkout.describe}, its turn on ${cosModel}, Alice ${alice.userId} and Bob ${bob.userId}; ` +
        `each routed post's evaluation trace named ${[...new Set(routeModels)].join(", ") || "no model (no post was routed)"}`,
    );
  }

  if (legs.has("e")) {
    say("leg e: the goal-local coordinators");
    results.e = gradeE(await runLegE(checkout.root, env));
  }

  if (control !== undefined) {
    const marked = existsSync(mark) ? readFileSync(mark, "utf8") : "";
    if (!marked.includes(join(checkout.root, control.module))) {
      throw new Error(`setup: control ${control.name}'s patch never reached ${control.module} in the code under test, so this run shows nothing`);
    }
    say(`control ${control.name}: the patch reached ${control.module}`);
  }

  const failures: string[] = [];
  for (const l of [...legs].sort()) {
    const r = results[l];
    if (r === undefined) continue;
    for (const note of r.notes) say(`${l}: ${note}`);
    say(`leg ${l}: ${r.failures.length === 0 ? "PASS" : `FAIL (${[...new Set(r.failures.map((f) => f.split(" — ")[0]))].join(", ")})`}`);
    failures.push(...r.failures);
  }
  if (control !== undefined) {
    const named = failures.some((f) => f.startsWith(`${control.assertion} `));
    failures.unshift(
      named
        ? `control ${control.name}: leg ${control.leg} failed on ${control.assertion}, as it must`
        : `control ${control.name}: leg ${control.leg} did NOT fail on ${control.assertion}, so the check can't see what the control removes`,
    );
  }
  return { failures, evidence: `legs ${[...legs].sort().join(", ")} PASS; ${evidence.join("; ")}` };
});
