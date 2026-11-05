import { describe, expect, it } from "vitest";
// @ts-expect-error — root check script, plain .mjs with no type declarations.
import { findBlocked as findBlockedUntyped } from "../../../scripts/validate-user-docs-scope.mjs";

type Context = { branch?: string; labels?: string[] };
const findBlocked = findBlockedUntyped as (files: string[], ctx?: Context) => string[];

const USER_DOCS = [
  "apps/docs/docs/state/overview.md",
  "apps/docs/guides/first-flow.mdx",
  "apps/docs/blog/2026-11-01-launch.md",
  "apps/docs/sidebars.ts",
  "apps/docs/sidebarsGuides.ts",
  "apps/docs/release-docs.json",
  "packages/core/README.md",
];

const NOT_USER_DOCS = [
  "apps/docs/src/components/Hero.tsx",
  "apps/docs/docusaurus.config.ts",
  "apps/docs/scripts/lint-brand.mjs",
  "packages/core/src/index.ts",
  "packages/core/docs/README.md",
  "docs/architecture/streaming.md",
  "docs/contributing/user-docs.md",
  "README.md",
  "labs/knowledge-hub/README.md",
];

describe("a normal PR", () => {
  it("is blocked on every user-doc path", () => {
    expect(findBlocked(USER_DOCS, { branch: "fix-123-thing" })).toEqual(USER_DOCS);
  });

  it("passes on internal docs, site code and source", () => {
    expect(findBlocked(NOT_USER_DOCS, { branch: "fix-123-thing" })).toEqual([]);
  });

  it("reports only the user-doc files in a mixed diff", () => {
    const files = ["packages/core/src/index.ts", "packages/core/README.md"];
    expect(findBlocked(files, { branch: "fix-123-thing" })).toEqual(["packages/core/README.md"]);
  });
});

describe("exemptions", () => {
  it("lets the release docs branch through", () => {
    expect(findBlocked(USER_DOCS, { branch: "release-docs/2026-11-05" })).toEqual([]);
  });

  it("lets a docs-fix PR through", () => {
    expect(findBlocked(USER_DOCS, { branch: "fix-typo", labels: ["docs-fix"] })).toEqual([]);
  });

  it("does not exempt a branch that only mentions release-docs", () => {
    expect(findBlocked(USER_DOCS, { branch: "feat/release-docs-skill" })).toEqual(USER_DOCS);
  });
});
