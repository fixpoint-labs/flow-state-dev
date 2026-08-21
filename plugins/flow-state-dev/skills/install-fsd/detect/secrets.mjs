/**
 * Resolutions 9 and 10 — what each secret variable **resolves to**, per runtime, and which files
 * are therefore about to hold a secret.
 *
 * Not a walk over `.env.local`. Two loaders read these files with different search rules and two
 * different tie-breaks:
 *
 * - **our CLI** (`loadEnvFiles`) walks from the write root **upward**; the first file that assigns
 *   a key wins, and within that file the **last** assignment wins. Inherited `process.env` beats
 *   every file.
 * - **`next dev`** (`@next/env`'s `loadEnvConfig`) reads **one directory** — no walk — in the
 *   order `.env.development.local`, `.env.local`, `.env.development`, `.env`. Inherited
 *   `process.env` beats every file here too.
 *
 * So nearest-wins across files and last-wins inside a file are opposite directions, and the two
 * runtimes disagree about an ancestor's value on purpose. A files-only scan reports `absent` for
 * an exported variable, and reports `absent` for a token sitting in `.env.development.local` —
 * then a fresh one gets generated that Next will ignore, and every request carrying it 401s with
 * nothing to explain why.
 *
 * **No secret value ever leaves this module.** Every answer is `absent` / `empty` / `non-empty`
 * plus the path that decided it. The report is JSON an assistant reads, so anything in it is in a
 * retained transcript — which is the same hazard the run refuses to create by asking for a key.
 * That covers the provider key the developer already had just as much as the token we generate;
 * a rule scoped to the secret we authored would leak the one we did not.
 */
import { existsSync } from "node:fs";
import { join } from "node:path";
import { CLI_ENV_FILE, DEMO_TOKEN_KEY, NEXT_DEV_ENV_FILES, SECRET_KEYS } from "./constants.mjs";
import { ancestorsFrom, isIgnoredByGit, isTrackedByGit, readIfPresent } from "./fs-util.mjs";
import { parseAsCli, parseAsNextDev } from "./env-parsers.mjs";

/** `absent` / `empty` / `non-empty` — the only three things this module will say about a value. */
function statusOf(value) {
  if (value === undefined) return "absent";
  return value === "" ? "empty" : "non-empty";
}

/**
 * Resolve one key the way our CLI would: inherited environment first, then `.env.local` from the
 * write root upward, first file that assigns it wins.
 */
export function resolveForCli(key, writeRoot, env) {
  if (Object.hasOwn(env, key)) {
    return { status: statusOf(env[key]), from: "the inherited environment", path: null };
  }
  for (const dir of ancestorsFrom(writeRoot)) {
    const path = join(dir, CLI_ENV_FILE);
    const content = readIfPresent(path);
    if (content === null) continue;
    const vars = parseAsCli(content);
    if (!vars.has(key)) continue;
    return { status: statusOf(vars.get(key)), from: "an env file", path };
  }
  return { status: "absent", from: null, path: null };
}

/**
 * Resolve one key the way `next dev` would: inherited environment first, then this **one**
 * directory's env files in Next's own order. There is no walk, which is why an ancestor's
 * perfectly good key is invisible to a mounted route.
 */
export function resolveForNextDev(key, writeRoot, env) {
  if (Object.hasOwn(env, key)) {
    return { status: statusOf(env[key]), from: "the inherited environment", path: null };
  }
  for (const name of NEXT_DEV_ENV_FILES) {
    const path = join(writeRoot, name);
    const content = readIfPresent(path);
    if (content === null) continue;
    const vars = parseAsNextDev(content);
    if (!vars.has(key)) continue;
    const entry = vars.get(key);
    // Expansion is Next's, not ours. We do not run it, so we do not claim to know the value.
    if (entry.expands) return { status: "unreadable", from: "an env file", path };
    return { status: statusOf(entry.value), from: "an env file", path };
  }
  return { status: "absent", from: null, path: null };
}

/**
 * Resolution 9 for every secret variable — all three provider keys and the demo token.
 *
 * All of them, not the chosen one, and that is what makes the ordering satisfiable at all. The
 * provider key's *name* depends on an answer the developer has not given when detection runs, so
 * a detector asked for "the effective credential" would have to guess a name or re-read the
 * repository after the answer. The candidate set is closed at three, so detection resolves every
 * one and the answer merely *selects*. Refusals that do not depend on the answer can then fire
 * before it is asked.
 */
export function resolveSecrets(writeRoot, host, env = process.env) {
  const secrets = {};
  for (const key of SECRET_KEYS) {
    const cli = resolveForCli(key, writeRoot, env);
    const next = host === "next" ? resolveForNextDev(key, writeRoot, env) : null;
    secrets[key] = {
      cli,
      next,
      // A divergence is reported, never averaged: the same input genuinely has two answers,
      // because two loaders search differently, and a single-answer rule is wrong for one of them.
      divergent: next !== null && (next.status !== cli.status || next.path !== cli.path),
    };
  }
  return secrets;
}

/** The write root's own `.env.local` — the one file both loaders resolve, and the only one we write. */
export function ownEnvFile(writeRoot) {
  return join(writeRoot, CLI_ENV_FILE);
}

/**
 * Resolution 10 — the **set** of files that will hold a secret, and the git questions asked of
 * every one of them.
 *
 * A set rather than a file, because two secrets with two provenances point at two places: the
 * provider key may resolve to a workspace-root `.env.local` while the token is written to the
 * app's own. Written as a singular "the file that will be filled", the tracking check aimed at the
 * app sees a file that does not exist, reports untracked, and lets the run point a developer's
 * live credential at a committed file.
 *
 * The provider key is left where it resolves — we never write a second assignment for a key the
 * loader already sees, because `""` counts as set and a nearer empty line masks a working parent.
 * The token is different and deliberately so: an ancestor's token belongs to another app, `next
 * dev` cannot see it, and a workspace-wide token means one leak reaches every sibling. So it is
 * always written to the write root's own file.
 */
/**
 * How a secret's value comes to exist. **The only thing that differs between secrets**, and the
 * reason there is one destination rule rather than one per key.
 *
 * The demo token used to have its own hand-written branch that consulted the CLI answer alone,
 * which is the same defect the provider keys had a round earlier. Two call sites that agree today
 * are not one rule; they are a sibling waiting to diverge.
 */
export const PROVENANCE = { developer: "developer", generated: "generated" };

/** Which provenance each secret has. Every key in `SECRET_KEYS` must appear here. */
export function provenanceOf(key) {
  return key === DEMO_TOKEN_KEY ? PROVENANCE.generated : PROVENANCE.developer;
}

/**
 * Where one secret's value will be written or filled, **per runtime**, for either provenance.
 *
 * One rule table. The runtime loop is the point: a secret resolved by two loaders has two answers
 * and either can name the file that ends up holding a value, so both are always consulted. The
 * provenance changes exactly one row — what to do when the value already exists somewhere we are
 * not writing.
 *
 * @returns `{ destinations, consulted }` — `consulted` names the runtimes actually examined, so
 *   the caller can prove no secret was resolved from half its loaders.
 */
function destinationsFor(key, resolution, { writeRoot, own, provenance }) {
  const destinations = [];
  const consulted = [];

  for (const [runtime, answer] of [
    ["your CLI", resolution.cli],
    ["next dev", resolution.next],
  ]) {
    // `null` means this runtime does not read env for this host at all — a plain-Node project has
    // no `next dev`. That is "not applicable", not "not consulted".
    if (answer === null) continue;
    consulted.push(runtime);

    if (answer.status === "non-empty") {
      const inWriteRoot = answer.path !== null && answer.path.startsWith(`${writeRoot}/`);
      if (inWriteRoot) {
        // A file inside the write root already holding this value. It decides what this runtime
        // sees, so it must reach the tracked-git check — including `.env.development.local`,
        // which `next dev` reads BEFORE `.env.local` and which would silently shadow a token
        // generated beside it.
        destinations.push({
          path: answer.path,
          reason:
            provenance === PROVENANCE.generated
              ? `${key} already has a value here and will be reused; ${runtime} resolves it`
              : `${key} already has a value here, and ${runtime} resolves it`,
        });
      } else if (provenance === PROVENANCE.generated) {
        // An ancestor's token belongs to another app: `next dev` cannot see it, and a
        // workspace-wide token means one leak reaches every sibling. We write our own.
        destinations.push({ path: own, reason: `${key} will be generated here (the value ${runtime} finds is another project's)` });
      }
      // A developer's credential outside the write root is theirs to keep where it is.
      continue;
    }

    if (answer.status === "empty" && answer.path !== null) {
      destinations.push({ path: answer.path, reason: `${key} is an empty assignment here, and this is the line ${runtime} resolves` });
      continue;
    }
    if (answer.status === "unreadable" && answer.path !== null) {
      destinations.push({ path: answer.path, reason: `${key} here expands a variable ${runtime} resolves and we do not` });
      continue;
    }
    // Absent for this runtime: the write root's own file is where it goes, whether the developer
    // fills it or we generate it.
    destinations.push({
      path: own,
      reason:
        provenance === PROVENANCE.generated
          ? `${key} will be generated here`
          : `${key} will be written here as an empty line for you to fill`,
    });
  }

  return { destinations, consulted };
}

/**
 * Resolution 10 — the **set** of files about to hold a secret, and the git questions asked of
 * every one.
 *
 * Every secret goes through {@link destinationsFor}. `coverage` records which runtimes each key
 * was resolved from, and `test/secrets.test.mjs` asserts it accounts for **every** key in
 * `SECRET_KEYS` — so a seventh secret wired directly, or a key resolved from half its loaders,
 * fails a test instead of surfacing as next round's finding.
 */
export function resolveSecretFiles(writeRoot, secrets, { providerKey = null } = {}) {
  const files = new Map();
  const own = ownEnvFile(writeRoot);
  const coverage = {};

  // The demo token is always in scope — the run authors it. A provider key is in scope once the
  // developer has chosen one; before that, resolution 9 has already resolved all three by name.
  const inScope = SECRET_KEYS.filter(
    (key) => provenanceOf(key) === PROVENANCE.generated || key === providerKey,
  );

  for (const key of inScope) {
    const resolution = secrets[key];
    if (resolution === undefined) continue;
    const { destinations, consulted } = destinationsFor(key, resolution, {
      writeRoot,
      own,
      provenance: provenanceOf(key),
    });
    coverage[key] = consulted;
    for (const { path, reason } of destinations) {
      const existing = files.get(path);
      if (existing === undefined) files.set(path, { path, reasons: [reason] });
      else if (!existing.reasons.includes(reason)) existing.reasons.push(reason);
    }
  }

  const entries = [...files.values()].map((entry) => ({
    ...entry,
    exists: existsSync(entry.path),
    tracked: isTrackedByGit(entry.path),
    // Kept because sub-PR c's write step needs it: the run must not create a secret file that git
    // would not ignore, and that question is answered here from unmodified state.
    ignored: isIgnoredByGit(entry.path),
  }));
  entries.coverage = coverage;
  return entries;
}
