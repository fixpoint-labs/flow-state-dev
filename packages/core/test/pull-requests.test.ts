/**
 * The session's pull-request record: what counts as opened, and the one writer.
 *
 * What a reader of the record relies on: every source's create call lands
 * (Codex, Claude Code, Cursor, the generator's bash tool, a create-PR tool), a
 * pull request the session only looked at never does, and one pull request is
 * one row however often, and however spelled, its link appears.
 *
 * The Cursor items are a real Cursor turn (`fixtures/pull-requests/`); the
 * others are built in the shape each adapter's emitter writes.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { RuntimeItem } from "../src/items/internal";
import {
  findOpenedPullRequests,
  githubPullRequestRule,
  observedPullRequestStateSchema,
  pullRequestKey,
  pullRequestRefFromUrl,
  writePullRequests,
  type PullRequestRef,
} from "../src/types/pull-requests";

const cursor = JSON.parse(
  readFileSync(new URL("./fixtures/pull-requests/cursor-shell.json", import.meta.url), "utf8"),
) as { items: RuntimeItem[] };
const [cursorCreate, cursorView, cursorAlreadyExists] = cursor.items as [RuntimeItem, RuntimeItem, RuntimeItem];

/** A settled `tool_output` item in the shape the adapters emit. */
function toolItem(name: string, args: unknown, output: unknown, id = `item_${name}`): RuntimeItem {
  return {
    id,
    type: "tool_output",
    status: "completed",
    blockName: name,
    output,
    toolCall: { callId: `call_${id}`, name, arguments: typeof args === "string" ? args : JSON.stringify(args) },
  } as unknown as RuntimeItem;
}

const GH_OUT = "https://github.com/acme/app/pull/88\n";
const refsOf = (item: RuntimeItem) => findOpenedPullRequests(item).map((r) => `${r.owner}/${r.name}#${r.number}`);

describe("findOpenedPullRequests — a create call whose result names it", () => {
  it("reads a real Cursor shell `gh pr create`, with its title and branch", () => {
    expect(findOpenedPullRequests(cursorCreate)).toEqual([
      {
        host: "github.com",
        owner: "Acme-Org",
        name: "My.App",
        number: 88,
        url: "https://github.com/Acme-Org/My.App/pull/88",
        title: "Add notes export",
        branch: "notes-export",
        state: "open",
      },
    ]);
  });

  it("reads Codex's command_execution, wrapped in `bash -lc`", () => {
    const item = toolItem("command_execution", { command: "/bin/bash -lc 'gh pr create --fill --head notes'" }, GH_OUT);
    expect(refsOf(item)).toEqual(["acme/app#88"]);
  });

  it("reads Claude Code's Bash, with a string result and with content blocks", () => {
    const args = { command: 'gh pr create --title "Fix \\"export\\" name" --body x', description: "Open the PR" };
    const asString = findOpenedPullRequests(toolItem("Bash", args, GH_OUT));
    const asBlocks = findOpenedPullRequests(toolItem("Bash", args, [{ type: "text", text: GH_OUT }]));
    expect(asString.map((r) => r.title)).toEqual(['Fix "export" name']);
    expect(asBlocks.map((r) => r.number)).toEqual([88]);
  });

  it("reads the generator's bash tool, whose result is { stdout, stderr, exitCode }", () => {
    const item = toolItem("bash", { command: "gh pr create -t 'Notes' -H notes" }, { stdout: GH_OUT, stderr: "", exitCode: 0 });
    expect(findOpenedPullRequests(item)).toMatchObject([{ number: 88, title: "Notes", branch: "notes" }]);
  });

  it("reads a create-pull-request tool under any harness's prefix", () => {
    const result = { number: 7, html_url: "https://github.com/acme/app/pull/7", url: "https://api.github.com/repos/acme/app/pulls/7" };
    const args = { owner: "acme", repo: "app", title: "Seven", head: "seven", base: "main" };
    for (const name of ["create_pull_request", "mcp:github/create_pull_request", "mcp__github__create_pull_request"]) {
      expect(findOpenedPullRequests(toolItem(name, args, JSON.stringify(result)))).toMatchObject([
        { number: 7, title: "Seven", branch: "seven", url: "https://github.com/acme/app/pull/7" },
      ]);
    }
  });

  it("records only the pull request a create call opened, not one its body links", () => {
    const body = "Follow-up to https://github.com/acme/app/pull/12";
    const args = { owner: "acme", repo: "app", title: "Eighty-nine", head: "eighty-nine", base: "main", body };
    const created = { number: 89, html_url: "https://github.com/acme/app/pull/89", body, title: "Eighty-nine" };
    // As the tool's JSON, wrapped in a text block the way an MCP result arrives, and as GitHub's own MCP server answers.
    const shapes = [
      JSON.stringify(created),
      [{ type: "text", text: JSON.stringify(created) }],
      JSON.stringify({ id: "1", url: "https://github.com/acme/app/pull/89", body }),
    ];
    for (const output of shapes) {
      expect(findOpenedPullRequests(toolItem("mcp__github__create_pull_request", args, output)).map((r) => r.number)).toEqual([89]);
    }
  });

  it("reads the created pull request from a nested result, and a plain-text result's first link", () => {
    const args = { owner: "acme", repo: "app", title: "Eighty-nine", head: "eighty-nine", base: "main" };
    const body = "Follow-up to https://github.com/acme/app/pull/12";
    const nested = { pullRequest: { body, html_url: "https://github.com/acme/app/pull/89" } };
    const plain = "Created https://github.com/acme/app/pull/89\n\n" + body;
    for (const output of [JSON.stringify(nested), plain]) {
      expect(findOpenedPullRequests(toolItem("mcp__github__create_pull_request", args, output)).map((r) => r.number)).toEqual([89]);
    }
  });

  it("records every pull request a command of only `gh pr create`s prints", () => {
    const item = toolItem("bash", { command: "for r in app api; do gh pr create -R acme/$r --fill; done" }, {
      stdout: "https://github.com/acme/app/pull/89\nhttps://github.com/acme/api/pull/4\n",
    });
    expect(findOpenedPullRequests(item).map((r) => `${r.name}#${r.number}`)).toEqual(["app#89", "api#4"]);
  });

  it("records nothing from a create mixed with a command that prints other links, in either order", () => {
    // The output can't be split by command, so any row would be a guess; the branch check finds the real one.
    for (const command of [
      "gh pr create --fill && gh pr view 12 --json url -q .url",
      "gh pr view 12 --json url -q .url && gh pr create --fill",
      "gh api repos/acme/app/pulls/12 --jq .html_url; gh pr create --fill",
    ]) {
      const item = toolItem("bash", { command }, {
        stdout: "https://github.com/acme/app/pull/12\nhttps://github.com/acme/app/pull/89\n",
      });
      expect(findOpenedPullRequests(item)).toEqual([]);
    }
  });

  it("counts a create that failed because the branch already has the pull request", () => {
    expect(refsOf(cursorAlreadyExists)).toEqual(["Acme-Org/My.App#88"]);
  });

  it("reads a link with `www.` or a trailing path as the same pull request", () => {
    const item = toolItem("bash", { command: "gh pr create --fill" }, { stdout: "https://www.github.com/acme/app/pull/88/files\n" });
    expect(findOpenedPullRequests(item)).toMatchObject([{ host: "github.com", url: "https://github.com/acme/app/pull/88" }]);
  });

  it("reads a GitHub Enterprise host", () => {
    const item = toolItem("bash", { command: "gh pr create --fill" }, { stdout: "https://git.corp.example/eng/tool/pull/3\n" });
    expect(findOpenedPullRequests(item)).toMatchObject([{ host: "git.corp.example", owner: "eng", name: "tool", number: 3 }]);
  });
});

describe("findOpenedPullRequests — what is not opened", () => {
  it("does not count a real Cursor `gh pr view` of someone else's pull request", () => {
    expect(findOpenedPullRequests(cursorView)).toEqual([]);
  });

  it("does not count `gh pr list`, a search tool, or a link the agent only typed", () => {
    const list = toolItem("Bash", { command: "gh pr list" }, "12\tFix\tother\thttps://github.com/other/repo/pull/12");
    const search = toolItem("mcp__github__search_pull_requests", { q: "x" }, '{"items":[{"html_url":"https://github.com/o/r/pull/1"}]}');
    const typed = toolItem("Bash", { command: "echo https://github.com/acme/app/pull/88" }, GH_OUT);
    expect([list, search, typed].flatMap((item) => findOpenedPullRequests(item))).toEqual([]);
  });

  it("does not count the `/pull/new/<branch>` link a push prints", () => {
    const item = toolItem("bash", { command: "git push -u origin notes && gh pr create --fill" }, {
      stderr: "remote: Create a pull request for 'notes' on GitHub by visiting:\nremote:   https://github.com/acme/app/pull/new/notes\n",
      stdout: "",
    });
    expect(findOpenedPullRequests(item)).toEqual([]);
  });

  it("does not read a call still in flight, or an item that is not a tool call", () => {
    const running = toolItem("bash", { command: "gh pr create --fill" }, undefined);
    const message = { id: "m", type: "message", status: "completed", content: [{ type: "text", text: GH_OUT }] } as unknown as RuntimeItem;
    expect([...findOpenedPullRequests(running), ...findOpenedPullRequests(message)]).toEqual([]);
  });

  it("is GitHub's rule by default, and takes another forge's rule beside it", () => {
    const gitlab = {
      name: "gitlab",
      match: () => [{ host: "gitlab.example", owner: "g", name: "p", number: 4, url: "https://gitlab.example/g/p/-/merge_requests/4" }],
    };
    const item = toolItem("bash", { command: "glab mr create" }, "https://gitlab.example/g/p/-/merge_requests/4");
    expect(findOpenedPullRequests(item)).toEqual([]);
    expect(findOpenedPullRequests(item, [githubPullRequestRule, gitlab]).map((r) => r.host)).toEqual(["gitlab.example"]);
  });
});

/** An in-memory stand-in for the collection ref. */
function memoryCollection() {
  const rows = new Map<string, Record<string, unknown>>();
  return {
    rows,
    async getOptional(key: string) {
      const state = rows.get(key);
      return state === undefined ? undefined : { state };
    },
    async upsert(key: string, update: Record<string, unknown>) {
      rows.set(key, { ...rows.get(key), ...update });
    },
  };
}

const ref = (over: Partial<PullRequestRef> = {}): PullRequestRef => ({
  host: "github.com",
  owner: "acme",
  name: "app",
  number: 88,
  url: "https://github.com/acme/app/pull/88",
  ...over,
});

describe("writePullRequests — one pull request, one row", () => {
  it("lands a repeated link, and the same link spelled differently, on one row", async () => {
    const collection = memoryCollection();
    await writePullRequests(collection, [ref({ title: "Notes" })], { source: "tool", requestId: "r1", now: () => 1 });
    await writePullRequests(collection, [ref()], { source: "tool", requestId: "r1", now: () => 2 });
    await writePullRequests(
      collection,
      [ref({ host: "GitHub.com", owner: "ACME", name: "App", url: "https://www.github.com/ACME/App/pull/88/files" })],
      { source: "tool", requestId: "r2", now: () => 3 },
    );
    expect([...collection.rows.keys()]).toEqual(["github.com/acme/app/88"]);
    expect(collection.rows.get("github.com/acme/app/88")).toMatchObject({ title: "Notes", requestId: "r1", firstSeenAt: 1 });
  });

  it("keys owner and repository names with dots, dashes and upper case as one", () => {
    expect(pullRequestKey({ host: "github.com", owner: "Acme-Org", name: "My.App", number: 88 })).toBe(
      pullRequestKey({ host: "GITHUB.COM", owner: "acme-org", name: "my.app", number: 88 }),
    );
    expect(pullRequestKey({ host: "github.com", owner: "a", name: "..", number: 1 })).toBe("github.com/a/%2E%2E/1");
  });

  it("never moves the opening request; a later sighting only fills what was null", async () => {
    const collection = memoryCollection();
    await writePullRequests(collection, [ref({ state: "open" })], { source: "tool", requestId: "r1" });
    await writePullRequests(collection, [ref({ title: "Late title", state: "merged", branch: "notes" })], {
      source: "branch",
      requestId: "r2",
    });
    expect(collection.rows.get("github.com/acme/app/88")).toMatchObject({
      requestId: "r1",
      title: "Late title",
      state: "open",
      branch: "notes",
      source: "tool",
    });
  });

  it("upgrades a branch row a create call names later, and fills its request", async () => {
    const collection = memoryCollection();
    await writePullRequests(collection, [ref({ branch: "notes" })], { source: "branch" });
    await writePullRequests(collection, [ref()], { source: "tool", requestId: "r1" });
    expect(collection.rows.get("github.com/acme/app/88")).toMatchObject({ source: "tool", requestId: "r1" });
  });

  it("writes rows the schema reads, every field defaulting when an older row lacks it", () => {
    expect(observedPullRequestStateSchema.parse({})).toMatchObject({ host: null, number: null, source: null });
  });
});

describe("pullRequestRefFromUrl", () => {
  it("reads a listed link the way a tool's output is read, so both key one row", () => {
    const listed = pullRequestRefFromUrl("https://www.GitHub.com/acme/app/pull/12");
    const seen = findOpenedPullRequests({
      id: "i",
      type: "tool_output",
      status: "completed",
      output: { stdout: "https://github.com/acme/app/pull/12\n" },
      toolCall: { name: "bash", arguments: JSON.stringify({ command: "gh pr create --fill" }) },
    } as unknown as RuntimeItem)[0]!;
    expect(listed).toEqual({ host: "github.com", owner: "acme", name: "app", number: 12, url: "https://github.com/acme/app/pull/12" });
    expect(pullRequestKey(listed!)).toBe(pullRequestKey(seen));
  });

  it("is null for a link that is not a pull request's", () => {
    expect(pullRequestRefFromUrl("https://github.com/acme/app/pull/new/feat")).toBeNull();
    expect(pullRequestRefFromUrl("https://github.com/acme/app/issues/3")).toBeNull();
  });
});
