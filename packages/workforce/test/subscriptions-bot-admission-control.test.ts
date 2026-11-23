// FIX-2873.
/**
 * The control for "a model's `subscribe` can't set bot admission"
 * (`subscriptions-bot-admission.test.ts`). Here the regression is planted for
 * the whole file: `subscribe`'s input schema takes `botsScreenedBy`, and the
 * write takes it from the input. The routine tools are built from that schema
 * when they load, so the plant can't be switched per test. Under it, the very
 * call the claim refuses is saved, and the listed bot is heard: the claim's
 * test reaches the code it covers.
 */
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { githubTrustedReviewers, operatorGitHub } from "../src";
import { bootSubscriptionsHost, event, github } from "./subscriptions-harness";

vi.mock("../src/subscriptions/subscribe", async (importOriginal) => {
  const real = await importOriginal<typeof import("../src/subscriptions/subscribe")>();
  type Input = Parameters<typeof real.subscribe>[2] & { botsScreenedBy?: string };
  return {
    ...real,
    subscribeInputSchema: real.subscribeInputSchema.extend({ botsScreenedBy: z.string().optional() }),
    subscribe: (ctx: never, providers: never, input: Input, target?: never, write: Parameters<typeof real.subscribe>[4] = {}) =>
      real.subscribe(ctx, providers, input, target, { ...write, ...(input.botsScreenedBy === undefined ? {} : { botsScreenedBy: input.botsScreenedBy }) })
  };
});

let api: Server;
let apiUrl: string;
beforeAll(async () => {
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

describe("control: a model's subscribe that carries bot admission", () => {
  it("saves the model's routine, and the listed bot is heard on it", async () => {
    const reviewers = githubTrustedReviewers({ operator: "alice", judgeModel: "test/judge", holders: ["eng.lead"], env: { GITHUB_REVIEWERS: "greptile-apps[bot]" } });
    const operator = operatorGitHub({ operator: "alice", token: "operator-token", apiUrl, reviewers });
    const h = bootSubscriptionsHost({ screens: operator.screens!, follower: reviewers.follow({ ...github, screens: operator.screens! }) });
    try {
      const session = await h.follower("alice", "eng.watcher");
      const trigger = { event: { provider: "github", thread: "github:acme/api#412", screens: [{ screen: "custom", name: "github-reviewers" }], botsScreenedBy: "github-reviewers", interest: "the PR" } };
      const asked = (await h.act("alice", session, "saveRoutine", { trigger }, "follower")) as { output?: { ok?: boolean }; error?: unknown };
      expect(asked.error === undefined && asked.output?.ok === true, "the model's routine is saved under the plant").toBe(true);
      await h.route(event({ kind: "comment", text: "planted bot comment", sender: { id: "greptile-apps", name: "greptile-apps", role: "bot" } }));
      expect((await h.heard(session)).some((m) => m.includes("planted bot comment")), "the bot is heard under the plant").toBe(true);
    } finally {
      await h.dispose();
    }
  });
});
