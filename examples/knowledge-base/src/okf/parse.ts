// ---------------------------------------------------------------------------
// parseOkfBundle — walk an on-disk OKF bundle into structured concepts.
//
// Recursively reads every markdown file under the bundle root, skipping the
// reserved `index.md` / `log.md` filenames at every level (SPEC §3.1). Each
// concept's frontmatter is split (YAML 1.2), its body normalized, and its
// in-bundle links resolved to concept IDs. Parsing is best-effort: an
// unreadable directory is fatal, but a malformed individual concept becomes a
// warning, not a thrown error (SPEC §9).
// ---------------------------------------------------------------------------

import { promises as fs } from "node:fs";
import * as path from "node:path";
import { splitFrontmatter } from "./frontmatter";
import { extractLinkTargets, resolveLinkToConceptId } from "./links";
import { RESERVED_FILENAMES, type OkfConcept, type ParsedOkfBundle } from "./types";

/**
 * Walk `dir` and return its concepts plus bundle-level metadata. `okfVersion`
 * is read from the root `index.md` frontmatter when present. Throws only if the
 * bundle root cannot be read; per-concept problems are collected in `warnings`.
 */
export async function parseOkfBundle(dir: string): Promise<ParsedOkfBundle> {
  const warnings: string[] = [];
  const files = await walkMarkdownFiles(dir, dir);

  const concepts: OkfConcept[] = [];
  for (const abs of files) {
    const rel = toPosix(path.relative(dir, abs));
    if (isReserved(rel)) continue;

    const id = rel.slice(0, -3); // strip `.md`
    let raw: string;
    try {
      raw = await fs.readFile(abs, "utf8");
    } catch {
      warnings.push(`${id}: unreadable, skipped`);
      continue;
    }

    // Best-effort (SPEC §9): a YAML/parse failure on one concept is a warning +
    // skip, not a rejection of the whole bundle.
    try {
      const { data, body } = splitFrontmatter(raw);
      const links = dedupe(
        extractLinkTargets(body)
          .map((target) => resolveLinkToConceptId(target, id))
          .filter((t): t is string => t !== null),
      );
      concepts.push({ id, frontmatter: data, body, links });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      warnings.push(`${id}: failed to parse (${msg}); skipped`);
    }
  }

  concepts.sort((a, b) => a.id.localeCompare(b.id));

  return {
    concepts,
    okfVersion: await readOkfVersion(dir),
    warnings,
  };
}

/** Recursively collect absolute paths of every `.md` file under `dir`. */
async function walkMarkdownFiles(root: string, dir: string): Promise<string[]> {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  const out: string[] = [];
  for (const entry of entries) {
    const abs = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...(await walkMarkdownFiles(root, abs)));
    } else if (entry.isFile() && entry.name.endsWith(".md")) {
      out.push(abs);
    }
  }
  return out;
}

/** A path is reserved when its FINAL segment is a reserved filename (any level). */
function isReserved(relPath: string): boolean {
  const base = relPath.slice(relPath.lastIndexOf("/") + 1);
  return (RESERVED_FILENAMES as readonly string[]).includes(base);
}

/** Read `okf_version` from the bundle-root `index.md` frontmatter, if any. */
async function readOkfVersion(dir: string): Promise<string | null> {
  const raw = await readOptionalFile(path.join(dir, "index.md"));
  if (raw === null) return null;
  const { data } = splitFrontmatter(raw);
  return typeof data.okf_version === "string" ? data.okf_version : null;
}

async function readOptionalFile(file: string): Promise<string | null> {
  try {
    return await fs.readFile(file, "utf8");
  } catch {
    return null;
  }
}

function toPosix(p: string): string {
  return p.split(path.sep).join("/");
}

function dedupe(items: string[]): string[] {
  return [...new Set(items)];
}
