import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
// @ts-expect-error — docs site script, plain .mjs with no type declarations.
import { decide as decideUntyped } from "../../../apps/docs/scripts/docs-deploy-gate.mjs";

type Fetch = (url: string) => Promise<{ ok: boolean }>;
type Decision = { build: boolean; reason: string };
const decide = decideUntyped as (opts: {
  env: Record<string, string>;
  root: string;
  fetchImpl: Fetch;
}) => Promise<Decision>;

/**
 * Production docs go live with the packages they describe. Two states put docs
 * for uninstallable versions on main: a docs pass waiting for Version Packages,
 * and bumped versions that haven't reached npm. Production skips both.
 */
describe("the docs production deploy", () => {
  let root = "";
  afterEach(() => rmSync(root, { recursive: true, force: true }));

  function repo({ manifest, pending = [] }: { manifest?: string[]; pending?: string[] }) {
    root = mkdtempSync(join(tmpdir(), "docs-deploy-gate-"));
    mkdirSync(join(root, "apps/docs"), { recursive: true });
    mkdirSync(join(root, ".changeset"));
    for (const [dir, pkg] of [
      ["core", { name: "@flow-state-dev/core", version: "0.5.0" }],
      ["ui", { name: "@flow-state-dev/ui", version: "9.9.9", private: true }],
    ] as const) {
      mkdirSync(join(root, "packages", dir), { recursive: true });
      writeFileSync(join(root, "packages", dir, "package.json"), JSON.stringify(pkg));
    }
    if (manifest) writeFileSync(join(root, "apps/docs/release-docs.json"), JSON.stringify({ changesets: manifest }));
    for (const id of pending) writeFileSync(join(root, ".changeset", `${id}.md`), "---\n---\n");
  }

  const published: Fetch = async () => ({ ok: true });
  const notYet: Fetch = async (url) => ({ ok: !url.includes("core") });
  const offline: Fetch = async () => {
    throw new Error("ENOTFOUND registry.npmjs.org");
  };
  const production = { VERCEL_ENV: "production" };

  it("always builds previews", async () => {
    repo({ manifest: ["postgres-bus"], pending: ["postgres-bus"] });
    expect((await decide({ env: { VERCEL_ENV: "preview" }, root, fetchImpl: notYet })).build).toBe(true);
  });

  it("skips while a docs pass waits for Version Packages", async () => {
    repo({ manifest: ["postgres-bus"], pending: ["postgres-bus", "late-arrival"] });
    const decision = await decide({ env: production, root, fetchImpl: published });
    expect(decision.build).toBe(false);
    expect(decision.reason).toContain("postgres-bus");
  });

  it("skips after Version Packages merges until npm has the new versions", async () => {
    repo({ manifest: ["postgres-bus"] });
    const decision = await decide({ env: production, root, fetchImpl: notYet });
    expect(decision.build).toBe(false);
    expect(decision.reason).toContain("@flow-state-dev/core@0.5.0");
  });

  it("builds once the release is on npm", async () => {
    repo({ manifest: ["postgres-bus"], pending: ["late-arrival"] });
    expect((await decide({ env: production, root, fetchImpl: published })).build).toBe(true);
  });

  it("ignores private packages", async () => {
    repo({});
    const onlyPublic: Fetch = async (url) => ({ ok: !url.includes("/ui") });
    expect((await decide({ env: production, root, fetchImpl: onlyPublic })).build).toBe(true);
  });

  it("skips when npm can't be reached", async () => {
    repo({});
    expect((await decide({ env: production, root, fetchImpl: offline })).build).toBe(false);
  });
});
