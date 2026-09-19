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
 */
import { CAPABILITY, type Build, type Candidate, type Mode } from "../harness/contract.mts";
import {
  BYSTANDER,
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
        `---\ndescription: The handover capability.\ntools: [${CAPABILITY.toolName}]\n---\n\n` +
          `${CAPABILITY.instructions}\n\n${CAPABILITY.documentBody}\n`,
      ),
      "blocks/ledger-append.ts": writeFile(
        root,
        `${PACKAGE_DIR}/blocks/ledger-append.ts`,
        AUTHORED_BLOCK_SOURCE,
      ),
    };

    const compiled = await compilePackage(
      root,
      `${PACKAGE_DIR}/blocks/ledger-append.ts`,
      "handover",
      mode,
    );
    writeBaseTree(root, compiled.holderFrontmatter);

    // Held in a library, the same authored package is compiled into the seat's
    // skills instead of into its capability selection — the one channel the
    // framework has that puts text in context on activation and not before.
    // GENERATED, so it is not in `packageFiles`: P4 compares what the author
    // wrote, not what a build step emitted.
    if (mode === "library") {
      writeFile(root, "teams/support/workers/holder/skills/handover/SKILL.md", skillMd());
    }

    return {
      root,
      packageFiles,
      seatBlocks: compiled.seatBlocks,
      kinds: compiled.kinds,
      holder: HOLDER,
      bystander: BYSTANDER,
      document:
        mode === "attached"
          ? { kind: "seat-context", via: "capability preset `context`" }
          : { kind: "skill-body", skill: "handover" },
      activationMessage: mode === "library" ? "/handover" : null,
      mechanism: {
        P1: "compiled to a capability preset's `context`, selected by the seat's `capabilities:`",
        P2: "the authored `blocks/*.ts` is imported and registered for the seat; `tools:` still grants",
        P3: "prompt text on both paths — there is no per-seat resource channel to compile into",
        P4: "one authored folder; the build step picks the channel",
      },
    };
  },
};
