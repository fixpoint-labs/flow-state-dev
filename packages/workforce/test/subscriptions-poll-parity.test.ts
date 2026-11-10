/**
 * A poll reaches the same subscriptions push does: an app's custom and
 * interest screens decide on a polled thread as they do on a pushed one, and
 * what no ordinary subscription heard is forwarded to a coordinator that
 * follows the thread `unmatched`, marked the same.
 *
 * Why these matter: polling is the only way a laptop hears GitHub. A screen or
 * a forward that pushed events pass through and polled events skip would have
 * the same subscription hear different things depending on how the app is
 * hosted.
 */
import { mockEvaluationModel, mockGenerator } from "@flow-state-dev/testing";
import type { SubscriptionEvent } from "@flow-state-dev/core/types";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { WorkerManifest } from "../src/manifest";
import type { SubscriptionScreens } from "../src/subscriptions";
import { bootSubscriptionsHost, event, pollTimeline, type SubscriptionsHost, type SubscriptionsHostOptions } from "./subscriptions-harness";

const PR = "github:acme/api#412";
const REPO = "github:acme/api";
const T0 = Date.parse("2026-11-09T10:00:00Z");
const MINUTE = 60_000;

let now = T0;
beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  now = T0;
  vi.setSystemTime(now);
  pollTimeline.events = [];
  pollTimeline.calls = [];
  pollTimeline.incomplete = false;
  pollTimeline.overlapMs = 0;
});
afterEach(() => vi.useRealTimers());

type Way = "push" | "poll";

/**
 * Boot a host for `way`, let `setup` subscribe, deliver `events` (routed one by
 * one on push; on poll, there for the provider to return, and ticked through
 * one cadence), then answer what `read` reads from the host.
 */
async function deliver<T>(
  way: Way,
  options: SubscriptionsHostOptions,
  setup: (host: SubscriptionsHost) => Promise<void>,
  events: (at: number) => SubscriptionEvent[],
  read: (host: SubscriptionsHost) => Promise<T>
): Promise<T> {
  const host = bootSubscriptionsHost({ ...options, ...(way === "poll" ? { poll: {} } : {}) });
  try {
    await setup(host);
    const batch = events(now + 1_000);
    if (way === "push") {
      for (const e of batch) await host.route(e);
    } else {
      pollTimeline.events.push(...batch);
      for (let i = 0; i < 5; i += 1) {
        now += MINUTE;
        vi.setSystemTime(now);
        await host.tick();
      }
    }
    return await read(host);
  } finally {
    await host.dispose();
  }
}

/** Run the same scenario both ways and answer each way's reading. */
async function bothWays<T>(...args: Parameters<typeof deliver<T>> extends [Way, ...infer Rest] ? Rest : never) {
  return { push: await deliver<T>("push", ...args), poll: await deliver<T>("poll", ...args) };
}

const stackTrace: SubscriptionScreens["custom"] = {
  "stack-trace": { describe: "the text holds a stack trace", screen: (e) => (/\n\s+at .+:\d+/.test(e.text) ? undefined : "no stack trace") }
};

/** A model that says yes when the event's text holds the word after "about " in the interest. */
function byWordModel() {
  return mockEvaluationModel({
    answers: ({ state, questions }) =>
      Object.fromEntries(
        Object.entries(questions).map(([id, q]) => {
          const word = /about (\w+)/.exec((q as { instructions: string }).instructions)?.[1] ?? "\u0000";
          return [id, { type: "boolean" as const, probability: String(state).includes(word) ? 0.9 : 0.1 }];
        })
      )
  });
}

describe("the app's screens on a polled thread", () => {
  it("custom and interest screens let through on a poll exactly what they let through on push", async () => {
    const sessions: Record<string, string> = {};
    const heard = await bothWays<Record<string, string[]>>(
      { screens: { custom: stackTrace, interestModel: byWordModel() } },
      async (host) => {
        sessions.custom = await host.follower("alice");
        sessions.interest = await host.follower("alice");
        sessions.plain = await host.follower("alice");
        await host.subscribe("alice", sessions.custom, { thread: PR, screens: [{ screen: "custom", name: "stack-trace" }] });
        await host.subscribe("alice", sessions.interest, { thread: PR, screens: [{ screen: "interest" }], interest: "about crash" });
        await host.subscribe("alice", sessions.plain, { thread: PR });
      },
      (at) => [
        event({ at, received: at, text: "Looks fine." }),
        event({ at: at + 1, received: at + 1, text: "Crashed:\n    at handler (api.ts:12)" }),
        event({ at: at + 2, received: at + 2, text: "Another crash on the export path." })
      ],
      async (host) => Object.fromEntries(await Promise.all(Object.entries(sessions).map(async ([name, id]) => [name, (await host.heard(id)).length] as const))) as never
    );
    expect(heard.push).toEqual({ custom: 1, interest: 1, plain: 3 });
    expect(heard.poll).toEqual(heard.push);
  });
});

/** A coordinator that lands what reaches it as a line and runs no model on it. */
const WATCHER: WorkerManifest = {
  id: "watch.off",
  declared: { flow: "coordinator", delegates: ["eng.tasker"], inferredWork: "off", description: "Watches the repo." },
  body: "Triage what reaches you.",
  skills: []
};

let seq = 0;
/** An event on the repo and its issue, by a member, at `at`. */
function onRepo(at: number, fields: Partial<SubscriptionEvent> = {}): SubscriptionEvent {
  seq += 1;
  return event({
    kind: "issue",
    threads: [REPO, `${REPO}#${900 + seq}`],
    object: { id: `parity-${seq}`, version: 1 },
    title: `New issue ${seq}`,
    text: "The export button does nothing.",
    url: `https://github.com/acme/api/issues/${900 + seq}`,
    at,
    received: at,
    ...fields
  });
}

describe("an unmatched subscription on a polled thread", () => {
  it("is forwarded on a poll what it is forwarded on push: only what no ordinary subscription heard, of a forwarded kind, marked the same", async () => {
    const forwards = await bothWays<unknown[]>(
      {
        standard: [WATCHER],
        judgment: mockGenerator({ script: [{ when: () => true, then: { text: "Done." } }] }),
        service: { forwards: { kinds: ["issue", "comment"] } }
      },
      async (host) => {
        const coordinator = await host.conversation("alice", "watch.off");
        expect(await host.subscribe("alice", coordinator, { thread: REPO, unmatched: true, interest: "what nobody picked up" }, undefined, "coordinator")).toHaveProperty("id");
        const follower = await host.follower("alice");
        await host.subscribe("alice", follower, { thread: REPO, kinds: ["comment"], screens: [{ screen: "words", any: ["export"] }] });
      },
      (at) => [
        // Heard by the follower: not forwarded.
        onRepo(at, { kind: "comment", text: "export is broken" }),
        // Nobody heard it: forwarded, inferred.
        onRepo(at + 1, { kind: "comment", text: "the logo is blurry" }),
        // A kind the app doesn't forward.
        onRepo(at + 2, { kind: "review" }),
        // Asked for: forwarded, addressed.
        onRepo(at + 3, { addressed: true }),
        // The screens refused it: not forwarded.
        onRepo(at + 4, { sender: { id: "stranger", name: "Stranger", role: "outsider" } })
      ],
      async (host) =>
        (await host.serviceRows("alice"))
          .filter((message) => message.forward !== undefined)
          .map((message) => message.forward.as)
          .sort()
    );
    expect(forwards.push).toEqual(["addressed", "inferred"]);
    expect(forwards.poll).toEqual(forwards.push);
  });
});
