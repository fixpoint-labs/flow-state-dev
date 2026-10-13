/**
 * Where a coding harness session works: its own git worktree of the
 * repository, on its own branch, kept outside the checkout.
 *
 * Server only. One place per session, keyed on the flow kind, the tenant and
 * the session, and the same place every turn and after a restart. The first
 * turn cuts it from the repository's `HEAD`; nothing is fetched. Nothing here
 * clears a place: a session going idle, being deleted, or the server
 * restarting leaves its worktree and branch for the person to take.
 *
 * The git is `@flow-state-dev/workspace`'s local-repository host, the one
 * harness-manager uses. Kitchen Sink runs no git and makes no directory of its
 * own.
 *
 * The root is derived from the repository, never set:
 * `${XDG_STATE_HOME:-~/.local/state}/flow-state-dev/kitchen-sink-harness/<name>-<hash>/`,
 * where the hash is the first 12 hex of the SHA-256 of the repository's real
 * path. Outside the checkout, so the checkout's own test globs, typecheck and
 * file watchers never walk into a full copy of it.
 */
import { createHash } from "node:crypto";
import { existsSync, realpathSync } from "node:fs";
import { homedir } from "node:os";
import { basename, isAbsolute, join } from "node:path";
import { localWorkspaceHost } from "@flow-state-dev/workspace";

/** The environment the root is derived from. */
export type WorktreeEnv = Readonly<Record<string, string | undefined>>;

/** Who a session belongs to, as the framework names it. Never read from the request body. */
export interface SessionPlace {
  /** The session's flow kind, one per harness mode. */
  readonly flowKind: string;
  /** The authenticated tenant, when the host has one. */
  readonly tenantId?: string;
  readonly sessionId: string;
}

/** A session's worktree, provisioned. */
export interface SessionWorktree {
  /** The worktree's directory, where the run works. */
  readonly path: string;
  /** The session's branch, in the repository. */
  readonly branch: string;
}

/** A flow kind is ours: lowercase words joined by single dashes, so `--` can frame the tenant. */
const FLOW_KIND = /^[a-z0-9]+(-[a-z0-9]+)*$/;

/** A segment longer than this is named by its digest instead. Filenames stop at 255 bytes. */
const MAX_SEGMENT = 64;

/**
 * The directory every worktree of `repository` lives under.
 *
 * @param repository The top level of the checkout, as `readHarnessWorkspace` returns it.
 * @param env The environment `XDG_STATE_HOME` is read from; the process's own by default.
 */
export function worktreeRoot(repository: string, env: WorktreeEnv = process.env): string {
  const real = realpathSync(repository);
  const stateHome = env.XDG_STATE_HOME;
  // The XDG spec ignores a relative value, and so does this.
  const base = stateHome !== undefined && isAbsolute(stateHome) ? stateHome : join(homedir(), ".local", "state");
  const hash = createHash("sha256").update(real).digest("hex").slice(0, 12);
  return join(base, "flow-state-dev", "kitchen-sink-harness", `${basename(real)}-${hash}`);
}

/**
 * One id as one path segment and one branch component, injectively.
 *
 * Lowercase letters, digits and `-` stay as they are, so a session id the
 * server minted (`sess_1760…`, as `sess__1760…`) still reads as itself in the
 * branch. `_` is the escape: a literal `_` is `__`, and every other UTF-16
 * code unit is `_` and four hex digits. What remains is what both the
 * workspace host's branch names and a directory accept (`[a-z0-9_-]`):
 * case-folding filesystems can't merge two ids, no `/`, `.`, `..` or `+`
 * survives, and a lone surrogate keeps its own spelling. An empty id is `_e`,
 * and one too long for a filename is `_h` and its SHA-256 over UTF-16: no
 * escape spells either, since `_e` is too short for one and `h` is not a hex
 * digit.
 */
export function idSegment(value: string): string {
  let out = "";
  for (let i = 0; i < value.length; i += 1) {
    const unit = value.charCodeAt(i);
    const char = value[i]!;
    out += char === "_" ? "__" : /[a-z0-9-]/.test(char) ? char : `_${unit.toString(16).padStart(4, "0")}`;
  }
  if (out === "") return "_e";
  if (out.length <= MAX_SEGMENT) return out;
  return `_h${createHash("sha256").update(Buffer.from(value, "utf16le")).digest("hex")}`;
}

/** The place's segments under the root: the flow kind (with the tenant, when there is one) and the session. */
function placeSegments(place: SessionPlace): [string, string] {
  if (!FLOW_KIND.test(place.flowKind)) {
    throw new Error(`[kitchen-sink] "${place.flowKind}" is not a harness flow kind: lowercase words joined by single dashes.`);
  }
  const kind = place.tenantId === undefined ? place.flowKind : `${place.flowKind}--${idSegment(place.tenantId)}`;
  return [kind, idSegment(place.sessionId)];
}

/**
 * A session's branch: `kitchen-sink/<flow kind>/<session>`, each segment
 * encoded. A tenant, when the host has one, rides on the flow kind's segment
 * (`<flow kind>--<tenant>`), so every branch has the same depth and none is a
 * prefix of another.
 */
export function sessionBranch(place: SessionPlace): string {
  const [kind, session] = placeSegments(place);
  return `kitchen-sink/${kind}/${session}`;
}

/**
 * Where a session's worktree is, without making it.
 *
 * Its real path once it exists, so the run's directory and a sandbox naming
 * it agree when the state directory sits behind a symlink.
 */
export function locateSessionWorktree(repository: string, place: SessionPlace, env: WorktreeEnv = process.env): string {
  const located = hostFor(repository, env).locate(sourceFor(repository), { place: placeSegments(place) }).cwd;
  return existsSync(located) ? realpathSync(located) : located;
}

/**
 * Give a session its worktree: cut on the first turn from the repository's
 * `HEAD`, on the session's branch, and handed back as it is on every later
 * turn. Never reset, forced or cleared.
 */
export async function provisionSessionWorktree(
  repository: string,
  place: SessionPlace,
  env: WorktreeEnv = process.env,
): Promise<SessionWorktree> {
  const branch = sessionBranch(place);
  const provisioned = await hostFor(repository, env).provision(sourceFor(repository), {
    place: placeSegments(place),
    branch,
  });
  return { path: realpathSync(provisioned.cwd), branch };
}

function sourceFor(repository: string) {
  return { kind: "repo" as const, repo: realpathSync(repository), baseRef: "HEAD" };
}

/** The host for one repository. The repository is the operator's allowance; no remote is reached. */
function hostFor(repository: string, env: WorktreeEnv) {
  const repo = realpathSync(repository);
  return localWorkspaceHost({
    root: worktreeRoot(repo, env),
    remotes: { allow: [] },
    localRepositories: [repo],
    source: () => sourceFor(repo),
  });
}
