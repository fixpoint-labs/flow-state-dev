// FIX-2873.
/**
 * Who sets a subscription's bot admission (`botsScreenedBy`), and what it
 * takes to keep it. The trusted reviewers' follow hands every bot sender past
 * the sender screen to its list screen, which decides. That setting is the
 * one way past the service's `trustedBots` for a bot, so:
 *
 * - **A model can't set it.** A model's `subscribe` (the `saveRoutine` tool)
 *   has no such field: it is refused, and nothing hears the bot.
 * - **It needs its screen, at the write, at routing and at delivery.** A
 *   model's rewrite of the follow that drops the list screen drops it too,
 *   and a row or index entry that carries it without the screen (restored,
 *   or stale) hands no bot on, so a listed bot never reaches a subscription
 *   that has no list screen.
 *
 * Controls, each an `it` that plants its regression and shows the claim breaks:
 * - the setting honoured whether or not the subscription lists its screen
 *   (`botsHandedOn` planted, below): every "not heard" signal turns heard.
 * - a model's `subscribe` carrying the setting through to the write: its own
 *   file, `subscriptions-bot-admission-control.test.ts`, since that plant
 *   replaces the input schema the routine tools are built from.
 */
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { PullRequestFollower } from "@flow-state-dev/core/harness";
import { SUBSCRIPTION_INDEX_PATTERN, SUBSCRIPTIONS_PATTERN, type SubscriptionProvider } from "../src/subscriptions";
import { followPullRequest, githubTrustedReviewers, operatorGitHub } from "../src";
import type { WorkerInstallation } from "../src/workers/installation";
import { bootSubscriptionsHost, event, github } from "./subscriptions-harness";
import { ORG } from "./conversation-board-harness";

/** The control's switch: while set, the setting is honoured whatever the subscription lists. */
const plant = vi.hoisted(() => ({ flagWithoutScreen: false }));

vi.mock("../src/subscriptions/rows", async (importOriginal) => {
  const real = await importOriginal<typeof import("../src/subscriptions/rows")>();
  return {
    ...real,
    botsHandedOn: (entry: Parameters<typeof real.botsHandedOn>[0]) => (plant.flagWithoutScreen ? entry.botsScreenedBy : real.botsHandedOn(entry))
  };
});

let api: Server;
let apiUrl: string;
beforeAll(async () => {
  // Nobody is a collaborator: the bots under test never ask.
  api = createServer((_req, res) => {
    res.writeHead(404, { "content-type": "application/json" });
    res.end(JSON.stringify({ message: "Not Found" }));
  });
  await new Promise<void>((resolve) => api.listen(0, "127.0.0.1", resolve));
  apiUrl = `http://127.0.0.1:${(api.address() as AddressInfo).port}`;
});
afterAll(async () => {
  await new Promise((resolve) => api.close(resolve));
});

const PR = "github:acme/api#412";

/** A host on the trusted reviewers' wiring, its follow as `follower` builds it (default the reviewers' own). */
function host(follower?: (provider: SubscriptionProvider, installation: WorkerInstallation) => PullRequestFollower) {
  const reviewers = githubTrustedReviewers({ operator: "alice", judgeModel: "test/judge", holders: ["eng.lead"], env: { GITHUB_REVIEWERS: "greptile-apps[bot]" } });
  const operator = operatorGitHub({ operator: "alice", token: "operator-token", apiUrl, reviewers });
  const provider = { ...github, screens: operator.screens! };
  return bootSubscriptionsHost({
    screens: operator.screens!,
    follower: follower === undefined ? reviewers.follow(provider) : (installation) => follower(provider, installation)
  });
}

type Host = ReturnType<typeof host>;

let said = 0;
/** The listed bot comments on #412; whether `session` heard it. */
async function botHeard(h: Host, session: string) {
  said += 1;
  const text = `bot comment ${said}`;
  await h.route(event({ kind: "comment", text, sender: { id: "greptile-apps", name: "greptile-apps", role: "bot" } }));
  return (await h.heard(session)).some((m) => m.includes(text));
}

/** Rewrite `userId`'s stored rows of one collection with `edit`, as a restore or a stale write would leave them. */
async function rewrite(h: Host, scope: "user" | "org", prefix: string, edit: (state: Record<string, any>) => Record<string, any>) {
  const runtime = await h.state.getRuntime();
  const scopeId = scope === "user" ? `alice:~org:${ORG}` : ORG;
  const stored = await runtime.stores.resourceState.getByPrefix(scope, scopeId, prefix);
  for (const [key, entry] of Object.entries(stored)) await runtime.stores.resourceState.set(scope, scopeId, key, edit(entry.state as Record<string, any>) as never, "any" as never);
}

const dropScreens = (entry: Record<string, any>) => ({ ...entry, screens: [] });

/** A host whose run follows #412, run through `body`, then disposed. */
async function withFollow<T>(body: (h: Host, run: string) => Promise<T>): Promise<T> {
  const h = host();
  try {
    const run = await h.follower("alice");
    await h.act("alice", run, "respond", { message: "opened it [follow-pr:412]" }, "follower");
    return await body(h, run);
  } finally {
    await h.dispose();
  }
}

/** The run's own session saves a routine on its pull request with no screens (the same subscription): whether the bot is then heard. */
const rewrittenWithoutScreen = () =>
  withFollow(async (h, run) => {
    expect(await botHeard(h, run), "the follow hears the listed bot").toBe(true);
    expect(await h.subscribe("alice", run, { thread: PR })).toHaveProperty("id");
    const [follow] = await h.subscriptionRows("alice");
    expect({ hearsClose: follow!.hearsClose, screens: follow!.screens }).toEqual({ hearsClose: true, screens: [] });
    return botHeard(h, run);
  });

/** The thread's index entry loses its screens: whether routing still hands the bot on. */
const staleIndexEntry = () =>
  withFollow(async (h, run) => {
    await rewrite(h, "org", SUBSCRIPTION_INDEX_PATTERN.replace("*", ""), (index) => ({
      subscriptions: Object.fromEntries(Object.entries(index.subscriptions as Record<string, Record<string, any>>).map(([slot, entry]) => [slot, dropScreens(entry)]))
    }));
    return botHeard(h, run);
  });

/** The subscription's own row loses its screens: whether delivery still hands the bot on. */
const restoredRow = () =>
  withFollow(async (h, run) => {
    await rewrite(h, "user", SUBSCRIPTIONS_PATTERN.replace("*", ""), dropScreens);
    return botHeard(h, run);
  });

describe("a subscription's bot admission", () => {
  it("can't be set by a model's subscribe: the model's routine is refused, and the bot wakes nothing", async () => {
    const h = host();
    try {
      const session = await h.follower("alice", "eng.watcher");
      // As a model calls the tool: the whole input, the setting among it.
      const event = { provider: "github", thread: PR, screens: [{ screen: "custom", name: "github-reviewers" }], botsScreenedBy: "github-reviewers", interest: "the PR" };
      const asked = (await h.act("alice", session, "saveRoutine", { trigger: { event } }, "follower")) as { output?: { ok?: boolean }; error?: unknown };
      expect(asked.error !== undefined || asked.output?.ok === false, "the model's routine is refused").toBe(true);
      expect((await h.subscriptionRows("alice")).some((subscription) => subscription.botsScreenedBy !== undefined), "no subscription carries it").toBe(false);
      expect(await botHeard(h, session), "the bot wakes nothing").toBe(false);
    } finally {
      await h.dispose();
    }
  });

  it("is dropped when a model rewrites the follow without its list screen", async () => {
    expect(await rewrittenWithoutScreen(), "rewritten without its screen: not heard").toBe(false);
  });

  it("is kept when a model's rewrite still lists the list screen", async () => {
    const h = host();
    try {
      const run = await h.follower("alice");
      await h.act("alice", run, "respond", { message: "opened it [follow-pr:412]" }, "follower");
      expect(await h.subscribe("alice", run, { thread: PR, screens: [{ screen: "custom", name: "github-reviewers" }] })).toHaveProperty("id");
      const [follow] = await h.subscriptionRows("alice");
      expect(follow!.botsScreenedBy).toBe("github-reviewers");
      expect(await botHeard(h, run)).toBe(true);
    } finally {
      await h.dispose();
    }
  });

  it("hands no bot on at routing from an index entry that lost its screen", async () => {
    expect(await staleIndexEntry(), "stale index entry: not heard").toBe(false);
  });

  it("hands no bot on at delivery from a row that lost its screen, though routing's entry still lists it", async () => {
    expect(await restoredRow(), "restored row: not heard").toBe(false);
  });

  it("is refused on a host's write that doesn't list its screen", async () => {
    // A follow handing bots on to a screen it doesn't list: the follow throws the refusal, and nothing is saved.
    const h = host((provider, installation) => followPullRequest({ providers: [provider], installation, botsScreenedBy: "github-reviewers" }));
    try {
      const run = await h.follower("alice");
      const ran = await h.act("alice", run, "respond", { message: "opened it [follow-pr:412]" }, "follower");
      expect(String((ran as { error?: { message?: unknown } }).error?.message)).toContain("no_screen");
      expect(await h.subscriptionRows("alice")).toEqual([]);
    } finally {
      await h.dispose();
    }
  });
});

describe("control: the setting honoured without its screen", () => {
  // The plant reaches the write, routing and delivery alike: each claim above breaks under it.
  it("lets the listed bot through a rewrite, a stale index entry and a restored row", async () => {
    plant.flagWithoutScreen = true;
    try {
      expect(await rewrittenWithoutScreen(), "rewritten without its screen: heard under the plant").toBe(true);
      expect(await staleIndexEntry(), "stale index entry: heard under the plant").toBe(true);
      expect(await restoredRow(), "restored row: heard under the plant").toBe(true);
    } finally {
      plant.flagWithoutScreen = false;
    }
  });
});
