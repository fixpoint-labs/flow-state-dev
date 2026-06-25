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

  let resolved: string;
  if (pathPart.startsWith("/")) {
    resolved = pathPart.slice(1);
  } else {
    const dir = fromConceptId.includes("/") ? fromConceptId.slice(0, fromConceptId.lastIndexOf("/")) : "";
    resolved = joinPosix(dir, pathPart);
  }

  const id = normalizeSegments(resolved.slice(0, -3));
  return id.length > 0 ? id : null;
}

/** Resolve `.`/`..` segments against a base directory, POSIX-style, no leading slash. */
function joinPosix(dir: string, rel: string): string {
  const base = dir.length > 0 ? dir.split("/") : [];
  for (const seg of rel.split("/")) {
    if (seg === "." || seg === "") continue;
    if (seg === "..") base.pop();
    else base.push(seg);
  }
  return base.join("/");
}

/** Collapse `.` segments and strip empties in an already-absolute concept path. */
function normalizeSegments(path: string): string {
  return path
    .split("/")
    .filter((seg) => seg.length > 0 && seg !== ".")
    .join("/");
}
