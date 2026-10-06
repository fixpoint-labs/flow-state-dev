/**
 * A publish without the build fails before anything is packed (BR-25): the
 * `prepublishOnly` guard refuses a copy of the package that lacks the built
 * pages or the command, and passes one that has them.
 */
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const guard = fileURLToPath(new URL("../scripts/check-pages.mjs", import.meta.url));

/** A package copy holding `files`. */
function copyWith(files: string[]): string {
  const root = mkdtempSync(join(tmpdir(), "sm-publish-guard-"));
  for (const file of files) {
    mkdirSync(dirname(join(root, file)), { recursive: true });
    writeFileSync(join(root, file), "");
  }
  return root;
}

const check = (root: string) => spawnSync(process.execPath, [guard, "--root", root], { encoding: "utf8" });
const BUILT = ["dist-client/index.html", "dist/bin.js", "dist/index.js"];

describe("the publish guard", () => {
  it("passes a package holding its pages and its command", () => {
    expect(check(copyWith(BUILT)).status).toBe(0);
  });

  it("refuses one without its built pages, naming what is missing", () => {
    const result = check(copyWith(BUILT.filter((f) => f !== "dist-client/index.html")));
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("missing: dist-client/index.html");
  });

  it("refuses one without the command", () => {
    const result = check(copyWith(["dist-client/index.html"]));
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("dist/bin.js, dist/index.js");
  });
});
