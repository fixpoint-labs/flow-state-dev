#!/usr/bin/env node
/**
 * Re-derive FIX-1496's factual base from the repository.
 *
 * Throwaway evidence, deleted at S8 (`PLAN.md` → the sunset rule). What it
 * checks, why, and every planted control: see `README.md` beside this file.
 *
 * Run:  node specs/issues/FIX-1496/poc/gap-check/check.mjs [--plant <kind>|list]
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const REPO = fileURLToPath(new URL("../../../../../", import.meta.url));
const LAB = join(REPO, "goals/devforce-lab");
const SIBLINGS = ["goals/pentest-lab", "goals/manager-queue-lab"];

/**
 * The browsable child-session surface FIX-1440 removes.
 *
 * Case-insensitive and anchored on the canonical client method
 * (`listChildSessions`, `packages/client/src/session-client/sessions.ts`) and
 * its types. The first version of this pattern spelled `childSessions` with a
 * lower-case c and therefore could not match `listChildSessions` — the exact
 * call it existed to catch. Found by reproduction, not by reading, which is why
 * `browse-surface` below is now a planted control.
 */
const BROWSE_SURFACE = /\/children\b|childsession|listchildren/i;

/** Dispatch parentage read as provenance — the form FIX-1440 explicitly keeps. */
const PROVENANCE = /parentage:\s*\{\s*parentOf/;

const PLANTS = [
  "unclassified-file",
  "channel-is-opened",
  "durable-stores",
  "model-check-passed",
  "browse-surface",
  "provenance-gone",
  "sibling-lost-channel",
  "artifact-pushed",
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

// Plants are applied to the in-memory copy only; nothing on disk is touched, so
// a control run cannot leave the repository perturbed.
let tree = filesUnder(LAB);
const patch = (match, fn) => {
  tree = tree.map(([p, t]) => (p.includes(match) ? [p, fn(t)] : [p, t]));
};

if (plant === "unclassified-file") {
  tree = [...tree, ["goals/devforce-lab/lab/workforce/flows/helpers.ts", "// planted\n"]];
}
if (plant === "channel-is-opened") {
  patch("lab/host.mts", (t) => `${t}\n// planted: await openChannels(channels, {});\n`);
}
if (plant === "durable-stores") {
  patch("it-commits-from-the-seats-own-file", (t) => t.replace(/inMemoryStores\(\)/g, "sqliteStores()"));
}
if (plant === "model-check-passed") {
  patch("it-commits-from-the-seats-own-file/goal.md", (t) => t.replace("| NOT RUN |", "| PASS |"));
}
if (plant === "browse-surface") {
  // The canonical call, spelled exactly as the client exports it. This is the
  // case the first pattern missed while reporting green.
  patch("lab/host.mts", (t) => `${t}\nconst rows = await client.sessions.listChildSessions(id);\n`);
}
if (plant === "provenance-gone") {
  patch("lab/host.mts", (t) => t.replace(/parentage:\s*\{\s*parentOf/, "filter: { startedBy"));
}
if (plant === "artifact-pushed") {
  patch("lab/scratch-repo.mts", (t) => `${t}\n// planted\nexport const publish = (d) => git("push", "origin", d);\n`);
}

let siblingDirs = SIBLINGS;
if (plant === "sibling-lost-channel") siblingDirs = [...SIBLINGS, "goals/task-board"];

const body = (suffix) => tree.filter(([p]) => p.endsWith(suffix)).map(([, t]) => t).join("\n");

// --- Claim 0 — totality. Fatal: every claim below reads a subset of these. ---
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

// --- Claim 1 — two goal checks, one model-backed, never a passing run. ---
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
  const verdicts = (honesty?.[1] ?? "").split("\n").filter((l) => /^\|\s*\d{4}-\d{2}-\d{2}/.test(l));
  const passes = verdicts.filter((l) => /\|\s*PASS/.test(l));
  claim(
    verdicts.length > 0 && passes.length === 0,
    `the model-backed check records ${passes.length} passing verdict(s); the spec's whole ` +
      `premise is that it has never been run`,
    `the model-backed check records ${verdicts.length} verdict row(s) and none of them is a PASS`,
  );
}

// --- Claim 2 — the artifact does not outlive the run. ---
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
    `the artifact's repository helper now pushes or calls gh, so the artifact may already ` +
      `leave the run`,
    `nothing in the artifact's repository helper pushes or calls gh`,
  );
}

// --- Claim 3 — the model-backed check runs on stores that do not survive it. ---
{
  claim(
    /inMemoryStores\(\)/.test(body("it-commits-from-the-seats-own-file/run.mts")),
    `the model-backed check no longer runs on inMemoryStores(), so ER-3's "durable across the ` +
      `run" may already be met`,
    `the model-backed check runs on inMemoryStores(), which ER-3 calls not durable`,
  );
}

// --- Claim 4 — the channel is walked but never opened, while siblings open theirs. ---
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

  // The positive half. Without it, "devforce does not open a channel" is
  // equally true of a framework that has no channels at all.
  const open = siblingDirs.filter((dir) =>
    filesUnder(join(REPO, dir)).some(([, t]) => /\bopenChannels\s*\(/.test(t)),
  );
  claim(
    open.length === siblingDirs.length,
    `only ${open.length} of ${siblingDirs.length} sibling labs open a channel, so "the path is ` +
      `already proven next door" is weaker than the spec claims: ` +
      `${siblingDirs.filter((d) => !open.includes(d)).join(", ")} does not`,
    `all ${siblingDirs.length} sibling labs open a channel on the same primitive`,
  );
}

// --- Claim 5 — FIX-1440 does not fence this work. ---
{
  const browse = tree.filter(([, t]) => BROWSE_SURFACE.test(t));
  claim(
    browse.length === 0,
    `the lab reads the child-session browse surface FIX-1440 removes ` +
      `(${browse.map(([p]) => p).join(", ")}), so this work IS fenced by FIX-1440`,
    `nothing in the lab reads the browsable child-session surface FIX-1440 removes ` +
      `(pattern covers the canonical listChildSessions)`,
  );

  const provenance = tree.filter(([, t]) => PROVENANCE.test(t));
  claim(
    provenance.length >= 1,
    `the lab no longer reads dispatch parentage as provenance, so the FIX-1440 finding needs ` +
      `re-deriving rather than carrying forward`,
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
