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
import { emitConceptFile, emitRootIndex, normalizeBody, splitFrontmatter } from "./frontmatter";
import { extractLinkTargets, resolveLinkToConceptId } from "./links";
import { OKF_VERSION, RESERVED_FILENAMES } from "./types";
import { conceptIdFromPath, stateToFrontmatter, type ConceptState } from "../concepts";

/** Outcome of an export: how many concepts were written. */
export interface ExportResult {
  exported: number;
}

/**
 * Export every instance of `collection` into the directory `dir` as an OKF v0.1
 * bundle. Creates `dir` (and any concept subdirectories) as needed. Deterministic
 * — concepts and listing entries are emitted in concept-ID order. Stale concept
 * files from a prior export (concept documents no longer in the collection) are
 * removed first, so the emitted bundle reflects exactly the current collection.
 * Files this exporter does not own — reserved `log.md`, hand-authored `README.md`,
 * and other non-concept markdown — are left untouched.
 */
export async function exportOkf(
  collection: ResourceCollectionRef<ConceptState>,
  dir: string,
): Promise<ExportResult> {
  const prefix = getPatternPrefix(collection.pattern);
  const instances = await collection.list();
  instances.sort((a, b) => a.path.localeCompare(b.path));

  await fs.mkdir(dir, { recursive: true });

  // The relative paths this export will (re)write; anything else that is a
  // concept document gets pruned, anything non-concept is preserved.
  const written = new Set<string>(["index.md"]);
  for (const ref of instances) written.add(`${conceptIdFromPath(ref.path, prefix)}.md`);
  await pruneStaleConcepts(dir, dir, written);

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
 * Remove stale concept documents under `root` — `.md` files that are NOT being
 * (re)written this export AND parse as OKF concepts (non-empty `type` frontmatter)
 * — then prune directories left empty. Reserved filenames (`log.md`/`index.md`)
 * and non-concept markdown (e.g. a hand-authored `README.md` with no `type`) are
 * preserved, so pointing `exportBundle` at an existing directory never deletes
 * files the exporter does not own.
 */
async function pruneStaleConcepts(root: string, dir: string, written: Set<string>): Promise<void> {
  let entries: import("node:fs").Dirent[];
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    const abs = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      await pruneStaleConcepts(root, abs, written);
      await fs.rmdir(abs).catch(() => {}); // remove only if now empty
      continue;
    }
    if (!entry.isFile() || !entry.name.endsWith(".md")) continue;

    const rel = path.relative(root, abs).split(path.sep).join("/");
    if (written.has(rel)) continue; // will be overwritten
    if ((RESERVED_FILENAMES as readonly string[]).includes(entry.name)) continue; // reserved (e.g. log.md)

    // Only delete files that are actually concept documents; leave user markdown.
    const raw = await fs.readFile(abs, "utf8").catch(() => null);
    if (raw === null) continue;
    const { data } = splitFrontmatter(raw);
    if (typeof data.type === "string" && data.type.length > 0) await fs.unlink(abs);
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
