/**
 * The detector for one defect class: a workforce-tree entry the published
 * convention tells an author to write, which every reader then passes over in
 * silence — no record, no error, no seat, no document.
 *
 * **The class policy.** A declared-but-unsupported entry is either made to work
 * or refused loudly, naming the path. Silence is not an option. The policy is
 * not new: `discoverWorkforceCode` already states it ("a folder an author
 * created and the tool ignored is the silence this convention exists to
 * remove"). What was missing is anything that *checks* it, which is why every
 * instance so far was found by hand-reading merged code instead of by a failing
 * test.
 *
 * **How the table below is derived, and why it is not derived from the code.**
 * Enumerating the class by grepping for the shapes of the instances already
 * known can only ever confirm that list. So {@link PUBLISHED_SHAPES} is read off
 * the *published* surface — the pages and READMEs an author actually reads —
 * and every row carries the file and the verbatim sentence that publishes it.
 * The first test re-checks those quotes against the real files, so a doc that
 * starts publishing a new shape, or stops publishing an old one, breaks this
 * suite rather than letting it drift away from what authors are being told.
 *
 * **What this does not cover, deliberately.** Only tree *paths*, and only ones
 * a published page or README declares. Frontmatter keys are a different seam
 * and already have their own loud refusals — the readers' `refusedDeclaration`
 * doors, and the hire's refusal of a setting the kind does not declare. And a
 * shape declared only in an internal tree note is not here: no author can read
 * it, so closing that gap means publishing the shape first.
 */
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { discoverWorkforceCode } from "../src/codegen/discover";
import { readChannelsDirectory } from "../src/loader/read-channels-directory";
import { readResourcesDirectory } from "../src/loader/read-resources-directory";
import { readSeatSkills } from "../src/loader/read-seat-skills";
import { readWorkforce } from "../src/loader/read-workforce";

/** Repo root, from this file: `packages/workforce/test/` is three levels down. */
const REPO_ROOT = path.resolve(import.meta.dirname, "../../..");

/** Everything every reader made of one tree, gathered once. */
interface Readout {
  /** Worker ids that loaded. */
  workers: string[];
  /** Document refs that loaded. */
  documents: string[];
  /** Channel ids that loaded. */
  channels: string[];
  /** Resource-module refs the codegen walk found. */
  resourceModules: string[];
  /** `<slot>:<name>` for every file in a locked code folder. */
  code: string[];
  /** Skill names the `alpha.lead` seat resolved, read directly. */
  teamSeatSkills: string[];
  /** Skill names each loaded worker's manifest arrived carrying, keyed by worker id. */
  workerSkills: Record<string, string[]>;
  /** Every root-relative path any reader reported as a failure. */
  reported: string[];
}

/** One path shape the published convention tells an author they may write. */
interface PublishedShape {
  /** The shape, spelled as the docs spell it. */
  shape: string;
  /** Where an author reads that they may write it. Checked verbatim. */
  publishedIn: { file: string; quote: string };
  /** Write one concrete instance of the shape into the fixture tree. */
  write: (root: string) => Promise<void>;
  /**
   * Whether that instance was accounted for — loaded by some reader, or named
   * in some reader's errors. Anything else is the silence this suite exists to
   * catch.
   */
  accountedFor: (out: Readout) => boolean;
}

/**
 * A shape that is published and silent today, with the issue that owns closing
 * it. An entry here is a debt this suite keeps visible, not a permission: the
 * assertion below requires the silent set to *equal* this list, so a gap that
 * gets fixed fails until it is removed, and a new gap fails on arrival.
 */
const KNOWN_SILENT_GAPS: ReadonlyArray<{ shape: string; owner: string }> = [
  {
    shape: "org/workers/<worker>/WORKER.md",
    owner: "FIX-1414 — org-level workers are declared in the tree but unhireable",
  },
  {
    shape: "org/workers/<worker>/skills/<skill>/SKILL.md",
    owner: "FIX-1414 — a seat that cannot be hired has no seat to read skills for",
  },
];

async function writeFile(root: string, at: string, contents: string): Promise<void> {
  const target = path.join(root, ...at.split("/"));
  await fs.mkdir(path.dirname(target), { recursive: true });
  await fs.writeFile(target, contents);
}

/** A `WORKER.md`, `CHANNEL.md`, `SKILL.md` or document with the minimum each requires. */
const doc = (description: string, body = "Body.\n"): string =>
  `---\ndescription: ${description}\n---\n\n${body}`;

const skillDoc = (name: string): string =>
  `---\nname: ${name}\ndescription: The ${name} skill.\n---\n\nDo ${name}.\n`;

const PUBLISHED_SHAPES: readonly PublishedShape[] = [
  {
    shape: "teams/<team>/workers/<worker>/WORKER.md",
    publishedIn: {
      file: "apps/docs/docs/workforce/overview.md",
      quote: "Each worker lives at `teams/<team>/workers/<name>/WORKER.md`.",
    },
    write: (root) => writeFile(root, "teams/alpha/workers/lead/WORKER.md", doc("A lead.")),
    accountedFor: (out) =>
      out.workers.includes("alpha.lead") || out.reported.includes("teams/alpha/workers/lead"),
  },
  {
    shape: "teams/<team>/channels/<channel>/CHANNEL.md",
    publishedIn: {
      file: "apps/docs/docs/workforce/channels.md",
      quote: "`teams/engineering/channels/standup/` becomes `engineering.standup`",
    },
    write: (root) =>
      writeFile(root, "teams/alpha/channels/standup/CHANNEL.md", doc("A standup.")),
    accountedFor: (out) =>
      out.channels.includes("alpha.standup") ||
      out.reported.includes("teams/alpha/channels/standup"),
  },
  {
    shape: "teams/<team>/resources/<name>.md",
    publishedIn: {
      file: "apps/docs/docs/workforce/documents-on-disk.md",
      quote: "| `<root>/teams/engineering/resources/handbook.md` | `teams/engineering/handbook` |",
    },
    write: (root) => writeFile(root, "teams/alpha/resources/handbook.md", doc("A handbook.")),
    accountedFor: (out) =>
      out.documents.includes("teams/alpha/handbook") ||
      out.reported.includes("teams/alpha/resources/handbook.md"),
  },
  {
    shape: "teams/<team>/workers/<worker>/resources/<name>.md",
    publishedIn: {
      file: "apps/docs/docs/workforce/documents-on-disk.md",
      quote:
        "| `<root>/teams/engineering/workers/on-call/resources/runbook.md` | `teams/engineering/workers/on-call/runbook` |",
    },
    write: (root) =>
      writeFile(root, "teams/alpha/workers/lead/resources/runbook.md", doc("A runbook.")),
    accountedFor: (out) =>
      out.documents.includes("teams/alpha/workers/lead/runbook") ||
      out.reported.includes("teams/alpha/workers/lead/resources/runbook.md"),
  },
  {
    shape: "teams/<team>/skills/<skill>/SKILL.md",
    publishedIn: {
      file: "apps/docs/docs/skills/overview.md",
      quote: "workforce/teams/pentest/skills/port-scan/SKILL.md",
    },
    write: (root) =>
      writeFile(root, "teams/alpha/skills/regression/SKILL.md", skillDoc("regression")),
    accountedFor: (out) =>
      out.teamSeatSkills.includes("regression") ||
      out.reported.includes("teams/alpha/skills/regression"),
  },
  {
    shape: "teams/<team>/workers/<worker>/skills/<skill>/SKILL.md",
    publishedIn: {
      file: "apps/docs/docs/skills/overview.md",
      quote: "workforce/teams/pentest/workers/recon/skills/sweep/SKILL.md",
    },
    write: (root) =>
      writeFile(root, "teams/alpha/workers/lead/skills/sweep/SKILL.md", skillDoc("sweep")),
    accountedFor: (out) =>
      out.teamSeatSkills.includes("sweep") ||
      out.reported.includes("teams/alpha/workers/lead/skills/sweep"),
  },
  {
    shape: "org/resources/<name>.md",
    publishedIn: {
      file: "apps/docs/docs/workforce/documents-on-disk.md",
      quote: "| `<root>/org/resources/code-of-conduct.md` | `code-of-conduct` |",
    },
    write: (root) =>
      writeFile(root, "org/resources/code-of-conduct.md", doc("How we behave.")),
    accountedFor: (out) =>
      out.documents.includes("code-of-conduct") ||
      out.reported.includes("org/resources/code-of-conduct.md"),
  },
  {
    shape: "org/skills/<skill>/SKILL.md",
    publishedIn: {
      file: "apps/docs/docs/skills/overview.md",
      quote: "workforce/org/skills/triage/SKILL.md",
    },
    write: (root) =>
      writeFile(root, "org/skills/house-style/SKILL.md", skillDoc("house-style")),
    accountedFor: (out) =>
      out.teamSeatSkills.includes("house-style") ||
      out.reported.includes("org/skills/house-style"),
  },
  {
    shape: "org/workers/<worker>/resources/<name>.md",
    publishedIn: {
      file: "apps/docs/docs/workforce/documents-on-disk.md",
      quote: "| `<root>/org/workers/build/resources/runbook.md` | `workers/build/runbook` |",
    },
    write: (root) =>
      writeFile(root, "org/workers/build/resources/playbook.md", doc("A playbook.")),
    accountedFor: (out) =>
      out.documents.includes("workers/build/playbook") ||
      out.reported.includes("org/workers/build/resources/playbook.md"),
  },
  {
    // Published as an assertion that org-level workers exist and are read like
    // team ones. The tree that carries their documents is the same tree that
    // would carry their `WORKER.md`.
    shape: "org/workers/<worker>/WORKER.md",
    publishedIn: {
      file: "apps/docs/docs/workforce/documents-on-disk.md",
      quote: "Organization-level workers, under `org/workers/`, are read the same way.",
    },
    write: (root) => writeFile(root, "org/workers/build/WORKER.md", doc("Shared infra seat.")),
    // Whatever id an org seat ends up minting is FIX-1414's call, so this asks
    // whether *some* seat came back for that folder rather than guessing the
    // spelling — and a loud refusal naming the folder counts just as well.
    accountedFor: (out) =>
      out.workers.some((id) => id === "build" || id.endsWith(".build")) ||
      out.reported.some((at) => at.startsWith("org/workers/build")),
  },
  {
    // The same sentence, applied to the skills convention's third level: a
    // worker's own `skills/` folder, for a worker that sits under `org/`.
    shape: "org/workers/<worker>/skills/<skill>/SKILL.md",
    publishedIn: {
      file: "apps/docs/docs/workforce/documents-on-disk.md",
      quote: "Organization-level workers, under `org/workers/`, are read the same way.",
    },
    write: (root) =>
      writeFile(root, "org/workers/build/skills/deploy/SKILL.md", skillDoc("deploy")),
    // No API can ask an org seat for its skills today — `readSeatSkills` takes
    // a team — so the consumed side is read off whatever manifest the seat
    // would arrive on once it can be hired.
    accountedFor: (out) =>
      Object.values(out.workerSkills).some((names) => names.includes("deploy")) ||
      out.reported.includes("org/workers/build/skills/deploy"),
  },
  {
    shape: "teams/<team>/resources/<name>.ts",
    publishedIn: {
      file: "apps/docs/docs/workforce/capabilities-on-disk.md",
      quote: "research.ts      ← a capability",
    },
    write: (root) =>
      writeFile(root, "teams/alpha/resources/research.ts", "export default {};\n"),
    accountedFor: (out) =>
      out.resourceModules.includes("teams/alpha/research") ||
      out.reported.includes("teams/alpha/resources/research.ts"),
  },
  {
    shape: "flows/workers/<kind>.ts",
    publishedIn: {
      file: "apps/docs/docs/workforce/workers-on-disk.md",
      quote: "request-triage.ts     ← a worker kind",
    },
    write: (root) =>
      writeFile(root, "flows/workers/request-triage.ts", "export default {};\n"),
    accountedFor: (out) =>
      out.code.includes("worker:request-triage") ||
      out.reported.includes("flows/workers/request-triage.ts"),
  },
  {
    shape: "flows/channels/<kind>.ts",
    publishedIn: {
      file: "apps/docs/docs/workforce/workers-on-disk.md",
      quote: "standup.ts            ← a channel kind",
    },
    write: (root) => writeFile(root, "flows/channels/standup.ts", "export default {};\n"),
    accountedFor: (out) =>
      out.code.includes("channel:standup") ||
      out.reported.includes("flows/channels/standup.ts"),
  },
  {
    shape: "blocks/<name>.ts",
    publishedIn: {
      file: "apps/docs/docs/workforce/workers-on-disk.md",
      quote: "triage.ts               ← a block a task board assigns by name",
    },
    write: (root) => writeFile(root, "blocks/triage.ts", "export default {};\n"),
    accountedFor: (out) =>
      out.code.includes("block:triage") || out.reported.includes("blocks/triage.ts"),
  },
];

/**
 * Run every reader over one tree and gather what each made of it.
 *
 * All readers see the same tree on purpose: an author writes one tree, and a
 * shape that is silent is silent across the whole package, not just in the one
 * reader you would have thought to ask.
 */
async function readEverything(root: string): Promise<Readout> {
  const reported: string[] = [];

  const workforce = await readWorkforce(root);
  for (const error of workforce.errors) reported.push(error.path);
  for (const seat of workforce.skillErrors) {
    for (const error of seat.errors) reported.push(error.path);
  }

  const resources = await readResourcesDirectory(root);
  for (const error of resources.errors) reported.push(error.path);

  const channels = await readChannelsDirectory(root);
  for (const error of channels.errors) reported.push(error.path);

  // The seat the fixture's team shapes hang off. Read directly rather than
  // through `readWorkforce`'s join so a shape stays observable even when the
  // `WORKER.md` beside it is the thing that failed.
  const seat = await readSeatSkills(root, { team: "alpha", worker: "lead" });
  for (const error of seat.errors) reported.push(error.path);

  let code: string[] = [];
  let resourceModules: string[] = [];
  try {
    const discovered = await discoverWorkforceCode(root);
    code = discovered.files.map((file) => `${file.slot}:${file.name}`);
    resourceModules = discovered.resourceModules.map((module) => module.ref);
  } catch (err) {
    // The codegen walk refuses loudly, by throwing with every problem named.
    // That is the policy working, so the message counts as the report.
    reported.push((err as Error).message);
  }

  return {
    workers: workforce.workers.map((worker) => worker.id),
    documents: resources.documents.map((document) => document.ref),
    channels: channels.channels.map((channel) => channel.id),
    resourceModules,
    code,
    teamSeatSkills: seat.skills.map((skill) => skill.name),
    workerSkills: Object.fromEntries(
      workforce.workers.map((worker) => [
        worker.id,
        (worker.skills ?? []).map((skill) => skill.name),
      ]),
    ),
    reported,
  };
}

describe("the published workforce-tree surface", () => {
  let root: string;

  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), "published-tree-surface-"));
  });
  afterEach(async () => {
    await fs.rm(root, { recursive: true, force: true });
  });

  it("is what the table says it is", async () => {
    // The guard on the derivation. Without it the table is a list of shapes
    // someone once read in the docs, which decays into a list of shapes the
    // code already handles — exactly the self-confirming scan this suite is
    // built to avoid.
    for (const { shape, publishedIn } of PUBLISHED_SHAPES) {
      const contents = await fs.readFile(path.join(REPO_ROOT, publishedIn.file), "utf8");
      expect(
        contents.includes(publishedIn.quote),
        `${shape} cites ${publishedIn.file}, which no longer contains:\n  ${publishedIn.quote}\n` +
          `Re-read that page: either it moved, or the published surface changed and this table must follow it.`,
      ).toBe(true);
    }
  });

  it("is either consumed or reported — never passed over in silence", async () => {
    for (const shape of PUBLISHED_SHAPES) await shape.write(root);

    const out = await readEverything(root);
    const silent = PUBLISHED_SHAPES.filter((shape) => !shape.accountedFor(out)).map(
      (shape) => shape.shape,
    );

    // Equality, not containment, in both directions. A new silent shape fails
    // on arrival; a gap someone has since closed fails until it is struck from
    // the list, so the list cannot rot into a permanent excuse.
    expect(
      [...silent].sort(),
      `Silent shapes and known gaps disagree.\n` +
        `Known gaps:\n${KNOWN_SILENT_GAPS.map((gap) => `  ${gap.shape}  (${gap.owner})`).join("\n")}\n` +
        `A shape here that is not a known gap is a new instance of the class: make it work, ` +
        `or refuse it loudly at load time naming the path. A known gap missing here is fixed — delete its row.`,
    ).toEqual([...KNOWN_SILENT_GAPS.map((gap) => gap.shape)].sort());
  });
});
