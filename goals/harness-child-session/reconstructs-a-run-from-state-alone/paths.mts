/**
 * How this check addresses a row and decides two spellings name one file.
 *
 * Shared by the reader and the grader so there is one rule, not two. It imports
 * nothing — assertion 8 scans this file as well as the reader, because a local
 * module the reader imports is a second way to reach the filesystem.
 *
 * ## Matching is a CANDIDATE relation, and a non-unique match is not a match
 *
 * The two surfaces spell a path differently: the collection canonicalizes
 * against the run's working directory and prefixes a namespace, the item stream
 * carries the raw tool input. Reimplementing the recorder's canonicalization
 * here would couple this check to a storage-key layout that is not a contract —
 * and it already gained a segment once mid-build. So {@link sameFile} compares
 * whole trailing segments instead.
 *
 * The cost is real and is the whole reason this file has a header: when one
 * side is shorter — a run that names a file relatively, `index.ts` rather than
 * `/tmp/x/src/index.ts` — the comparison can be true of MORE THAN ONE
 * candidate. `src/index.ts` and `test/index.ts` are ordinary in a repository,
 * and a sub-agent touches paths the fixture never named.
 *
 * **So no caller may pick one.** Every call site counts its candidates and
 * treats two-or-more as a state it cannot resolve: the reader leaves the
 * derived path and position null, and the grader fails by name. A wrong
 * assignment would let assertion 2 pass while a mutation record is genuinely
 * missing — the exact failure it exists to catch, in the artifact carrying this
 * epic's proof. Converting it into a can't-tell is the same move every other
 * assertion here makes.
 *
 * Two rows legitimately sharing a tail is therefore fine as long as the stream
 * names them fully, which is the ordinary case; when it does not, this check
 * says so rather than guessing.
 */

/**
 * THE ONE PLACE a collection's per-run namespace is spelled.
 *
 * `topicPrefix` is matched against the STORAGE key, so it carries the
 * collection prefix as well as the request id. A row's full key is
 * `<collection>/<requestId>/<invocation>/…` — the invocation segment separates
 * repeat calls of the agent inside one request — so this prefix selects
 * everything one request did, which here is exactly one run.
 *
 * Nothing anywhere DECOMPOSES a key. A row's identity is its topic, carried
 * verbatim and compared by {@link sameFile}.
 */
export function namespaceFor(collection: string, runId: string): string {
  return `${collection}/${runId}/`;
}

/** Split a path into non-empty segments. */
function segmentsOf(path: string): string[] {
  return path.split("/").filter((s) => s.length > 0);
}

/**
 * Could these two spellings name the same file?
 *
 * True when the shorter one's segment list is a suffix of the longer's, so
 * `/tmp/run-1/src/a.ts` matches the recorder's `<req>/<inv>/tmp/run-1/src/a.ts`
 * and a bare `a.ts` matches both. WHOLE segments only — `notes.txt` must not
 * match `my-notes.txt`, which a plain `endsWith` would.
 *
 * **A candidate relation, not an identity.** Read the header before using it:
 * a caller that finds two candidates has found an ambiguity, not a match.
 */
export function sameFile(a: string, b: string): boolean {
  const sa = segmentsOf(a);
  const sb = segmentsOf(b);
  const n = Math.min(sa.length, sb.length);
  if (n === 0) return false;
  for (let i = 1; i <= n; i += 1) {
    if (sa[sa.length - i] !== sb[sb.length - i]) return false;
  }
  return true;
}
