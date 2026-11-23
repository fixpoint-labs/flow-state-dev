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
 * Controls (each must FAIL, on the named signal):
 * - `GOAL_CONTROL=model-sets-bot-flag`: `subscribe`'s input carries the
 *   setting through to the write. Fails on "the model's routine is refused".
 * - `GOAL_CONTROL=flag-without-screen`: the setting is honoured whether or
 *   not the subscription lists its screen. Fails on each "not heard" signal.
 */
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import type { PullRequestFollower } from "@flow-state-dev/core/harness";
import { SUBSCRIPTION_INDEX_PATTERN, SUBSCRIPTIONS_PATTERN, type SubscriptionProvider } from "../src/subscriptions";
import { followPullRequest, githubTrustedReviewers, operatorGitHub } from "../src";
import type { WorkerInstallation } from "../src/workers/installation";
import { bootSubscriptionsHost, event, github } from "./subscriptions-harness";
import { ORG } from "./conversation-board-harness";

vi.mock("../src/subscriptions/subscribe", async (importOriginal) => {
  const real = await importOriginal<typeof import("../src/subscriptions/subscribe")>();
  if (process.env.GOAL_CONTROL !== "model-sets-bot-flag") return real;
  // The planted regression: the input schema takes the setting, and the write takes it from the input.
  type Input = Parameters<typeof real.subscribe>[2] & { botsScreenedBy?: string };
  return {
    ...real,
    subscribeInputSchema: real.subscribeInputSchema.extend({ botsScreenedBy: z.string().optional() }),
    subscribe: (ctx: never, providers: never, input: Input, target?: never, write: Parameters<typeof real.subscribe>[4] = {}) =>
      real.subscribe(ctx, providers, input, target, { ...write, ...(input.botsScreenedBy === undefined ? {} : { botsScreenedBy: input.botsScreenedBy }) })
  };
});

vi.mock("../src/subscriptions/rows", async (importOriginal) => {
  const real = await importOriginal<typeof import("../src/subscriptions/rows")>();
  if (process.env.GOAL_CONTROL !== "flag-without-screen") return real;
  // The planted regression: the setting is honoured whatever the subscription lists.
  return { ...real, botsHandedOn: (entry: { botsScreenedBy?: string }) => entry.botsScreenedBy };
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
  const reviewers = githubTrustedReviewers({ operator: "alice", judgeModel: "test/judge", env: { GITHUB_REVIEWERS: "greptile-apps[bot]" } });
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
    const h = host();
    try {
      const run = await h.follower("alice");
      await h.act("alice", run, "respond", { message: "opened it [follow-pr:412]" }, "follower");
      expect(await botHeard(h, run), "the follow hears the listed bot").toBe(true);
      // The run's own session saves a routine on its pull request, with no screens: the same subscription.
      expect(await h.subscribe("alice", run, { thread: PR })).toHaveProperty("id");
      const [follow] = await h.subscriptionRows("alice");
      expect({ hearsClose: follow!.hearsClose, screens: follow!.screens }).toEqual({ hearsClose: true, screens: [] });
      expect(await botHeard(h, run), "rewritten without its screen: not heard").toBe(false);
    } finally {
      await h.dispose();
    }
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
    const h = host();
    try {
      const run = await h.follower("alice");
      await h.act("alice", run, "respond", { message: "opened it [follow-pr:412]" }, "follower");
      await rewrite(h, "org", SUBSCRIPTION_INDEX_PATTERN.replace("*", ""), (index) => ({
        subscriptions: Object.fromEntries(Object.entries(index.subscriptions as Record<string, Record<string, any>>).map(([slot, entry]) => [slot, dropScreens(entry)]))
      }));
      expect(await botHeard(h, run), "stale index entry: not heard").toBe(false);
    } finally {
      await h.dispose();
    }
  });

  it("hands no bot on at delivery from a row that lost its screen, though routing's entry still lists it", async () => {
    const h = host();
    try {
      const run = await h.follower("alice");
      await h.act("alice", run, "respond", { message: "opened it [follow-pr:412]" }, "follower");
      await rewrite(h, "user", SUBSCRIPTIONS_PATTERN.replace("*", ""), dropScreens);
      expect(await botHeard(h, run), "restored row: not heard").toBe(false);
    } finally {
      await h.dispose();
    }
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
