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
 *
 * That derivation is guarded in BOTH directions, because either one alone
 * rots. Checking each row's quote against its file proves no row went stale —
 * and proves nothing about a page that started declaring something new, which
 * would leave the table quietly incomplete while every assertion in it passed.
 * So {@link shapesDeclaredIn} runs the extraction as a standing check: the
 * pages are read, every path shape and file extension they declare is pulled
 * out, and anything without a row fails. A missing row is worse than a missing
 * check, because it looks like coverage.
 *
 * **The same rule, one level up.** A path is not the only thing the convention
 * publishes. The ref tables publish *addresses*, and an address that resolves
 * to nothing is the same defect wearing a different hat — so the second half of
 * this file checks that a published document ref naming a worker names a worker
 * the roster reader accounts for. {@link WORKER_REFS_RESOLVE} carries that.
 *
 * **What this does not cover, deliberately.** Only what a published page or
 * README declares. Frontmatter keys are a different seam and already have their
 * own loud refusals — the readers' `refusedDeclaration` doors, and the hire's
 * refusal of a setting the kind does not declare.
 *
 * A shape declared only in an internal tree note is **not** here, and cannot be
 * without giving up the guard: nothing in the repo states that lock, so such a
 * row would carry no quote to re-check and would drift exactly the way this
 * table is built not to. Keeping the two apart also keeps the assertion
 * meaningful — mixing promises we made to authors with plans we made to
 * ourselves would make "we publish this and it does not work" unsayable.
 */
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { WorkforceCodeError, discoverWorkforceCode } from "../src/codegen/discover";
import { readChannelsDirectory } from "../src/loader/read-channels-directory";
import {
  readReferencesDirectory,
  readResourcesDirectory,
} from "../src/loader/read-resources-directory";
import { readSeatSkills } from "../src/loader/read-seat-skills";
import { readWorkforce } from "../src/loader/read-workforce";
import { DOCUMENT_SLOTS } from "../src/loader/resource-convention";

/** Repo root, from this file: `packages/workforce/test/` is three levels down. */
const REPO_ROOT = path.resolve(import.meta.dirname, "../../..");

/** Everything every reader made of one tree, gathered once. */
interface Readout {
  /** Worker ids that loaded. */
  workers: string[];
  /** Document refs that loaded, from the `resources/` slot. */
  documents: string[];
  /** Reference refs that loaded, from the `references/` slot. Its own field, not merged into `documents`: the two slots go to different install halves, and a shape accounted for by the wrong one is a shape nobody reads. */
  references: string[];
  /** Channel ids that loaded. */
  channels: string[];
  /** Ids of teams whose `TEAM.md` loaded. */
  teams: string[];
  /** Resource-module refs the codegen walk found. */
  resourceModules: string[];
  /** `<seat>:<name>` for every per-seat block registration the codegen walk found. */
  seatBlocks: string[];
  /** `<slot>:<name>` for every file in a locked code folder. */
  code: string[];
  /**
   * Skill names the `alpha.lead` seat resolved.
   *
   * Read through a SECOND `readSeatSkills` call rather than off the manifest
   * `readWorkforce` already joined on, deliberately: a skill row stays
   * observable even when the `WORKER.md` beside it is the thing that failed,
   * which is exactly the case where a skills-level silence would otherwise be
   * hidden behind a worker-level one.
   */
  teamSeatSkills: string[];
  /** Document refs that loaded, paired with the worker each one is addressed to. */
  workerAddressedRefs: Array<{ ref: string; worker: string; folder: string }>;
  /** Every root-relative path any reader reported as a failure. */
  reported: string[];
  /** Whether the codegen walk threw, which empties {@link Readout.code} and {@link Readout.resourceModules}. */
  codeWalkThrew: boolean;
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
 *
 * Empty, and that is the honest answer rather than a clean bill of health.
 * Every path the published surface declares is read by something today; what is
 * broken is one level up, in {@link KNOWN_UNRESOLVABLE_REFS}. The list stays
 * because the next gap needs somewhere to be recorded the moment it arrives,
 * and because an empty one is what makes the equality assertion say "none".
 */
const KNOWN_SILENT_GAPS: ReadonlyArray<{ shape: string; owner: string }> = [];

/**
 * The ref-table row that publishes an org worker's document address. Cited
 * twice — once as the row that says the path may be written, once as the
 * promise that its ref names a worker — so it lives in one place: the two
 * citations must not be able to drift apart.
 */
const ORG_WORKER_DOC_REF_ROW =
  "| `<root>/org/workers/build/resources/runbook.md` | `workers/build/runbook` |";

/**
 * Where the convention publishes that a worker's documents get an address
 * naming that worker. Two unambiguous table rows, checked verbatim the way
 * {@link PublishedShape.publishedIn} is — a ref table states the promise far
 * more plainly than any sentence of prose around it does.
 */
const WORKER_REFS_RESOLVE: ReadonlyArray<{ file: string; quote: string }> = [
  {
    file: "apps/docs/docs/workforce/documents-on-disk.md",
    quote: ORG_WORKER_DOC_REF_ROW,
  },
  {
    file: "packages/workforce/README.md",
    quote: "| `<root>/org/workers/<worker>/<slot>/<name>.md` | `workers/<worker>/<name>` |",
  },
];

/**
 * A published document ref that names a worker nothing accounts for, with the
 * issue that owns closing it.
 *
 * Held to the same equality discipline as {@link KNOWN_SILENT_GAPS}: a new
 * unresolvable ref fails on arrival, and one that starts resolving fails until
 * its row is struck.
 */
const KNOWN_UNRESOLVABLE_REFS: ReadonlyArray<{ worker: string; owner: string }> = [
  {
    worker: "build",
    owner:
      "FIX-1414 — an org-level worker has no id to be addressed by, so the ref " +
      "published for its documents names nothing hireable",
  },
];

/**
 * Where the published surface lives. Every `.md` under these directories is
 * read, so a page ADDED to one is scanned from the moment it lands — a
 * hand-listed set of pages would have been the same defect this suite catches,
 * one level up: a list describing itself as the published surface while
 * silently not being it.
 *
 * What stays manual is which directories, which is a far smaller and more
 * stable claim than which pages. The honest scope is therefore: **these trees,
 * plus the files named below**. A page published somewhere else is not scanned
 * and this suite will not say so.
 */
const PUBLISHED_DIRECTORIES: readonly string[] = [
  "apps/docs/docs/workforce",
  "apps/docs/docs/skills",
];

/** Published surface that is not a page under {@link PUBLISHED_DIRECTORIES}. */
const PUBLISHED_EXTRA_FILES: readonly string[] = ["packages/workforce/README.md"];

/** Every file the extraction reads, resolved when the check runs rather than listed. */
async function publishedFiles(): Promise<string[]> {
  const pages: string[] = [];
  for (const directory of PUBLISHED_DIRECTORIES) {
    const entries = await fs.readdir(path.join(REPO_ROOT, directory));
    for (const entry of entries.sort()) {
      if (entry.endsWith(".md")) pages.push(`${directory}/${entry}`);
    }
  }
  return [...pages, ...PUBLISHED_EXTRA_FILES];
}

/** Segments the convention fixes. Everything else in a path is the author's name for something. */
const RESERVED = new Set([
  "org",
  "teams",
  "workers",
  // Both documents slots, read from the convention rather than spelled here:
  // this suite exists to notice a folder the pages publish and the code does
  // not, so its own vocabulary must not be a second place the slot names live.
  // A third slot added later arrives here on its own.
  ...DOCUMENT_SLOTS,
  "skills",
  "channels",
  "flows",
  "blocks",
]);

/**
 * The metavariable the pages use when a rule holds for BOTH documents slots.
 *
 * The ref rule is one rule over `resources/` and `references/`, and the README
 * states it once as `<root>/org/<slot>/<name>.md` rather than writing every
 * level twice. That is a notation, not a path — so a shape carrying it is
 * expanded into the concrete slots before anything compares it to the table.
 * Read literally it would be a folder nobody implements, which is the opposite
 * of what it says.
 *
 * Expanding rather than tabling it also makes the check STRICTER: the page's
 * one generic sentence is now verified against each slot separately.
 */
const SLOT_PLACEHOLDER = "<slot>";
/** Filenames the convention fixes, which stay literal in a shape. */
const FIXED_LEAVES = new Set(["WORKER.md", "CHANNEL.md", "SKILL.md"]);

/**
 * A published path token, reduced to the shape it is an instance of.
 *
 * Normalizes by STRUCTURE rather than against a list of shapes already known:
 * a segment the convention fixes stays literal, and anything else is the
 * author's own name, rewritten to the placeholder its parent slot implies. That
 * is what lets a shape nobody has written down yet come out of this function —
 * a list-driven normalizer could only ever return shapes already in the table,
 * which is the self-confirming scan one level down.
 *
 * A segment in a position the convention does not fix stays literal on purpose,
 * so a genuinely new slot (`org/tools/...`) arrives spelled as itself and fails
 * the comparison loudly instead of being bent into a shape that fits.
 *
 * Returns `undefined` for a token that is not a tree path at all: a ref (no
 * slot word), or a folder mention with no file at the end.
 */
function toShape(token: string): string | undefined {
  let segments = token.split("/").filter(Boolean);
  if (segments[0] === "workforce") segments = segments.slice(1);
  if (segments.length < 2) return undefined;
  if (!["org", "teams", "flows", "blocks"].includes(segments[0])) return undefined;

  const last = segments[segments.length - 1];
  // A shape ends in a file. That one test is what separates a path from a ref
  // and from a folder mention: `teams/engineering/workers/on-call/runbook` is a
  // ref (the ref tables print both in adjacent columns), `org/skills/triage` is
  // a folder. Neither has a file at the end.
  //
  // It used to ALSO require a segment from a known slot vocabulary. That was
  // this suite's own defect, in the fix for this suite's own defect: it asked
  // "is this built from parts we already recognize?", so a genuinely new slot —
  // the one case the completeness check exists for — was discarded before it
  // could be reported. Removing it costs nothing measurable: over the whole
  // published surface it changes the extracted set by zero shapes, because the
  // leaf test was already rejecting every ref and folder on its own.
  if (!FIXED_LEAVES.has(last) && !/\.[a-z]+$/.test(last)) return undefined;

  return segments
    .map((segment, index) => {
      if (RESERVED.has(segment) || FIXED_LEAVES.has(segment)) return segment;
      const parent = segments[index - 1];
      const grandparent = segments[index - 2];
      const extension = /\.([a-z]+)$/.exec(segment)?.[1];
      if (grandparent === "flows") return `<kind>.${extension}`;
      if (parent === "blocks") return `<name>.${extension}`;
      // Either documents slot, for the reason `RESERVED` reads them from the
      // convention: a file under `references/` is an author's own name exactly
      // as one under `resources/` is, and normalizing only one of them left
      // half the convention's shapes spelled as whatever the page's example
      // happened to call them.
      if (parent !== undefined && (DOCUMENT_SLOTS as readonly string[]).includes(parent)) {
        return `<name>.${extension}`;
      }
      if (parent === "teams") return "<team>";
      if (parent === "workers") return "<worker>";
      if (parent === "skills") return "<skill>";
      if (parent === "channels") return "<channel>";
      return segment;
    })
    .join("/");
}

/**
 * Every path an indented tree block spells, reassembled from its indentation.
 *
 * Fences are read separately from prose because a fence spells one path across
 * many lines, which is exactly the part a line-by-line regex cannot see — and
 * is why the first version of this table was extracted by hand.
 */
function pathsInFence(lines: readonly string[]): string[] {
  const found: string[] = [];
  const stack: Array<{ indent: number; name: string }> = [];
  for (const raw of lines) {
    // Trailing annotations: `request-triage.ts     ← a worker kind`, `foo  # note`.
    const line = raw.replace(/\s+←.*$/, "").replace(/\s+#.*$/, "").trimEnd();
    if (line.trim() === "") continue;
    const indent = line.length - line.trimStart().length;
    const name = line.trim().replace(/\/$/, "");
    if (!/^[A-Za-z0-9_<>.\-/]+$/.test(name)) continue;
    while (stack.length > 0 && stack[stack.length - 1]!.indent >= indent) stack.pop();
    stack.push({ indent, name });
    found.push(stack.map((entry) => entry.name).join("/"));
  }
  return found;
}

/** Every path token written inline — in prose, a table cell, or a code span. */
function pathsInLine(line: string): string[] {
  const found: string[] = [];
  const pattern = /(?:<root>\/|workforce\/|\.\/)?((?:org|teams|flows|blocks)\/[A-Za-z0-9_<>/.\-]*)/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(line)) !== null) {
    found.push(match[1]!.replace(/[.,`|)]+$/, ""));
  }
  return found;
}

/** Every shape one published page declares, from its fences and its prose alike. */
function shapesDeclaredIn(text: string): Set<string> {
  const tokens: string[] = [];
  let inFence = false;
  let language = "";
  let fence: string[] = [];

  for (const line of text.split("\n")) {
    const marker = /^```(\w*)/.exec(line.trim());
    if (marker !== null) {
      if (inFence) {
        // An unlabelled fence holding indented names is a tree; anything else
        // (ts, bash, md) is read line by line like prose.
        const isTree = language === "" && fence.some((entry) => /^\s{2,}\S/.test(entry));
        tokens.push(...(isTree ? pathsInFence(fence) : fence.flatMap(pathsInLine)));
        inFence = false;
        fence = [];
      } else {
        inFence = true;
        language = marker[1]!;
      }
      continue;
    }
    if (inFence) fence.push(line);
    else tokens.push(...pathsInLine(line));
  }

  const shapes = new Set<string>();
  for (const token of tokens) {
    const shape = toShape(token);
    if (shape === undefined) continue;
    // A `<slot>` shape is one sentence standing for both slots, so it becomes
    // both. Everything else passes through untouched.
    if (shape.includes(SLOT_PLACEHOLDER)) {
      for (const slot of DOCUMENT_SLOTS) shapes.add(shape.replace(SLOT_PLACEHOLDER, slot));
      continue;
    }
    shapes.add(shape);
  }
  return shapes;
}

/**
 * Every file extension the published pages name as one an author may write —
 * a backtick span holding nothing but a dotted suffix, which is how the pages
 * spell one.
 *
 * Extensions are extracted separately because a published shape is a path AND
 * what may sit at the end of it. `.tsx` is declared in a sentence and appears
 * in no path anywhere, so a check that read only paths would have reported full
 * coverage over a declaration nothing exercised.
 */
function extensionsDeclaredIn(text: string): Set<string> {
  return new Set([...text.matchAll(/`(\.[a-z]{1,5})`/g)].map((match) => match[1]!));
}

/**
 * A table shape no path token in the docs spells, because the page publishes it
 * in a sentence instead. Asserted to be exactly the difference, so a row cannot
 * hide here once the pages start spelling it out.
 */
const PROSE_PUBLISHED: ReadonlyArray<{ shape: string; why: string }> = [
  {
    shape: "org/resources/<name>.ts",
    why: "published by 'A capability lives at the organization level or in a team.' — no page writes the path",
  },
  {
    shape: "org/workers/<worker>/resources/<name>.ts",
    why: "published by 'A plain resource there is fine…' — the sentence covers a worker's folder at either level",
  },
  {
    shape: "teams/<team>/workers/<worker>/resources/<name>.ts",
    why: "the same sentence, at the team level",
  },
  {
    shape: "flows/workers/<kind>.tsx",
    why: "published by 'Every `.ts` and `.tsx` file…' — the pages spell only the `.ts` form in their trees",
  },
  {
    shape: "teams/<team>/resources/<name>.tsx",
    why: "the same sentence, for the module walk's own extension list",
  },
];

/**
 * A dotted token that reads as an extension and is not one. Each needs a
 * reason: a silently lossy filter is the defect this suite is named after.
 */
const NOT_AN_EXTENSION: ReadonlyArray<{ token: string; why: string }> = [
  { token: ".tap", why: "the `.tap()` step method, written in backticks beside `.md` and `.ts`" },
];

/** Write one instance of every published shape into the fixture tree. */
async function writeAllPublishedShapes(root: string): Promise<void> {
  for (const shape of PUBLISHED_SHAPES) await shape.write(root);
}

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
    shape: "teams/<team>/TEAM.md",
    publishedIn: {
      file: "apps/docs/docs/workforce/workers-on-disk.md",
      quote:
        "A `TEAM.md` at the top of a team's folder describes the team and holds the instructions every",
    },
    write: (root) =>
      writeFile(
        root,
        "teams/alpha/TEAM.md",
        "---\ndescription: The alpha team.\n---\n\nStay inside the brief.\n",
      ),
    accountedFor: (out) =>
      out.teams.includes("alpha") || out.reported.includes("teams/alpha/TEAM.md"),
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
    shape: "org/references/<name>.md",
    publishedIn: {
      file: "apps/docs/docs/workforce/documents-on-disk.md",
      quote: "| `<root>/org/references/code-of-conduct.md` | `code-of-conduct` |",
    },
    write: (root) => writeFile(root, "org/references/coc.md", doc("A code of conduct.")),
    accountedFor: (out) =>
      out.references.includes("coc") || out.reported.includes("org/references/coc.md"),
  },
  {
    shape: "teams/<team>/references/<name>.md",
    publishedIn: {
      file: "packages/workforce/README.md",
      quote: "| `<root>/teams/<teamId>/<slot>/<name>.md` | `teams/<teamId>/<name>` |",
    },
    write: (root) => writeFile(root, "teams/alpha/references/handbook.md", doc("A handbook.")),
    accountedFor: (out) =>
      out.references.includes("teams/alpha/handbook") ||
      out.reported.includes("teams/alpha/references/handbook.md"),
  },
  {
    shape: "teams/<team>/workers/<worker>/references/<name>.md",
    publishedIn: {
      file: "apps/docs/docs/workforce/documents-on-disk.md",
      quote:
        "| `<root>/teams/engineering/workers/ada/references/runbook.md` | `teams/engineering/workers/ada/runbook` |",
    },
    write: (root) =>
      writeFile(root, "teams/alpha/workers/lead/references/runbook.md", doc("A runbook.")),
    accountedFor: (out) =>
      out.references.includes("teams/alpha/workers/lead/runbook") ||
      out.reported.includes("teams/alpha/workers/lead/references/runbook.md"),
  },
  {
    // The level with no seat below it: documents here load and are minted, and
    // no seat can be hired at this address, so nothing reaches them. Tabled
    // anyway — the pages publish the shape, and a shape that reaches nobody is
    // exactly the kind this suite must not let go unnoticed.
    shape: "org/workers/<worker>/references/<name>.md",
    publishedIn: {
      file: "packages/workforce/README.md",
      quote: "| `<root>/org/workers/<worker>/<slot>/<name>.md` | `workers/<worker>/<name>` |",
    },
    write: (root) => writeFile(root, "org/workers/build/references/playbook.md", doc("A playbook.")),
    accountedFor: (out) =>
      out.references.includes("workers/build/playbook") ||
      out.reported.includes("org/workers/build/references/playbook.md"),
  },
  {
    shape: "teams/<team>/resources/<name>.md",
    publishedIn: {
      file: "apps/docs/docs/workforce/documents-on-disk.md",
      quote: "| `<root>/teams/engineering/resources/scratch.md` | `teams/engineering/scratch` |",
    },
    write: (root) => writeFile(root, "teams/alpha/resources/handbook.md", doc("A handbook.")),
    accountedFor: (out) =>
      out.documents.includes("teams/alpha/handbook") ||
      out.reported.includes("teams/alpha/resources/handbook.md"),
  },
  {
    shape: "teams/<team>/workers/<worker>/resources/<name>.md",
    publishedIn: {
      file: "packages/workforce/README.md",
      quote:
        "| `<root>/teams/<teamId>/workers/<worker>/<slot>/<name>.md` | `teams/<teamId>/workers/<worker>/<name>` |",
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
      file: "packages/workforce/README.md",
      quote: "| `<root>/org/<slot>/<name>.md` | `<name>` |",
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
      quote: ORG_WORKER_DOC_REF_ROW,
    },
    write: (root) =>
      writeFile(root, "org/workers/build/resources/playbook.md", doc("A playbook.")),
    accountedFor: (out) =>
      out.documents.includes("workers/build/playbook") ||
      out.reported.includes("org/workers/build/resources/playbook.md"),
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
    shape: "org/resources/<name>.ts",
    publishedIn: {
      file: "apps/docs/docs/workforce/capabilities-on-disk.md",
      quote: "A capability lives at the organization level or in a team.",
    },
    write: (root) => writeFile(root, "org/resources/house.ts", "export default {};\n"),
    accountedFor: (out) =>
      out.resourceModules.includes("house") ||
      out.reported.includes("org/resources/house.ts"),
  },
  // The two rows below are the same path at the two worker levels, and both
  // assert only that the module walk SEES the file. That is deliberate, and it
  // is less than the page says, so it is worth being exact about what is not
  // covered here.
  //
  // The page splits a worker-level `.ts` two ways by what the file *is*: "A
  // plain resource there is fine", while a capability in the same folder "is
  // refused by name". The walk cannot tell them apart — it reads names, not
  // default exports — so it consumes both and flags the position
  // (`atWorkerRoot`), leaving the capability refusal to the seam that installs
  // them. These rows therefore cover the plain-resource half, which is the half
  // this suite is about: a published path that produces nothing and says
  // nothing. Whether the refusal actually fires for the capability half is a
  // different check at a different seam, and asserting it from a path alone
  // would be claiming coverage this fixture cannot have.
  {
    shape: "teams/<team>/workers/<worker>/resources/<name>.ts",
    publishedIn: {
      file: "apps/docs/docs/workforce/capabilities-on-disk.md",
      quote: "A plain resource there is fine, and works like a document at that path.",
    },
    write: (root) =>
      writeFile(root, "teams/alpha/workers/lead/resources/helper.ts", "export default {};\n"),
    accountedFor: (out) =>
      out.resourceModules.includes("teams/alpha/workers/lead/helper") ||
      out.reported.includes("teams/alpha/workers/lead/resources/helper.ts"),
  },
  {
    shape: "org/workers/<worker>/resources/<name>.ts",
    publishedIn: {
      file: "apps/docs/docs/workforce/capabilities-on-disk.md",
      quote: "A plain resource there is fine, and works like a document at that path.",
    },
    write: (root) =>
      writeFile(root, "org/workers/build/resources/helper.ts", "export default {};\n"),
    accountedFor: (out) =>
      out.resourceModules.includes("workers/build/helper") ||
      out.reported.includes("org/workers/build/resources/helper.ts"),
  },
  {
    shape: "flows/workers/<kind>.ts",
    publishedIn: {
      file: "apps/docs/docs/workforce/code-on-disk.md",
      quote: "request-triage.ts       ← a worker kind",
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
      file: "apps/docs/docs/workforce/code-on-disk.md",
      quote: "standup.ts              ← a channel kind",
    },
    write: (root) => writeFile(root, "flows/channels/standup.ts", "export default {};\n"),
    accountedFor: (out) =>
      out.code.includes("channel:standup") ||
      out.reported.includes("flows/channels/standup.ts"),
  },
  {
    shape: "blocks/<name>.ts",
    publishedIn: {
      file: "apps/docs/docs/workforce/code-on-disk.md",
      quote: "triage.ts                 ← a block any worker may name",
    },
    write: (root) => writeFile(root, "blocks/triage.ts", "export default {};\n"),
    accountedFor: (out) =>
      out.code.includes("block:triage") || out.reported.includes("blocks/triage.ts"),
  },
  {
    shape: "teams/<team>/blocks/<name>.ts",
    publishedIn: {
      file: "apps/docs/docs/workforce/code-on-disk.md",
      quote: "| `workforce/teams/<team>/blocks/` | every worker on that team |",
    },
    write: (root) =>
      writeFile(root, "teams/alpha/blocks/build-status.ts", "export default {};\n"),
    // A team's block is registered for every seat on the team, so the seat
    // fixture beside it is what accounts for this one. A team with no workers
    // registers it for nobody, which is why the WORKER.md row's seat is the
    // one looked for.
    accountedFor: (out) =>
      out.seatBlocks.includes("alpha.lead:build-status") ||
      out.reported.includes("teams/alpha/blocks/build-status.ts"),
  },
  {
    shape: "teams/<team>/workers/<worker>/blocks/<name>.ts",
    publishedIn: {
      file: "apps/docs/docs/workforce/code-on-disk.md",
      quote:
        "| `workforce/teams/<team>/workers/<worker>/blocks/` | that one worker |",
    },
    write: (root) =>
      writeFile(root, "teams/alpha/workers/lead/blocks/page-oncall.ts", "export default {};\n"),
    accountedFor: (out) =>
      out.seatBlocks.includes("alpha.lead:page-oncall") ||
      out.reported.includes("teams/alpha/workers/lead/blocks/page-oncall.ts"),
  },
  // `.tsx` is published in a sentence and written in no tree on any page, so
  // nothing above exercises it — a declaration the suite reported full coverage
  // over while never touching it.
  //
  // Two rows, not seven. The extension is not one setting: `codegen/discover.ts`
  // and `codegen/discover-resource-modules.ts` each keep their OWN
  // `TYPESCRIPT_EXTENSIONS`, so one row per walk is the granularity at which
  // dropping `.tsx` can actually be caught. A row for every `.ts` position would
  // be six more fixtures that all fail or all pass together.
  {
    shape: "flows/workers/<kind>.tsx",
    publishedIn: {
      file: "apps/docs/docs/workforce/code-on-disk.md",
      quote: "Every `.ts` and `.tsx` file in one of the code folders is a declaration",
    },
    write: (root) => writeFile(root, "flows/workers/intake.tsx", "export default {};\n"),
    accountedFor: (out) =>
      out.code.includes("worker:intake") || out.reported.includes("flows/workers/intake.tsx"),
  },
  {
    shape: "teams/<team>/resources/<name>.tsx",
    publishedIn: {
      file: "apps/docs/docs/workforce/code-on-disk.md",
      quote: "Every `.ts` and `.tsx` file in one of the code folders is a declaration",
    },
    write: (root) =>
      writeFile(root, "teams/alpha/resources/panel.tsx", "export default {};\n"),
    accountedFor: (out) =>
      out.resourceModules.includes("teams/alpha/panel") ||
      out.reported.includes("teams/alpha/resources/panel.tsx"),
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
  for (const error of workforce.teamErrors) reported.push(error.path);

  const resources = await readResourcesDirectory(root);
  for (const error of resources.errors) reported.push(error.path);

  const references = await readReferencesDirectory(root);
  for (const error of references.errors) reported.push(error.path);

  const channels = await readChannelsDirectory(root);
  for (const error of channels.errors) reported.push(error.path);

  // The seat the fixture's team shapes hang off. Read directly rather than
  // through `readWorkforce`'s join so a shape stays observable even when the
  // `WORKER.md` beside it is the thing that failed.
  const seat = await readSeatSkills(root, { team: "alpha", worker: "lead" });
  for (const error of seat.errors) reported.push(error.path);

  let codeWalkThrew = false;
  let code: string[] = [];
  let resourceModules: string[] = [];
  let seatBlocks: string[] = [];
  try {
    const discovered = await discoverWorkforceCode(root);
    code = discovered.files.map((file) => `${file.slot}:${file.name}`);
    resourceModules = discovered.resourceModules.map((module) => module.ref);
    seatBlocks = discovered.seatBlocks.map((entry) => `${entry.seat}:${entry.name}`);
  } catch (err) {
    // The codegen walk refuses loudly, by throwing once with every problem
    // named. That is the policy working — but every predicate here asks
    // `reported.includes(path)`, an exact match per element, so pushing the
    // aggregate message as one string means a path INSIDE it never matches and
    // a conforming refusal gets classified as silence. The message counts as a
    // report to a human reading the failure; it does not count to `includes`.
    //
    // So the structured list is used instead, and each problem contributes the
    // path it names. The walk quotes the offending path in every problem it
    // builds, which is what makes this recoverable rather than a guess.
    const problems = err instanceof WorkforceCodeError ? err.problems : [(err as Error).message];
    for (const problem of problems) {
      const quoted = [...problem.matchAll(/"([^"]+)"/g)].map((match) => match[1]!);
      // A refusal can name two paths (a duplicate basename names both). Push
      // each, and the raw problem too so a human reading a failure sees it.
      reported.push(...quoted, problem);
    }
    // `files` and `resourceModules` are lost with the throw, so every OTHER
    // code shape in this run reads unaccounted. That is deliberate rather than
    // papered over: a degraded readout should fail loudly and be explained, not
    // quietly excuse whatever it can no longer see.
    codeWalkThrew = true;
  }

  return {
    workers: workforce.workers.map((worker) => worker.id),
    documents: resources.documents.map((document) => document.ref),
    references: references.documents.map((reference) => reference.ref),
    channels: channels.channels.map((channel) => channel.id),
    teams: workforce.teams.map((team) => team.id),
    resourceModules,
    seatBlocks,
    code,
    teamSeatSkills: seat.skills.map((skill) => skill.name),
    workerAddressedRefs: resources.documents.flatMap((document) => {
      const addressed = workerFromRef(document.ref);
      return addressed === undefined ? [] : [{ ref: document.ref, ...addressed }];
    }),
    reported,
    codeWalkThrew,
  };
}

/**
 * The worker a document ref is addressed to, and the folder that worker would
 * sit in — or `undefined` when the ref names no worker.
 *
 * Read off the ref rule the convention publishes, not off a list of the forms
 * it currently produces: a ref carries a `workers/` segment exactly when the
 * document sat in a worker's own folder, and what precedes that segment is the
 * team, or nothing at the organization level. `ResourceDoc.ref` states the rule
 * and makes the same point about why the rule leads and the forms follow.
 */
function workerFromRef(ref: string): { worker: string; folder: string } | undefined {
  const segments = ref.split("/");
  const at = segments.indexOf("workers");
  if (at === -1) return undefined;

  const name = segments[at + 1];
  if (name === undefined) return undefined;

  // `teams/<team>/workers/<name>/…` mints `<team>.<name>`; an org-level worker
  // has no team segment, so the id it would mint is FIX-1414's to decide and
  // the bare folder name is the most that can be asserted about it.
  return at === 2 && segments[0] === "teams"
    ? { worker: `${segments[1]}.${name}`, folder: `teams/${segments[1]}/workers/${name}` }
    : { worker: name, folder: `org/workers/${name}` };
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

  it("surfaces a slot it has never seen before, rather than discarding it", () => {
    // The regression for this suite's own worst defect. The extraction used to
    // require a segment from a vocabulary of slots already known, which meant a
    // genuinely NEW slot — the one thing the completeness check exists to catch
    // — was thrown away before it could be reported, and the suite stayed green
    // over a published path nothing handles.
    //
    // Synthetic rather than a real page on purpose: the whole point is a slot
    // that does not exist yet, and one cannot be left sitting in the docs.
    const declared = shapesDeclaredIn(
      "A tool lives at `org/tools/scanner.md` and is read at boot.\n",
    );

    expect(
      [...declared],
      "An unrecognized slot must come out of the extraction spelled as itself, so the " +
        "completeness assertion can fail on it by name. Discarding it is how a newly " +
        "published shape stays invisible.",
    ).toEqual(["org/tools/scanner.md"]);

    // And the two things the leaf test is what rejects — a ref and a folder
    // mention — must still not be mistaken for shapes, or removing the slot
    // filter would have traded a blind spot for noise.
    expect([...shapesDeclaredIn("its ref is `teams/engineering/workers/on-call/runbook`")]).toEqual(
      [],
    );
    expect([...shapesDeclaredIn("the folder `org/skills/triage` holds it")]).toEqual([]);
  });

  it("has a row for everything the published pages declare", async () => {
    // The other direction, and the one that decides whether the table can be
    // trusted as COMPLETE. Checking each row's quote proves no row went stale;
    // it proves nothing about a page that started declaring something new, and
    // a missing row is worse than a missing check because it looks like
    // coverage. So the extraction that built this table by hand runs as a
    // standing check instead.
    const declaredShapes = new Set<string>();
    const declaredExtensions = new Set<string>();
    for (const file of await publishedFiles()) {
      const contents = await fs.readFile(path.join(REPO_ROOT, file), "utf8");
      for (const shape of shapesDeclaredIn(contents)) declaredShapes.add(shape);
      for (const extension of extensionsDeclaredIn(contents)) declaredExtensions.add(extension);
    }

    const tabled = new Set(PUBLISHED_SHAPES.map((row) => row.shape));

    // Every shape the pages spell must have a row.
    expect(
      [...declaredShapes].filter((shape) => !tabled.has(shape)).sort(),
      `The published pages declare a path shape with no row in PUBLISHED_SHAPES.\n` +
        `Add a row for it — with the file and sentence that publishes it — or, if the ` +
        `extraction misread something, fix the extraction. Do not delete the shape from here.`,
    ).toEqual([]);

    // And every row the extraction cannot see is accounted for as prose, so a
    // row cannot quietly hide behind the extractor's blind spots.
    expect(
      [...tabled].filter((shape) => !declaredShapes.has(shape)).sort(),
      `A row is not spelled as a path anywhere in the published pages. That is fine when the ` +
        `page publishes it in a sentence — list it in PROSE_PUBLISHED with which sentence. ` +
        `If a page has since started spelling it out, remove it from PROSE_PUBLISHED instead.`,
    ).toEqual([...PROSE_PUBLISHED.map((entry) => entry.shape)].sort());

    // An extension is half of what a published shape is. A row must exercise
    // each one the pages name, or it is a declaration nothing checks.
    const exercised = new Set(
      [...tabled].map((shape) => /\.[a-z]+$/.exec(shape)?.[0]).filter(Boolean),
    );
    const excused = new Set(NOT_AN_EXTENSION.map((entry) => entry.token));
    expect(
      [...declaredExtensions].filter((ext) => !exercised.has(ext) && !excused.has(ext)).sort(),
      `The published pages name a file extension no row exercises.\n` +
        `Each of the two walks keeps its own TYPESCRIPT_EXTENSIONS list, so one row per walk ` +
        `is what covers an extension — drop it from one list and only that walk's row fails. ` +
        `If the token is not really an extension, add it to NOT_AN_EXTENSION with why.`,
    ).toEqual([]);
  });

  it("is either consumed or reported — never passed over in silence", async () => {
    await writeAllPublishedShapes(root);

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
        (out.codeWalkThrew
          ? `NOTE: the codegen walk threw, so its files and modules are empty this run — ` +
            `code shapes it did not name are unverifiable rather than silent.\n`
          : ``) +
        `A shape here that is not a known gap is a new instance of the class: make it work, ` +
        `or refuse it loudly at load time naming the path. A known gap missing here is fixed — delete its row.`,
    ).toEqual([...KNOWN_SILENT_GAPS.map((gap) => gap.shape)].sort());
  });

  it("publishes a ref for a worker's documents that names a worker", async () => {
    for (const { file, quote } of WORKER_REFS_RESOLVE) {
      const contents = await fs.readFile(path.join(REPO_ROOT, file), "utf8");
      expect(
        contents.includes(quote),
        `${file} no longer contains:\n  ${quote}\nThe promise checked below is this row. Re-read the page.`,
      ).toBe(true);
    }

    await writeAllPublishedShapes(root);
    // A team worker folder holding documents and no `WORKER.md`. The convention
    // says such a folder's documents load and the missing file is reported
    // separately, so this is the case that proves the assertion below
    // discriminates: its ref is unresolved for a reason the author is TOLD, and
    // it must not read the same as the org-level silence.
    await writeFile(root, "teams/alpha/workers/ghost/resources/note.md", doc("A note."));

    const out = await readEverything(root);

    // The class policy, applied to an address instead of a path: a ref that
    // names a worker must name one that loaded, or one whose absence was
    // reported. Neither is the silence — a document an author can read, whose
    // address points at nothing and says nothing.
    const unresolvable = out.workerAddressedRefs
      .filter(
        // Exact, never a prefix. The worker slot is what must be reported, and
        // a prefix would let a failure on a *sibling* under that folder — a
        // document in its own `resources/`, say — stand in for a worker nobody
        // said anything about, which is the assertion passing for a reason
        // unrelated to its claim.
        ({ worker, folder }) =>
          !out.workers.includes(worker) && !out.reported.includes(folder),
      )
      .map(({ worker }) => worker);

    expect(
      [...new Set(unresolvable)].sort(),
      `Published worker-addressed refs and known unresolvable ones disagree.\n` +
        `Known:\n${KNOWN_UNRESOLVABLE_REFS.map((r) => `  ${r.worker}  (${r.owner})`).join("\n")}\n` +
        `A worker here that is not known is a new instance: the convention publishes an ` +
        `address for its documents, so hiring it must work or its folder must be refused ` +
        `loudly. One missing is fixed — delete its row.`,
    ).toEqual([...KNOWN_UNRESOLVABLE_REFS.map((known) => known.worker)].sort());
  });
});
