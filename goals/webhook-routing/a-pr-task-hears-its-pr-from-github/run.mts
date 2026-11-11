/** What this run proves is `goal.md` beside this file. */
import { createHmac } from "node:crypto";
import { spawnSync } from "node:child_process";
import { readFileSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { defineFlow, defineWebhookBinding, handler, sequencer } from "@flow-state-dev/core";
import {
  OBSERVED_PULL_REQUESTS,
  followRecordedPullRequests,
  observedPullRequestsCollection,
  pullRequestWritesSettled,
  recordPullRequests
} from "@flow-state-dev/core/harness";
import type { FlowInstance, SubscriptionEvent } from "@flow-state-dev/core/types";
import { createFlowState, createWebhookTransportAdapter, githubWebhookVerifier, inMemoryStores, runAction } from "@flow-state-dev/engine";
import { routeServiceEvent } from "@flow-state-dev/engine/internal";
import type { InboundTransportHost } from "@flow-state-dev/engine/host";
import { createMockModelResolver } from "@flow-state-dev/testing";
import {
  ROSTER_FLOW,
  SUBSCRIPTIONS_PATTERN,
  WORKER_MESSAGES_PATTERN,
  createWorkerInstallation,
  followPullRequest,
  githubServiceFlow,
  hireWorkforce,
  messageReceivedEntry,
  normalizeGitHubEvent,
  subscribe,
  subscriptionResources,
  workerConfigSchema,
  workerMessagesResources,
  workerTaskEntry,
  type GitHubSubscriptionProvider,
  type WorkerManifest
} from "@flow-state-dev/workforce";
import { z } from "zod";
import { REPO_ROOT, goalTmpDir, runGoal, silentLogger } from "../../lib/index.mts";
import { assertPatched, describePatches, modulePatchEnv, type ModulePatch } from "../../lib/module-patch.mts";

const HERE = dirname(fileURLToPath(import.meta.url));
const ORG = "acme";
const SECRET = "goal-webhook-secret";
const CONTROL = process.env.GOAL_CONTROL ?? "";
const SCRATCH = process.env.GOAL_SCRATCH ?? goalTmpDir("webhook-routing-github");

/** The controls that degrade production code as it loads. `session-id` swaps the flow instead (below). */
const PATCHES: Record<string, ModulePatch[]> = {
  // An object's version read from the delivery's arrival, not from GitHub's own time.
  "version-from-delivery": [
    {
      module: "packages/workforce/src/service-flows/github/normalize.ts",
      from: String.raw`object: \{ id: parts\.id, version: parts\.version \},`,
      to: "object: { id: parts.id, version: input.received },"
    }
  ],
  // The session subscribes when its turn ends, not when its record is written.
  "subscribe-at-turn-end": [
    {
      module: "packages/core/src/helpers/pull-request-recorder.ts",
      from: String.raw`whenPullRequestRecorded\(response, follow\);`,
      to: "whenPullRequestRecorded(response, (pr) => void onRequestEnded(ctx as never, () => follow(pr)));"
    }
  ]
};
const CONTROLS = [...Object.keys(PATCHES), "session-id"];
if (CONTROL !== "" && !CONTROLS.includes(CONTROL)) {
  console.error(`unknown GOAL_CONTROL "${CONTROL}"; known: ${CONTROLS.join(", ")}`);
  process.exit(2);
}
if (PATCHES[CONTROL] !== undefined && process.env.GOAL_MODULE_PATCH === undefined) {
  const mark = join(SCRATCH, `patch-mark-${CONTROL}`);
  rmSync(mark, { force: true });
  console.error(`control ${CONTROL}:\n${describePatches(PATCHES[CONTROL]!, REPO_ROOT)}`);
  const child = spawnSync(process.execPath, [...process.execArgv, ...process.argv.slice(1)], {
    stdio: "inherit",
    env: { ...process.env, GOAL_SCRATCH: SCRATCH, ...modulePatchEnv(PATCHES[CONTROL]!, REPO_ROOT, mark) }
  });
  assertPatched(PATCHES[CONTROL]!, REPO_ROOT, mark);
  process.exit(child.status ?? 1);
}

// ---- the fixture ------------------------------------------------------------

type Delivery = { label: string; event: string; payload: Record<string, any> };
type ApiForm = { label: string; timelineEvent: Record<string, any>; pullRequest: Record<string, any>; repository: Record<string, any> };
const { deliveries: DELIVERIES, apiForms: API_FORMS } = JSON.parse(readFileSync(join(HERE, "fixtures/deliveries.json"), "utf8")) as {
  deliveries: Delivery[];
  apiForms: ApiForm[];
};
const byLabel = (label: string) => DELIVERIES.find((d) => d.label === label)!;
const TRUSTED_BOTS = ["github-actions", "codex"];
const PR_THREAD = "github:acme/api#412";
const REPO_THREAD = "github:acme/api";

// ---- the app ----------------------------------------------------------------

const modelCalls: string[] = [];
/** GitHub, as the app's token answers for each user: both can read acme/api; each one's own login is `<user>-gh`. */
const github: GitHubSubscriptionProvider = {
  provider: "github",
  canRead: (thread) => thread.startsWith("github:acme/api"),
  self: (ctx) => `${(ctx.session.identity as { userId: string }).userId}-gh`
};

const installationFlows: Record<string, unknown> = {};
const installation = createWorkerInstallation({
  standardWorkers: [{ id: "eng.coder", declared: { flow: "coder", description: "Opens pull requests." }, body: "", skills: [] } as WorkerManifest],
  workerFlows: () => installationFlows as never
});
const follower = followPullRequest({ providers: [github] });

// The coding turn, on the seam a coding task's harness step uses: the follower is
// registered before the harness runs, the harness's tool calls are recorded as they
// settle, a `gh pr create` opens #412, and CI completes before the turn ends.
let duringTurn: () => Promise<void> = async () => undefined;
const startTurn = handler({
  name: "coding-turn-start",
  resources: { [OBSERVED_PULL_REQUESTS]: observedPullRequestsCollection },
  execute: (input: unknown, ctx) => {
    followRecordedPullRequests(ctx, follower);
    recordPullRequests(ctx);
    return input;
  }
});
const bash = handler({
  name: "bash",
  inputSchema: z.object({ command: z.string() }),
  outputSchema: z.object({ stdout: z.string() }),
  execute: async () => ({ stdout: "https://github.com/acme/api/pull/412\n" })
}).asTool();
const ciLands = handler({
  name: "ci-lands",
  execute: async (_input: unknown, ctx) => {
    // The record is written as the create call settles; CI completes after that, still inside the turn.
    await pullRequestWritesSettled(ctx.response);
    await duringTurn();
    return "done";
  }
});
const codingTurn = sequencer({ name: "coding-turn", inputSchema: z.object({ command: z.string() }) }).tap(startTurn).step(bash).step(ciLands);
// A repository watcher subscribes the way any worker does.
const follow = handler({
  name: "follow-repo",
  inputSchema: z.object({ thread: z.string() }),
  resources: subscriptionResources,
  execute: async (input, ctx) => subscribe(ctx, [github], { provider: "github", thread: input.thread, interest: "everything on the repository" })
});
const doorInput = z.object({ message: z.string() });
const door = handler({ name: "coder-door", inputSchema: doorInput, execute: async () => "ok" });
installationFlows.coder = {
  roles: ["contributor"],
  flow: defineFlow({
    kind: "coder",
    configSchema: workerConfigSchema(),
    session: installation.session(),
    resources: { ...installation.resources, ...workerMessagesResources, ...subscriptionResources, [OBSERVED_PULL_REQUESTS]: observedPullRequestsCollection },
    actions: {
      respond: { inputSchema: doorInput, block: door, userMessage: (i: { message: string }) => i.message },
      turn: { inputSchema: z.object({ command: z.string() }), block: codingTurn },
      follow: { inputSchema: z.object({ thread: z.string() }), block: follow }
    },
    // No turn on a message: it lands as its items and nothing runs, so no model is asked.
    internal: { actions: { onMessageReceived: messageReceivedEntry({ installation, flowKind: "coder" }) } },
    task: { actions: { work: workerTaskEntry({ name: "coder-task", turn: door }) } }
  })
};
const instances: Record<string, FlowInstance> = Object.fromEntries(
  hireWorkforce(installation).map((copy) => [copy.id === ROSTER_FLOW ? "roster" : copy.id, copy])
);

// Today's binding, under `session-id`: each review lands in a session named for its pull request.
const bindingHits: string[] = [];
const bindingHandler = handler({
  name: "github-binding",
  inputSchema: z.object({ label: z.string() }),
  execute: async (input) => void bindingHits.push(input.label)
});
const toBinding = (e: { payload: any }) => ({ label: String(e.payload?.action ?? "") });
const prNumber = (e: { payload: any }) => `pr-${e.payload?.pull_request?.number ?? e.payload?.issue?.number ?? e.payload?.check_run?.pull_requests?.[0]?.number}`;
instances["github-service"] =
  CONTROL === "session-id"
    ? defineFlow({
        kind: "github-service",
        actions: {},
        webhooks: {
          github: {
            on: Object.fromEntries(
              ["pull_request_review", "pull_request_review_comment", "issue_comment", "check_run", "pull_request"].map((name) => [
                name,
                defineWebhookBinding({ block: bindingHandler, input: toBinding, sessionId: prNumber })
              ])
            )
          }
        }
      })()
    : githubServiceFlow({ provider: github, installation, trustedBots: TRUSTED_BOTS, capPerHour: 10_000 });

const mocks = createMockModelResolver({});
const modelResolver = Object.assign((modelId: string, blockName?: string) => {
  modelCalls.push(`${modelId} for ${blockName ?? "?"}`);
  return (mocks as any)(modelId, blockName);
}, mocks);

// The webhook transport, mounted as a host mounts it. Its host can be told to fail one
// owner run's recording, as a crash partway through a fan-out would.
let failOwnerRunsOf: string | undefined;
let captured: InboundTransportHost | undefined;
const webhook = createWebhookTransportAdapter({
  providers: {
    github: {
      verify: githubWebhookVerifier(SECRET),
      eventType: (_payload, headers) => headers.get("x-github-event"),
      deliveryId: (_payload, headers) => headers.get("x-github-delivery") ?? undefined
    }
  }
});
const stores = inMemoryStores();
const state = createFlowState({
  flows: instances,
  stores: { default: { primary: stores } },
  modelResolver,
  logger: silentLogger,
  resolvePrincipal: (context: any) => {
    const user = context.request?.headers.get("x-user");
    if (typeof user === "string") return { userId: user, orgId: ORG };
    // A verified webhook runs as the app's system user, in its org.
    return context.source === "webhook" ? { userId: "github-app", orgId: ORG } : null;
  },
  adapters: [
    {
      source: "webhook",
      createBindings: (h: InboundTransportHost) => {
        captured = h;
        const crashing: InboundTransportHost = {
          ...h,
          dispatch: (envelope) => {
            if (failOwnerRunsOf !== undefined && envelope.metadata?.ownerRun !== undefined && envelope.principal.userId === failOwnerRunsOf) {
              failOwnerRunsOf = undefined;
              throw new Error("the host stopped before recording this run");
            }
            return h.dispatch(envelope);
          }
        };
        return webhook.createBindings(crashing);
      }
    }
  ]
} as never);
const router = (await state.getRouter()) as any;
const runtime = await state.getRuntime();

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
async function settled(): Promise<void> {
  const running = (r: { status: string; finalizedAtMs?: number | null }) =>
    r.status === "in_progress" || (r.status !== "suspended" && r.status !== "pending" && r.finalizedAtMs == null);
  for (const deadline = Date.now() + 20_000; ; await sleep(10)) {
    const all = await runtime.stores.request.list({});
    if (!all.some(running)) {
      await sleep(10);
      const again = await runtime.stores.request.list({});
      if (!again.some(running) && again.length === all.length) return;
    }
    if (Date.now() > deadline) throw new Error("setup: a request never finished");
  }
}

let deliveryCount = 0;
/** POST one delivery to the real webhook route, signed (or not) as GitHub signs it. */
async function post(delivery: Delivery, options: { secret?: string } = {}): Promise<number> {
  const raw = JSON.stringify(delivery.payload);
  const signature = `sha256=${createHmac("sha256", options.secret ?? SECRET).update(raw).digest("hex")}`;
  deliveryCount += 1;
  const req = new Request("http://localhost/api/flows/github-service/webhooks/github", {
    method: "POST",
    headers: { "content-type": "application/json", "x-github-event": delivery.event, "x-github-delivery": `delivery-${deliveryCount}`, "x-hub-signature-256": signature },
    body: raw
  });
  const res = (await router.POST(req, { params: { path: ["github-service", "webhooks", "github"] } })) as Response;
  // Each delivery arrives at its own millisecond, so a version read from arrival differs.
  await sleep(3);
  return res.status;
}

async function createCoder(user: string): Promise<string> {
  const request = new Request("http://localhost/api/flows/coder/sessions", {
    method: "POST",
    headers: { "content-type": "application/json", "x-user": user },
    body: JSON.stringify({ userId: user, state: { workerId: "eng.coder" } })
  });
  const res = await router.POST(request, { params: { path: ["coder", "sessions"] } });
  const body = (await res.json()) as { session?: { id: string } };
  if (body.session === undefined) throw new Error(`setup: creating ${user}'s coder failed (${res.status}): ${JSON.stringify(body)}`);
  return body.session.id;
}
const act = async (user: string, sessionId: string, action: string, input: unknown) =>
  (await runAction({
    flow: instances.coder!,
    actionName: action,
    input,
    userId: user,
    orgId: ORG,
    sessionId,
    stores: runtime.stores,
    runtimeConfig: { ...runtime.runtimeConfig }
  })) as { output?: any; error?: unknown };

/** One user's stored messages from the service, by session, keyed `<object>@<version>`. */
async function landed(user: string): Promise<Array<{ session: string; key: string; status: string }>> {
  const entries = await runtime.stores.resourceState.getByPrefix("user", `${user}:~org:${ORG}`, WORKER_MESSAGES_PATTERN.replace("*", ""));
  return Object.values(entries).flatMap((value) => {
    const message = value.state as { id: string; from: string; toSession: string; status: string };
    if (!message.from.startsWith("service:")) return [];
    const base = message.id.endsWith(`:${message.toSession}`) ? message.id.slice(0, -(message.toSession.length + 1)) : message.id;
    const [object, version] = base.slice("sub_".length).split("@");
    return [{ session: message.toSession, key: `${decodeURIComponent(object!)}@${version}`, status: message.status }];
  });
}

// ---- the run ----------------------------------------------------------------

const statuses: Record<string, number[]> = {};
const record = (label: string, status: number) => (statuses[label] ??= []).push(status);

const task = await createCoder("alice");
const watcher = await createCoder("bob");
const watched = await act("bob", watcher, "follow", { thread: REPO_THREAD });
if (watched.output?.id === undefined) throw new Error(`setup: the watcher's subscribe failed: ${JSON.stringify(watched.output ?? watched.error)}`);

// The opening turn: it records #412 and, before it ends, CI completes.
duringTurn = async () => {
  record("ci-during-turn", await post(byLabel("ci-during-turn")));
};
const turn = await act("alice", task, "turn", { command: "gh pr create --fill" });
if (turn.error !== undefined) throw new Error(`setup: the coding turn failed: ${JSON.stringify(turn.error)}`);
await settled();
const afterTurn = await landed("alice");

// The rest, in order. The member's review crashes partway through its fan-out the first time.
for (const delivery of DELIVERIES.slice(1)) {
  if (delivery.label === "member-review") failOwnerRunsOf = "bob";
  record(delivery.label, await post(delivery));
  await settled();
  if (delivery.label === "member-review") {
    record("member-review", await post(delivery));
    await settled();
  }
}
const firstPass = { alice: await landed("alice"), bob: await landed("bob") };

// Every delivery again, as GitHub's redeliver button sends it; and one with a forged signature.
for (const delivery of DELIVERIES) record(`again:${delivery.label}`, await post(delivery));
await settled();
const forged = await post(byLabel("member-review"), { secret: "not-the-secret" });
// The poll's form of the two review requests, routed as a poll routes it.
const apiEvents = API_FORMS.flatMap((form) =>
  normalizeGitHubEvent({
    eventType: "pull_request",
    payload: {
      action: "review_requested",
      repository: form.repository,
      sender: form.timelineEvent.actor,
      requested_reviewer: form.timelineEvent.requested_reviewer,
      // The timeline event's time is the occurrence's; the pull request's own has moved on.
      pull_request: { ...form.pullRequest, updated_at: form.timelineEvent.created_at }
    },
    received: Date.now()
  })
);
if (CONTROL !== "session-id") {
  for (const input of apiEvents) {
    const routed = await routeServiceEvent(captured!, { flowKind: "github-service", entry: "routeSubscriptionEvent", input, principal: { userId: "service:github", orgId: ORG } });
    await Promise.all(routed.ownerRuns.map((run) => run.finished));
  }
}
await settled();
const final = { alice: await landed("alice"), bob: await landed("bob") };

// ---- the oracle: the spec's rules over the fixture, written again here ---------

type Expected = { label: string; key: string; kind: string; thread: string; afterClose: boolean };
function expectedEvents(): Expected[] {
  const out: Expected[] = [];
  let closed = false;
  for (const d of DELIVERIES) {
    const p = d.payload;
    const t = (s: string) => Date.parse(s);
    let kind: string, key: string, role: string, sender: string;
    const assoc = (a: string | undefined, type?: string) =>
      type === "Bot" ? "bot" : a === "OWNER" || a === "MEMBER" ? "member" : a === "COLLABORATOR" ? "collaborator" : a === undefined ? "unknown" : "outsider";
    if (d.event === "check_run") {
      kind = "check";
      key = `check_run:${p.check_run.id}@${t(p.check_run.completed_at)}`;
      role = "bot";
      sender = p.check_run.app.slug;
    } else if (d.event === "pull_request_review") {
      kind = "review";
      key = `review:${p.review.id}@${t(p.review.submitted_at)}`;
      role = assoc(p.review.author_association, p.sender.type);
      sender = p.sender.login;
    } else if (d.event === "pull_request_review_comment" || d.event === "issue_comment") {
      kind = "comment";
      key = `${d.event === "issue_comment" ? "issue_comment" : "review_comment"}:${p.comment.id}@${t(p.comment.updated_at)}`;
      role = assoc(p.comment.author_association, p.sender.type);
      sender = p.sender.login;
    } else {
      kind = "pull_request";
      const subject = p.action === "review_requested" ? p.requested_reviewer.login : "";
      key = `pull_request:${PR_THREAD}:${p.action}:${subject}@${t(p.action === "closed" ? p.pull_request.closed_at : p.pull_request.updated_at)}`;
      role = p.sender.login === p.pull_request.user.login ? assoc(p.pull_request.author_association) : "unknown";
      sender = p.sender.login;
    }
    const id = sender.toLowerCase().replace(/\[bot\]$/, "");
    const passesSender = role === "member" || role === "collaborator" || (role === "bot" && TRUSTED_BOTS.includes(id));
    if (passesSender) out.push({ label: d.label, key, kind, thread: PR_THREAD, afterClose: closed });
    void sender;
    if (d.event === "pull_request" && p.action === "closed") closed = true;
  }
  return out;
}
const EXPECTED = expectedEvents();
/** The task follows #412 for reviews, comments and CI, until it closes; its own comments are dropped. */
const taskWants = EXPECTED.filter((e) => ["review", "comment", "check"].includes(e.kind) && !e.afterClose && !e.label.startsWith("own")).map((e) => e.key);
/** The watcher follows the whole repository, every kind, through the close. */
const watcherWants = EXPECTED.map((e) => e.key);
const sorted = (xs: string[]) => [...xs].sort();
const keysIn = (messages: Array<{ session: string; key: string }>, session: string) => messages.filter((r) => r.session === session).map((r) => r.key);

await runGoal(async (failures, tell) => {
  // (a) The task's messages from service:github equal the expected set, each delivered.
  tell.over("a · expected deliveries to the task", taskWants);
  const taskGot = tell.over("a · the task's messages", keysIn(final.alice, task));
  if (JSON.stringify(sorted(taskGot)) !== JSON.stringify(sorted(taskWants))) {
    failures.push(
      `a: the task has ${taskGot.length} message(s) for ${taskWants.length} expected (missing ${taskWants.filter((k) => !taskGot.includes(k)).join(", ") || "none"}; extra ${taskGot.filter((k) => !taskWants.includes(k)).join(", ") || "none"})`
    );
  }
  const undelivered = final.alice.filter((r) => r.session === task && r.status !== "delivered");
  if (undelivered.length > 0) failures.push(`a: ${undelivered.length} of the task's messages not delivered (${undelivered[0]!.status})`);
  if (statuses["ci-during-turn"]?.[0] !== 202) failures.push(`a: the CI delivery during the turn answered ${statuses["ci-during-turn"]?.[0]}`);

  // (b) The check completed before the opening turn ended is heard, before any redelivery.
  const ciKey = EXPECTED.find((e) => e.label === "ci-during-turn")!.key;
  const heardByTurnEnd = tell.over("b · the task's messages when the turn ended", keysIn(afterTurn, task), { emptyIs: "nothing when the check was lost" });
  if (!heardByTurnEnd.includes(ciKey) && !keysIn(firstPass.alice, task).includes(ciKey)) failures.push(`b: the check that completed during the opening turn (${ciKey}) was never heard`);

  // (c) 0 sessions made from an event: every session is a worker's, the service's routing one, or a subscription's owner-run one.
  const sessions = tell.over("c · sessions in the store", await runtime.stores.session.list({}));
  const fromEvents = tell.over(
    "c · sessions made from an event",
    sessions.filter((s: { id: string }) => s.id !== task && s.id !== watcher && !s.id.startsWith("service-route:") && !s.id.startsWith("owner-run:")),
    { emptyIs: "the claim: no event makes a session" }
  );
  for (const s of fromEvents.slice(0, 3)) failures.push(`c: a session was made from an event: ${(s as { id: string }).id}`);

  // (d) A redelivery adds nothing; a forged signature answers 401.
  for (const who of ["alice", "bob"] as const) {
    const before = firstPass[who].map((r) => `${r.session} ${r.key}`);
    const after = final[who].map((r) => `${r.session} ${r.key}`);
    const added = after.filter((k) => !before.includes(k));
    // The poll's two review-request events are (g)'s; any other new message is a redelivery's.
    if (added.length > 0) failures.push(`d: redelivering every delivery (and the poll's form) added ${added.length} message(s) for ${who}: ${added.slice(0, 2).join("; ")}`);
  }
  tell.over("d · redeliveries answered", Object.entries(statuses).filter(([label]) => label.startsWith("again:")));
  if (forged !== 401) failures.push(`d: a forged signature answered ${forged}, not 401`);

  // (e) A fan-out stopped partway, then redelivered, leaves each session one message.
  const reviewKey = EXPECTED.find((e) => e.label === "member-review")!.key;
  if (statuses["member-review"]?.[0] !== 503) failures.push(`e: the crashed fan-out answered ${statuses["member-review"]?.[0]}, not 503 (so GitHub would not be asked to redeliver)`);
  for (const [who, session] of [["alice", task], ["bob", watcher]] as const) {
    const copies = tell.over(`e · ${who}'s messages of the crashed review`, final[who].filter((r) => r.session === session && r.key === reviewKey));
    if (copies.length !== 1) failures.push(`e: ${who}'s session has ${copies.length} message(s) of the review whose fan-out crashed`);
  }

  // (f) Nothing on #412 after the merge; the task's subscription ended; the repository's stays.
  const subs = await runtime.stores.resourceState.getByPrefix("user", `alice:~org:${ORG}`, SUBSCRIPTIONS_PATTERN.replace("*", ""));
  const taskSub = tell.over("f · the task's subscriptions", Object.values(subs).map((v) => v.state as { thread: string; enabled: boolean; endedReason?: string }));
  const onPr = taskSub.find((s) => s.thread === PR_THREAD);
  if (onPr === undefined) failures.push("f: the task never subscribed to #412");
  else if (onPr.enabled || onPr.endedReason !== "thread_closed") failures.push(`f: the task's subscription to #412 is ${onPr.enabled ? "still on" : `ended ${onPr.endedReason}`} after the merge`);
  const afterCloseKey = DELIVERIES.find((d) => d.label === "after-close-comment")!;
  const lateKey = `issue_comment:${afterCloseKey.payload.comment.id}@${Date.parse(afterCloseKey.payload.comment.updated_at)}`;
  if (keysIn(final.alice, task).includes(lateKey)) failures.push("f: the task heard a comment after its pull request merged");
  tell.over("f · the watcher's messages after the merge", keysIn(final.bob, watcher).filter((k) => k === lateKey));

  // (g) One id and version by webhook and by the API; two in one second both land.
  const webhookRequests = DELIVERIES.filter((d) => d.label.startsWith("review-request-")).flatMap((d) =>
    normalizeGitHubEvent({ eventType: d.event, payload: d.payload, received: 1 })
  );
  tell.over("g · the webhook's review requests", webhookRequests);
  tell.over("g · the API's review requests", apiEvents);
  for (const event of apiEvents) {
    if (!webhookRequests.some((w) => w.object.id === event.object.id && w.object.version === event.object.version)) {
      failures.push(`g: the API form of ${event.object.id} names version ${event.object.version}, which no webhook event names`);
    }
  }
  const watcherGot = keysIn(final.bob, watcher);
  const requestKeys = tell.over("g · review requests the watcher holds", watcherGot.filter((k) => k.includes(":review_requested:")));
  if (requestKeys.length !== 2) failures.push(`g: the watcher holds ${requestKeys.length} review request(s) of the two made in one second`);
  if (JSON.stringify(sorted(watcherGot)) !== JSON.stringify(sorted(watcherWants))) {
    failures.push(`g: the watcher has ${watcherGot.length} message(s) for ${watcherWants.length} expected (missing ${watcherWants.filter((k) => !watcherGot.includes(k)).join(", ") || "none"})`);
  }

  // (h) 0 model calls.
  tell.over("h · model resolutions", modelCalls, { emptyIs: "the claim: nothing on this path asks a model" });
  if (modelCalls.length > 0) failures.push(`h: ${modelCalls.length} model call(s): ${modelCalls[0]}`);
  if (CONTROL === "session-id") console.log(`(control: today's binding ran ${bindingHits.length} time(s), each in a session named for its PR)`);

  return {
    failures,
    evidence: `the task heard ${taskGot.length} of ${DELIVERIES.length} deliveries (the check during its turn among them), the watcher ${watcherGot.length}; ${DELIVERIES.length} redeliveries and the poll's form added nothing; 0 sessions from events; 0 model calls`
  };
});
await state.dispose();
