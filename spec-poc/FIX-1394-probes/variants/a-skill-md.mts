/**
 * Variant A — the package IS a `SKILL.md` folder.
 *
 * Built in its strongest form, deliberately: the document rides in the
 * `SKILL.md` BODY rather than as a supporting file, because a supporting file
 * is stored in the skills collection and read only by the delegation surface —
 * it never reaches the holding seat's own context. Authoring it the idiomatic
 * way would have made P3 fail for a reason that is about the delivery of
 * `files[]`, not about the format's fitness as a package. The observation is
 * recorded in the ratify either way.
 *
 * What A cannot do is carry code. A skill folder is Markdown plus supporting
 * files, nothing walks it for blocks, and `allowed-tools` is validated and
 * granted nothing (BR-1). So the tool arrives as a NAME the seat still has to
 * find somewhere else.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { hireWorkforce } from "@flow-state-dev/workforce";
import { readWorkforce } from "@flow-state-dev/workforce/loader";
import { CAPABILITY, type Build, type Candidate, type Mode } from "../harness/contract.mts";
import {
  BYSTANDER,
  FENCED,
  HOLDER,
  NO_ATTACHMENT,
  skillMd,
  writeBaseTree,
  writeFile,
} from "../harness/capability-fixture.mts";

/**
 * What the framework says when a seat names a tool this package cannot supply.
 *
 * Run rather than quoted: the message is the evidence for P2's cell, and a
 * quoted one rots the first time the wording changes.
 */
async function refusalIfTheSeatNamesIt(): Promise<string> {
  const probe = fs.mkdtempSync(path.join(os.tmpdir(), "fix1394-A-refusal-"));
  writeBaseTree(probe, { ...NO_ATTACHMENT, holder: `tools: [${CAPABILITY.toolName}]\n` });
  const loaded = await readWorkforce(probe);
  try {
    hireWorkforce(loaded.workers);
    return "no refusal — the seat hired with a tool nothing registers";
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return (message.split("\n").find((line) => line.includes("which nothing registers")) ?? message)
      .trim()
      .slice(0, 220);
  }
}

/**
 * Where the folder sits in each mode. Same folder, two levels of the tree.
 *
 * `%s` is the seat: attached, a skill folder lives under a seat, so A has to
 * write it once per seat that holds the package. Held in a library it is one
 * folder at the org level, reachable by both.
 */
const LOCATION: Record<Mode, string> = {
  attached: "teams/support/workers/%s/skills/handover",
  library: "org/skills/handover",
};

export const variantA: Candidate = {
  id: "A",
  title: "reuse `SKILL.md`",
  authoring: "a skills folder: `handover/SKILL.md`, the format we already ship",
  authorsPackage: true,

  async build(root: string, mode: Mode): Promise<Build> {
    // The seat does NOT name the tool, and that is forced rather than chosen.
    // A `SKILL.md` package registers no block, so a seat that names the tool
    // anyway is refused at the hire — for the whole roster, not just itself.
    // The refusal is captured rather than described, so P2's cell carries what
    // the framework actually said.
    writeBaseTree(root, NO_ATTACHMENT);
    // The holder and the fenced seat both HOLD the package, which for A means
    // the folder sits under each of them. They differ in the same one line
    // every other candidate's pair differs in — neither names the tool, because
    // for A naming it is refused at the hire, and that refusal IS P2's cell.
    const bytes =
      mode === "attached"
        ? ["holder", "fenced"]
            .map((seat) =>
              writeFile(root, `${LOCATION[mode].replace("%s", seat)}/SKILL.md`, skillMd()),
            )
            .at(0)!
        : writeFile(root, `${LOCATION[mode]}/SKILL.md`, skillMd());
    const refusal = await refusalIfTheSeatNamesIt();

    return {
      root,
      packageFiles: { "handover/SKILL.md": bytes },
      // Empty on purpose: a `SKILL.md` folder has no channel that registers a
      // block, so there is nothing to put here without inventing one.
      seatBlocks: {},
      holder: HOLDER,
      fenced: FENCED,
      bystander: BYSTANDER,
      document: { kind: "skill-body", skill: "handover" },
      activationMessage: "/handover",
      mechanism: {
        P1: "the skill's body, which renders only while the skill is active",
        P2: `\`allowed-tools:\` only — validated, and granted nothing. Naming it in the seat's own \`tools:\` instead is refused at the hire: "${refusal}"`,
        P3: "the skill's body",
        P4: "the same folder, written at the seat level or the org level",
      },
    };
  },
};
