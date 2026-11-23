// FIX-2873.
/**
 * One stored list decides whose comments a coding run acts on, wired as
 * Teammates wires it: `githubTrustedReviewers({ operator })`, its follow on
 * the run's pull request, and `operatorGitHub({ reviewers })` declaring its
 * list screen, through the real routing and delivery, beside an ordinary
 * subscription that has no list screen.
 *
 * Why it matters: a run acts on what it hears with a push, and anyone can
 * comment on a public repository. So a run hears a listed bot, or a listed
 * user who can push, and nobody else. `GITHUB_REVIEWERS` is the list's
 * default only until it is first saved: emptying the list must stop all
 * steering, never bring the setting back. A listed bot is heard on the run's
 * own follow, never on another subscription: the service's `trustedBots`
 * stays service-wide and is never fed from the list.
 *
 * GitHub's permission endpoint is a local stub; it counts each lookup, because
 * a listed user costs one permission call per comment, and a bot or a
 * stranger none.
 *
 * Controls, each an `it` that plants its regression and shows the named signal breaks:
 * - `empty-falls-back`: the list screen reads `GITHUB_REVIEWERS` when the
 *   saved list is empty. Breaks "save []: alice refused".
 * - `provider-wide-bots`: the list's bots fed to the service's `trustedBots`.
 *   Breaks "ordinary subscription not woken".
 */
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { BlockContext } from "@flow-state-dev/core/types";
import { followPullRequest, GITHUB_REVIEWERS_DOC, githubLoginsListed, githubReviewersDocument, githubTrustedReviewers, operatorGitHub, type GitHubTrustedReviewers } from "../src";
import { bootSubscriptionsHost, event, github } from "./subscriptions-harness";
import { ORG } from "./conversation-board-harness";
import { SUBSCRIPTION_INDEX_PATTERN, SUBSCRIPTIONS_PATTERN } from "../src/subscriptions";

/** A planted regression a control runs the wiring with. */
type Plant = "empty-falls-back" | "provider-wide-bots";
const SETTING = "alice,greptile-apps[bot]";

/** Each login's permission on acme/api, as GitHub answers it; anyone else isn't a collaborator. */
const PERMISSIONS: Record<string, string> = { alice: "write", bob: "write", carol: "read" };
/** Every login GitHub was asked about. */
const asked: string[] = [];
let api: Server;
let apiUrl: string;

beforeAll(async () => {
  api = createServer((req, res) => {
    const login = /^\/repos\/acme\/api\/collaborators\/([^/]+)\/permission$/.exec((req.url ?? "").split("?")[0]!)?.[1];
    if (login !== undefined) asked.push(login);
    const permission = login === undefined ? undefined : PERMISSIONS[login];
    res.writeHead(permission === undefined ? 404 : 200, { "content-type": "application/json" });
    res.end(JSON.stringify(permission === undefined ? { message: "Not Found" } : { permission, role_name: permission }));
  });
  await new Promise<void>((resolve) => api.listen(0, "127.0.0.1", resolve));
  apiUrl = `http://127.0.0.1:${(api.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await new Promise((resolve) => api.close(resolve));
});

/** The reviewers as Teammates builds them, or under `empty-falls-back` with the fallback the decision rejects planted. */
function reviewersOf(setting: string, plant?: Plant): GitHubTrustedReviewers {
  const reviewers = githubTrustedReviewers({ operator: "alice", judgeModel: "test/judge", holders: ["eng.lead"], env: { GITHUB_REVIEWERS: setting } });
  if (plant !== "empty-falls-back") return reviewers;
  const read = async (ctx: BlockContext) => {
    const listed = await reviewers.read(ctx);
    return listed.length > 0 ? listed : githubLoginsListed(githubReviewersDocument(setting.split(",")));
  };
  return { ...reviewers, read };
}

/** A host on Teammates' wiring: the follow, the provider's list screen, and the service with no `trustedBots` from the list. */
function teammatesHost(reviewers: GitHubTrustedReviewers, plant?: Plant) {
  const operator = operatorGitHub({ operator: "alice", token: "operator-token", apiUrl, reviewers });
  // The harness's provider (read access, `self`) with the screens `operatorGitHub` declares.
  const provider = { ...github, screens: operator.screens! };
  const bots = githubLoginsListed((reviewers.document as { content?: string }).content)
    .filter((login) => login.endsWith("[bot]"))
    .map((login) => login.replace(/\[bot\]$/, ""));
  return bootSubscriptionsHost({
    screens: operator.screens!,
    follower: reviewers.follow(provider),
    // The harness's service trusts `codex` only; the control feeds the list's bots to it, service-wide.
    ...(plant === "provider-wide-bots" ? { service: { trustedBots: ["codex", ...bots] } } : {})
  });
}

type Host = ReturnType<typeof teammatesHost>;

/** Save the list as the tool's write leaves it: the stored row the document reads from then on. */
async function save(host: Host, logins: string[]) {
  const runtime = await host.state.getRuntime();
  await runtime.stores.content.set("org", ORG, GITHUB_REVIEWERS_DOC, githubReviewersDocument(logins));
}

let said = 0;
/** A comment on `#pr` from `id` as `role`; its text names it, so what was heard can be read back. */
function comment(id: string, role: "member" | "collaborator" | "outsider" | "bot", pr = 412) {
  said += 1;
  const text = `comment ${said} by ${role} ${id}`;
  return { text, event: event({ kind: "comment", threads: ["github:acme/api", `github:acme/api#${pr}`], text, sender: { id, name: id, role } }) };
}

describe("one stored list, on Teammates' wiring", () => {
  it("defaults from GITHUB_REVIEWERS until saved; a save, even an empty one, wins on the next comment", async () => {
    const host = teammatesHost(reviewersOf(SETTING));
    try {
      const run = await host.follower("alice");
      const opened = await host.act("alice", run, "respond", { message: "opened it [follow-pr:412]" }, "follower");
      expect((opened as { error?: unknown }).error).toBeUndefined();
      // An ordinary subscription of the same user, on another pull request, with no list screen.
      const ordinary = await host.follower("alice", "eng.watcher");
      expect(await host.subscribe("alice", ordinary, { thread: "github:acme/api#413", kinds: ["comment"] })).toHaveProperty("id");

      const hears = async (said: { text: string; event: Parameters<Host["route"]>[0] }, session = run) => {
        await host.route(said.event);
        return (await host.heard(session)).some((m) => m.includes(said.text));
      };

      // Nothing saved: the setting is the list.
      asked.length = 0;
      expect(await hears(comment("alice", "member")), "nothing saved: alice (a writer) heard").toBe(true);
      // Asked at routing, and again at delivery, where the screens run on the subscription's own row.
      expect(asked, "a listed user's comment asks GitHub").toEqual(["alice", "alice"]);
      expect(await hears(comment("greptile-apps", "bot")), "nothing saved: the listed bot heard").toBe(true);
      expect(await hears(comment("bob", "member")), "nothing saved: bob refused").toBe(false);
      expect(await hears(comment("greptile-apps", "outsider")), "a user named like the listed bot refused").toBe(false);
      expect(await hears(comment("codex", "bot")), "a bot the service trusts but the list doesn't refused").toBe(false);
      expect(asked, "no permission call for a bot or a stranger").toEqual(["alice", "alice"]);
      // The listed bot on a thread only the ordinary subscription follows: it has no list screen, so it isn't woken.
      expect(await hears(comment("greptile-apps", "bot", 413), ordinary), "ordinary subscription not woken").toBe(false);

      // Saved empty: nobody, whatever the setting says.
      await save(host, []);
      expect(await hears(comment("alice", "member")), "save []: alice refused").toBe(false);
      expect(await hears(comment("greptile-apps", "bot")), "save []: the bot refused").toBe(false);

      // Saved with others: they're heard on the next comment, with no restart. A listed reader isn't.
      await save(host, ["bob", "carol", "cursor[bot]"]);
      asked.length = 0;
      expect(await hears(comment("bob", "member")), "saved: bob heard").toBe(true);
      expect(await hears(comment("cursor", "bot")), "saved: cursor[bot] heard").toBe(true);
      expect(await hears(comment("carol", "collaborator")), "listed reader-only carol refused").toBe(false);
      expect(await hears(comment("alice", "member")), "alice, no longer listed, refused").toBe(false);
      // bob's comment is asked at routing and delivery; carol's is refused at routing.
      expect(asked.sort(), "permission calls only for listed people").toEqual(["bob", "bob", "carol"]);
    } finally {
      await host.dispose();
    }
  });

  it("follows the run's pull request with the list screen first, outsiders taken, and bots handed to the list screen", async () => {
    const host = teammatesHost(reviewersOf(SETTING));
    try {
      const run = await host.follower("alice");
      await host.act("alice", run, "respond", { message: "opened it [follow-pr:412]" }, "follower");
      const [follow] = await host.subscriptionRows("alice");
      expect({ screens: follow!.screens, outsiders: follow!.outsiders, botsScreenedBy: follow!.botsScreenedBy }).toEqual({
        screens: [{ screen: "custom", name: "github-reviewers" }],
        outsiders: true,
        botsScreenedBy: "github-reviewers"
      });
      // An outsider the list names is heard; one it doesn't isn't.
      await host.route(comment("alice", "outsider").event);
      await host.route(comment("mallory", "outsider").event);
      const heard = (await host.heard(run)).join("\n");
      expect(heard).toContain("by outsider alice");
      expect(heard).not.toContain("mallory");
    } finally {
      await host.dispose();
    }
  });
});

describe("controls: each planted regression breaks its signal", () => {
  /** A run following #412 and an ordinary subscription on #413, on the wiring with `plant`. */
  async function planted(plant: Plant, body: (host: Host, run: string, ordinary: string) => Promise<void>) {
    const host = teammatesHost(reviewersOf(SETTING, plant), plant);
    try {
      const run = await host.follower("alice");
      await host.act("alice", run, "respond", { message: "opened it [follow-pr:412]" }, "follower");
      const ordinary = await host.follower("alice", "eng.watcher");
      await host.subscribe("alice", ordinary, { thread: "github:acme/api#413", kinds: ["comment"] });
      await body(host, run, ordinary);
    } finally {
      await host.dispose();
    }
  }
  const heard = async (host: Host, session: string, said: ReturnType<typeof comment>) => {
    await host.route(said.event);
    return (await host.heard(session)).some((m) => m.includes(said.text));
  };

  it("empty-falls-back: after save [], alice is heard", async () => {
    await planted("empty-falls-back", async (host, run) => {
      await save(host, []);
      expect(await heard(host, run, comment("alice", "member")), "save []: alice heard under the plant").toBe(true);
    });
  });

  it("provider-wide-bots: the listed bot wakes the ordinary subscription", async () => {
    await planted("provider-wide-bots", async (host, _run, ordinary) => {
      expect(await heard(host, ordinary, comment("greptile-apps", "bot", 413)), "ordinary subscription woken under the plant").toBe(true);
    });
  });
});

// BP-030: Teammates' follows saved before the one list carry a fixed `allow` screen of their own and
// no list screen, so the list never runs on them. A follow of that shape must not keep hearing a
// user the operator has since removed from the list, nor skip the write check. A follow a host makes
// today with the same screens is a supported shape, and must still be heard as it lists.
describe("a run's follow of a fixed allow list", () => {
  /** A host whose run follows #412 with the screens the removed allow-list follower wrote, and `alice` comments after `save []`. */
  async function aliceHeard(asSaved: (host: Host) => Promise<void>) {
    const reviewers = reviewersOf(SETTING);
    const operator = operatorGitHub({ operator: "alice", token: "operator-token", apiUrl, reviewers });
    const provider = { ...github, screens: operator.screens! };
    const host = bootSubscriptionsHost({
      screens: operator.screens!,
      follower: (installation) =>
        followPullRequest({ providers: [provider], installation, screens: [{ screen: "allow", ids: ["alice"], bots: ["greptile-apps"] }], outsiders: true })
    });
    try {
      const run = await host.follower("alice");
      await host.act("alice", run, "respond", { message: "opened it [follow-pr:412]" }, "follower");
      await asSaved(host);
      await save(host, []);
      const said = comment("alice", "member");
      const routed = await host.route(said.event);
      const reasons = (routed.output as { verdicts: Array<{ reason: string }> }).verdicts.map((v) => v.reason);
      return { heard: (await host.heard(run)).some((m) => m.includes(said.text)), reasons };
    } finally {
      await host.dispose();
    }
  }

  /** Take `followRev` off the follow and its index entry, as the removed follower saved them. */
  async function asLegacy(host: Host) {
    const runtime = await host.state.getRuntime();
    const strip = ({ followRev: _rev, ...kept }: Record<string, unknown>) => kept;
    for (const [scope, scopeId, prefix] of [
      ["user", `alice:~org:${ORG}`, SUBSCRIPTIONS_PATTERN.replace("*", "")],
      ["org", ORG, SUBSCRIPTION_INDEX_PATTERN.replace("*", "")]
    ] as const) {
      for (const [key, stored] of Object.entries(await runtime.stores.resourceState.getByPrefix(scope, scopeId, prefix))) {
        const state = stored.state as Record<string, any>;
        const next = scope === "user" ? strip(state) : { subscriptions: Object.fromEntries(Object.entries(state.subscriptions as Record<string, Record<string, unknown>>).map(([slot, entry]) => [slot, strip(entry)])) };
        await runtime.stores.resourceState.set(scope, scopeId, key, next as never, "any" as never);
      }
    }
  }

  it("made today, is heard as it lists, whatever the shared list says", async () => {
    const { heard } = await aliceHeard(async () => undefined);
    expect(heard, "current follow: alice heard").toBe(true);
  });

  it("saved before the one list (no followRev), hears no one, at routing and at delivery", async () => {
    const { heard, reasons } = await aliceHeard(asLegacy);
    expect(heard, "legacy follow, save []: alice refused").toBe(false);
    expect(reasons).toEqual([expect.stringMatching(/^allow: .*follows its pull request again/)]);
  });
});

describe("githubLoginsListed", () => {
  it("reads users and bots apart, lower-cased, a bot keeping its [bot]", () => {
    expect(githubLoginsListed("# Title\n\nProse - not a login\n- JHoffner\n* @Bob\n- Cursor[bot]\n- not a login\n")).toEqual(["jhoffner", "bob", "cursor[bot]"]);
  });
});

describe("the list's default", () => {
  it("is read when the reviewers are built, never at import, and lists each account once", () => {
    const built = githubTrustedReviewers({ operator: "alice", judgeModel: "test/judge", holders: ["eng.lead"], env: { GITHUB_REVIEWERS: " Alice, greptile-apps[bot],alice ,, " } });
    const content = (built.document as { content?: string }).content;
    expect(githubLoginsListed(content)).toEqual(["alice", "greptile-apps[bot]"]);
    // Unset: a list that names nobody.
    const unset = githubTrustedReviewers({ operator: "alice", judgeModel: "test/judge", holders: ["eng.lead"], env: {} });
    expect(githubLoginsListed((unset.document as { content?: string }).content)).toEqual([]);
  });

  it("is the document's definition content, not a template: a stored row wins", () => {
    const built = githubTrustedReviewers({ operator: "alice", judgeModel: "test/judge", holders: ["eng.lead"], env: { GITHUB_REVIEWERS: SETTING } });
    expect(built.document).not.toHaveProperty("contentTemplate");
    expect(typeof (built.document as { content?: unknown }).content).toBe("string");
  });
});
