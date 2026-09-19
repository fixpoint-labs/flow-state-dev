/**
 * V1 — six violating fixtures, one per probe.
 *
 * Each is a package tree built to fail exactly ONE probe and satisfy the other
 * five. This is what makes the harness's `fail` mean something: one empty
 * fixture cannot do the job, because an empty tree cannot fail P5 (nothing
 * crosses the gate) or P6 (an unchanged tree IS P6's pass), so a harness that
 * always answered `fail` would look correct against it.
 *
 * The defects are real failure modes, not syntax errors: a package whose text
 * never reaches the prompt, one that carries a tool name and no code, one whose
 * document is missing, one that needs two authored forms, one that edits a seat
 * it was not attached to, and one whose machinery changes a tree that authored
 * no package at all. The last two are the ones that are easy to ship by
 * accident — the sixth is a preset with no `default:` key, which
 * `resolveActivePresets` turns on for every seat of the kind.
 */
import { CAPABILITY, type Build, type Candidate, type Mode, type ProbeId } from "../harness/contract.mts";
import {
  BYSTANDER,
  HOLDER,
  skillMd,
  writeBaseTree,
  writeFile,
} from "../harness/capability-fixture.mts";
import { AUTHORED_BLOCK_SOURCE, compilePackage, type CompileDefects } from "../harness/compile.mts";

const PACKAGE_DIR = "library/handover";

/** Build the control package, with one defect applied. */
function fixtureCandidate(
  id: string,
  defects: CompileDefects,
  /** V1's P3 defect has to reach the generated skill too, not only the context. */
  libraryDocument = true,
  /** V1's P4 defect: the library mode authors something the attached mode did not. */
  extraLibraryFile = false,
): Candidate {
  return {
    id,
    title: `fixture ${id}`,
    authoring: "the control package, with one deliberate defect",
    authorsPackage: true,
    async build(root: string, mode: Mode): Promise<Build> {
      const packageFiles: Record<string, string> = {
        "PACKAGE.md": writeFile(
          root,
          `${PACKAGE_DIR}/PACKAGE.md`,
          `---\nname: handover\ndescription: The handover capability.\n---\n\n` +
            `${CAPABILITY.instructions}\n\n${CAPABILITY.documentBody}\n`,
        ),
        "blocks/ledger-append.ts": writeFile(
          root,
          `${PACKAGE_DIR}/blocks/ledger-append.ts`,
          AUTHORED_BLOCK_SOURCE,
        ),
      };
      if (extraLibraryFile && mode === "library") {
        packageFiles["library-only.md"] = writeFile(
          root,
          `${PACKAGE_DIR}/library-only.md`,
          "The library form needs a second file the attached form does not.\n",
        );
      }

      const compiled = await compilePackage(
        root,
        `${PACKAGE_DIR}/blocks/ledger-append.ts`,
        "handover",
        mode,
        defects,
      );
      writeBaseTree(root, compiled.holderFrontmatter, compiled.bystanderFrontmatter);

      if (mode === "library") {
        const body = libraryDocument
          ? skillMd()
          : skillMd().replace(`\n\n${CAPABILITY.documentBody}\n`, "\n");
        writeFile(root, "teams/support/workers/holder/skills/handover/SKILL.md", body);
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
        mechanism: { P1: "fixture", P2: "fixture", P3: "fixture", P4: "fixture" },
      };
    },
  };
}

export interface Fixture {
  candidate: Candidate;
  violates: ProbeId;
  /** The defect, in one line, for the run log. */
  defect: string;
}

export const FIXTURES: Fixture[] = [
  {
    violates: "P1",
    defect: "the package's instructions never reach the context entry",
    candidate: fixtureCandidate("fx-P1", { omitInstructions: true }),
  },
  {
    violates: "P2",
    defect: "the package carries the tool's NAME and no code",
    candidate: fixtureCandidate("fx-P2", { carryNoTool: true }),
  },
  {
    violates: "P3",
    defect: "the package carries no document on either path",
    candidate: fixtureCandidate("fx-P3", { omitDocument: true }, false),
  },
  {
    violates: "P4",
    defect: "the library form needs a second authored file",
    candidate: fixtureCandidate("fx-P4", {}, true, true),
  },
  {
    violates: "P5",
    defect: "attaching the package writes the tool into a seat's own file",
    candidate: fixtureCandidate("fx-P5", { grantBystander: true }),
  },
  {
    violates: "P6",
    defect: "the package's kind installs a preset that is on for every seat",
    candidate: fixtureCandidate("fx-P6", { alwaysOnPreset: true }),
  },
];
