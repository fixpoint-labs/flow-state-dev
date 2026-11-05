import { describe, expect, it } from "vitest";
import {
  changesetId as changesetIdUntyped,
  findUndocumented as findUndocumentedUntyped,
  isEmptyChangeset as isEmptyChangesetUntyped,
  // @ts-expect-error — root check script, plain .mjs with no type declarations.
} from "../../../scripts/validate-release-docs.mjs";

type Manifest = { changesets?: string[] } | null;
const changesetId = changesetIdUntyped as (path: string) => string | null;
const isEmptyChangeset = isEmptyChangesetUntyped as (source: string) => boolean;
const findUndocumented = findUndocumentedUntyped as (ids: string[], m: Manifest) => string[];

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
});
