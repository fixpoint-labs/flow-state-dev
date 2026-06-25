// ---------------------------------------------------------------------------
// exportOkf — emit a concept collection as an on-disk OKF bundle.
//
// One `.md` file per concept (canonical frontmatter + verbatim body), plus a
// generated root `index.md` carrying `okf_version` and a progressive-disclosure
// listing (SPEC §6, §11). Links live in the body: import projected them into
// edges, and the verbatim body still carries them, so export does NOT re-emit
// body-resident links. Edges added programmatically (e.g. via the capability's
// `relate`) that are NOT already in the body are materialized once into a
// trailing `# Related` section — which a re-import then reads back as
// body-resident links, so a second export is byte-identical (the idempotency
// gate). Edge metadata (confidence/temporality) is dropped — lossy by design.
// ---------------------------------------------------------------------------

import { promises as fs } from "node:fs";
import * as path from "node:path";
import type { ResourceCollectionRef, ResourceRef } from "@flow-state-dev/core/types";
import { getPatternPrefix } from "@flow-state-dev/core/types";
import { emitConceptFile, emitRootIndex, normalizeBody } from "./frontmatter";
import { extractLinkTargets, resolveLinkToConceptId } from "./links";
import { OKF_VERSION } from "./types";
import { conceptIdFromPath, stateToFrontmatter, type ConceptState } from "../concepts";

/** Outcome of an export: how many concepts were written. */
export interface ExportResult {
  exported: number;
}

/**
 * Export every instance of `collection` into the directory `dir` as an OKF v0.1
 * bundle. Creates `dir` (and any concept subdirectories) as needed. Deterministic
 * — concepts and listing entries are emitted in concept-ID order. Existing `.md`
 * files in `dir` are cleared first, so exporting into a directory that held a
 * prior bundle does not leave stale concept files; the emitted bundle reflects
 * exactly the current collection.
 */
export async function exportOkf(
  collection: ResourceCollectionRef<ConceptState>,
  dir: string,
): Promise<ExportResult> {
  const prefix = getPatternPrefix(collection.pattern);
  const instances = await collection.list();
  instances.sort((a, b) => a.path.localeCompare(b.path));

  await fs.mkdir(dir, { recursive: true });
  await clearManagedMarkdown(dir);

  const listing: Array<{ id: string; title: string; description: string | null }> = [];
  for (const ref of instances) {
    const id = conceptIdFromPath(ref.path, prefix);
    const fileText = emitConceptFile(stateToFrontmatter(ref.state), await composeBody(ref, id));
    const dest = path.join(dir, `${id}.md`);
    await fs.mkdir(path.dirname(dest), { recursive: true });
    await fs.writeFile(dest, fileText, "utf8");
    listing.push({ id, title: ref.state.title ?? id, description: ref.state.description });
  }

  await fs.writeFile(path.join(dir, "index.md"), emitRootIndex(OKF_VERSION, formatListing(listing)), "utf8");

  return { exported: instances.length };
}

/**
 * Remove every `.md` file under `dir` (concept files + a prior `index.md`) and
 * prune directories left empty afterwards, so a re-export reflects only the
 * current collection. Non-`.md` files are left untouched.
 */
async function clearManagedMarkdown(dir: string): Promise<void> {
  let entries: import("node:fs").Dirent[];
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    const abs = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      await clearManagedMarkdown(abs);
      await fs.rmdir(abs).catch(() => {}); // remove only if now empty
    } else if (entry.isFile() && entry.name.endsWith(".md")) {
      await fs.unlink(abs);
    }
  }
}

/**
 * The body to write for one concept: the verbatim stored body, plus a trailing
 * `# Related` section for any outgoing edge whose target is not already linked
 * in the body (so programmatic edges survive the round trip exactly once).
 */
async function composeBody(ref: ResourceRef<ConceptState>, id: string): Promise<string> {
  const body = normalizeBody((await ref.readContentRaw()) ?? "");

  const linkedInBody = new Set(
    extractLinkTargets(body)
      .map((t) => resolveLinkToConceptId(t, id))
      .filter((t): t is string => t !== null),
  );

  const outgoing = ref.edges
    ? [...new Set(ref.edges.all().filter((e) => e.from === id).map((e) => e.to))]
        .filter((t) => !linkedInBody.has(t))
        .sort()
    : [];

  if (outgoing.length === 0) return body;

  const related = outgoing.map((t) => `* [${t}](/${t}.md)`).join("\n");
  const section = `# Related\n\n${related}`;
  return body.length > 0 ? `${body}\n\n${section}` : section;
}

/** Format the progressive-disclosure listing for the root `index.md` body. */
function formatListing(entries: Array<{ id: string; title: string; description: string | null }>): string {
  const lines = entries.map(({ id, title, description }) => {
    const suffix = description ? ` - ${description}` : "";
    return `* [${title}](/${id}.md)${suffix}`;
  });
  return `# Concepts\n\n${lines.join("\n")}`;
}
