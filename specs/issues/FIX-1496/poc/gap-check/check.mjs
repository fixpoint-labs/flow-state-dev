#!/usr/bin/env node
/**
 * Re-derive FIX-1496's factual base from the repository, rather than trusting
 * the spec's prose.
 *
 * The spec's whole argument is a gap table: ER-DevForce is mostly built, and
 * exactly four things are missing. A hand-counted table like that does not
 * converge by being argued about in review — each round corrects one row and
 * leaves the ones nobody looked at. So it gets a checker, and the checker gets
 * the two properties a hand-written one always lacks.
 *
 * **A totality assertion.** Every `.mts` file under `goals/devforce-lab/` is
 * classified as lab code, a goal runner, or a fixture. A checker that only
 * inspects the files it already knew about cannot report the one nobody listed.
 *
 * **A negative control.** `--plant <kind>` injects the exact defect a claim
 * exists to catch, so the green can be watched going red before it is believed.
 *
 * Throwaway evidence, not production code. Nothing imports it, it is not a
 * workspace package, and it is not in any build, test or lint discovery path.
 *
 * Run:     node specs/issues/FIX-1496/poc/gap-check/check.mjs
 * Control: node specs/issues/FIX-1496/poc/gap-check/check.mjs --plant unclassified-file
 *          node specs/issues/FIX-1496/poc/gap-check/check.mjs --plant channel-is-opened
 *          node specs/issues/FIX-1496/poc/gap-check/check.mjs --plant durable-stores
 *          node specs/issues/FIX-1496/poc/gap-check/check.mjs --plant model-check-passed
 *          node specs/issues/FIX-1496/poc/gap-check/check.mjs --plant list
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const REPO = fileURLToPath(new URL("../../../../../", import.meta.url));
const LAB = join(REPO, "goals/devforce-lab");
const SIBLINGS = ["goals/pentest-lab", "goals/manager-queue-lab"];

const PLANTS = [
  "unclassified-file",
  "channel-is-opened",
  "durable-stores",
  "model-check-passed",
];

const plant = (() => {
  const i = process.argv.indexOf("--plant");
  if (i === -1) return undefined;
  const value = process.argv[i + 1];
  if (value === "list") {
    console.log(PLANTS.join("\n"));
    process.exit(0);
  }
  if (!PLANTS.includes(value)) {
    console.error(`unknown plant "${value}"; one of: ${PLANTS.join(", ")}`);
    process.exit(2);
  }
  return value;
})();

/** Every file under a directory, recursively, as [repo-relative path, contents]. */
function filesUnder(root) {
  const out = [];
  for (const entry of readdirSync(root)) {
    const full = join(root, entry);
    if (statSync(full).isDirectory()) out.push(...filesUnder(full));
    else out.push([relative(REPO, full), readFileSync(full, "utf8")]);
  }
  return out;
}

const failures = [];
const evidence = [];
const claim = (ok, red, green) => (ok ? evidence.push(green) : failures.push(red));

// The tree, with the plant applied to the in-memory copy only. Nothing on disk
// is touched, so a control run cannot leave the repository perturbed.
let tree = filesUnder(LAB);
if (plant === "unclassified-file") {
  tree = [...tree, ["goals/devforce-lab/lab/workforce/flows/helpers.ts", "// planted\n"]];
}
if (plant === "channel-is-opened") {
  tree = tree.map(([p, t]) =>
    p.endsWith("lab/host.mts") ? [p, `${t}\n// planted: await openChannels(channels, {});\n`] : [p, t],
  );
}
if (plant === "durable-stores") {
  tree = tree.map(([p, t]) =>
    p.includes("it-commits-from-the-seats-own-file")
      ? [p, t.replace(/inMemoryStores\(\)/g, "sqliteStores()")]
      : [p, t],
  );
}
if (plant === "model-check-passed") {
  tree = tree.map(([p, t]) =>
    p.endsWith("it-commits-from-the-seats-own-file/goal.md")
      ? [p, t.replace("| NOT RUN |", "| PASS |")]
      : [p, t],
  );
}

const text = (suffix) => tree.filter(([p]) => p.endsWith(suffix));
const body = (suffix) => text(suffix).map(([, t]) => t).join("\n");

// ---------------------------------------------------------------------------
// Claim 0 — totality. Every .mts under the lab is one of three known kinds.
//
// This runs first and its failure is fatal: every claim below reads a subset of
// these files, and a file none of them classified is a file none of them saw.
// ---------------------------------------------------------------------------
{
  const mts = tree.filter(([p]) => p.endsWith(".mts") || p.endsWith(".ts"));
  const unclassified = mts.filter(([p]) => {
    const isRunner = /goals\/devforce-lab\/[^/]+\/run\.mts$/.test(p);
    const isLabRoot = /goals\/devforce-lab\/lab\/[^/]+\.mts$/.test(p);
    const isLabKind = /goals\/devforce-lab\/lab\/workforce\/flows\/workers\/[^/]+\.mts$/.test(p);
    return !isRunner && !isLabRoot && !isLabKind;
  });
  claim(
    unclassified.length === 0,
    `${unclassified.length} TypeScript file(s) under the lab are classified by no rule, so no ` +
      `claim below inspected them: ${unclassified.map(([p]) => p).join(", ")}`,
    `all ${mts.length} TypeScript files under the lab are classified (runners, lab root, kinds)`,
  );
  if (unclassified.length > 0) {
    report();
    process.exit(1);
  }
}

// ---------------------------------------------------------------------------
// Claim 1 — two goal checks, exactly one of them model-backed, and the
// model-backed one has never recorded a passing run.
// ---------------------------------------------------------------------------
{
  const goals = tree.filter(([p]) => p.endsWith("/goal.md")).map(([p]) => p);
  claim(
    goals.length === 2,
    `the lab holds ${goals.length} goal checks, not the 2 the spec counts: ${goals.join(", ")}`,
    `the lab holds exactly 2 goal checks`,
  );

  const modelBacked = tree.filter(([, t]) => /^\*\*Model:\*\*\s*real/m.test(t));
  claim(
    modelBacked.length === 1,
    `${modelBacked.length} goal checks declare a real model, not 1`,
    `exactly 1 goal check declares a real model (${modelBacked[0]?.[0] ?? "-"})`,
  );

  const honesty = tree.find(([p]) => p.endsWith("it-commits-from-the-seats-own-file/goal.md"));
  const verdicts = (honesty?.[1] ?? "")
    .split("\n")
    .filter((line) => /^\|\s*\d{4}-\d{2}-\d{2}/.test(line));
  const passes = verdicts.filter((line) => /\|\s*PASS/.test(line));
  claim(
    verdicts.length > 0 && passes.length === 0,
    `the model-backed check records ${passes.length} passing verdict(s); the spec's whole ` +
      `premise is that it has never been run`,
    `the model-backed check records ${verdicts.length} verdict row(s) and none of them is a PASS`,
  );
}

// ---------------------------------------------------------------------------
// Claim 2 — the artifact does not outlive the run: the repository it is
// committed into is created under the OS temp directory.
// ---------------------------------------------------------------------------
{
  const scratch = body("lab/scratch-repo.mts");
  claim(
    /\btmpdir\(\)/.test(scratch) && /mkdtempSync/.test(scratch),
    `the scratch repository is no longer created under the OS temp directory, so the spec's ` +
      `"the artifact does not outlive the run" row is stale`,
    `the artifact's repository is created with mkdtempSync under tmpdir(), so it does not ` +
      `outlive the machine's temp sweep`,
  );
  claim(
    !/git\(\s*"push"/.test(scratch) && !/\bgh\b/.test(scratch),
    `the scratch repository now pushes or shells to gh, so the artifact may already leave the run`,
    `nothing in the artifact's repository helper pushes or calls gh`,
  );
}

// ---------------------------------------------------------------------------
// Claim 3 — the model-backed check runs on stores that do not survive it.
// ---------------------------------------------------------------------------
{
  const honesty = body("it-commits-from-the-seats-own-file/run.mts");
  claim(
    /inMemoryStores\(\)/.test(honesty),
    `the model-backed check no longer runs on inMemoryStores(), so ER-3's "durable across the ` +
      `run" may already be met`,
    `the model-backed check runs on inMemoryStores(), which ER-3 calls not durable`,
  );
}

// ---------------------------------------------------------------------------
// Claim 4 — the declared channel is walked but never opened, while the two
// sibling labs that prove the path both open theirs.
//
// The positive half is what makes this a gap rather than a missing primitive:
// a claim that only said "devforce does not open a channel" is equally true of
// a framework with no channels in it.
// ---------------------------------------------------------------------------
{
  const opensHere = tree.filter(([, t]) => /\bopenChannels\s*\(/.test(t)).map(([p]) => p);
  claim(
    opensHere.length === 0,
    `the devforce lab already opens a channel (${opensHere.join(", ")}), so the spec's channel ` +
      `gap is stale`,
    `no file in the devforce lab calls openChannels`,
  );

  const declared = tree.filter(([p]) => p.endsWith("/CHANNEL.md"));
  claim(
    declared.length >= 1,
    `the devforce lab declares no CHANNEL.md, so there is no channel to call unused`,
    `the devforce lab declares ${declared.length} channel file(s) that nothing opens`,
  );

  const siblingsThatOpen = SIBLINGS.filter((dir) =>
    filesUnder(join(REPO, dir)).some(([, t]) => /\bopenChannels\s*\(/.test(t)),
  );
  claim(
    siblingsThatOpen.length === SIBLINGS.length,
    `only ${siblingsThatOpen.length} of ${SIBLINGS.length} sibling labs open a channel, so ` +
      `"the path is already proven next door" is weaker than the spec claims`,
    `both sibling labs (${SIBLINGS.join(", ")}) open a channel on the same primitive`,
  );
}

// ---------------------------------------------------------------------------
// Claim 5 — nothing in the lab reads the browsable child-session surface
// FIX-1440 removes, so an unlanded FIX-1440 does not fence this work.
//
// `parentage` is provenance, which FIX-1440's own owner amendment keeps.
// ---------------------------------------------------------------------------
{
  const browse = tree.filter(([, t]) => /\/children\b|childSessions|listChildren/.test(t));
  claim(
    browse.length === 0,
    `the lab reads the child-session browse surface FIX-1440 removes (${browse
      .map(([p]) => p)
      .join(", ")}), so this work IS fenced by FIX-1440`,
    `nothing in the lab reads the browsable child-session surface FIX-1440 removes`,
  );

  const provenance = tree.filter(([, t]) => /parentage:\s*\{\s*parentOf/.test(t));
  claim(
    provenance.length >= 1,
    `the lab no longer reads dispatch parentage at all, so the FIX-1440 finding needs re-deriving`,
    `the lab reads dispatch parentage as provenance only (${provenance.length} site), which ` +
      `FIX-1440's owner amendment explicitly keeps`,
  );
}

function report() {
  for (const line of evidence) console.log(`  ok   ${line}`);
  for (const line of failures) console.log(`  FAIL ${line}`);
  console.log(
    `\n${failures.length === 0 ? "PASS" : "FAIL"} — ${evidence.length} claim(s) held, ` +
      `${failures.length} failed${plant === undefined ? "" : ` (plant: ${plant})`}`,
  );
}

report();
process.exit(failures.length === 0 ? 0 : 1);
