/**
 * Variant C — a new package file.
 *
 * `PACKAGE.md`, its own frontmatter dialect, naming what the package carries
 * and which attachment modes it supports. Present because reuse-vs-create is
 * the owner's to close (ER-13), not because it is recommended.
 *
 * It compiles through the SAME compiler B does, on purpose. If a new file
 * compiled to something B could not reach, that difference would be the
 * argument for creating one, and the matrix should be able to see it. The two
 * dialects are genuinely parsed — `tools:` here holds PATHS and `attach:` names
 * the modes, where B's seat dialect holds bare names and cannot say — and they
 * still arrive at the same installed capability.
 *
 * What C buys is authoring clarity: a `PACKAGE.md` is unambiguously a package,
 * where B's `WORKER.md` outside `workers/` is not. What it costs is an eighth
 * convention and an eighth reader, against a tree whose totality check counts
 * seven (`check-conventions.mjs` C1).
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

export const variantC: Candidate = {
  id: "C",
  title: "a new package file",
  authoring: "`PACKAGE.md` with its own frontmatter, plus `blocks/`",
  authorsPackage: true,

  async build(root: string, mode: Mode): Promise<Build> {
    const packageFiles: Record<string, string> = {
      "PACKAGE.md": writeFile(
        root,
        `${PACKAGE_DIR}/PACKAGE.md`,
        `---\nname: handover\ndescription: The handover capability.\n` +
          `tools: [./blocks/ledger-append.ts]\nattach: [seat, library]\n---\n\n` +
          `${CAPABILITY.instructions}\n\n` +
          `## ${CAPABILITY.documentName}\n\n${CAPABILITY.documentBody}\n`,
      ),
      "blocks/ledger-append.ts": writeFile(
        root,
        `${PACKAGE_DIR}/blocks/ledger-append.ts`,
        AUTHORED_BLOCK_SOURCE,
      ),
    };

    const compiled = await compilePackage(root, `${PACKAGE_DIR}/PACKAGE.md`, mode);
    writeBaseTree(root, compiled.frontmatter);

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
        P2: "`tools:` names the authored `blocks/*.ts` by path; the module is imported and registered for the seat, and the seat's own `tools:` still grants",
        P3: "prompt text on both paths — there is no per-seat resource channel to compile into",
        P4: `one authored \`PACKAGE.md\` plus its folder; \`attach: [${(compiled.parsed.declaredModes ?? []).join(", ")}]\` names both modes and the reader is held to it`,
      },
    };
  },
};
