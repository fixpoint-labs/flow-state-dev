/**
 * The POC's stand-in for the codegen a ship ticket would write.
 *
 * Variants B and C both propose a package tree that nothing in the framework
 * reads today, so each needs a reader. The reading half is
 * {@link readPackage} — one parser, two dialects — and this file is the
 * compiling half, shared by both because the two variants differ in the SHAPE
 * an author writes and not in what it compiles to. Writing two compilers that
 * emit the same thing would have hidden exactly that.
 *
 * **Everything installed here comes out of the authored file.** The instruction
 * text, the document text, the package's name and the block itself are read off
 * disk; nothing is taken from the `CAPABILITY` constants, which now live only
 * on the probes' assertion side. That is the fix for round 2's first P1: before
 * it, P1, P3 and VG stayed green against an empty `PACKAGE.md`, so the matrix
 * could not have measured that B and C compile equivalently.
 *
 * What it compiles to is the only per-seat channel the framework actually has
 * for both content kinds at once:
 *
 *   instructions -> a capability preset's `context` entry
 *   a tool       -> the seat's block registry, still gated by the seat's `tools:`
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
import { FENCED, HOLDER, type SeatFrontmatter } from "./capability-fixture.mts";
import { readPackage, type ParsedPackage } from "./package-reader.mts";

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
export function linkModules(root: string): void {
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
  /** What each seat's `WORKER.md` frontmatter has to say for this attachment. */
  frontmatter: SeatFrontmatter;
  /** The parse the compile ran on, so a cell's evidence can quote the file. */
  parsed: ParsedPackage;
}

/**
 * Defects in the READER, used only by the V1 fixtures.
 *
 * Distinct from `AuthoringDefects`, which corrupt the authored file itself. The
 * split is the point: P1, P2 and P3's fixtures now go through the parse on bad
 * bytes, and only P5's and P6's — which are about what a reader installs, not
 * about what an author wrote — switch behaviour here.
 */
export interface ReaderDefects {
  /** Grant the package-attached seat that named no tool (P5). */
  grantFenced?: boolean;
  /** Add a second preset with no `default:` gate, so it reaches every seat (P6). */
  alwaysOnPreset?: boolean;
}

/**
 * Compile one authored package into the framework inputs, for one mode.
 *
 * @param root     the workforce tree
 * @param manifest path, relative to `root`, of the authored `WORKER.md`/`PACKAGE.md`
 * @param mode     which attachment mode this build is for
 * @param defects  V1 only — see {@link ReaderDefects}
 */
export async function compilePackage(
  root: string,
  manifest: string,
  mode: "attached" | "library",
  defects: ReaderDefects = {},
): Promise<Compiled> {
  linkModules(root);
  const parsed = await readPackage(path.join(root, manifest));

  // `attach:` is honoured rather than decorative: a dialect that can name its
  // modes is held to them. B's dialect cannot (`declaredModes === null`), which
  // is a real difference between the two formats and one the matrix could not
  // see while the files went unread.
  if (parsed.declaredModes !== null && !parsed.declaredModes.includes(seatOrLibrary(mode)))
    throw new Error(`the package does not declare the "${seatOrLibrary(mode)}" mode`);

  const contextText = [parsed.instructions, parsed.documentBody]
    .filter((line) => line.length > 0)
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
  const capability = defineCapability({ name: parsed.name, presets: presets as never });

  // No app catalog either: a package attached to ONE seat registers for that
  // seat. The catalog is app-wide, and compiling into it would make the package
  // nameable by every seat of the kind — still gated by `tools:`, but a wider
  // surface than the attachment asked for.
  const kind = defineAgentWorkerFlow({ uses: [capability] });

  const carried = parsed.blocks;
  const toolNames = Object.keys(carried);
  const selection = mode === "attached" ? `capabilities:\n  ${parsed.name}: [package]\n` : "";

  return {
    kinds: { [AGENT_KIND]: kind },
    seatBlocks: {
      // The FENCED seat is registered the same blocks as the holder on purpose.
      // It holds the package and differs from the holder in one line — the
      // `tools:` grant — which is what makes P5 a statement about the gate in
      // the package-attached case rather than about an unattached seat.
      [HOLDER]: carried,
      [FENCED]: carried,
    },
    frontmatter: {
      holder: selection + (toolNames.length > 0 ? `tools: [${toolNames.join(", ")}]\n` : ""),
      fenced:
        selection +
        // The defect: a reader that grants whatever the package carries to every
        // seat it is attached to, instead of leaving the grant to the seat.
        (defects.grantFenced === true && toolNames.length > 0
          ? `tools: [${toolNames.join(", ")}]\n`
          : ""),
      bystander: "",
    },
    parsed,
  };
}

/** The mode names a package file uses, which are not the harness's internal ones. */
function seatOrLibrary(mode: "attached" | "library"): string {
  return mode === "attached" ? "seat" : "library";
}
