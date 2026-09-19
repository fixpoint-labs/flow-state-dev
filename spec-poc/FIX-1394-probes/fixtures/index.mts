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
 * document is missing, one that needs two authored forms, one whose reader
 * grants the tool to a seat that did not name it, and one whose machinery
 * changes a tree that authored no package at all. The last two are the ones
 * that are easy to ship by accident — the sixth is a preset with no `default:`
 * key, which `resolveActivePresets` turns on for every seat of the kind.
 *
 * **Three of the six now corrupt the authored FILE**, not the reader. P1, P2
 * and P3's defects rewrite the bytes `readPackage` then opens, so a red cell is
 * a statement about a badly authored package travelling the real parse. Round 1
 * switched the reader with a flag instead, which is how a fixture can go red
 * while the parse it claims to exercise never runs. Only P5's and P6's remain
 * reader defects, because both are about what a reader INSTALLS rather than
 * about what an author wrote.
 */
import { CAPABILITY, type Build, type Candidate, type Mode, type ProbeId } from "../harness/contract.mts";
import {
  BYSTANDER,
  FENCED,
  HOLDER,
  skillMd,
  writeBaseTree,
  writeFile,
} from "../harness/capability-fixture.mts";
import { AUTHORED_BLOCK_SOURCE, compilePackage, type ReaderDefects } from "../harness/compile.mts";
import { corrupt, type AuthoringDefects } from "../harness/package-reader.mts";

const PACKAGE_DIR = "library/handover";

/** The control package, well-formed. Every fixture starts from these bytes. */
const MANIFEST =
  `---\nname: handover\ndescription: The handover capability.\n` +
  `tools: [./blocks/ledger-append.ts]\nattach: [seat, library]\n---\n\n` +
  `${CAPABILITY.instructions}\n\n` +
  `## ${CAPABILITY.documentName}\n\n${CAPABILITY.documentBody}\n`;

interface FixtureOptions {
  /** Rewrites the authored `PACKAGE.md` before the reader opens it. */
  authoring?: AuthoringDefects;
  /** Changes what the reader installs. */
  reader?: ReaderDefects;
  /** V1's P3 defect has to reach the generated skill too, not only the context. */
  libraryDocument?: boolean;
  /** V1's P4 defect: the library mode authors something the attached mode did not. */
  extraLibraryFile?: boolean;
}

/** Build the control package, with one defect applied. */
function fixtureCandidate(id: string, options: FixtureOptions): Candidate {
  const {
    authoring = {},
    reader = {},
    libraryDocument = true,
    extraLibraryFile = false,
  } = options;
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
          corrupt(MANIFEST, authoring),
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

      const compiled = await compilePackage(root, `${PACKAGE_DIR}/PACKAGE.md`, mode, reader);
      writeBaseTree(root, compiled.frontmatter);

      if (mode === "library") {
        const body = libraryDocument
          ? skillMd()
          : skillMd().replace(`\n\n${CAPABILITY.documentBody}\n`, "\n");
        for (const seat of ["holder", "fenced"]) {
          writeFile(root, `teams/support/workers/${seat}/skills/handover/SKILL.md`, body);
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
        mechanism: { P1: "fixture", P2: "fixture", P3: "fixture", P4: "fixture" },
      };
    },
  };
}

/**
 * The control for round 2's first P1: is the authored file on the path at all?
 *
 * Round 1's compiler took the instructions, the document and the tool from
 * constants and never opened the file, so P1, P3 and VG stayed green against an
 * empty `PACKAGE.md` — and "B and C are identical" was a statement about the
 * compiler rather than about the two formats. This candidate authors a file
 * with valid frontmatter and NOTHING in it. Three probes have to go red, or the
 * reader is not reading.
 */
export const EMPTY_PACKAGE: Candidate = fixtureCandidate("fx-empty", {
  authoring: { omitInstructions: true, omitDocument: true, carryNoTool: true },
  libraryDocument: false,
});

/** A file the parser cannot read at all. The build must throw, not shrug. */
export async function malformedPackageThrows(root: string): Promise<string | null> {
  writeFile(root, `${PACKAGE_DIR}/blocks/ledger-append.ts`, AUTHORED_BLOCK_SOURCE);
  writeFile(root, `${PACKAGE_DIR}/PACKAGE.md`, "this file has no frontmatter at all\n");
  try {
    await compilePackage(root, `${PACKAGE_DIR}/PACKAGE.md`, "attached");
    return null;
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
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
    defect: "the authored file's instruction paragraph is deleted",
    candidate: fixtureCandidate("fx-P1", { authoring: { omitInstructions: true } }),
  },
  {
    violates: "P2",
    defect: "the authored file's `tools:` key is deleted, so it carries no code",
    candidate: fixtureCandidate("fx-P2", { authoring: { carryNoTool: true } }),
  },
  {
    violates: "P3",
    defect: "the authored file's document section is deleted",
    candidate: fixtureCandidate("fx-P3", {
      authoring: { omitDocument: true },
      libraryDocument: false,
    }),
  },
  {
    violates: "P4",
    defect: "the library form needs a second authored file",
    candidate: fixtureCandidate("fx-P4", { extraLibraryFile: true }),
  },
  {
    violates: "P5",
    defect: "the reader grants the package's tool to a holding seat that named nothing",
    candidate: fixtureCandidate("fx-P5", { reader: { grantFenced: true } }),
  },
  {
    violates: "P6",
    defect: "the package's kind installs a preset that is on for every seat",
    candidate: fixtureCandidate("fx-P6", { reader: { alwaysOnPreset: true } }),
  },
];
