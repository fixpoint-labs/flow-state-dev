/**
 * The parser a ship ticket would have to write, and the answer to the review's
 * first P1.
 *
 * Round 1 of this POC compiled the package's instructions, document and tool
 * out of the `CAPABILITY` constants and never opened the file the variant
 * authored. That made "B and C are identical" circular: the two formats were
 * never on the path, so the matrix could not have measured that they compile
 * equivalently, and P1/P3/VG would have stayed green against an empty
 * `PACKAGE.md`. Everything the reader emits now comes out of the authored
 * bytes. The constants survive only on the ASSERTION side, where they belong:
 * the probes know what text they are looking for, and nothing else does.
 *
 * Two dialects, one output. That is the comparison B and C exist for:
 *
 *   `WORKER.md`  (B) — the seat dialect, reused. `tools:` holds bare NAMES, and
 *                      code is found by walking `blocks/` beside the file, which
 *                      is how a seat's own colocated blocks work. The dialect has
 *                      no key for which attachment modes the package supports,
 *                      because a seat does not have modes.
 *   `PACKAGE.md` (C) — a dialect of its own. `tools:` holds PATHS, and `attach:`
 *                      names the modes.
 *
 * Whether those differences are worth an eighth convention is the owner's call
 * (ER-13). What this module makes possible is seeing that they do not reach
 * what the package can DO — the parsed result is the same either way, and the
 * matrix now says so with both files actually read.
 */
import fs from "node:fs";
import path from "node:path";
import type { BlockDefinition } from "@flow-state-dev/core/types";

/** One authored package, after parsing. Dialect-independent by construction. */
export interface ParsedPackage {
  /** The name a seat's `capabilities:` key uses. */
  name: string;
  description: string;
  /** The package's prose, above the document heading. */
  instructions: string;
  /** The document's heading text, or `null` when the package carries none. */
  documentName: string | null;
  /** The document's body, or `""` when the package carries none. */
  documentBody: string;
  /** Blocks the package carries, keyed by the block's own `name`. */
  blocks: Record<string, BlockDefinition>;
  /** Which attachment modes the file DECLARES. `null` = the dialect cannot say. */
  declaredModes: readonly string[] | null;
  /** Which dialect was read, for the evidence line. */
  dialect: "WORKER.md" | "PACKAGE.md";
}

/** Split `---` frontmatter from the body. Throws on a file with neither. */
function split(bytes: string): { frontmatter: string; body: string } {
  const match = /^---\n([\s\S]*?)\n---\n([\s\S]*)$/.exec(bytes);
  if (match === null) throw new Error("the authored package has no frontmatter block");
  return { frontmatter: match[1]!, body: match[2]! };
}

/** A scalar key. `undefined` when absent — absence is a result, not an error. */
function scalar(frontmatter: string, key: string): string | undefined {
  const line = new RegExp(`^${key}:\\s*(.+)$`, "m").exec(frontmatter);
  return line === null ? undefined : line[1]!.trim();
}

/** An inline list key: `key: [a, b]`. `undefined` when absent. */
function list(frontmatter: string, key: string): string[] | undefined {
  const raw = scalar(frontmatter, key);
  if (raw === undefined) return undefined;
  const inner = /^\[(.*)\]$/.exec(raw.trim());
  if (inner === null) throw new Error(`\`${key}:\` is not an inline list: ${raw}`);
  return inner[1]!
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
}

/**
 * Body -> instructions + document.
 *
 * The first `## ` heading opens the document; everything above it is the
 * package's instructions. A package with no heading carries no document, which
 * is what the P3 fixture authors.
 */
function readBody(
  body: string,
): Pick<ParsedPackage, "instructions" | "documentName" | "documentBody"> {
  const heading = /^## (.+)$/m.exec(body);
  if (heading === null) {
    return { instructions: body.trim(), documentName: null, documentBody: "" };
  }
  return {
    instructions: body.slice(0, heading.index).trim(),
    documentName: heading[1]!.trim(),
    documentBody: body.slice(heading.index + heading[0]!.length).trim(),
  };
}

/** Import one module and return every block it exports, keyed by `name`. */
async function blocksIn(file: string): Promise<Record<string, BlockDefinition>> {
  const module = (await import(file)) as Record<string, unknown>;
  const found: Record<string, BlockDefinition> = {};
  for (const exported of Object.values(module)) {
    const name = (exported as { name?: unknown } | null)?.name;
    if (typeof name === "string" && typeof (exported as { kind?: unknown }).kind === "string") {
      found[name] = exported as BlockDefinition;
    }
  }
  return found;
}

/**
 * Read one authored package off disk.
 *
 * @param manifest absolute path to the authored `WORKER.md` or `PACKAGE.md`
 */
export async function readPackage(manifest: string): Promise<ParsedPackage> {
  const dialect = path.basename(manifest);
  if (dialect !== "WORKER.md" && dialect !== "PACKAGE.md")
    throw new Error(`not a package manifest: ${dialect}`);

  const { frontmatter, body } = split(fs.readFileSync(manifest, "utf8"));
  const dir = path.dirname(manifest);
  const declared = list(frontmatter, "tools") ?? [];

  // The dialects locate code differently, and that difference is the only place
  // reuse-vs-create shows up at all. B walks `blocks/` the way a seat does and
  // `tools:` names which of the found blocks the package exposes; C names paths
  // outright. Both end at the same registry.
  let blocks: Record<string, BlockDefinition> = {};
  if (dialect === "WORKER.md") {
    const blocksDir = path.join(dir, "blocks");
    const files = fs.existsSync(blocksDir)
      ? fs.readdirSync(blocksDir).filter((file) => file.endsWith(".ts"))
      : [];
    for (const file of files) Object.assign(blocks, await blocksIn(path.join(blocksDir, file)));
    // A bare name matching nothing found is a package claiming code it does not
    // carry — exactly variant A's shape, and the P2 fixture's.
    blocks = Object.fromEntries(
      declared.filter((name) => name in blocks).map((name) => [name, blocks[name]!]),
    );
  } else {
    for (const entry of declared) Object.assign(blocks, await blocksIn(path.resolve(dir, entry)));
  }

  return {
    name: scalar(frontmatter, "name") ?? path.basename(dir),
    description: scalar(frontmatter, "description") ?? "",
    ...readBody(body),
    blocks,
    declaredModes: list(frontmatter, "attach") ?? null,
    dialect,
  };
}

/**
 * Corrupt an authored manifest's BYTES, for the V1 fixtures.
 *
 * Round 1's fixtures reached past the file and switched the reader's behaviour
 * with a flag, which is how a fixture can go red while the parse it claims to
 * exercise never runs. These edit the file the reader then opens, so a fixture
 * cell is a statement about the authored package.
 */
export interface AuthoringDefects {
  /** Delete the instruction paragraph (P1). */
  omitInstructions?: boolean;
  /** Delete the document heading and its body (P3). */
  omitDocument?: boolean;
  /** Delete the `tools:` key, so the package carries no code (P2). */
  carryNoTool?: boolean;
}

export function corrupt(bytes: string, defects: AuthoringDefects): string {
  let out = bytes;
  if (defects.carryNoTool === true) out = out.replace(/^tools:.*\n/m, "");
  const { frontmatter, body } = split(out);
  let edited = body;
  if (defects.omitDocument === true) {
    const heading = /^## .+$/m.exec(edited);
    if (heading !== null) edited = edited.slice(0, heading.index);
  }
  if (defects.omitInstructions === true) {
    const heading = /^## .+$/m.exec(edited);
    edited = heading === null ? "" : edited.slice(heading.index);
  }
  return `---\n${frontmatter}\n---\n${edited.length === 0 ? "\n" : edited}`;
}
