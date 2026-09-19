/**
 * Variant B — the package reuses the SEAT FOLDER shape.
 *
 * A `WORKER.md`-shaped file with colocated `blocks/` and `skills/` beside it,
 * sitting somewhere that is not `teams/<id>/workers/<name>/`. An author who
 * knows how to write a seat already knows how to write one of these, which is
 * the whole argument for it.
 *
 * The cost the matrix should see: a `WORKER.md` outside the workers level is
 * either a package or a mistake, and nothing in the tree can tell which. The
 * loader's published-surface rule says a declared entry is consumed or refused
 * loudly (`test/published-tree-surface.test.ts`), so B spends its ambiguity at
 * exactly the place that rule is strictest.
 *
 * Two things show up only once the file is actually parsed, and neither moves
 * a cell: the seat dialect's `tools:` holds bare NAMES, so the reader has to
 * walk `blocks/` to find code the way a seat's own colocated blocks are found;
 * and the dialect has no key for which attachment modes the package supports,
 * because a seat does not have modes. Recorded in `mechanism` rather than
 * argued.
 */
import { CAPABILITY, type Build, type Candidate, type Mode } from "../harness/contract.mts";
import {
  BYSTANDER,
  FENCED,
  HOLDER,
  skillMd,
  writeBaseTree,
  writeFile,
} from "../harness/capability-fixture.mts";
import { AUTHORED_BLOCK_SOURCE, compilePackage } from "../harness/compile.mts";

const PACKAGE_DIR = "library/handover";

export const variantB: Candidate = {
  id: "B",
  title: "reuse the seat folder",
  authoring: "a folder shaped like a seat: `WORKER.md` + `blocks/`, outside `workers/`",
  authorsPackage: true,

  async build(root: string, mode: Mode): Promise<Build> {
    const packageFiles: Record<string, string> = {
      "WORKER.md": writeFile(
        root,
        `${PACKAGE_DIR}/WORKER.md`,
        `---\nname: handover\ndescription: The handover capability.\n` +
          `tools: [${CAPABILITY.toolName}]\n---\n\n` +
          `${CAPABILITY.instructions}\n\n` +
          `## ${CAPABILITY.documentName}\n\n${CAPABILITY.documentBody}\n`,
      ),
      "blocks/ledger-append.ts": writeFile(
        root,
        `${PACKAGE_DIR}/blocks/ledger-append.ts`,
        AUTHORED_BLOCK_SOURCE,
      ),
    };

    const compiled = await compilePackage(root, `${PACKAGE_DIR}/WORKER.md`, mode);
    writeBaseTree(root, compiled.frontmatter);

    // Held in a library, the same authored package is compiled into the seat's
    // skills instead of into its capability selection — the one channel the
    // framework has that puts text in context on activation and not before.
    // GENERATED, so it is not in `packageFiles`: P4 compares what the author
    // wrote, not what a build step emitted.
    if (mode === "library") {
      for (const seat of ["holder", "fenced"]) {
        writeFile(root, `teams/support/workers/${seat}/skills/handover/SKILL.md`, skillMd());
      }
    }

    return {
      root,
      packageFiles,
      seatBlocks: compiled.seatBlocks,
      kinds: compiled.kinds,
      holder: HOLDER,
      fenced: FENCED,
      bystander: BYSTANDER,
      document:
        mode === "attached"
          ? { kind: "seat-context", via: "capability preset `context`" }
          : { kind: "skill-body", skill: "handover" },
      activationMessage: mode === "library" ? "/handover" : null,
      mechanism: {
        P1: `parsed out of the authored ${compiled.parsed.dialect} and compiled to a capability preset's \`context\`, selected by the seat's \`capabilities:\``,
        P2: `\`tools: [${CAPABILITY.toolName}]\` names a block found by walking \`blocks/\`, as a seat's colocated blocks are; the seat's own \`tools:\` still grants`,
        P3: "prompt text on both paths — there is no per-seat resource channel to compile into",
        P4: `one authored folder, the build step picks the channel; the seat dialect declares no modes (\`attach:\` absent, so the reader assumes both)`,
      },
    };
  },
};
