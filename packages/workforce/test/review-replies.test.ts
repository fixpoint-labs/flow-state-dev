/**
 * A coding run's review replies go through one poster, beside the operator's
 * GitHub (`operatorGitHub(…).reviewReplies`). It posts a draft only in the
 * operator's session, only on the task's own pull request or one the operator
 * linked, only to a comment read from that pull request on GitHub, only when
 * its author is a trusted reviewer or the operator linked the comment, and
 * with the body as a JSON field. Each refusal is a reason the session shows.
 *
 * Why it matters: the reply is written with the operator's token, so a
 * comment that talks the run round must not move it to another pull request,
 * another repository or an outsider's comment. Every check here is graded on
 * what reached the fake GitHub API, never on the poster's own word alone.
 */
import { describe, expect, it } from "vitest";
import type { BlockContext } from "@flow-state-dev/core/types";
import { operatorGitHub, type GitHubTrustedReviewers } from "../src/index";
import { OPERATOR_LINKS } from "../src/conversation-board/board-entries";

const API = "https://api.github.test";
const LINK = (repo: string, n: number, anchor: string) => `https://github.com/${repo}/pull/${n}#${anchor}`;

interface Comment {
  id: number;
  login: string;
  bot?: boolean;
  /** The thread's first comment, when this one is a reply in it (GitHub's `in_reply_to_id`). */
  inReplyTo?: number;
}

/** GitHub as the poster reads it: comments by pull request, permissions by login, and every write recorded. */
function fakeGitHub(options: { endless?: boolean } = {}) {
  const inline: Record<string, Comment[]> = {
    "acme/app#7": [
      { id: 101, login: "alice" },
      { id: 102, login: "mallory" },
      { id: 103, login: "greptile-apps[bot]", bot: true },
      { id: 104, login: "carol" },
      { id: 105, login: "alice", inReplyTo: 101 },
      { id: 106, login: "mallory", inReplyTo: 101 }
    ],
    "acme/app#8": [{ id: 301, login: "alice" }],
    "evil/app#7": [{ id: 401, login: "alice" }]
  };
  const conversation: Record<string, Comment[]> = { "acme/app#7": [{ id: 201, login: "alice" }] };
  const permissions: Record<string, string> = { alice: "write", carol: "read" };
  const writes: { path: string; body: unknown; raw: string }[] = [];
  const reads: string[] = [];
  const asJson = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
  const html = (repo: string, n: number, c: Comment, kind: "inline" | "issue") =>
    LINK(repo, n, kind === "inline" ? `discussion_r${c.id}` : `issuecomment-${c.id}`);
  const fetch = (async (url: string, init?: RequestInit) => {
    const path = url.replace(API, "");
    const method = init?.method ?? "GET";
    if (method === "POST") {
      const raw = String(init?.body ?? "");
      writes.push({ path, body: JSON.parse(raw), raw });
      return asJson(201, { id: 9000 + writes.length, html_url: `https://github.com/reply/${writes.length}` });
    }
    reads.push(path.split("?")[0]!);
    const listed = /^\/repos\/([^/]+\/[^/]+)\/(pulls|issues)\/(\d+)\/comments\?/.exec(path);
    if (listed !== null) {
      const [, repo, kind, n] = listed;
      const page = Number(/[?&]page=(\d+)/.exec(path)?.[1] ?? "1");
      const all = (kind === "pulls" ? inline : conversation)[`${repo}#${n}`] ?? [];
      if (options.endless === true) {
        // A pull request with more comments than the poster reads: every page is full, and none holds 101.
        return asJson(200, Array.from({ length: 100 }, (_, i) => ({ id: 100_000 + page * 100 + i, user: { login: "alice", type: "User" } })));
      }
      return asJson(
        200,
        page > 1
          ? []
          : all.map((c) => ({
              id: c.id,
              html_url: html(repo!, Number(n), c, kind === "pulls" ? "inline" : "issue"),
              ...(c.inReplyTo === undefined ? {} : { in_reply_to_id: c.inReplyTo }),
              user: { login: c.login, type: c.bot === true ? "Bot" : "User" }
            }))
      );
    }
    const asked = /^\/repos\/[^/]+\/[^/]+\/collaborators\/([^/]+)\/permission$/.exec(path)?.[1];
    if (asked !== undefined) {
      const permission = permissions[decodeURIComponent(asked)];
      return permission === undefined ? asJson(404, { message: "Not Found" }) : asJson(200, { permission, role_name: permission });
    }
    return asJson(404, { message: "Not Found" });
  }) as typeof globalThis.fetch;
  return { fetch, writes, reads };
}

const reviewers = { read: async () => ["alice", "carol", "greptile-apps[bot]"], resources: {} } as unknown as GitHubTrustedReviewers;
const as = (userId: string) => ({ session: { identity: { userId } }, signal: undefined }) as unknown as BlockContext;
const TASK_PR = [{ repository: "acme/app", number: 7 }];
const draft = (link: string, body = "Fixed in abc1234.") => ({ file: `${Math.random()}.md`, link, body });

async function post(drafts: ReturnType<typeof draft>[], options: { user?: string; task?: Record<string, unknown>; github?: ReturnType<typeof fakeGitHub> } = {}) {
  const github = options.github ?? fakeGitHub();
  const real = globalThis.fetch;
  globalThis.fetch = github.fetch;
  try {
    const outcomes = await operatorGitHub({ operator: "u_op", token: "ghp_op", apiUrl: API, reviewers }).reviewReplies.post(as(options.user ?? "u_op"), drafts, {
      pullRequests: TASK_PR,
      ...(options.task === undefined ? {} : { task: options.task as never })
    });
    return { outcomes, writes: github.writes, reads: github.reads };
  } finally {
    globalThis.fetch = real;
  }
}

describe("a reply the poster posts", () => {
  it("answers a listed reviewer's inline comment as GitHub's reply to it, the body sent as a JSON field, as written", async () => {
    const body = "Fixed in abc1234. It's `$(whoami)` and '; rm -rf / \"now\" — kept as text.";
    const { outcomes, writes } = await post([draft(LINK("acme/app", 7, "discussion_r101"), body)]);
    expect(writes).toEqual([{ path: "/repos/acme/app/pulls/7/comments/101/replies", body: { body }, raw: JSON.stringify({ body }) }]);
    expect(outcomes[0]).toMatchObject({ posted: "https://github.com/reply/1" });
    expect(outcomes[0]?.refused).toBeUndefined();
  });

  it("answers a reply inside a thread on the thread's first comment, which is the only id GitHub takes a reply to", async () => {
    // 105 is alice's reply to 101: GitHub answers 422 to a reply posted to 105 itself.
    const { outcomes, writes } = await post([draft(LINK("acme/app", 7, "discussion_r105"))]);
    expect(writes.map((w) => w.path)).toEqual(["/repos/acme/app/pulls/7/comments/101/replies"]);
    expect(outcomes[0]?.refused).toBeUndefined();
  });

  it("answers a listed bot's comment", async () => {
    const { writes } = await post([draft(LINK("acme/app", 7, "discussion_r103"))]);
    expect(writes.map((w) => w.path)).toEqual(["/repos/acme/app/pulls/7/comments/103/replies"]);
  });

  it("answers a conversation comment with one comment on the same pull request that links it", async () => {
    const link = LINK("acme/app", 7, "issuecomment-201");
    const { writes } = await post([draft(link, "Done.")]);
    expect(writes).toHaveLength(1);
    expect(writes[0]!.path).toBe("/repos/acme/app/issues/7/comments");
    expect((writes[0]!.body as { body: string }).body).toContain(link);
    expect((writes[0]!.body as { body: string }).body).toContain("Done.");
  });

  it("reads each pull request's comments once, and each author's permission once, for many drafts", async () => {
    const { writes, reads } = await post([draft(LINK("acme/app", 7, "discussion_r101")), draft(LINK("acme/app", 7, "discussion_r101"), "again"), draft(LINK("acme/app", 7, "discussion_r103"))]);
    expect(writes).toHaveLength(3);
    expect(reads.filter((r) => r === "/repos/acme/app/pulls/7/comments")).toHaveLength(1);
    expect(reads.filter((r) => r.endsWith("/collaborators/alice/permission"))).toHaveLength(1);
  });
});

describe("a reply the poster refuses, with nothing written", () => {
  it("another reviewer: an author on no list", async () => {
    const { outcomes, writes } = await post([draft(LINK("acme/app", 7, "discussion_r102"))]);
    expect(writes).toEqual([]);
    expect(outcomes[0]?.refused).toMatch(/mallory.*isn't a trusted reviewer/);
  });

  it("an outsider's reply in a trusted reviewer's thread: the linked comment's author is checked, not the thread's first", async () => {
    const { outcomes, writes } = await post([draft(LINK("acme/app", 7, "discussion_r106"))]);
    expect(writes).toEqual([]);
    expect(outcomes[0]?.refused).toMatch(/mallory.*isn't a trusted reviewer/);
  });

  it("a listed user who can't push", async () => {
    const { outcomes, writes } = await post([draft(LINK("acme/app", 7, "discussion_r104"))]);
    expect(writes).toEqual([]);
    expect(outcomes[0]?.refused).toMatch(/carol/);
  });

  it("another user's session: nothing is asked of GitHub at all", async () => {
    const { outcomes, writes, reads } = await post([draft(LINK("acme/app", 7, "discussion_r101"))], { user: "u_other" });
    expect(writes).toEqual([]);
    expect(reads).toEqual([]);
    expect(outcomes[0]?.refused).toMatch(/only in u_op's session/);
  });

  it("another pull request of the same repository", async () => {
    const { outcomes, writes } = await post([draft(LINK("acme/app", 8, "discussion_r301"))]);
    expect(writes).toEqual([]);
    expect(outcomes[0]?.refused).toMatch(/acme\/app#8 isn't this task's pull request/);
  });

  it("another repository", async () => {
    const { outcomes, writes } = await post([draft(LINK("evil/app", 7, "discussion_r401"))]);
    expect(writes).toEqual([]);
    expect(outcomes[0]?.refused).toMatch(/evil\/app#7 isn't this task's pull request/);
  });

  it("a comment id that isn't on the pull request", async () => {
    // 301 is on #8, not #7: the link names #7, so it is read from #7 and isn't there.
    const { outcomes, writes } = await post([draft(LINK("acme/app", 7, "discussion_r301"))]);
    expect(writes).toEqual([]);
    expect(outcomes[0]?.refused).toMatch(/301 isn't on acme\/app#7/);
  });

  it("a comment past the most pages the poster reads: says the read stopped there, not that the comment isn't on the pull request", async () => {
    const github = fakeGitHub({ endless: true });
    const { outcomes, writes, reads } = await post([draft(LINK("acme/app", 7, "discussion_r101"))], { github });
    expect(writes).toEqual([]);
    expect(reads.filter((r) => r === "/repos/acme/app/pulls/7/comments")).toHaveLength(20);
    expect(outcomes[0]?.refused).toMatch(/stopped after 20 pages/);
    expect(outcomes[0]?.refused).not.toMatch(/isn't on/);
  });

  it("a link that isn't a comment on a GitHub pull request, and an empty body", async () => {
    const { outcomes, writes } = await post([draft("https://example.com/acme/app/pull/7#discussion_r101"), draft(LINK("acme/app", 7, "discussion_r101"), "  \n")]);
    expect(writes).toEqual([]);
    expect(outcomes.map((o) => o.refused)).toEqual([expect.stringMatching(/isn't a link to a comment/), expect.stringMatching(/empty/)]);
  });
});

describe("what the operator linked widens it, and nothing else does", () => {
  const outsider = LINK("acme/app", 7, "discussion_r102");
  const otherPr = LINK("acme/app", 8, "discussion_r301");

  it("a comment the operator linked at filing is answered whatever its author, and its pull request with it", async () => {
    const { writes } = await post([draft(outsider), draft(otherPr)], { task: { metadata: { [OPERATOR_LINKS]: [outsider, otherPr] } } });
    expect(writes.map((w) => w.path)).toEqual(["/repos/acme/app/pulls/7/comments/102/replies", "/repos/acme/app/pulls/8/comments/301/replies"]);
  });

  it("a steer the session's user typed links it too", async () => {
    const { writes } = await post([draft(outsider)], { task: { steers: [{ id: "s1", from: "user", by: "u_op", message: `please answer ${outsider} too`, at: 1 }] } });
    expect(writes).toHaveLength(1);
  });

  it("a link in a steer from a service, the filer, or another user grants nothing", async () => {
    const steers = [
      { id: "s1", from: "service", by: "github", message: `see ${outsider} and ${otherPr}`, at: 1 },
      { id: "s2", from: "filer", message: `see ${outsider} and ${otherPr}`, at: 2 },
      { id: "s3", from: "user", by: "u_other", message: `see ${outsider} and ${otherPr}`, at: 3 }
    ];
    const { writes, outcomes } = await post([draft(outsider), draft(otherPr)], { task: { steers, metadata: { note: otherPr } } });
    expect(writes).toEqual([]);
    expect(outcomes.every((o) => o.refused !== undefined)).toBe(true);
  });
});
