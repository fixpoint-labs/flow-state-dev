/** What this run proves is `goal.md` beside this file. */
import { spawnSync } from "node:child_process";
import { readFileSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { defineFlow, handler } from "@flow-state-dev/core";
import { createFlowState, inMemoryStores, runAction } from "@flow-state-dev/engine";
import { createMockModelResolver } from "@flow-state-dev/testing";
import {
  WORKER_MESSAGES_PATTERN,
  messageReceivedEntry,
  subscriptionResources,
  workerConfigSchema,
  workerFlow,
  workerMessagesResources,
  workerTaskEntry,
  type InternalTopics,
  type WorkerManifest
} from "@flow-state-dev/workforce";
import { internalEventsOf, workforce } from "@flow-state-dev/workforce/kit";
import { workerRoutineVerbs } from "@flow-state-dev/workforce/internal";
import { z } from "zod";
import { REPO_ROOT, goalTmpDir, runGoal, silentLogger, workforceTree } from "../../lib/index.mts";
import { assertPatched, describePatches, modulePatchEnv, type ModulePatch } from "../../lib/module-patch.mts";

const HERE = dirname(fileURLToPath(import.meta.url));
const CONTROL = process.env.GOAL_CONTROL ?? "";
const SCRATCH = process.env.GOAL_SCRATCH ?? goalTmpDir("internal-events");

/** The controls: each degrades one behaviour in the code under test, as it loads. */
const PATCHES: Record<string, ModulePatch[]> = {
  // A published event's delivery placed as GitHub's is: at the owner run's hop, in the owner run's chain or a new one.
  "owner-run-hop": [
    {
      module: "packages/workforce/src/service-flows/service-flow.ts",
      from: String.raw`\.\.\.\(event\.hop === undefined \|\| event\.chain === undefined \? \{\} : \{ after: \{ hop: event\.hop, chain: event\.chain \} \}\)`,
      to: ""
    }
  ],
  // A published event's delivery one hop on, but in the owner run's chain or a new one: each subscriber starts its own budget.
  "fresh-chain": [
    {
      module: "packages/workforce/src/messages/send-message.ts",
      from: String.raw`chain: after\.chain, hop: after\.hop \+ 1`,
      to: "chain: turnChainOf(ctx) ?? newChainId(), hop: after.hop + 1"
    }
  ],
  // Any topic is taken: nothing is checked against the declared ones.
  "free-topic": [
    {
      module: "packages/workforce/src/service-flows/internal-events/topics.ts",
      from: String.raw`if \(declared === undefined\) return \x60no_topic:.*;`,
      to: "if (declared === undefined) return undefined;"
    },
    {
      module: "packages/workforce/src/service-flows/internal-events/publish.ts",
      from: String.raw`const topic = options\.topics\[given\.topic\]!?;`,
      to: "const topic = options.topics[given.topic] ?? {};"
    }
  ],
  // Today's main: the seam has no service route, so a publish starts the routing entry as its sender, and nothing fires its runs.
  "main-seam": [
    {
      module: "packages/engine/src/context/create-request-host.ts",
      from: String.raw`const service = spec\.type === "internal" \? \(?entry( as InternalEntry)?\)?\.service : undefined;`,
      to: "const service = undefined;"
    }
  ]
};

if (CONTROL !== "" && PATCHES[CONTROL] === undefined) {
  console.error(`unknown GOAL_CONTROL "${CONTROL}"; known: ${Object.keys(PATCHES).join(", ")}`);
  process.exit(2);
}
// A control runs this same file again with its patch applied as it loads.
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

type Publish = { topic: string; kind: string; title: string; text: string; data?: Record<string, string> };
type Routine = { label: string; user: string; topic: string; kinds?: string[]; passes?: { topic: string; kind: string } };
const F = JSON.parse(readFileSync(join(HERE, "fixtures/fixture.json"), "utf8")) as {
  orgs: Record<string, string>;
  budget: number;
  topics: Record<string, { kinds: string[]; data?: string[]; description: string }>;
  publisher: { label: string; user: string; worker: string };
  routines: Routine[];
  publishes: Publish[];
  undeclared: Publish;
  ring: { start: Publish; routines: Routine[] };
  fan: { start: Publish; routines: Routine[] };
};
const orgOf = (user: string) => F.orgs[user]!;
const topics: InternalTopics = Object.fromEntries(
  Object.entries(F.topics).map(([name, t]) => [
    name,
    { kinds: t.kinds, description: t.description, ...(t.data === undefined ? {} : { data: z.object(Object.fromEntries(t.data.map((field) => [field, z.string()]))).strict() }) }
  ])
);

// ---- the host ---------------------------------------------------------------

const modelCalls: string[] = [];
const TREE = workforceTree([
  { id: "eng.follower", declared: { flow: "follower", description: "Follows topics." }, body: "" } as WorkerManifest,
  { id: "eng.watcher", declared: { flow: "follower", description: "Publishes what it learns." }, body: "" } as WorkerManifest
]);

/** What a routine a message wakes passes on, by its session: the ring's and the fan's, with no model. */
const passesOf = new Map<string, Publish>();
/** Each pass a woken routine tried: its session, the hop its turn ran at, and what the publish answered. */
const passes: Array<{ session: string; hop: number; outcome: Record<string, unknown> }> = [];

const doorInput = z.object({ message: z.string() });
const door = handler({ name: "follower-run", inputSchema: doorInput, execute: async () => "ok" });

/** The follower flow, built on the installation the kit hired: the internal events it serves are that installation's. */
const followerFlow = workerFlow(
  (installation) => {
    const internal = internalEventsOf(installation);
    const tools = workerRoutineVerbs(installation);
    // A block in the flow that publishes: the app's own code, no model. Its input goes to publishEvent as given.
    const publish = handler({ name: "announce", inputSchema: z.unknown(), resources: internal.resources, execute: async (input, ctx) => internal.publishEvent(ctx, input) });
    // A routine's turn on what it heard: it passes it on, when its session passes one on.
    const relay = handler({
      name: "follower-relay",
      inputSchema: z.object({ text: z.string() }).passthrough(),
      resources: internal.resources,
      execute: async (_received, ctx) => {
        const next = passesOf.get(ctx.session.identity.id);
        if (next === undefined) return "";
        const hop = Number((ctx.request.state as Record<string, unknown>).workforceTurnHop ?? -1);
        const outcome = (await internal.publishEvent(ctx, next)) as unknown as Record<string, unknown>;
        passes.push({ session: ctx.session.identity.id, hop, outcome });
        return "";
      }
    });
    return defineFlow({
      kind: "follower",
      configSchema: workerConfigSchema(),
      session: installation.session(),
      resources: { ...installation.resources, ...workerMessagesResources, ...subscriptionResources, ...internal.resources },
      actions: {
        respond: { inputSchema: doorInput, block: door, userMessage: (i: { message: string }) => i.message },
        announce: { inputSchema: z.unknown(), block: publish },
        ...Object.fromEntries([tools.listRoutines, tools.saveRoutine, tools.pauseRoutine, tools.deleteRoutine].map((block) => [block.name, { inputSchema: block.inputSchema, block }]))
      },
      internal: { actions: { onMessageReceived: messageReceivedEntry({ installation, flowKind: "follower", turn: relay }) } },
      task: { actions: { work: workerTaskEntry({ name: "follower-task", turn: door }) } }
    });
  },
  { roles: ["contributor"] }
);

const mocks = createMockModelResolver({});
const modelResolver = Object.assign((modelId: string, blockName?: string) => {
  modelCalls.push(`${modelId} for ${blockName ?? "?"}`);
  return (mocks as any)(modelId, blockName);
}, mocks);

const stores = inMemoryStores();
// The kit serves the internal service flow (`internal-service`) and adds its provider to routines.
const state = createFlowState({
  kits: [workforce({ directory: TREE, internalEvents: { topics }, messages: { budget: F.budget } })],
  fill: { [workforce.slots.workerFlows]: { follower: followerFlow } },
  stores: { default: { primary: stores } },
  modelResolver,
  logger: silentLogger,
  resolvePrincipal: (context: any) => {
    const user = context.request?.headers.get("x-user");
    return typeof user === "string" ? { userId: user, orgId: orgOf(user) } : null;
  }
} as never);
const router = (await state.getRouter()) as any;
const runtime = await state.getRuntime();
/** The one copy of the follower flow the kit serves. */
const follower = runtime.registry.get("follower") ?? (() => {
  throw new Error("setup: the workforce kit serves no follower flow");
})();

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Wait until no request is running or unfinalized. */
async function settled(): Promise<void> {
  const running = (r: { status: string; finalizedAtMs?: number | null }) =>
    r.status === "in_progress" || (r.status !== "suspended" && r.status !== "pending" && r.finalizedAtMs == null);
  for (const deadline = Date.now() + 120_000; ; await sleep(10)) {
    const all = await runtime.stores.request.list({});
    if (!all.some(running)) {
      await sleep(20);
      const again = await runtime.stores.request.list({});
      if (!again.some(running) && again.length === all.length) return;
    }
    if (Date.now() > deadline) throw new Error("setup: a request never finished");
  }
}

async function createFollower(user: string, worker = "eng.follower"): Promise<string> {
  const request = new Request("http://localhost/api/flows/follower/sessions", {
    method: "POST",
    headers: { "content-type": "application/json", "x-user": user },
    body: JSON.stringify({ userId: user, state: { workerId: worker } })
  });
  const res = await router.POST(request, { params: { path: ["follower", "sessions"] } });
  const body = (await res.json()) as { session?: { id: string } };
  if (body.session === undefined) throw new Error(`setup: creating ${user}'s follower failed (${res.status}): ${JSON.stringify(body)}`);
  return body.session.id;
}

async function act(user: string, sessionId: string, action: string, input: unknown) {
  const ran = (await runAction({
    flow: follower,
    actionName: action,
    input,
    userId: user,
    orgId: orgOf(user),
    sessionId,
    stores: runtime.stores,
    runtimeConfig: { ...runtime.runtimeConfig }
  })) as { output?: any; error?: unknown };
  await settled();
  return ran;
}

/** Save a routine on `topic` as the session's worker would. Its answer: the routine, or why it was refused. */
const follow = async (user: string, sessionId: string, topic: string, kinds?: string[]) =>
  (await act(user, sessionId, "saveRoutine", { trigger: { event: { provider: "internal", thread: `internal:${topic}`, interest: `what happens on ${topic}`, ...(kinds === undefined ? {} : { kinds }) } } })).output as
    | { ok: true }
    | { ok: false; error: string };

type Row = { id: string; from: string; toSession: string; hop: number; chain: string; replyRequested?: true; text: string };
/** Every message-log row in `user`'s cell. */
const rowsOf = async (user: string): Promise<Row[]> =>
  Object.values(await runtime.stores.resourceState.getByPrefix("user", `${user}:~org:${orgOf(user)}`, WORKER_MESSAGES_PATTERN.replace("*", ""))).map((v) => v.state as Row);
/** The service's rows that landed in `sessionId`, from `service:internal`. */
const heardIn = (rows: Row[], sessionId: string) => rows.filter((r) => r.from === "service:internal" && r.toSession === sessionId);
/** The event a delivery row carries: `sub_<object>@<version>:<session>`. */
const objectOf = (row: Row) => decodeURIComponent(row.id.slice("sub_".length).split("@")[0]!);
/** `user`'s message-chain rows: what each chain has paid for. */
const chainsOf = async (user: string) =>
  Object.fromEntries(
    Object.entries(await runtime.stores.resourceState.getByPrefix("user", `${user}:~org:${orgOf(user)}`, "workforce/message-chains/")).map(([key, v]) => [key, (v.state as { sent: string[] }).sent])
  );

// ---- the run ----------------------------------------------------------------

const sessions = new Map<string, string>();
const publisher = await createFollower(F.publisher.user, F.publisher.worker);
sessions.set(F.publisher.label, publisher);
const followed = new Map<string, { ok: boolean; error?: string }>();
for (const routine of F.routines) {
  const sessionId = sessions.get(routine.label) ?? (await createFollower(routine.user));
  sessions.set(routine.label, sessionId);
  followed.set(routine.label, (await follow(routine.user, sessionId, routine.topic, routine.kinds)) as never);
}

// Leg a: four publishes, from the publisher's session.
const outcomes: Array<{ leg: string; outcome: Record<string, unknown> }> = [];
const published: Array<{ id: string; publish: Publish }> = [];
for (const p of F.publishes) {
  const outcome = (await act(F.publisher.user, publisher, "announce", p)).output as Record<string, unknown>;
  outcomes.push({ leg: "a", outcome });
  if (typeof outcome?.published === "string") published.push({ id: outcome.published, publish: p });
}
const rowsAfterA = { alice: await rowsOf("alice"), bob: await rowsOf("bob"), carol: await rowsOf("carol") };

// Leg b: an undeclared topic, published and followed; an input that names a sender.
const undeclaredPublish = (await act(F.publisher.user, publisher, "announce", F.undeclared)).output as Record<string, unknown>;
outcomes.push({ leg: "b", outcome: undeclaredPublish });
const undeclaredFollow = await follow(F.publisher.user, sessions.get("r-failed")!, F.undeclared.topic);
const senderNamed = (await act(F.publisher.user, publisher, "announce", { ...F.publishes[0], sender: { id: sessions.get("r-failed"), name: "someone", role: "member" } })).output as Record<string, unknown>;
outcomes.push({ leg: "b", outcome: senderNamed });

// Legs c and d: the ring, then the fan-out, each started once from the publisher's session.
const relayLeg = async (leg: "c" | "d", spec: { start: Publish; routines: Routine[] }) => {
  const own = new Set<string>();
  for (const routine of spec.routines) {
    const sessionId = await createFollower(routine.user);
    sessions.set(routine.label, sessionId);
    own.add(sessionId);
    passesOf.set(sessionId, { ...spec.start, ...routine.passes!, title: `passed on by ${routine.label}` });
    followed.set(routine.label, (await follow(routine.user, sessionId, routine.topic)) as never);
  }
  const chainsBefore = await chainsOf("alice");
  const triedBefore = passes.length;
  const outcome = (await act(F.publisher.user, publisher, "announce", spec.start)).output as Record<string, unknown>;
  outcomes.push({ leg, outcome });
  const tried = passes.slice(triedBefore);
  for (const t of tried) outcomes.push({ leg, outcome: t.outcome });
  const chainsAfter = await chainsOf("alice");
  const newChains = Object.entries(chainsAfter).filter(([key]) => chainsBefore[key] === undefined);
  return { own, outcome, tried, newChains, rows: (await rowsOf("alice")).filter((r) => own.has(r.toSession) && r.from === "service:internal") };
};
const ring = await relayLeg("c", F.ring);
const fan = await relayLeg("d", F.fan);

// ---- the oracle: the spec's rules, written again here, not imported ----------

/** Which published events a routine should hear: its topic and kinds, its own user's, never its own session's. */
function expectedFor(routine: Routine): string[] {
  if (routine.user !== F.publisher.user || orgOf(routine.user) !== orgOf(F.publisher.user)) return [];
  if (sessions.get(routine.label) === publisher) return [];
  return published.filter((p) => p.publish.topic === routine.topic && (routine.kinds === undefined || routine.kinds.includes(p.publish.kind))).map((p) => p.id);
}

const sorted = (xs: string[]) => [...xs].sort();
const BUDGET_REFUSAL = new RegExp(String.raw`^budget: this would be message \d+ since the user's last line, and the budget is ${F.budget}\.`);

await runGoal(async (failures, tell) => {
  // (a) Each routine's rows from service:internal equal the oracle.
  tell.over("a · publishes accepted", published);
  tell.over("a · expected deliveries", F.routines.flatMap(expectedFor));
  for (const routine of F.routines) {
    const rows = rowsAfterA[routine.user as "alice" | "bob" | "carol"];
    const got = heardIn(rows, sessions.get(routine.label)!).map(objectOf);
    const want = expectedFor(routine);
    if (followed.get(routine.label)?.ok !== true) failures.push(`a: ${routine.label}'s routine wasn't saved: ${followed.get(routine.label)?.error}`);
    if (JSON.stringify(sorted(got)) !== JSON.stringify(sorted(want))) failures.push(`a: ${routine.label} heard ${got.length}, expected ${want.length}`);
  }
  if (published.length !== F.publishes.length) failures.push(`a: ${published.length} of ${F.publishes.length} publishes were accepted`);

  // (b) 0 to the publisher's own session, though it follows the topic it published on.
  const toPublisher = tell.over("b · rows in the publisher's session", heardIn(rowsAfterA.alice, publisher), { emptyIs: "the claim: a session never hears its own events" });
  if (toPublisher.length > 0) failures.push(`b: the publisher's own session heard ${toPublisher.length} of its own events`);
  tell.over("b · the publisher's routine is on the topic", [followed.get(F.publisher.label)].filter((f) => f?.ok === true));

  // (c) 0 to the teammate and 0 to the other org, though both follow the topic.
  for (const label of ["r-teammate", "r-other-org"]) {
    const routine = F.routines.find((r) => r.label === label)!;
    tell.over(`c · ${label}'s routine is on the topic`, [followed.get(label)].filter((f) => f?.ok === true));
    const heard = tell.over(`c · ${label}'s rows`, heardIn(rowsAfterA[routine.user as "bob" | "carol"], sessions.get(label)!), { emptyIs: "the claim: own-user first" });
    if (heard.length > 0) failures.push(`c: ${label} heard ${heard.length}`);
  }

  // (d) The undeclared topic refused at publish and at follow, naming the declared ones; a sender in the input fails the schema.
  const declaredList = Object.keys(F.topics).join(", ");
  if (!(typeof undeclaredPublish?.refused === "string" && undeclaredPublish.refused.startsWith(`no_topic: "${F.undeclared.topic}"`) && undeclaredPublish.refused.includes(declaredList))) {
    failures.push(`d: publishing on "${F.undeclared.topic}" wasn't refused naming the declared topics: ${JSON.stringify(undeclaredPublish)}`);
  }
  if (undeclaredFollow.ok !== false || !undeclaredFollow.error.startsWith("no_topic:")) failures.push(`d: following "${F.undeclared.topic}" wasn't refused as no_topic: ${JSON.stringify(undeclaredFollow)}`);
  if (!(typeof senderNamed?.refused === "string" && /^invalid_input: .*sender/.test(senderNamed.refused))) failures.push(`d: an input naming a sender wasn't refused by the schema: ${JSON.stringify(senderNamed)}`);

  // (e) The ring stops at the budget: one refusal, by a turn at hop 6, naming the budget; its deliveries one hop apart in one chain.
  tell.over("e · the ring's passes", ring.tried);
  const ringRefused = ring.tried.filter((t) => typeof t.outcome.refused === "string");
  const ringPassed = ring.tried.filter((t) => typeof t.outcome.published === "string");
  if (ringRefused.length !== 1 || !BUDGET_REFUSAL.test(String(ringRefused[0]!.outcome.refused)) || ringRefused[0]!.hop !== F.budget) {
    failures.push(`e: the ring wasn't refused once at hop ${F.budget} naming the budget: ${ringRefused.length} refusal(s), first at hop ${ringRefused[0]?.hop}: ${String(ringRefused[0]?.outcome.refused ?? "none")}`);
  }
  if (ringPassed.length !== F.budget - 1) failures.push(`e: the ring passed it on ${ringPassed.length} times, expected ${F.budget - 1} (the budget, less the publisher's own place)`);
  const ringHops = tell.over("e · the ring's deliveries", ring.rows).map((r) => r.hop);
  if (JSON.stringify([...ringHops].sort((a, b) => a - b)) !== JSON.stringify(Array.from({ length: F.budget }, (_, i) => i + 1))) {
    failures.push(`e: the ring's ${ringHops.length} deliveries landed at hops ${[...ringHops].sort((a, b) => a - b).join(",")}, expected 1..${F.budget}`);
  }

  // (f) 0 task rows, 0 reply requests, no recipient in any result.
  const allRows = [...(await rowsOf("alice")), ...(await rowsOf("bob")), ...(await rowsOf("carol"))];
  tell.over("f · message rows read", allRows);
  const asking = tell.over("f · rows asking a reply", allRows.filter((r) => r.replyRequested === true), { emptyIs: "the claim: a publish asks no reply" });
  if (asking.length > 0) failures.push(`f: ${asking.length} row(s) ask a reply`);
  let taskRows = 0;
  for (const user of Object.keys(F.orgs)) {
    for (const v of Object.values(await runtime.stores.resourceState.getByPrefix("user", `${user}:~org:${orgOf(user)}`, ""))) {
      const s = v.state as Record<string, unknown> | undefined;
      if (s !== undefined && typeof s.assignee === "string" && typeof s.status === "string") taskRows += 1;
    }
  }
  tell.over("f · task rows", Array.from({ length: taskRows }), { emptyIs: "the claim: a publish files no task" });
  if (taskRows > 0) failures.push(`f: ${taskRows} task row(s) were filed`);
  for (const { leg, outcome } of tell.over("f · publish results", outcomes)) {
    const keys = Object.keys(outcome ?? {});
    if (!(keys.length === 1 && (keys[0] === "published" || keys[0] === "refused"))) failures.push(`f: a leg ${leg} result names more than its outcome: ${JSON.stringify(outcome)}`);
  }

  // (g) The fan-out's paid places never pass the budget, all in one chain; every pass past it refused with the budget's reason.
  const fanPaid = fan.newChains.reduce((n, [, sent]) => n + sent.length, 0);
  tell.over("g · the fan-out's passes", fan.tried);
  if (fanPaid > F.budget) failures.push(`g: the fan-out paid ${fanPaid} places across ${fan.newChains.length} chain(s), past the budget of ${F.budget}`);
  if (fan.newChains.length !== 1) failures.push(`g: the fan-out paid into ${fan.newChains.length} chains, not its publisher's one`);
  const fanPassed = fan.tried.filter((t) => typeof t.outcome.published === "string");
  if (fanPassed.length + 1 > F.budget) failures.push(`g: ${fanPassed.length + 1} publishes went out in the fan-out, past the budget of ${F.budget}`);
  const fanRefused = tell.over("g · passes refused", fan.tried.filter((t) => typeof t.outcome.refused === "string"));
  for (const t of fanRefused) if (!BUDGET_REFUSAL.test(String(t.outcome.refused))) failures.push(`g: a pass was refused for something else: ${String(t.outcome.refused)}`);

  tell.over("model resolutions", modelCalls, { emptyIs: "the claim: nothing on this path asks a model" });
  if (modelCalls.length > 0) failures.push(`model: ${modelCalls.length} call(s): ${modelCalls[0]}`);
  return {
    failures,
    evidence:
      `${published.length} publishes heard as the oracle says by ${F.routines.length} routines; publisher, teammate and other org heard 0; ` +
      `undeclared topic refused at publish and follow; ring stopped at hop ${ringRefused[0]?.hop} after ${ringPassed.length} passes; ` +
      `fan-out paid ${fanPaid} place(s) in ${fan.newChains.length} chain, ${fanRefused.length} pass(es) refused`
  };
});
await state.dispose();
