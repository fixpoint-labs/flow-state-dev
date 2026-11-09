/**
 * What nobody heard reaches a coordinator: an event no ordinary subscription
 * heard, of a kind the app forwards, is delivered to a coordinator that
 * follows its thread `unmatched`, marked `addressed` or `inferred` by the delivery;
 * and the coordinator's `inferredWork` decides what its turn may do with
 * inferred work. Real engine, scripted judgment turn, no live model.
 *
 * Graded on stored rows (board rows, their holds, the tasker's attempts, the
 * message log), never on tool calls.
 */
import { mockGenerator } from "@flow-state-dev/testing";
import type { SubscriptionEvent } from "@flow-state-dev/core/types";
import type { OwnHold, TaskHold } from "@flow-state-dev/orchestration/tasks";
import { afterEach, describe, expect, it } from "vitest";
import { blocksForward } from "../src/subscriptions/screens";
import type { WorkerManifest } from "../src/manifest";
import { githubServiceFlow } from "../src/subscriptions/github/service-flow";
import type { GitHubSubscriptionProvider } from "../src/subscriptions/github/provider";
import { bootSubscriptionsHost, event, github, revoked, type SubscriptionsHost } from "./subscriptions-harness";

afterEach(() => revoked.clear());

/** A coordinator over the tasker, set to `mode`. */
const watcher = (id: string, mode: string): WorkerManifest => ({
  id,
  declared: { flow: "coordinator", delegates: ["eng.tasker"], inferredWork: mode, description: "Watches the repo." },
  body: "Triage what reaches you.",
  skills: []
});

const WATCHERS = [watcher("watch.observe", "observe"), watcher("watch.auto", "auto"), watcher("watch.off", "off")];

/** The judgment turn's input as text. */
function textOf(input: unknown): string {
  return JSON.stringify(input);
}

/**
 * A judgment turn that files one task for the tasker per forwarded event it
 * reads (its `[evt-…]` mark, the latest in its input), with no questions of
 * its own, then says so. `[send]` in the event sends the tasker a message
 * instead. Every call is counted.
 */
function scriptedJudgment(calls: string[]) {
  const handled = new Set<string>();
  // The mock reads `then` right after `when` matched: `when` fills it for this call.
  const step: { toolCalls?: Array<{ toolCallId: string; toolName: string; args: unknown }> } = {};
  return mockGenerator({
    script: [
      {
        when: (input: unknown) => {
          const text = textOf(input);
          calls.push(text);
          const last = [...text.matchAll(/\[evt-(\w+?)(-send)?\]/g)].at(-1);
          if (last === undefined || handled.has(last[0])) return false;
          handled.add(last[0]);
          step.toolCalls =
            last[2] !== undefined
              ? [{ toolCallId: `send-${last[1]}`, toolName: "sendMessage", args: { to: "lead", text: `look at ${last[0]}` } }]
              : [{ toolCallId: `file-${last[1]}`, toolName: "createTask", args: { goal: `Triage ${last[0]}`, assignee: "eng.tasker", questions: [] } }];
          return true;
        },
        then: step
      },
      { when: () => true, then: { text: "Done." } }
    ]
  });
}

let seq = 0;
/** A new issue on `acme/api` by a member, nobody addressed, marked for the scripted turn. */
function issue(fields: Partial<SubscriptionEvent> = {}): SubscriptionEvent {
  seq += 1;
  return event({
    kind: "issue",
    threads: ["github:acme/api", `github:acme/api#${900 + seq}`],
    object: { id: `issue-${seq}`, version: 1 },
    title: `New issue [evt-${seq}]`,
    text: "The export button does nothing.",
    url: `https://github.com/acme/api/issues/${900 + seq}`,
    ...fields
  });
}

function boot(calls: string[] = [], forwards: readonly string[] | null = ["issue", "comment"]) {
  return bootSubscriptionsHost({
    standard: WATCHERS,
    judgment: scriptedJudgment(calls),
    service: forwards === null ? {} : { forwards: { kinds: forwards } }
  });
}

/** A coordinator conversation of `worker` for `userId`, following the repo unmatched. */
async function watching(h: SubscriptionsHost, userId: string, worker: string): Promise<string> {
  const sessionId = await h.conversation(userId, worker);
  const subscribed = await h.subscribe(userId, sessionId, { thread: "github:acme/api", unmatched: true, interest: "new issues nobody picked up" }, undefined, "coordinator");
  expect(subscribed).toHaveProperty("id");
  return sessionId;
}

/** `userId`'s board rows filed by the coordinator conversation `sessionId`. */
async function filedBy(h: SubscriptionsHost, userId: string): Promise<Array<Record<string, any>>> {
  return (await h.rows(userId)).filter((row) => String(row.goal).startsWith("Triage")) as never;
}

/** A row's own holds that wait on the user's yes. */
const confirmsOf = (row: Record<string, any>) =>
  ((row.holds ?? []) as TaskHold[]).filter((hold): hold is OwnHold => hold.source.kind === "task" && hold.ask.kind === "confirm");

describe("an unmatched subscription", () => {
  it("is a coordinator's only: a follower is refused not_a_coordinator", async () => {
    const h = boot();
    const follower = await h.follower("alice");
    const refused = await h.subscribe("alice", follower, { thread: "github:acme/api", unmatched: true });
    expect(refused).toMatchObject({ refused: expect.stringContaining("not_a_coordinator") });
    expect(await h.subscriptionRows("alice")).toHaveLength(0);
  });

  it("hears an event only when no ordinary subscription heard it, and a kind the app forwards", async () => {
    const h = boot();
    await watching(h, "alice", "watch.auto");
    const follower = await h.follower("bob");
    // Bob follows the repo for comments that say "export".
    await h.subscribe("bob", follower, { thread: "github:acme/api", kinds: ["comment"], screens: [{ screen: "words", any: ["export"] }] });

    const heardByBob = await h.route(issue({ kind: "comment", title: "A comment [evt-a]", text: "export is broken" }));
    expect(heardByBob.output).not.toHaveProperty("unmatched");

    const unheard = await h.route(issue({ kind: "comment", title: "A comment [evt-b]", text: "the logo is blurry" }));
    expect((unheard.output as any).unmatched).toEqual({ forwarded: 1 });

    const unlisted = await h.route(issue({ kind: "review", title: "A review [evt-c]" }));
    expect((unlisted.output as any).unmatched).toEqual({ forwarded: 0, dropped: "kind not forwarded" });

    const outsider = await h.route(issue({ title: "An outsider's issue [evt-d]", sender: { id: "stranger", name: "Stranger", role: "outsider" } }));
    expect((outsider.output as any).unmatched).toEqual({ forwarded: 0, dropped: "screens refused it" });

    // Rows, not routing's word: the coordinator's log holds the one forward, marked inferred.
    const forwards = (await h.serviceRows("alice")).filter((row) => row.forward !== undefined);
    expect(forwards.map((row) => row.forward)).toEqual([{ as: "inferred", url: expect.stringContaining("/issues/") }]);
    expect((await h.serviceRows("bob")).length).toBe(1);
  });

  it("forwards nothing without the app's forwards: the drop is counted", async () => {
    const h = boot([], null);
    await watching(h, "alice", "watch.auto");
    const routed = await h.route(issue());
    expect((routed.output as any).unmatched).toEqual({ forwarded: 0, dropped: "kind not forwarded" });
    expect(await h.serviceRows("alice")).toHaveLength(0);
  });

  it("forwards through GitHub's own service flow when the app lists the kinds, and not without", async () => {
    for (const forwards of [{ kinds: ["issue"] }, undefined]) {
      const h = bootSubscriptionsHost({
        standard: WATCHERS,
        serviceFlow: (installation) =>
          githubServiceFlow({ provider: github as GitHubSubscriptionProvider, installation, ...(forwards === undefined ? {} : { forwards }) })
      });
      await watching(h, "alice", "watch.auto");
      const routed = await h.route(issue());
      expect((routed.output as any).unmatched).toEqual(forwards === undefined ? { forwarded: 0, dropped: "kind not forwarded" } : { forwarded: 1 });
    }
  });

  it("counts an unheard event nobody follows unmatched as dropped", async () => {
    const h = boot();
    const routed = await h.route(issue());
    expect((routed.output as any).unmatched).toEqual({ forwarded: 0, dropped: "no coordinator follows" });
  });
});

describe("a coordinator's inferredWork", () => {
  it("observe: every task an inferred turn files waits on a confirm and starts no attempt; an addressed event runs", async () => {
    const h = boot();
    await watching(h, "alice", "watch.observe");
    await h.route(issue({ title: "Inferred [evt-10]" }));
    await h.route(issue({ title: "Asked [evt-11]", addressed: true }));

    const rows = await filedBy(h, "alice");
    const inferred = rows.find((row) => row.goal === "Triage [evt-10]");
    const asked = rows.find((row) => row.goal === "Triage [evt-11]");
    expect(inferred, "the inferred turn filed its task").toBeDefined();
    expect(confirmsOf(inferred!)).toHaveLength(1);
    expect(confirmsOf(inferred!)[0]!.ask.prompt).toContain("/issues/");
    expect(inferred!.attempts ?? 0).toBe(0);
    expect(h.runs.some((run) => run.taskId === inferred!.id)).toBe(false);
    // The addressed event is ordinary work: no confirm, and it ran.
    expect(confirmsOf(asked!)).toHaveLength(0);
    expect(h.runs.some((run) => run.taskId === asked!.id)).toBe(true);
  });

  it("observe: a message to another worker on an inferred turn is refused; in auto the same send goes", async () => {
    /** The messages `from` sent, from the log. */
    const sentBy = async (h: SubscriptionsHost, from: string) => {
      const runtime = await h.state.getRuntime();
      const entries = await runtime.stores.resourceState.getByPrefix("user", "alice:~org:acme", "workforce/messages/");
      return Object.values(entries).filter((value) => (value.state as { from?: string }).from === from);
    };
    const observe = boot();
    await watching(observe, "alice", "watch.observe");
    await observe.route(issue({ title: "Inferred [evt-20-send]" }));
    expect(await sentBy(observe, "watch.observe")).toHaveLength(0);
    // The control: the same turn, set to auto, sends.
    const auto = boot();
    await watching(auto, "alice", "watch.auto");
    await auto.route(issue({ title: "Inferred [evt-21-send]" }));
    expect(await sentBy(auto, "watch.auto")).toHaveLength(1);
  });

  it("auto: the same inferred task is filed with no confirm and runs", async () => {
    const h = boot();
    await watching(h, "alice", "watch.auto");
    await h.route(issue({ title: "Inferred [evt-30]" }));
    const [row] = await filedBy(h, "alice");
    expect(row).toBeDefined();
    expect(confirmsOf(row!)).toHaveLength(0);
    expect(h.runs.some((run) => run.taskId === row!.id)).toBe(true);
  });

  it("off: an inferred forward lands as a line and calls no model; an addressed event still runs", async () => {
    const calls: string[] = [];
    const h = boot(calls);
    const sessionId = await watching(h, "alice", "watch.off");
    await h.route(issue({ title: "Inferred [evt-40]" }));
    expect(calls).toHaveLength(0);
    expect(await filedBy(h, "alice")).toHaveLength(0);
    expect((await h.heard(sessionId)).some((line) => line.includes("[evt-40]"))).toBe(true);

    await h.route(issue({ title: "Asked [evt-41]", addressed: true }));
    expect(calls.length).toBeGreaterThan(0);
    const [row] = await filedBy(h, "alice");
    expect(row?.goal).toBe("Triage [evt-41]");
    expect(h.runs.some((run) => run.taskId === row!.id)).toBe(true);
  });
});

describe("blocksForward", () => {
  it("reads the screens' could-not-decide reasons, never a content refusal", () => {
    expect(blocksForward({ subscription: "s", pass: false, reason: "interest: unjudged" })).toBe(true);
    expect(blocksForward({ subscription: "s", pass: false, reason: "custom:triage: failed" })).toBe(true);
    expect(blocksForward({ subscription: "s", pass: false, reason: "words: none of the words export" })).toBe(false);
    expect(blocksForward({ subscription: "s", pass: true, reason: "passed the config screens" })).toBe(false);
  });
});
