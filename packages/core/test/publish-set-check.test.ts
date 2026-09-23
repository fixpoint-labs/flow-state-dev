import { describe, expect, it } from "vitest";
// @ts-expect-error — root check script, plain .mjs with no type declarations.
import {
  findPublishable,
  neverPublish,
} from "../../../scripts/validate-publish-set.mjs";

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
