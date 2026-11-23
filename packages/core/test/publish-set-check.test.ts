import { describe, expect, it } from "vitest";
// @ts-expect-error — root check script, plain .mjs with no type declarations.
import { findPublishable, findUnversionable, loadChangesetParser, neverPublish } from "../../../scripts/validate-publish-set.mjs";

type Offender = { dir: string; name: string | null; reason: string };
type Manifest = { name?: string; private?: boolean };

const find = (manifests: Record<string, Manifest | Error>): Offender[] =>
  (
    findPublishable as (
      dirs: string[],
      read: (dir: string) => Manifest,
    ) => Offender[]
  )(Object.keys(manifests), (dir) => {
    const entry = manifests[dir];
    if (entry instanceof Error) throw entry;
    return entry;
  });

/**
 * The guard exists because one deleted line publishes a package permanently, so
 * the failing case is pinned here rather than discovered on a release run. A
 * check that cannot go red proves nothing, which is the whole reason the missing
 * `private` case leads.
 */
describe("packages held out of the publish set", () => {
  it("flags a held-out package whose private flag was removed", () => {
    const offenders = find({
      "thought-fabric-core": { name: "@thought-fabric/core" },
    });
    expect(offenders).toEqual([
      {
        dir: "thought-fabric-core",
        name: "@thought-fabric/core",
        reason: 'no "private": true',
      },
    ]);
  });

  it("flags private: false as loudly as an absent flag — publish reads falsy the same way", () => {
    const offenders = find({
      ui: { name: "@flow-state-dev/ui", private: false },
    });
    expect(offenders.map((o) => o.dir)).toEqual(["ui"]);
  });

  it("stays quiet when every held-out package is private", () => {
    const offenders = find({
      "thought-fabric-core": { name: "@thought-fabric/core", private: true },
      ui: { name: "@flow-state-dev/ui", private: true },
    });
    expect(offenders).toEqual([]);
  });

  it("flags a package whose manifest cannot be read rather than passing it", () => {
    const offenders = find({ "thought-fabric-core": new Error("ENOENT") });
    expect(offenders[0]?.reason).toBe("manifest is missing or unreadable");
  });

  it("covers @thought-fabric/core, the exclusion the list was added for", () => {
    expect(neverPublish).toContain("thought-fabric-core");
  });
});

type Unversionable = { path: string; name: string | null; reason: string };

// The real parser `changeset version` runs, so a case here fails exactly when the release would.
const parse = (loadChangesetParser as () => unknown)();

const unversionable = (fragments: Record<string, string>): Unversionable[] =>
  (findUnversionable as (f: { path: string; source: string }[], p: Map<string, boolean>, parse: unknown) => Unversionable[])(
    Object.entries(fragments).map(([path, source]) => ({ path, source })),
    new Map([
      ["@flow-state-dev/workforce", false],
      ["@flow-state-dev/orchestration", false],
      ["@flow-state-dev/ui", true],
    ]),
    parse,
  );

const unparsable = (path: string) => ({ path, name: null, reason: expect.stringMatching(/^cannot be parsed: /) as unknown as string });

/**
 * `changeset version` fails the whole release, not one fragment, when a note names a package it
 * skips (every private one) beside a published one, or a name with no package. One such note on
 * main froze the Version Packages PR, so the guard must refuse it on the PR that adds it.
 */
describe("pending changesets name published packages only", () => {
  it("flags a private package named beside published ones, the shape changeset version rejects", () => {
    const offenders = unversionable({
      ".changeset/mixed.md": '---\n"@flow-state-dev/ui": patch\n"@flow-state-dev/workforce": patch\n---\n\nNote (FIX-1).\n',
    });
    expect(offenders).toEqual([
      { path: ".changeset/mixed.md", name: "@flow-state-dev/ui", reason: "is private, so changeset version skips it" },
    ]);
  });

  it("flags a fragment naming only a private package: it releases nothing, so BP-022 says write none", () => {
    const offenders = unversionable({ ".changeset/ui.md": "---\n'@flow-state-dev/ui': minor\n---\n\nNote.\n" });
    expect(offenders.map((o) => o.name)).toEqual(["@flow-state-dev/ui"]);
  });

  it("flags a name no workspace package has, which changeset version cannot find", () => {
    const offenders = unversionable({ ".changeset/typo.md": '---\n"@flow-state-dev/wrokforce": patch\n---\n\nNote.\n' });
    expect(offenders).toEqual([
      { path: ".changeset/typo.md", name: "@flow-state-dev/wrokforce", reason: "is not a workspace package" },
    ]);
  });

  // changeset version reads the frontmatter as YAML, so every way YAML can spell an entry must be
  // read: a quoted bump or a trailing comment must not let a private name through.
  it("reads a private name in every YAML shape: quoted bump, single quotes, a trailing comment", () => {
    const offenders = unversionable({
      ".changeset/a.md": '---\n"@flow-state-dev/ui": "patch"\n---\n\nNote.\n',
      ".changeset/b.md": "---\n'@flow-state-dev/ui': 'minor' # the registry\n---\n\nNote.\n",
      ".changeset/c.md": '---\n"@flow-state-dev/ui": patch   # trailing\n"@flow-state-dev/workforce": "patch"\n---\n\nNote.\n',
    });
    expect(offenders.map((o) => `${o.path} ${o.name}`)).toEqual([
      ".changeset/a.md @flow-state-dev/ui",
      ".changeset/b.md @flow-state-dev/ui",
      ".changeset/c.md @flow-state-dev/ui",
    ]);
  });

  // Each of these makes changeset version throw, so each must fail here, by the same parser.
  it("refuses a fragment changeset version can't parse: a flow mapping, no frontmatter, a bad delimiter, a duplicate key", () => {
    const offenders = unversionable({
      ".changeset/flow.md": '---\n{ "@flow-state-dev/ui": patch, }}\n---\n\nNote.\n',
      ".changeset/none.md": "No frontmatter at all.\n",
      ".changeset/dashes.md": '---\n"@flow-state-dev/workforce": patch\n----\n\nNote.\n',
      ".changeset/twice.md": '---\n"@flow-state-dev/workforce": patch\n"@flow-state-dev/workforce": minor\n---\n\nNote.\n',
    });
    expect(offenders).toEqual([
      unparsable(".changeset/flow.md"),
      unparsable(".changeset/none.md"),
      unparsable(".changeset/dashes.md"),
      unparsable(".changeset/twice.md"),
    ]);
  });

  it("passes published packages, comments, and an empty fragment", () => {
    const offenders = unversionable({
      ".changeset/ok.md": '---\n"@flow-state-dev/orchestration": patch\n# a comment line\n"@flow-state-dev/workforce": "minor" # comment\n---\n\nNote.\n',
      ".changeset/docs-only.md": "---\n---\n\nThe registry is private (FIX-1). Mentions \"@flow-state-dev/ui\": patch in prose.\n",
    });
    expect(offenders).toEqual([]);
  });
});
