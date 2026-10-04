/**
 * The start script rebuilds a page build that is older than its source,
 * because a stale build reads keys the Lab no longer publishes and shows
 * empty screens as if the Lab had no data. What tells it so: the record a
 * build writes of the source files it was made from, checked against those
 * files now. Built here with real Vite over a two-file app, so the record is
 * the one a build actually writes.
 */
import { mkdirSync, mkdtempSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { build } from "vite";
import { afterEach, describe, expect, it } from "vitest";
import { BUILD_INPUTS_FILE, recordBuildInputs, staleBuildInputs } from "../../../scripts/build-inputs.mjs";

let repo: string;
afterEach(() => rmSync(repo, { recursive: true, force: true }));

/** A two-file app in a fresh "repository", built into `app/dist`. */
async function builtApp(): Promise<{ dist: string; keys: string }> {
  repo = mkdtempSync(join(tmpdir(), "build-inputs-"));
  const app = join(repo, "app");
  mkdirSync(join(app, "src"), { recursive: true });
  // The key lives in a second module, as the inventory pattern lives in reads.ts.
  const keys = join(app, "src/keys.ts");
  writeFileSync(keys, 'export const MAILBOXES = "inventory/mailboxes/*";\n');
  writeFileSync(join(app, "src/main.ts"), 'import { MAILBOXES } from "./keys";\ndocument.title = MAILBOXES;\n');
  writeFileSync(join(app, "index.html"), '<!doctype html><script type="module" src="/src/main.ts"></script>\n');
  const dist = join(app, "dist");
  await build({ root: app, logLevel: "silent", configFile: false, plugins: [recordBuildInputs({ repoRoot: repo })] });
  return { dist, keys };
}

describe("a page build's record of its source", () => {
  it("vouches for a build whose source hasn't changed", async () => {
    const { dist } = await builtApp();
    expect(staleBuildInputs(dist, repo)).toBeUndefined();
  });

  it("names an imported source file that changed since the build, the way a rename leaves the old key in the bundle", async () => {
    const { dist, keys } = await builtApp();
    writeFileSync(keys, 'export const MAILBOXES = "inventory/renamed/*";\n');
    expect(staleBuildInputs(dist, repo)).toBe("app/src/keys.ts changed since it was built");
  });

  it("names a source file that is gone, and ignores one rewritten with the same contents", async () => {
    const { dist, keys } = await builtApp();
    writeFileSync(keys, 'export const MAILBOXES = "inventory/mailboxes/*";\n');
    expect(staleBuildInputs(dist, repo)).toBeUndefined();
    unlinkSync(keys);
    expect(staleBuildInputs(dist, repo)).toBe("app/src/keys.ts is gone since it was built");
  });

  it("counts a build with no record as stale, since nothing says what it was built from", async () => {
    const { dist } = await builtApp();
    unlinkSync(join(dist, BUILD_INPUTS_FILE));
    expect(staleBuildInputs(dist, repo)).toMatch(/no build-inputs\.json/);
  });
});
