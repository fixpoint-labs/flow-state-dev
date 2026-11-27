/**
 * A run's reply drafts reach the host's poster when its turn ends, on the
 * manager's own path, whatever harness wrote them: the brief names the run's
 * reply folder, the drafts there are handed to `replies` with the task,
 * and each one ends as a line in the session. A draft that is a link out of
 * `.fsdev/`, or too long, is refused with a line and never reaches the poster.
 */
import { afterAll, describe, expect, it } from "vitest";
import { existsSync, readdirSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { ALICE, CONVERSATIONS, claimHost, cleanUpHosts } from "./claim-host";
import { REPLY_MAX_BYTES, type ReviewReplyPoster } from "../src/replies";

afterAll(cleanUpHosts);

const LINK = "https://github.com/acme/app/pull/7#discussion_r101";

/** A poster that records what it was handed and posts every draft. */
function poster() {
  const calls: { user: string; drafts: { file: string; link: string; body: string }[]; scope: unknown }[] = [];
  const replies: ReviewReplyPoster = {
    async post(ctx, drafts, scope) {
      calls.push({ user: ctx.session.identity.userId ?? "", drafts: drafts.map((d) => ({ ...d })), scope });
      return drafts.map((d) => (d.link === LINK ? { file: d.file, link: d.link, posted: "https://github.com/reply/1" } : { file: d.file, link: d.link, refused: "not this task's pull request" }));
    },
  };
  return { calls, replies };
}

/** Every status line the host's requests wrote. */
async function statuses(host: ReturnType<typeof claimHost>): Promise<string[]> {
  const requests = (await (await (host.stores as any).resolve()).request.list({ withItems: true })) as Array<{ items?: Array<Record<string, any>> }>;
  return requests.flatMap((r) => r.items ?? []).filter((i) => i.type === "status").map((i) => String(i.message ?? i.content ?? ""));
}

describe("a run's replies when its turn ends", () => {
  it("are handed to the poster with the task, and each ends as a line in the session", async () => {
    const { calls, replies } = poster();
    let folder = "";
    const host = claimHost({
      mode: "claim",
      manager: { replies },
      script: [
        {
          replies: (dir) => {
            folder = dir;
            writeFileSync(join(dir, "a.md"), `${LINK}\nFixed in abc1234.\n`);
            writeFileSync(join(dir, "b.md"), "https://github.com/acme/app/pull/8#discussion_r301\nAlso this.\n");
          },
        },
      ],
    });
    await host.seed({ ledgerId: CONVERSATIONS, partition: "c1", id: "t1", goal: "address the review", input: {} });
    await host.runAttempt(CONVERSATIONS, "t1", "c1");
    expect(host.seen[0]!.prompt).toContain(`REPLIES: ${folder}`);
    expect(calls).toHaveLength(1);
    expect(calls[0]!.user).toBe(ALICE);
    expect(calls[0]!.drafts).toEqual([
      { file: "a.md", link: LINK, body: "Fixed in abc1234." },
      { file: "b.md", link: "https://github.com/acme/app/pull/8#discussion_r301", body: "Also this." },
    ]);
    expect(calls[0]!.scope).toMatchObject({ pullRequests: [], task: { metadata: expect.anything() } });
    const lines = await statuses(host);
    expect(lines).toContain(`Replied to ${LINK}: https://github.com/reply/1`);
    expect(lines.some((line) => line.includes("pull/8#discussion_r301 was not posted: not this task's pull request"))).toBe(true);
    // Taken: a replay of the step finds nothing to post twice.
    expect(readdirSync(folder)).toEqual([]);
  });

  it("refuses a symlinked or oversized draft with a line, and never hands it, or its target, to the poster", async () => {
    const { calls, replies } = poster();
    const host = claimHost({
      mode: "claim",
      manager: { replies },
      script: [
        {
          replies: (dir) => {
            const secret = join(dir, "..", "..", "..", "..", "hosts.yml");
            writeFileSync(secret, `${LINK}\ngho_SECRET\n`);
            symlinkSync(secret, join(dir, "token.md"));
            writeFileSync(join(dir, "big.md"), `${LINK}\n${"x".repeat(REPLY_MAX_BYTES)}`);
            writeFileSync(join(dir, "ok.md"), `${LINK}\nFine.\n`);
          },
        },
      ],
    });
    await host.seed({ ledgerId: CONVERSATIONS, partition: "c1", id: "t1", goal: "address the review", input: {} });
    await host.runAttempt(CONVERSATIONS, "t1", "c1");
    expect(calls.flatMap((c) => c.drafts.map((d) => d.file))).toEqual(["ok.md"]);
    expect(JSON.stringify(calls)).not.toContain("gho_SECRET");
    const lines = await statuses(host);
    expect(lines.some((l) => l.startsWith("Reply token.md was not posted") && /link/.test(l))).toBe(true);
    expect(lines.some((l) => l.startsWith("Reply big.md was not posted") && /longer than/.test(l))).toBe(true);
    expect(lines.join("\n")).not.toContain("gho_SECRET");
  });

  it("names no folder and reads nothing when the host hands no poster", async () => {
    const host = claimHost({ mode: "claim", script: [{}] });
    await host.seed({ ledgerId: CONVERSATIONS, partition: "c1", id: "t1", goal: "anything", input: {} });
    await host.runAttempt(CONVERSATIONS, "t1", "c1");
    expect(host.seen[0]!.prompt).not.toContain("REPLIES:");
    expect(existsSync(join(host.seen[0]!.cwd, ".fsdev", "replies"))).toBe(false);
  });
});
