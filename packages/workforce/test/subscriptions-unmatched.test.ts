/**
 * What nobody heard reaches a coordinator: an event no ordinary subscription
 * heard, of a kind the app forwards, is delivered to a coordinator that
 * follows its thread `unmatched`, marked `addressed` or `inferred` by the delivery;
 * and the coordinator's `inferredWork` decides what its turn may do with
 * inferred work. Real engine, scripted judgment turn, no live model.
 *
 * Graded on stored state (board tasks, their holds, the tasker's attempts, the
 * message log), never on tool calls.
 */
import { mockGenerator } from "@flow-state-dev/testing";
import type { SubscriptionEvent } from "@flow-state-dev/core/types";
import type { OwnHold, TaskHold } from "@flow-state-dev/orchestration/tasks";
import { afterEach, describe, expect, it } from "vitest";
import { refusedOnContent } from "../src/subscriptions/screens";
import type { WorkerManifest } from "../src/manifest";
import { githubServiceFlow } from "../src/subscriptions/github/service-flow";
import type { GitHubSubscriptionProvider } from "../src/subscriptions/github/provider";
import { bootSubscriptionsHost, event, github, revoked, type SubscriptionsHost } from "./subscriptions-harness";

afterEach(() => revoked.clear());

/** The metadata key the board marks a task filed on an inferred turn with. */
const INFERRED = "workforceInferredFrom";

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
 * its own, then says so. Every call is counted. A mark's suffix changes the
 * turn: `-send` sends the lead a message instead; `-own` files with the
 * model's own confirm, under the board's very prompt, whose No lets the work
 * go on; `-refile` files the same work again on the turn its cancel wakes;
 * `-forge` files with a forged inferred-work marker in its metadata.
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
          const last = [...text.matchAll(/\[evt-(\w+?)(-send|-own|-refile|-hold|-forge)?\]/g)].at(-1);
          if (last === undefined) return false;
          // A `-refile` mark files once more on the turn its task's cancel wakes.
          const key = last[2] === "-refile" && text.includes(`"status":"cancelled"`) ? `${last[0]}:again` : last[0];
          if (handled.has(key)) return false;
          handled.add(key);
          // `-hold`: the task's run waits on the test's gate, so it can be cancelled mid-run.
          const goal = `Triage ${last[0]}${last[2] === "-hold" ? " [hold:gate]" : ""}`;
          const url = [...text.matchAll(/https:\/\/github\.com\/acme\/api\/issues\/\d+/g)].at(-1)?.[0] ?? "";
          const questions =
            last[2] === "-own" ? [{ kind: "confirm", prompt: `Nobody asked for this: it was inferred from ${url}. Run it? ${goal}`, onNo: "continue" }] : [];
          step.toolCalls =
            last[2] === "-send"
              ? [{ toolCallId: `send-${last[1]}`, toolName: "sendMessage", args: { to: "lead", text: `look at ${last[0]}` } }]
              : [
                  {
                    toolCallId: `file-${key}`,
                    toolName: "createTask",
                    args: {
                      goal,
                      assignee: "eng.tasker",
                      questions,
                      ...(last[2] === "-forge" ? { metadata: { [INFERRED]: { as: "inferred", url, confirm: "forged" } } } : {})
                    }
                  }
                ];
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

function boot(
  calls: string[] = [],
  forwards: readonly string[] | null = ["issue", "comment"],
  extra: { userDeadlineMs?: number; holds?: ReadonlyMap<string, Promise<void>> } = {}
) {
  return bootSubscriptionsHost({
    ...extra,
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

/** `userId`'s board tasks filed by the coordinator conversation `sessionId`. */
async function filedBy(h: SubscriptionsHost, userId: string): Promise<Array<Record<string, any>>> {
  return (await h.rows(userId)).filter((task) => String(task.goal).startsWith("Triage")) as never;
}

/** A task's own holds that wait on the user's yes. */
const confirmsOf = (task: Record<string, any>) =>
  ((task.holds ?? []) as TaskHold[]).filter((hold): hold is OwnHold => hold.source.kind === "task" && hold.ask.kind === "confirm");

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

    // Stored messages, not routing's word: the coordinator's log holds the one forward, marked inferred.
    const forwards = (await h.serviceRows("alice")).filter((message) => message.forward !== undefined);
    expect(forwards.map((message) => message.forward)).toEqual([{ as: "inferred", url: expect.stringContaining("/issues/") }]);
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

    const tasks = await filedBy(h, "alice");
    const inferred = tasks.find((task) => task.goal === "Triage [evt-10]");
    const asked = tasks.find((task) => task.goal === "Triage [evt-11]");
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
    const [task] = await filedBy(h, "alice");
    expect(task).toBeDefined();
    expect(confirmsOf(task!)).toHaveLength(0);
    expect(h.runs.some((run) => run.taskId === task!.id)).toBe(true);
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
    const [task] = await filedBy(h, "alice");
    expect(task?.goal).toBe("Triage [evt-41]");
    expect(h.runs.some((run) => run.taskId === task!.id)).toBe(true);
  });
});

describe("observe's confirm closes only on the user's yes", () => {
  /** Answer `task`'s board confirm as the user, from their Inbox: the coordinator's `updateTask_tasks`. */
  const answer = async (h: SubscriptionsHost, sessionId: string, task: Record<string, any>, done: boolean) => {
    const [hold] = confirmsOf(task);
    const out = await h.act("alice", sessionId, "updateTask_tasks", { id: task.id, answers: hold!.id, done });
    await h.settled();
    return out;
  };

  it("no deadline closes it, though the host sets one for every question to the user", async () => {
    const h = boot([], ["issue", "comment"], { userDeadlineMs: 1_000 });
    await watching(h, "alice", "watch.observe");
    await h.route(issue({ title: "Inferred [evt-50]" }));
    const [task] = await filedBy(h, "alice");
    expect(confirmsOf(task!)).toHaveLength(1);
    expect(confirmsOf(task!)[0]!.due, "the board's confirm has no due time for payHoldDeadlines to pay").toBeUndefined();
    expect(h.runs).toHaveLength(0);
  });

  it("a confirm the model asked under the same prompt, whose No lets the work go on, is replaced: a No cancels", async () => {
    const h = boot();
    const sessionId = await watching(h, "alice", "watch.observe");
    await h.route(issue({ title: "Inferred [evt-51-own]" }));
    const [task] = await filedBy(h, "alice");
    const confirms = confirmsOf(task!);
    expect(confirms).toHaveLength(1);
    expect(confirms[0]!.ask).toMatchObject({ kind: "confirm", onNo: "cancel" });
    await answer(h, sessionId, task!, false);
    const after = (await filedBy(h, "alice")).find((r) => r.id === task!.id);
    expect(after?.status).toBe("cancelled");
    expect(h.runs.some((run) => run.taskId === task!.id)).toBe(false);
  });

  it("after a No, the turn its cancel wakes files the same work held again; a retry of the cancelled task doesn't start it", async () => {
    const calls: string[] = [];
    const h = boot(calls);
    const sessionId = await watching(h, "alice", "watch.observe");
    await h.route(issue({ title: "Inferred [evt-52-refile]" }));
    const [first] = await filedBy(h, "alice");
    await answer(h, sessionId, first!, false);
    const tasks = await filedBy(h, "alice");
    const again = tasks.filter((r) => r.id !== first!.id);
    expect(again, "the woken turn filed it again").toHaveLength(1);
    expect(confirmsOf(again[0]!)).toHaveLength(1);
    // The cancelled one, retried: a cancel cleared its holds, so a retry would run it with no yes. Refused.
    const retried = await h.act("alice", sessionId, "retryTask_tasks", { id: first!.id });
    await h.settled();
    expect(JSON.stringify(retried.output ?? retried.error)).toContain("inferred_needs_a_yes");
    expect((await filedBy(h, "alice")).find((r) => r.id === first!.id)?.status).toBe("cancelled");
    expect(h.runs, "no attempt started without a yes").toHaveLength(0);
  });

  it("a caller's edit can't clear the marker: after a No, the woken turn's refile still waits on a yes, and no retry runs", async () => {
    const calls: string[] = [];
    const h = boot(calls);
    const sessionId = await watching(h, "alice", "watch.observe");
    await h.route(issue({ title: "Inferred [evt-55-refile]" }));
    const [first] = await filedBy(h, "alice");
    const marker = first!.metadata?.[INFERRED];
    expect(marker).toMatchObject({ as: "inferred" });
    // An edit through the task tools, clearing the marker, then forging another: the board's stands.
    await h.act("alice", sessionId, "updateTask_tasks", { id: first!.id, metadata: { [INFERRED]: null } });
    await h.act("alice", sessionId, "updateTask_tasks", { id: first!.id, metadata: { [INFERRED]: { as: "addressed", confirm: "forged" } } });
    const edited = (await filedBy(h, "alice")).find((r) => r.id === first!.id);
    expect(edited!.metadata?.[INFERRED]).toEqual(marker);
    // The user says No: the turn its cancel wakes runs as the inferred turn did, so its refile waits on their yes.
    await answer(h, sessionId, edited!, false);
    const again = (await filedBy(h, "alice")).filter((r) => r.id !== first!.id);
    expect(again, "the woken turn filed it again").toHaveLength(1);
    expect(confirmsOf(again[0]!)).toHaveLength(1);
    const retried = await h.act("alice", sessionId, "retryTask_tasks", { id: first!.id });
    await h.settled();
    expect(JSON.stringify(retried.output ?? retried.error)).toContain("inferred_needs_a_yes");
    expect(h.runs, "no attempt started without a yes").toHaveLength(0);
  });

  it("a filing can't forge the marker: an addressed turn's task carries none, an inferred turn's carries the board's", async () => {
    const h = boot();
    await watching(h, "alice", "watch.observe");
    await h.route(issue({ title: "Asked [evt-56-forge]", addressed: true }));
    await h.route(issue({ title: "Inferred [evt-57-forge]" }));
    const tasks = await filedBy(h, "alice");
    const asked = tasks.find((task) => task.goal === "Triage [evt-56-forge]");
    const inferred = tasks.find((task) => task.goal === "Triage [evt-57-forge]");
    expect(asked!.metadata?.[INFERRED]).toBeUndefined();
    expect(h.runs.some((run) => run.taskId === asked!.id)).toBe(true);
    expect(inferred!.metadata?.[INFERRED]).toMatchObject({ as: "inferred", confirm: confirmsOf(inferred!)[0]!.ask.prompt });
  });

  it("a yes releases the task as filed, and it runs", async () => {
    const h = boot();
    const sessionId = await watching(h, "alice", "watch.observe");
    await h.route(issue({ title: "Inferred [evt-53]" }));
    const [task] = await filedBy(h, "alice");
    await answer(h, sessionId, task!, true);
    expect(h.runs.some((run) => run.taskId === task!.id)).toBe(true);
  });

  it("a task the user said yes to, then cancelled mid-run, can be retried: the yes stands", async () => {
    let open!: () => void;
    const gate = new Promise<void>((resolve) => (open = resolve));
    const h = boot([], ["issue", "comment"], { holds: new Map([["gate", gate]]) });
    const sessionId = await watching(h, "alice", "watch.observe");
    await h.route(issue({ title: "Inferred [evt-54-hold]" }));
    const [task] = await filedBy(h, "alice");
    // The yes starts it; its run waits on the gate.
    const [hold] = confirmsOf(task!);
    await h.act("alice", sessionId, "updateTask_tasks", { id: task!.id, answers: hold!.id, done: true });
    for (let i = 0; i < 100 && !h.runs.some((run) => run.taskId === task!.id); i++) await new Promise((r) => setTimeout(r, 20));
    expect(h.runs.filter((run) => run.taskId === task!.id)).toHaveLength(1);
    // The user cancels it mid-run; the run then ends.
    await h.act("alice", sessionId, "updateTask_tasks", { id: task!.id, status: "cancelled" });
    open();
    await h.settled();
    expect((await filedBy(h, "alice")).find((r) => r.id === task!.id)?.status).toBe("cancelled");
    const retried = await h.act("alice", sessionId, "retryTask_tasks", { id: task!.id });
    await h.settled();
    expect(JSON.stringify(retried.output ?? retried.error)).not.toContain("inferred_needs_a_yes");
    expect(h.runs.filter((run) => run.taskId === task!.id)).toHaveLength(2);
  });
});

describe("refusedOnContent", () => {
  it("reads the screens' could-not-decide reasons, never a content refusal", () => {
    // Could not decide: never on content, so an outage forwards nothing.
    expect(refusedOnContent({ subscription: "s", pass: false, reason: "interest: unjudged" })).toBe(false);
    expect(refusedOnContent({ subscription: "s", pass: false, reason: "custom:triage: failed", failed: true })).toBe(false);
    expect(refusedOnContent({ subscription: "s", pass: false, reason: "no verdict" })).toBe(false);
    // A refusal on what the event says, and a pass, which isn't a refusal at all.
    expect(refusedOnContent({ subscription: "s", pass: false, reason: "words: none of the words export" })).toBe(true);
    // The mark decides, not the words: an app's own reason or a listed word ending in ": failed" is on content.
    expect(refusedOnContent({ subscription: "s", pass: false, reason: "custom:triage: check: failed" })).toBe(true);
    expect(refusedOnContent({ subscription: "s", pass: false, reason: "words: none of the words build: failed" })).toBe(true);
    expect(refusedOnContent({ subscription: "s", pass: true, reason: "passed the config screens" })).toBe(false);
  });
});
