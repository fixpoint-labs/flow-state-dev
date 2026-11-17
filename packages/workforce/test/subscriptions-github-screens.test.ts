/**
 * GitHub's provider carries the app's screens.
 *
 * Why it matters: without them a GitHub subscription that lists the
 * `interest` screen is always refused (`no_interest_model`), so an app can only
 * follow a whole repository unjudged, and every review and comment on it lands
 * in the subscriber's conversation.
 */
import { describe, expect, it } from "vitest";
import { githubSubscriptionProvider } from "../src/service-flows";
import { subscriptionInputRefusal } from "../src/subscriptions/subscribe";

const judged = { provider: "github", thread: "github:acme/api", kinds: ["review", "comment"], screens: [{ screen: "interest" as const }] };

describe("githubSubscriptionProvider's screens", () => {
  it("accepts an interest subscription once given a model to judge it", () => {
    const github = githubSubscriptionProvider({ token: () => "t", screens: { interestModel: "typesafe-ai/jev" } });
    expect(github.screens?.interestModel).toBe("typesafe-ai/jev");
    expect(subscriptionInputRefusal([github], judged)).toBeUndefined();
  });

  it("still refuses one with no model to judge it", () => {
    expect(subscriptionInputRefusal([githubSubscriptionProvider({ token: () => "t" })], judged)).toMatch(/^no_interest_model:/);
  });

  it("runs the app's custom screens, and lists them", () => {
    const github = githubSubscriptionProvider({
      token: () => "t",
      screens: { custom: { bots: { describe: "only bots", screen: () => undefined } } }
    });
    expect(subscriptionInputRefusal([github], { ...judged, screens: [{ screen: "custom", name: "bots" }] })).toBeUndefined();
  });
});
