/**
 * Who counts as a human — the guard the whole signal path rests on.
 *
 * `isHuman` is load-bearing in two directions at once. A bot review must never
 * satisfy an approval gate, and conductor's own comments must never come back
 * to it as signals: conductor answering a reviewer, then reading its own answer
 * as new feedback, is an infinite loop that costs money on every turn.
 *
 * So authorship is decided **structurally, from the author record GitHub sets**
 * — the account type, the `[bot]` login suffix, the configured bot list, and
 * conductor's own login. It is never decided from what the comment *says*. A
 * comment body is caller-controllable text; using it to decide whether a
 * message counts would let anyone impersonate a human reviewer, or conductor
 * itself, by writing the right words (BP-031).
 *
 * The bias is deliberate: an unattributable author is treated as **not human**.
 * The cost of that being wrong is a missed comment, which the next poll picks
 * up once the author is known. The cost of the opposite is a gate satisfied by
 * something nobody wrote.
 */

/** Conductor's view of who is a machine. Built once, read everywhere. */
export interface ConductorIdentity {
  /**
   * Conductor's own GitHub login, lowercased. Its own output is never a signal
   * and never satisfies a gate.
   */
  readonly selfLogin: string | null;
  /** Extra bot logins, lowercased — CI apps and reviewers without a `[bot]` suffix. */
  readonly botLogins: ReadonlySet<string>;
}

export interface IdentityOptions {
  /**
   * The login conductor posts as. Optional, but never absent by the time the
   * read path runs: `client.identity()` resolves it from `GET /user` when it
   * was not configured, and raises rather than handing back an identity that
   * cannot recognize conductor's own comments.
   */
  readonly selfLogin?: string;
  /** Additional logins to treat as machines. Case-insensitive. */
  readonly botLogins?: readonly string[];
}

/**
 * An author as GitHub reports it. Both fields are optional because the shape
 * differs across REST endpoints and webhook payloads, and a missing author is a
 * real case (a comment from a deleted account).
 */
export interface GitHubActor {
  readonly login?: string | null;
  /** `"User"`, `"Bot"`, or `"Organization"`. */
  readonly type?: string | null;
}

/** Extra structural evidence carried by some payloads but not others. */
export interface ActorEvidence {
  /** Webhook payloads set `performed_via_github_app` when an App acted. */
  readonly viaGitHubApp?: boolean;
}

/**
 * Build the identity every author check reads.
 *
 * @param options Conductor's own login and any extra bot logins.
 * @returns A normalized, lowercased identity.
 */
export function createIdentity(options: IdentityOptions = {}): ConductorIdentity {
  return {
    selfLogin: options.selfLogin ? options.selfLogin.toLowerCase() : null,
    botLogins: new Set((options.botLogins ?? []).map((login) => login.toLowerCase())),
  };
}

/**
 * True when this author is a human other than conductor.
 *
 * Every check below reads the author record. **None reads message text**, and
 * none may be added that does.
 *
 * @param actor The author GitHub reported, if any.
 * @param identity Conductor's own login and the configured bot list.
 * @param evidence Structural hints some payloads carry (`performed_via_github_app`).
 * @returns `false` for bots, for conductor itself, and for an unattributable author.
 */
export function isHumanActor(
  actor: GitHubActor | null | undefined,
  identity: ConductorIdentity,
  evidence: ActorEvidence = {},
): boolean {
  if (evidence.viaGitHubApp === true) return false;
  if (!actor) return false;

  const login = typeof actor.login === "string" ? actor.login.toLowerCase() : "";
  if (login === "") return false;

  if (typeof actor.type === "string" && actor.type.toLowerCase() === "bot") return false;
  if (login.endsWith("[bot]")) return false;
  if (identity.botLogins.has(login)) return false;
  if (identity.selfLogin !== null && login === identity.selfLogin) return false;

  return true;
}
