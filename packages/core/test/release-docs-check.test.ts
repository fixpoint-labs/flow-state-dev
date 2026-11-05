import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  changesetId as changesetIdUntyped,
  consumedChangesets as consumedChangesetsUntyped,
  findUndocumented as findUndocumentedUntyped,
  isEmptyChangeset as isEmptyChangesetUntyped,
  // @ts-expect-error — root check script, plain .mjs with no type declarations.
} from "../../../scripts/validate-release-docs.mjs";

type Manifest = { changesets?: string[] } | null;
const changesetId = changesetIdUntyped as (path: string) => string | null;
const isEmptyChangeset = isEmptyChangesetUntyped as (source: string) => boolean;
const findUndocumented = findUndocumentedUntyped as (ids: string[], m: Manifest) => string[];
const consumedChangesets = consumedChangesetsUntyped as (base: string, cwd: string) => string[];

/**
 * The gate exists so a release can't publish packages whose docs were never
 * written. The failure that matters is a changeset landing after the docs pass:
 * it must turn the gate red, not slip through on an older manifest.
 */
describe("the release gate", () => {
  it("passes when the docs pass reviewed every consumed changeset", () => {
    expect(findUndocumented(["postgres-bus", "board-notices"], { changesets: ["board-notices", "postgres-bus"] })).toEqual([]);
  });

  it("fails on a changeset that landed after the docs pass", () => {
    expect(findUndocumented(["postgres-bus", "late-arrival"], { changesets: ["postgres-bus"] })).toEqual(["late-arrival"]);
  });

  it("fails every changeset when no docs pass has run", () => {
    expect(findUndocumented(["postgres-bus"], null)).toEqual(["postgres-bus"]);
  });

  it("passes a release with no changesets", () => {
    expect(findUndocumented([], null)).toEqual([]);
  });
});

describe("which files count", () => {
  it("reads a fragment's id from its path", () => {
    expect(changesetId(".changeset/postgres-bus.md")).toBe("postgres-bus");
  });

  it("ignores the README and anything that isn't a fragment", () => {
    expect(changesetId(".changeset/README.md")).toBeNull();
    expect(changesetId(".changeset/config.json")).toBeNull();
    expect(changesetId("packages/core/CHANGELOG.md")).toBeNull();
  });

  it("skips empty changesets, which release nothing", () => {
    expect(isEmptyChangeset("---\n---\n")).toBe(true);
    expect(isEmptyChangeset('---\n"@flow-state-dev/core": patch\n---\n\nA fix (FIX-1).\n')).toBe(false);
  });

  it("counts a bump however the YAML is written", () => {
    expect(isEmptyChangeset('---\r\n"@flow-state-dev/core": patch\r\n---\r\n\r\nA fix.\r\n')).toBe(false);
    expect(isEmptyChangeset('---\n"@flow-state-dev/core": "minor"\n---\n')).toBe(false);
    expect(isEmptyChangeset("---\n'@flow-state-dev/core': 'major'\n---\n")).toBe(false);
  });
});

/**
 * The gate depends on reading the fragments the Version Packages PR deletes,
 * which only exist at the base. Run it against a real repository.
 */
describe("reading what a release consumes", () => {
  function git(cwd: string, ...args: string[]) {
    execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", ...args], { cwd, stdio: "pipe" });
  }

  it("lists deleted non-empty fragments, read at the base", () => {
    const repo = mkdtempSync(join(tmpdir(), "release-docs-"));
    try {
      git(repo, "init", "-q", "-b", "main");
      mkdirSync(join(repo, ".changeset"));
      const bump = '---\n"@flow-state-dev/core": patch\n---\n\nAdds the postgres bus so sessions survive restarts.\n';
      writeFileSync(join(repo, ".changeset/postgres-bus.md"), bump);
      writeFileSync(join(repo, ".changeset/empty-one.md"), "---\n---\n");
      writeFileSync(join(repo, ".changeset/README.md"), "# Changesets\n");
      git(repo, "add", ".");
      git(repo, "commit", "-q", "-m", "base");

      git(repo, "switch", "-q", "-c", "changeset-release/main");
      git(repo, "rm", "-q", ".changeset/postgres-bus.md", ".changeset/empty-one.md");
      // Same text in a new file, as a changelog entry would be: must not hide the delete as a rename.
      writeFileSync(join(repo, "CHANGELOG.md"), bump);
      git(repo, "add", ".");
      git(repo, "commit", "-q", "-m", "Version Packages");

      expect(consumedChangesets("main", repo)).toEqual(["postgres-bus"]);
    } finally {
      rmSync(repo, { recursive: true, force: true });
    }
  });
});
