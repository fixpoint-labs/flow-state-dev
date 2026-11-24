/**
 * The coder follows the pull request its run opens, and a GitHub routine can
 * ask for a judged interest, on the real Lab.
 *
 * Why these matter: asked how to make eng.coder watch its pull requests for
 * review feedback, the Shift Coordinator saved a repo-wide GitHub routine that
 * dropped every review and comment on the repository into its own
 * conversation. It did so because nothing subscribed a coding task to the pull
 * request it opened (so no review ever reached it), and because GitHub here
 * had no model to judge an interest (so the narrower routine it tried was
 * refused).
 *
 * 1. A task routed to the coder runs, and `gh` (a stub on `PATH`) lists one
 *    open pull request on the run's branch. The run's own session is then
 *    subscribed to that pull request for reviews, comments and CI, and the
 *    thread is polled, because a Lab on a laptop has no public URL to push to.
 *    Nothing subscribes the coordinator's conversation.
 * 2. Only a trusted reviewer reaches the run (FIX-2789, FIX-2873): an
 *    account on workforce's one stored list, a listed bot, or a listed user
 *    who can write to the repository, asked of GitHub when the comment
 *    arrives. `GITHUB_REVIEWERS` is the list's default until it is first
 *    saved; a save, an empty one included, applies to the next comment with no
 *    restart. A listed bot is heard on the run's follow and on no other
 *    subscription. The run acts on what it hears with Bash and a push, so this
 *    is who can steer it.
 * 3. A GitHub event routine listing the `interest` screen is saved, not
 *    refused with `no_interest_model`.
 *
 * GitHub's REST API is a local stub (`githubApiUrl`); best fit is scripted;
 * the coder's harness is the harness stub.
 */
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type {
  FlowInstance,
  GeneratorModel,
  ModelResolver,
} from "@flow-state-dev/core/types";
import { inMemoryStores, runAction } from "@flow-state-dev/engine";
import { createInboundTransportHost } from "@flow-state-dev/engine/host";
import { routeServiceEvent } from "@flow-state-dev/engine/internal";
import type { SubscriptionEvent } from "@flow-state-dev/core/types";
import { harnessStub } from "@flow-state-dev/harness-manager";
import { ROSTER_FLOW } from "@flow-state-dev/workforce/browser";
import { GITHUB_REVIEWERS_DOC, githubReviewersDocument } from "@flow-state-dev/workforce";
import {
  LAB_ORG_ID,
  LAB_USER_ID,
  openLab,
  type Lab,
} from "../teams/devteam/host.mts";
import { createBareRemote } from "../teams/devteam/scratch-repo.mts";

const SHIFT_COORDINATOR = "shift-coordinator";
const CODER = "eng.coder";
const STOREFRONT = { visibility: "shared", id: "storefront" } as const;
const PR_URL = "https://github.com/acme/storefront/pull/7";
const PR_THREAD = "github:acme/storefront#7";
const REPO_THREAD = "github:acme/storefront";

const dirs: string[] = [];
/** Each login's permission on acme/storefront, as GitHub answers it. */
const PERMISSIONS: Record<string, string> = { alice: "write", bob: "admin", carol: "read" };
/** Every permission GitHub was asked, with the token it was asked with. */
const permissionAsks: string[] = [];
const PATH = process.env.PATH;
let api: Server;
let apiUrl: string;

beforeAll(async () => {
  // `gh`, as the run's branch check and the pull-request wait ask it: one open pull request, opened just now.
  const bin = mkdtempSync(join(tmpdir(), "devteam-follow-gh-"));
  dirs.push(bin);
  writeFileSync(
    join(bin, "gh"),
    `#!/usr/bin/env node
const path = process.argv.slice(2).find((a) => a.startsWith("repos/")) ?? "";
const pr = { number: 7, html_url: ${JSON.stringify(PR_URL)}, title: "Cart badge", state: "open", draft: false, merged: false, merged_at: null, created_at: new Date().toISOString(), head: { ref: "b", sha: "abc", repo: { full_name: "acme/storefront" } }, base: { repo: { full_name: "acme/storefront" } } };
process.stdout.write(JSON.stringify(path.includes("/pulls?") ? [pr] : pr));
`,
  );
  chmodSync(join(bin, "gh"), 0o755);
  process.env.PATH = `${bin}${delimiter}${PATH ?? ""}`;
  // The list's default, read when the Lab opens.
  vi.stubEnv("GITHUB_REVIEWERS", "alice,greptile-apps[bot]");
  // GitHub's REST API, as the routines' provider reads it with the operator's token: the repository is readable,
  // and each login's permission on it is what PERMISSIONS says (none: not a collaborator).
  api = createServer((req, res) => {
    const path = (req.url ?? "").split("?")[0]!;
    const asked = /^\/repos\/acme\/storefront\/collaborators\/([^/]+)\/permission$/.exec(path)?.[1];
    if (asked !== undefined) permissionAsks.push(`${asked} ${req.headers.authorization}`);
    const body =
      path === "/repos/acme/storefront"
        ? { full_name: "acme/storefront" }
        : path === "/user"
          ? { login: "jake" }
          : asked !== undefined && PERMISSIONS[asked] !== undefined
            ? { permission: PERMISSIONS[asked], role_name: PERMISSIONS[asked] }
            : undefined;
    res.writeHead(body === undefined ? 404 : 200, {
      "content-type": "application/json",
    });
    res.end(JSON.stringify(body ?? { message: "Not Found" }));
  });
  await new Promise<void>((resolve) => api.listen(0, "127.0.0.1", resolve));
  apiUrl = `http://127.0.0.1:${(api.address() as AddressInfo).port}`;
});

afterAll(async () => {
  process.env.PATH = PATH;
  vi.unstubAllEnvs();
  await new Promise((resolve) => api.close(resolve));
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
});

let opened: Lab | undefined;
afterEach(async () => {
  await opened?.dispose();
  opened = undefined;
});

/** Best fit's evaluation: the coder, sure of it. The coder's judge, `done`. */
const route = {
  specificationVersion: "v4",
  provider: "test",
  modelId: "test/route",
  supportedQuestionTypes: ["choice", "score", "boolean"],
  async doEvaluate(call: { questions: Record<string, unknown> }) {
    const judging = "verdict" in call.questions;
    return {
      answers: judging
        ? {
            verdict: { type: "choice", choice: "done" },
            why: { type: "choice", choice: "off-target" },
          }
        : { worker: { type: "choice", choice: CODER } },
      usage: { inputTokens: 1, outputTokens: 1 },
      warnings: [],
      providerMetadata: {
        typesafe: {
          confidence: judging ? { verdict: 0.95 } : { worker: 0.95 },
        },
      },
    };
  },
};

/** No block in this test should reach a generator model. */
const models = Object.assign(
  (_id: string, block?: string): GeneratorModel => {
    throw new Error(`no model in this test (asked for ${block ?? "a block"})`);
  },
  { resolveId: (id: string) => id, resolveEvaluationModel: () => route },
) as unknown as ModelResolver;

async function act(
  lab: Lab,
  flow: string,
  sessionId: string,
  actionName: string,
  input: unknown,
) {
  const runtime = await lab.state.getRuntime();
  return (await runAction({
    orgId: LAB_ORG_ID,
    flow: runtime.registry.get(flow) as FlowInstance,
    actionName,
    input,
    userId: LAB_USER_ID,
    sessionId,
    stores: runtime.stores,
    runtimeConfig: runtime.runtimeConfig,
  } as never)) as { output?: any; error?: unknown };
}

/** Polls `check` until it returns a value. */
async function eventually<T>(
  check: () => Promise<T | undefined>,
  what: string,
  ms = 30_000,
): Promise<T> {
  for (const until = Date.now() + ms; ; ) {
    const value = await check();
    if (value !== undefined) return value;
    if (Date.now() > until) throw new Error(`timed out waiting for ${what}`);
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}

async function openFollowingLab(name: string): Promise<Lab> {
  const remote = createBareRemote(name, {
    seed: { "README.md": "storefront\n" },
  });
  const root = mkdtempSync(join(tmpdir(), `${name}-`));
  dirs.push(root);
  opened = await openLab({
    modelResolver: models,
    stores: inMemoryStores(),
    harness: harnessStub({ finalMessage: `Opened ${PR_URL}` }).slot,
    runTimeoutMs: 30_000,
    workspace: { root, remotes: { allow: ["file"] } },
    coderWorkerId: CODER,
    inventory: true,
    projects: [
      { id: STOREFRONT.id, title: "Storefront", repository: remote.url },
    ],
    githubToken: "operator-token",
    githubApiUrl: apiUrl,
  });
  return opened;
}

type Entry = Record<string, any>;
const storedUnder = async (lab: Lab, prefix: string) =>
  Object.values(await lab.stored("user", prefix)) as Entry[];

/** Route "open a PR" to the coder, and wait for its task to hold on the pull request its run opened. */
async function coderOpensPullRequest(lab: Lab) {
  const conversation = `s-shift-coordinator-${globalThis.crypto.randomUUID()}`;
  const created = await lab.door("POST", "coordinator/sessions", {
    body: {
      userId: LAB_USER_ID,
      sessionId: conversation,
      state: { workerId: SHIFT_COORDINATOR },
    },
  });
  expect(created.status).toBe(201);
  expect(
    (
      await act(lab, "coordinator", conversation, "setWorkProject", {
        project: STOREFRONT,
      })
    ).error,
  ).toBeUndefined();
  expect(
    (
      await act(lab, "coordinator", conversation, "respond", {
        message: "Fix the cart badge and open a PR.",
      })
    ).error,
  ).toBeUndefined();

  // The run opened #7: its task waits on it (`awaitPullRequests`), so it neither completes nor fails.
  const task = await eventually(async () => {
    const found = (await storedUnder(lab, "tasks/")).find(
      (r) => r.assignee === CODER,
    );
    const waiting = found?.holds?.some((h: Entry) =>
      h.source?.closedBy?.some(
        (c: Entry) => c.key === "github.com/acme/storefront/7",
      ),
    );
    return waiting === true ? found : undefined;
  }, "the coder's task to wait on pull request #7");
  return { task, conversation };
}

describe("the coder follows the pull request its run opens", () => {
  it("subscribes the run's session to the pull request, and polls it", async () => {
    const lab = await openFollowingLab("coder-follows-pr");
    const { task, conversation } = await coderOpensPullRequest(lab);
    const subscriptions = await storedUnder(lab, "workforce/subscriptions/");
    // Exactly one: the run's own session on #7. Never the coordinator's conversation, never the whole repository.
    // Only a trusted reviewer is heard: the run acts on what it hears, with Bash and a push.
    expect(
      subscriptions.map((s) => ({
        session: s.sessionId,
        thread: s.thread,
        kinds: s.kinds,
        screens: s.screens,
        outsiders: s.outsiders,
        botsScreenedBy: s.botsScreenedBy,
        enabled: s.enabled,
        taskId: s.taskId,
      })),
    ).toEqual([
      {
        session: task.run.sessionId,
        thread: PR_THREAD,
        kinds: ["review", "comment", "check"],
        screens: [{ screen: "custom", name: "github-reviewers" }],
        // The list screen decides who outside the project is heard, and which bots.
        outsiders: true,
        botsScreenedBy: "github-reviewers",
        enabled: true,
        // The coder's task: its failure or cancel ends the follow, so a failed run stops hearing its pull request.
        taskId: task.id,
      },
    ]);
    expect(
      subscriptions.some(
        (s) => s.sessionId === conversation || s.thread === REPO_THREAD,
      ),
    ).toBe(false);
    // Polled: on a laptop no webhook reaches the Lab, so the poll is the only way a review arrives.
    const polls = await storedUnder(lab, "workforce/subscription-polls/");
    expect(polls.map((p) => p.input?.thread)).toEqual([PR_THREAD]);
  }, 120_000);

  it("ends the follow when the coder's task is cancelled, so a run nobody waits on stops hearing its pull request", async () => {
    const lab = await openFollowingLab("coder-follow-ends-with-task");
    const { task, conversation } = await coderOpensPullRequest(lab);
    // The run's session works the conversation's tasks, not this one alone: the follow names the task itself.
    const cancelled = await act(lab, "coordinator", conversation, "updateTask_tasks", { id: task.id, status: "cancelled" });
    expect(cancelled.error).toBeUndefined();
    const ended = await eventually(async () => {
      const [follow] = await storedUnder(lab, "workforce/subscriptions/");
      return follow?.enabled === false ? follow : undefined;
    }, "the follow on #7 to end");
    expect({ thread: ended.thread, endedReason: ended.endedReason }).toEqual({ thread: PR_THREAD, endedReason: "task_cancelled" });
  }, 120_000);
});

let commentSeq = 0;
/** A comment on #7 (or `thread`), as GitHub's normalizer gives it. */
function commentFrom(login: string, role: SubscriptionEvent["sender"]["role"] = "member", thread = PR_THREAD): SubscriptionEvent {
  commentSeq += 1;
  return {
    provider: "github",
    threads: [REPO_THREAD, thread],
    kind: "comment",
    object: { id: `comment-${commentSeq}`, version: 1 },
    sender: { id: login, name: login, role },
    audience: "public",
    title: "Comment on #7",
    text: `Please rename the badge (${login}).`,
    labels: [],
    url: `${PR_URL}#issuecomment-${commentSeq}`,
    received: Date.now(),
    at: Date.now(),
  };
}

/** Route one GitHub event as an ingestion would: the verdict on the run's follow, and whether it was delivered to the run. */
async function routeGitHub(lab: Lab, event: SubscriptionEvent) {
  const runtime = await lab.state.getRuntime();
  const host = createInboundTransportHost({
    registry: runtime.registry,
    stores: runtime.stores,
    runtimeConfig: runtime.runtimeConfig,
    resolvePrincipal: async () => null,
  } as never);
  const routed = await routeServiceEvent(host, {
    flowKind: "github-service",
    entry: "routeSubscriptionEvent",
    input: event,
    principal: { userId: "service:github", orgId: LAB_ORG_ID },
  });
  expect(routed.error, JSON.stringify(routed.error)).toBeUndefined();
  const runs = (await Promise.all(routed.ownerRuns.map((run) => run.finished))) as { output?: { act?: string } }[];
  const [verdict] = (routed.output as { verdicts: { subscription: string; pass: boolean; reason: string; failed?: true }[] }).verdicts;
  // Delivered: the follow's own delivery, run as the operator, sent the comment on to the run.
  return { verdict, delivered: runs.some((run) => run.output?.act === "sent") };
}

/** Save the list as the Shift Coordinator's approved edit leaves it: the stored row the document reads from then on. */
async function save(lab: Lab, logins: string[]) {
  const runtime = await lab.state.getRuntime();
  await (runtime.stores as any).content.set("org", LAB_ORG_ID, GITHUB_REVIEWERS_DOC, githubReviewersDocument(logins));
}

describe("who can steer the coder through its pull request", () => {
  it("a listed bot, or a listed user who can write: GITHUB_REVIEWERS until saved, then the saved list, an empty one included", async () => {
    const lab = await openFollowingLab("coder-trusted-reviewers");
    await coderOpensPullRequest(lab);
    // An ordinary GitHub routine of the Shift Coordinator's, on another pull request, with no list screen.
    const saved = await act(lab, ROSTER_FLOW, `roster-${globalThis.crypto.randomUUID()}`, "saveRoutine", {
      worker: SHIFT_COORDINATOR,
      trigger: { event: { provider: "github", thread: "github:acme/storefront#8", kinds: ["comment"], interest: "Comments on #8." } },
    });
    expect(saved.output, JSON.stringify(saved.output)).toMatchObject({ ok: true });
    const heard = async (login: string, role?: SubscriptionEvent["sender"]["role"]) => (await routeGitHub(lab, commentFrom(login, role))).delivered;

    // Nothing saved: the setting is the list.
    permissionAsks.length = 0;
    expect(await heard("alice"), "nothing saved: alice (a writer) heard").toBe(true);
    expect(permissionAsks.length > 0 && permissionAsks.every((ask) => ask === "alice Bearer operator-token"), "a listed user is asked of GitHub, with the operator's token").toBe(true);
    expect(await heard("greptile-apps", "bot"), "nothing saved: the listed bot heard").toBe(true);
    expect(await heard("bob"), "nothing saved: bob refused").toBe(false);
    expect(await heard("greptile-apps", "outsider"), "a user named like the listed bot refused").toBe(false);
    // The listed bot on #8, which only the ordinary routine follows: it has no list screen, so nothing wakes.
    const elsewhere = await routeGitHub(lab, commentFrom("greptile-apps", "bot", "github:acme/storefront#8"));
    expect(elsewhere.delivered, "ordinary subscription not woken").toBe(false);
    expect(elsewhere.verdict?.reason).toMatch(/bot "greptile-apps"/);

    // Saved empty: nobody, whatever the setting says.
    await save(lab, []);
    expect(await heard("alice"), "save []: alice refused").toBe(false);
    expect(await heard("greptile-apps", "bot"), "save []: the bot refused").toBe(false);

    // Saved with others: heard on the next comment, with no restart. A listed reader isn't.
    await save(lab, ["bob", "carol", "cursor[bot]"]);
    expect(await heard("bob"), "saved: bob heard").toBe(true);
    expect(await heard("cursor", "bot"), "saved: cursor[bot] heard").toBe(true);
    const carol = await routeGitHub(lab, commentFrom("carol"));
    expect([carol.verdict?.reason, carol.delivered], "listed reader-only carol refused").toEqual(['custom:github-reviewers: "carol" can\'t write to acme/storefront', false]);
    expect(await heard("alice"), "alice, no longer listed, refused").toBe(false);
  }, 120_000);
});

describe("a GitHub routine that asks for a judged interest", () => {
  it("is saved, with the interest screen, not refused for want of a model", async () => {
    const lab = await openFollowingLab("github-interest-routine");
    const roster = `roster-${globalThis.crypto.randomUUID()}`;
    const saved = await act(lab, ROSTER_FLOW, roster, "saveRoutine", {
      worker: SHIFT_COORDINATOR,
      trigger: {
        event: {
          provider: "github",
          thread: REPO_THREAD,
          kinds: ["review", "comment"],
          screens: [{ screen: "interest" }],
          interest: "Review feedback on pull requests eng.coder opened.",
        },
      },
    });
    expect(saved.error).toBeUndefined();
    expect(saved.output, JSON.stringify(saved.output)).toMatchObject({
      ok: true,
    });
    const routines = await storedUnder(lab, "workforce/subscriptions/");
    expect(
      routines.map((r) => ({ thread: r.thread, screens: r.screens })),
    ).toEqual([{ thread: REPO_THREAD, screens: [{ screen: "interest" }] }]);
  }, 120_000);
});
