// ---------------------------------------------------------------------------
// Markdown link extraction + concept-ID resolution for the OKF adapter.
//
// OKF cross-links are STANDARD markdown links, not wikilinks (SPEC §5), so a
// constrained link regex is sufficient — a wikilink parser would only matter
// for a future Obsidian-vault importer (a non-goal). Links that point outside
// the bundle (http(s)/mailto), pure anchors, or non-`.md` targets are not
// concept edges and are dropped here. Bundle-relative (`/a/b.md`) and relative
// (`./b.md`, `../b.md`) targets are resolved to a concept ID (the bundle path
// minus `.md`), which is also the FSD collection key.
// ---------------------------------------------------------------------------

/**
 * Matches `[text](target)` and `[text](target "title")`, capturing the target.
 * The `(?<!!)` lookbehind skips image syntax `![alt](src)` — an image is not a
 * prose cross-link and must not become a concept edge (OKF links are §5 prose).
 */
const MARKDOWN_LINK = /(?<!!)\[(?:[^\]]*)\]\(\s*([^)\s]+)(?:\s+"[^"]*")?\s*\)/g;

/** All raw link targets in a markdown body, in document order (may include externals). */
export function extractLinkTargets(body: string): string[] {
  const targets: string[] = [];
  for (const match of body.matchAll(MARKDOWN_LINK)) {
    targets.push(match[1]!);
  }
  return targets;
}

/**
 * Resolve a raw link target to the concept ID it points at, or `null` when the
 * target is not an in-bundle concept link (external URL, mailto, bare anchor, or
 * a non-`.md` path). `fromConceptId` anchors relative resolution to the linking
 * concept's directory.
 */
export function resolveLinkToConceptId(target: string, fromConceptId: string): string | null {
  if (/^(https?:|mailto:|tel:)/i.test(target) || target.startsWith("#")) return null;

  // Drop any query/fragment before resolving the path.
  const pathPart = target.split(/[?#]/)[0]!;
  if (!pathPart.endsWith(".md")) return null;

  // Resolve absolute (`/a/b.md`) and relative (`./b.md`, `../b.md`) targets
  // through the same segment resolver. Absolute paths resolve from an empty
  // base (the bundle root); relative paths from the linking concept's dir. A
  // valid internal `..` (e.g. `/a/../b.md` -> `b`) resolves normally; only a
  // `..` that pops above the root returns null (the link escaped the bundle).
  const isAbsolute = pathPart.startsWith("/");
  const base = isAbsolute
    ? ""
    : fromConceptId.includes("/")
      ? fromConceptId.slice(0, fromConceptId.lastIndexOf("/"))
      : "";
  const rel = isAbsolute ? pathPart.slice(1) : pathPart;

  const resolved = joinPosix(base, rel);
  if (resolved === null) return null; // link traversed above the bundle root

  const id = resolved.slice(0, -3); // strip `.md`
  return id.length > 0 ? id : null;
}

/**
 * Resolve `.`/`..` segments against a base directory, POSIX-style, no leading
 * slash. Returns `null` when a `..` pops above the base — a link that escapes
 * the bundle root is not an in-bundle concept and must not be clamped to one.
 */
function joinPosix(dir: string, rel: string): string | null {
  const base = dir.length > 0 ? dir.split("/") : [];
  for (const seg of rel.split("/")) {
    if (seg === "." || seg === "") continue;
    if (seg === "..") {
      if (base.length === 0) return null;
      base.pop();
    } else {
      base.push(seg);
    }
  }
  return base.join("/");
}
