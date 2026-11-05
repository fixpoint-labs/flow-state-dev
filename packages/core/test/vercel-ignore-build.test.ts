import { spawnSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const SCRIPT = join(__dirname, "../../../apps/docs/scripts/vercel-ignore-build.sh");
const SKIP = 0;
const BUILD = 1;

/**
 * Production docs go live with the packages they describe. The only unreleased
 * prose main can hold is a merged release docs pass whose changesets haven't
 * published yet, so that is the one state production skips.
 */
describe("the docs production deploy", () => {
  let repo = "";
  afterEach(() => rmSync(repo, { recursive: true, force: true }));

  function layout({ manifest, pending }: { manifest?: string[]; pending: string[] }) {
    repo = mkdtempSync(join(tmpdir(), "vercel-ignore-"));
    mkdirSync(join(repo, "apps/docs/scripts"), { recursive: true });
    mkdirSync(join(repo, ".changeset"));
    copyFileSync(SCRIPT, join(repo, "apps/docs/scripts/vercel-ignore-build.sh"));
    if (manifest) {
      writeFileSync(join(repo, "apps/docs/release-docs.json"), JSON.stringify({ changesets: manifest }));
    }
    for (const id of pending) writeFileSync(join(repo, `.changeset/${id}.md`), "---\n---\n");
  }

  function run(env: string) {
    const result = spawnSync("bash", ["scripts/vercel-ignore-build.sh"], {
      cwd: join(repo, "apps/docs"),
      env: { ...process.env, VERCEL_ENV: env },
    });
    return result.status;
  }

  it("always builds previews", () => {
    layout({ manifest: ["postgres-bus"], pending: ["postgres-bus"] });
    expect(run("preview")).toBe(BUILD);
  });

  it("skips while a docs pass waits for its changesets to publish", () => {
    layout({ manifest: ["postgres-bus"], pending: ["postgres-bus", "late-arrival"] });
    expect(run("production")).toBe(SKIP);
  });

  it("builds once Version Packages has consumed those changesets", () => {
    layout({ manifest: ["postgres-bus"], pending: ["late-arrival"] });
    expect(run("production")).toBe(BUILD);
  });

  it("builds site fixes and docs fixes when nothing is staged", () => {
    layout({ pending: ["late-arrival"] });
    expect(run("production")).toBe(BUILD);
  });
});
