/**
 * A coding run's reply drafts at their own seam: the folder a run writes them
 * to, and how the manager reads them back. The run writes that folder, and a
 * comment can talk a run into anything it can write, so a draft is read the
 * way a spec is: a regular file whose real path stays under the checkout's
 * `.fsdev/`, up to a byte cap. A link out (say, to the run's `gh` login) is
 * refused and its target never read.
 */
import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, sep } from "node:path";
import { REPLY_DIR, REPLY_MAX_BYTES, readReplyDrafts, replyFolderPath } from "../src/replies";

const dirs: string[] = [];
const scratch = () => {
  const dir = mkdtempSync(join(tmpdir(), "harness-replies-"));
  dirs.push(dir);
  return dir;
};
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

const LINK = "https://github.com/acme/app/pull/7#discussion_r101";

describe("the reply folder", () => {
  it("is inside the checkout's .fsdev/, per attempt and per run", () => {
    const checkout = join(sep, "runs", "checkout");
    expect(replyFolderPath(checkout, 2, 3)).toBe(join(checkout, REPLY_DIR, "2-3"));
    expect(REPLY_DIR.startsWith(".fsdev")).toBe(true);
    expect(replyFolderPath(checkout, 1, 1)).not.toBe(replyFolderPath(checkout, 1, 2));
  });
});

describe("reading the drafts", () => {
  it("reads each .md file: the link on its first line, the body after it, as written", async () => {
    const checkout = scratch();
    const folder = replyFolderPath(checkout, 1, 1);
    mkdirSync(folder, { recursive: true });
    writeFileSync(join(folder, "a.md"), `${LINK}\nFixed in abc1234.\n\nIt's \`$(whoami)\`, as text.\n`);
    const read = await readReplyDrafts(checkout, 1, 1);
    expect(read.refused).toEqual([]);
    expect(read.drafts).toEqual([{ file: "a.md", link: LINK, body: "Fixed in abc1234.\n\nIt's `$(whoami)`, as text." }]);
  });

  it("reads nothing for a run that wrote none, or another run's folder", async () => {
    const checkout = scratch();
    mkdirSync(replyFolderPath(checkout, 1, 1), { recursive: true });
    writeFileSync(join(replyFolderPath(checkout, 1, 1), "a.md"), `${LINK}\nold`);
    expect(await readReplyDrafts(checkout, 1, 2)).toEqual({ drafts: [], refused: [] });
  });

  it("refuses a symlinked reply file that leads out of .fsdev/, and never reads its target", async () => {
    const checkout = scratch();
    const outside = join(scratch(), "hosts.yml");
    writeFileSync(outside, "github.com:\n  oauth_token: gho_SECRET\n");
    const folder = replyFolderPath(checkout, 1, 1);
    mkdirSync(folder, { recursive: true });
    symlinkSync(outside, join(folder, "token.md"));
    const read = await readReplyDrafts(checkout, 1, 1);
    expect(read.drafts).toEqual([]);
    expect(read.refused).toEqual([{ file: "token.md", reason: expect.stringMatching(/link/) }]);
    expect(JSON.stringify(read)).not.toContain("gho_SECRET");
  });

  it("refuses a run folder that is itself a link out of .fsdev/", async () => {
    const checkout = scratch();
    const elsewhere = scratch();
    writeFileSync(join(elsewhere, "a.md"), `${LINK}\ngho_SECRET`);
    mkdirSync(join(checkout, REPLY_DIR), { recursive: true });
    symlinkSync(elsewhere, replyFolderPath(checkout, 1, 1));
    const read = await readReplyDrafts(checkout, 1, 1);
    expect(read.drafts).toEqual([]);
    expect(read.refused.length).toBeGreaterThan(0);
    expect(JSON.stringify(read)).not.toContain("gho_SECRET");
  });

  it("refuses an oversized reply file whole, rather than post part of it", async () => {
    const checkout = scratch();
    const folder = replyFolderPath(checkout, 1, 1);
    mkdirSync(folder, { recursive: true });
    writeFileSync(join(folder, "big.md"), `${LINK}\n${"x".repeat(REPLY_MAX_BYTES)}`);
    const read = await readReplyDrafts(checkout, 1, 1);
    expect(read.drafts).toEqual([]);
    expect(read.refused).toEqual([{ file: "big.md", reason: expect.stringMatching(/longer than/) }]);
  });
});
