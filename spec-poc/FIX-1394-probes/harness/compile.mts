/**
 * The POC's stand-in for the codegen a ship ticket would write.
 *
 * Variants B and C both propose a package tree that nothing in the framework
 * reads today, so each needs a reader. That reader is this function, shared by
 * both, because the two variants differ in the SHAPE an author writes and not
 * in what it compiles to — and writing two readers that emit the same thing
 * would have hidden exactly that.
 *
 * What it compiles to is the only per-seat channel the framework actually has
 * for all three content kinds at once:
 *
 *   instructions -> a capability preset's `context` entry
 *   a tool       -> that preset's `tools` entry, plus the seat's block registry
 *   a document   -> the same `context` entry (see the note below)
 *
 * **The document is prompt text, not a resource, and that is forced.** A
 * capability preset carrying `resources` cannot be selected by a seat at all:
 * `resources` is in `BUILD_TIME_ONLY_KEYS` (`seat-capabilities.ts`) and naming
 * such a preset is refused at the mint. The file-declared documents convention
 * installs at flow level, which is the KIND's, so it reaches every sibling
 * seat. There is no per-seat resource channel to compile into.
 */
import fs from "node:fs";
import path from "node:path";
import { defineCapability } from "@flow-state-dev/core";
import type { BlockDefinition } from "@flow-state-dev/core/types";
import { AGENT_KIND, defineAgentWorkerFlow } from "@flow-state-dev/workforce";
import { CAPABILITY } from "./contract.mts";
import { HOLDER, BYSTANDER } from "./capability-fixture.mts";

/** Repo root, from this file: `spec-poc/FIX-1394-probes/harness/` is three down. */
const REPO_ROOT = path.resolve(import.meta.dirname, "../../..");

/**
 * Make the authored package's `.ts` resolvable.
 *
 * The block file a variant writes imports `@flow-state-dev/core` the way a
 * real one would, and it is written into a scratch tree where that resolves to
 * nothing. One symlink is what lets the POC IMPORT the authored module instead
 * of binding a block it built itself — the difference between P2 proving the
 * format can carry code and P2 proving this file can.
 */
function linkModules(root: string): void {
  const target = path.join(root, "node_modules");
  if (!fs.existsSync(target)) {
    fs.symlinkSync(path.join(REPO_ROOT, "packages/workforce/node_modules"), target, "dir");
  }
}

/**
 * The tool block a package authors, as source an author would actually write.
 *
 * `execute` appends to the file named by `FIX1394_MARKER`, which is how P2
 * knows the BLOCK ran rather than that the model was offered its name. Offering
 * and running are a tool call apart, and a probe that reads the first while
 * claiming the second is the neighbour-of-the-claim defect round 1 caught in
 * `check-conventions.mjs`.
 */
export const AUTHORED_BLOCK_SOURCE = `import fs from "node:fs";
import { z } from "zod";
import { handler } from "@flow-state-dev/core";

/** Appends one handover line to the ledger. Authored inside the package. */
export const ledgerAppend = handler({
  name: "${CAPABILITY.toolName}",
  description: "Appends one handover line to the ledger.",
  inputSchema: z.object({}),
  outputSchema: z.object({ appended: z.boolean() }),
  execute: async () => {
    const marker = process.env["FIX1394_MARKER"];
    if (marker !== undefined) fs.appendFileSync(marker, "ran\\n");
    return { appended: true };
  },
});
`;

export interface Compiled {
  kinds: Record<string, unknown>;
  seatBlocks: Record<string, Record<string, BlockDefinition>>;
  /** What the holder's `WORKER.md` frontmatter has to say to attach it. */
  holderFrontmatter: string;
  /** Normally empty — a package that edits a seat it was not attached to (V1). */
  bystanderFrontmatter: string;
}

/**
 * Deliberate defects, used ONLY by the V1 fixtures.
 *
 * Every field is a real way a package format could be wrong, and each one is
 * how a fixture produces a red cell in exactly one row. They live here rather
 * than in the fixtures so a fixture cannot reach past the reader and break
 * something the probes were not watching.
 */
export interface CompileDefects {
  /** Drop the instructions from the context entry (breaks P1 only). */
  omitInstructions?: boolean;
  /** Drop the document from the context entry (breaks P3's attached half). */
  omitDocument?: boolean;
  /**
   * The package carries the tool's NAME and no code (P2).
   *
   * The seat's `tools:` drops it too, and that is forced rather than a second
   * defect: naming a tool nothing registers refuses the whole roster at the
   * hire, which would take every other probe down with it. So the isolatable
   * shape of this defect is the one variant A actually has — a package whose
   * tool the seat cannot name.
   */
  carryNoTool?: boolean;
  /** Write the tool into the BYSTANDER's own file too — a package that edits a seat (P5). */
  grantBystander?: boolean;
  /** Add a second preset that is on by default, so the kind changes a package-free tree (P6). */
  alwaysOnPreset?: boolean;
}

/**
 * Compile an authored package into the framework inputs, for one mode.
 *
 * @param root        the workforce tree
 * @param blockFile   path, relative to `root`, of the package's authored block
 * @param packageName the name a seat's `capabilities:` key would use
 * @param defects     V1 only — see {@link CompileDefects}
 */
export async function compilePackage(
  root: string,
  blockFile: string,
  packageName: string,
  mode: "attached" | "library",
  defects: CompileDefects = {},
): Promise<Compiled> {
  linkModules(root);
  const module = (await import(path.join(root, blockFile))) as { ledgerAppend: BlockDefinition };
  const block = module.ledgerAppend;

  const contextText = [
    defects.omitInstructions === true ? undefined : CAPABILITY.instructions,
    defects.omitDocument === true ? undefined : CAPABILITY.documentBody,
  ]
    .filter((line) => line !== undefined)
    .join("\n\n");

  // `default: []` is what makes the preset opt-in per seat. Without it every
  // preset is active by default (`resolveActivePresets`: `rawPresets.default ??
  // every preset`), and the package would reach every seat of the kind — which
  // is the bug this whole probe set exists to catch, so it is worth naming.
  // No `tools` on the preset, deliberately. A preset's tools are inert for a
  // seat — `capabilities-on-disk.md`: "selecting a tool-bearing preset is a way
  // to give one worker that preset's context, not a way around its tool list."
  // Putting them there anyway would have made P2 pass through a route that does
  // not carry, with the seat's own registry quietly doing the work.
  const presets: Record<string, { context: Array<() => string> } | string[]> = {
    package: { context: [() => contextText] },
    default: defects.alwaysOnPreset === true ? ["ambient"] : [],
  };
  if (defects.alwaysOnPreset === true) {
    presets["ambient"] = { context: [() => "PACKAGE RUNTIME NOTICE: installed."] };
  }
  const capability = defineCapability({ name: packageName, presets: presets as never });

  // No app catalog either: a package attached to ONE seat registers for that
  // seat. The catalog is app-wide, and compiling into it would make the package
  // nameable by every seat of the kind — still gated by `tools:`, but a wider
  // surface than the attachment asked for.
  const kind = defineAgentWorkerFlow({ uses: [capability] });

  const registry: Record<string, BlockDefinition> =
    defects.carryNoTool === true ? {} : { [CAPABILITY.toolName]: block };

  return {
    kinds: { [AGENT_KIND]: kind },
    seatBlocks: {
      [HOLDER]: registry,
      // Normally empty: the bystander was attached nothing, so nothing of the
      // package's is registered for it. The defect is a reader that registers
      // the package for every seat and edits their files to match.
      ...(defects.grantBystander === true ? { [BYSTANDER]: registry } : {}),
    },
    holderFrontmatter: [
      mode === "attached" ? `capabilities:\n  ${packageName}: [package]\n` : "",
      defects.carryNoTool === true ? "" : `tools: [${CAPABILITY.toolName}]\n`,
    ].join(""),
    bystanderFrontmatter:
      defects.grantBystander === true ? `tools: [${CAPABILITY.toolName}]\n` : "",
  };
}
