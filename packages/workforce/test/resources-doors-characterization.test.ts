/**
 * Characterization of both `resources/` doors' complete output over one tree.
 *
 * Door A is the Markdown reader (`readResourcesDirectory`, and
 * `readReferencesDirectory` over the same walk); Door B is the TypeScript module
 * walk (`discoverResourceModules`). The suites beside this one each prove a
 * case. This file pins everything both doors hand back for a tree that has
 * several workers at each level, a document and a module at all four places,
 * decoy `resources/` folders at non-places, and every structural refusal a
 * symlink can produce — so a change to where either door looks, the order it
 * reports in, or the wording of a refusal shows up here as a diff.
 *
 * Two facts are asserted against the filesystem rather than as literals,
 * because neither door decides them: the order `fs.readdir` lists sibling teams
 * in (both doors), and the order it lists sibling workers in (Door A only —
 * Door B sorts workers). Everything else is exact.
 */
import { mkdtempSync, mkdirSync, readdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { discoverResourceModules } from "../src/codegen/discover-resource-modules";
import {
  readReferencesDirectory,
  readResourcesDirectory,
  type ReadResourcesDirectoryResult,
} from "../src/loader";

const roots: string[] = [];

afterEach(() => {
  for (const dir of roots.splice(0)) rmSync(dir, { recursive: true, force: true });
});

/** A document Door A reads; its body names it so two records never compare equal by accident. */
const doc = (name: string): string => `---\ndescription: ${name}\n---\n\n${name} body`;

/** A module Door B finds. Never loaded. */
const MODULE = "export default {};";

/** A workforce root written from `{ "relative/path": contents }`, then linked per `links`. */
function tree(files: Record<string, string>, links: Record<string, string> = {}): string {
  const root = mkdtempSync(join(tmpdir(), "fsd-doors-char-"));
  roots.push(root);
  for (const [rel, contents] of Object.entries(files)) {
    const full = join(root, rel);
    mkdirSync(join(full, ".."), { recursive: true });
    writeFileSync(full, contents);
  }
  for (const [rel, target] of Object.entries(links)) {
    const full = join(root, rel);
    mkdirSync(join(full, ".."), { recursive: true });
    symlinkSync(join(root, target), full);
  }
  return root;
}

/**
 * Concatenate `byName`'s values in the order `fs.readdir` lists `dir`. The order
 * a door meets siblings in is the filesystem's, so the expectation takes it from
 * the filesystem rather than guessing a literal that holds on one machine.
 */
function inReaddirOrder<T>(dir: string, byName: Record<string, T[]>): T[] {
  return readdirSync(dir).flatMap((name) => byName[name] ?? []);
}

/** Door A's errors as plain data, message included, so wording is pinned too. */
function plainErrors(result: ReadResourcesDirectoryResult) {
  return result.errors.map(({ path, kind, error }) => ({ path, kind, message: error.message }));
}

/** A Door A record as the reader builds it, `filePath` only for `references/`. */
function record(ref: string, name: string, filePath?: string) {
  const declared = { description: name };
  const body = `${name} body`;
  return filePath === undefined ? { ref, declared, body } : { ref, declared, body, filePath };
}

const symlinkMessage = (what: string, name: string): string =>
  `Symlinked ${what} "${name}" — refused for safety`;

/**
 * The main tree. Every place has a document and a module; every level that can
 * be symlinked is, somewhere; and `resources/` folders sit where the convention
 * does not look (the root, a channel, a folder nested inside a worker, a link
 * target outside `org/` and `teams/`).
 */
function mainTree(slot: "resources" | "references"): string {
  const s = slot;
  return tree(
    {
      // Decoys: places the convention does not read.
      [`${s}/root-decoy.md`]: doc("root-decoy"),
      [`${s}/root-decoy.ts`]: MODULE,
      [`org/channels/general/${s}/channel-decoy.md`]: doc("channel-decoy"),
      [`org/workers/alpha/nested/${s}/nested-decoy.md`]: doc("nested-decoy"),
      [`teams/eng/channels/standup/${s}/team-channel-decoy.ts`]: MODULE,
      [`outside/worker/${s}/outside-doc.md`]: doc("outside-doc"),
      [`outside/worker/${s}/outside-mod.ts`]: MODULE,
      // The org place and its workers — including one named `resources`.
      [`org/${s}/org-doc.md`]: doc("org-doc"),
      [`org/${s}/org-mod.ts`]: MODULE,
      [`org/workers/alpha/${s}/alpha-doc.md`]: doc("alpha-doc"),
      [`org/workers/alpha/${s}/alpha-mod.ts`]: MODULE,
      [`org/workers/beta/${s}/beta-doc.md`]: doc("beta-doc"),
      [`org/workers/beta/${s}/beta-mod.tsx`]: MODULE,
      [`org/workers/resources/${s}/res-doc.md`]: doc("res-doc"),
      [`org/workers/resources/${s}/res-mod.ts`]: MODULE,
      // A file in a workers/ level occupies no slot.
      "org/workers/notes.txt": "not a worker",
      // A team with two workers, a linked worker and a worker with a linked slot.
      [`teams/eng/${s}/eng-doc.md`]: doc("eng-doc"),
      [`teams/eng/${s}/eng-mod.ts`]: MODULE,
      [`teams/eng/workers/lead/${s}/lead-doc.md`]: doc("lead-doc"),
      [`teams/eng/workers/lead/${s}/lead-mod.ts`]: MODULE,
      [`teams/eng/workers/ic/${s}/ic-doc.md`]: doc("ic-doc"),
      [`teams/eng/workers/ic/${s}/ic-mod.ts`]: MODULE,
      "teams/eng/workers/slotted/WORKER.md": "---\nname: slotted\n---\n",
      // A team whose own slot is linked, but whose worker is read.
      [`teams/design/workers/ic/${s}/design-ic-doc.md`]: doc("design-ic-doc"),
      [`teams/design/workers/ic/${s}/design-ic-mod.ts`]: MODULE,
      // A team whose workers/ level is linked, but whose own slot is read.
      [`teams/ops/${s}/ops-doc.md`]: doc("ops-doc"),
      [`teams/ops/${s}/ops-mod.ts`]: MODULE,
    },
    {
      "org/workers/linked": "outside/worker",
      "teams/eng/workers/linked": "outside/worker",
      [`teams/eng/workers/slotted/${s}`]: `outside/worker/${s}`,
      [`teams/design/${s}`]: `outside/worker/${s}`,
      "teams/ops/workers": "outside",
      "teams/linked": "outside",
    },
  );
}

describe("Door A over the main tree", () => {
  for (const slot of ["resources", "references"] as const) {
    it(`returns every ${slot}/ document and refusal, in walk order`, async () => {
      const root = mainTree(slot);
      const reader = slot === "resources" ? readResourcesDirectory : readReferencesDirectory;
      const at = (rel: string): string | undefined =>
        slot === "references" ? join(root, rel) : undefined;
      const rec = (ref: string, name: string, dir: string) =>
        record(ref, name, at(`${dir}/${slot}/${name}.md`));

      const result = await reader(root);

      expect(result.documents).toEqual([
        rec("org-doc", "org-doc", "org"),
        ...inReaddirOrder(join(root, "org/workers"), {
          alpha: [rec("workers/alpha/alpha-doc", "alpha-doc", "org/workers/alpha")],
          beta: [rec("workers/beta/beta-doc", "beta-doc", "org/workers/beta")],
          resources: [rec("workers/resources/res-doc", "res-doc", "org/workers/resources")],
        }),
        ...inReaddirOrder(join(root, "teams"), {
          eng: [
            rec("teams/eng/eng-doc", "eng-doc", "teams/eng"),
            ...inReaddirOrder(join(root, "teams/eng/workers"), {
              lead: [rec("teams/eng/workers/lead/lead-doc", "lead-doc", "teams/eng/workers/lead")],
              ic: [rec("teams/eng/workers/ic/ic-doc", "ic-doc", "teams/eng/workers/ic")],
            }),
          ],
          design: [
            rec(
              "teams/design/workers/ic/design-ic-doc",
              "design-ic-doc",
              "teams/design/workers/ic",
            ),
          ],
          ops: [rec("teams/ops/ops-doc", "ops-doc", "teams/ops")],
        }),
      ]);

      const unreadableSlot = (path: string, message: string) => ({
        path,
        kind: "unreadable-slot",
        message,
      });
      expect(plainErrors(result)).toEqual([
        unreadableSlot("org/workers/linked", symlinkMessage("worker folder", "linked")),
        ...inReaddirOrder(join(root, "teams"), {
          eng: inReaddirOrder(join(root, "teams/eng/workers"), {
            linked: [
              unreadableSlot("teams/eng/workers/linked", symlinkMessage("worker folder", "linked")),
            ],
            slotted: [
              unreadableSlot(
                `teams/eng/workers/slotted/${slot}`,
                symlinkMessage("directory", `teams/eng/workers/slotted/${slot}`),
              ),
            ],
          }),
          design: [
            unreadableSlot(
              `teams/design/${slot}`,
              symlinkMessage("directory", `teams/design/${slot}`),
            ),
          ],
          ops: [
            unreadableSlot("teams/ops/workers", symlinkMessage("directory", "teams/ops/workers")),
          ],
          linked: [unreadableSlot("teams/linked", symlinkMessage("team folder", "linked"))],
        }),
      ]);
    });
  }

  it("refuses a symlinked org/ and reads the teams beside it", async () => {
    const root = tree(
      {
        "outside/resources/hidden.md": doc("hidden"),
        "teams/eng/resources/eng-doc.md": doc("eng-doc"),
      },
      { org: "outside" },
    );

    const result = await readResourcesDirectory(root);

    expect(result.documents).toEqual([record("teams/eng/eng-doc", "eng-doc")]);
    expect(plainErrors(result)).toEqual([
      { path: "org", kind: "unreadable-slot", message: symlinkMessage("directory", "org") },
    ]);
  });

  it("refuses a symlinked org slot and a symlinked org workers/ level", async () => {
    const root = tree(
      { "outside/resources/hidden.md": doc("hidden"), "org/WORKFORCE.md": "" },
      { "org/resources": "outside/resources", "org/workers": "outside" },
    );

    const result = await readResourcesDirectory(root);

    expect(result.documents).toEqual([]);
    expect(plainErrors(result)).toEqual([
      {
        path: "org/resources",
        kind: "unreadable-slot",
        message: symlinkMessage("directory", "org/resources"),
      },
      {
        path: "org/workers",
        kind: "unreadable-slot",
        message: symlinkMessage("directory", "org/workers"),
      },
    ]);
  });
});

describe("Door B over the main tree", () => {
  it("returns every module, sorted by path, and every refusal in walk order", async () => {
    const root = mainTree("resources");

    const result = await discoverResourceModules(root);

    const module = (ref: string, path: string, atWorkerRoot: boolean) => ({
      ref,
      path,
      importPath: `./${path.replace(/\.tsx?$/, "")}`,
      atWorkerRoot,
    });
    expect(result.modules).toEqual([
      module("org-mod", "org/resources/org-mod.ts", false),
      module("workers/alpha/alpha-mod", "org/workers/alpha/resources/alpha-mod.ts", true),
      module("workers/beta/beta-mod", "org/workers/beta/resources/beta-mod.tsx", true),
      module("workers/resources/res-mod", "org/workers/resources/resources/res-mod.ts", true),
      module(
        "teams/design/workers/ic/design-ic-mod",
        "teams/design/workers/ic/resources/design-ic-mod.ts",
        true,
      ),
      module("teams/eng/eng-mod", "teams/eng/resources/eng-mod.ts", false),
      module("teams/eng/workers/ic/ic-mod", "teams/eng/workers/ic/resources/ic-mod.ts", true),
      module(
        "teams/eng/workers/lead/lead-mod",
        "teams/eng/workers/lead/resources/lead-mod.ts",
        true,
      ),
      module("teams/ops/ops-mod", "teams/ops/resources/ops-mod.ts", false),
    ]);

    // Workers are visited sorted; teams in the order `fs.readdir` lists them.
    expect(result.problems).toEqual([
      symlinkMessage("worker folder", "org/workers/linked"),
      ...inReaddirOrder(join(root, "teams"), {
        eng: [
          symlinkMessage("worker folder", "teams/eng/workers/linked"),
          symlinkMessage("directory", "teams/eng/workers/slotted/resources"),
        ],
        design: [symlinkMessage("directory", "teams/design/resources")],
        ops: [symlinkMessage("directory", "teams/ops/workers")],
        linked: [symlinkMessage("team folder", "linked")],
      }),
    ]);
  });

  it("refuses a symlinked org/ and reads the teams beside it", async () => {
    const root = tree(
      {
        "outside/resources/hidden.ts": MODULE,
        "teams/eng/resources/eng-mod.ts": MODULE,
      },
      { org: "outside" },
    );

    const result = await discoverResourceModules(root);

    expect(result.modules.map((m) => m.ref)).toEqual(["teams/eng/eng-mod"]);
    expect(result.problems).toEqual([symlinkMessage("directory", "org")]);
  });

  it("refuses a symlinked org slot and a symlinked org workers/ level", async () => {
    const root = tree(
      { "outside/resources/hidden.ts": MODULE, "org/WORKFORCE.md": "" },
      { "org/resources": "outside/resources", "org/workers": "outside" },
    );

    const result = await discoverResourceModules(root);

    expect(result.modules).toEqual([]);
    expect(result.problems).toEqual([
      symlinkMessage("directory", "org/resources"),
      symlinkMessage("directory", "org/workers"),
    ]);
  });
});
