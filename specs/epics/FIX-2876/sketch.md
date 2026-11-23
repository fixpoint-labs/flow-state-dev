# FIX-2876 · Sketch: one request through the set

[Spec](SPEC.md) · [Decisions](DECISIONS.md) · **Sketch**

Illustrative TypeScript, not shipping code. It follows one request from a person's *Code with*
pick to the run that uses it, on the APIs `main` has at `3bdcd2817`. Every name without a mark
is real today. `// NEW (FIX-xxxx)` marks what a child adds. Where a child's spec picks the name
or the shape, the comment says so. Nothing here decides anything [DECISIONS](DECISIONS.md) leaves
to a child.

## 1 · The coder flow declares what its tasks take (FIX-2894, FIX-2878)

The `work` entry declares its tasks' input: a schema, the fields only the server writes, and the
function that fills them. Filing checks a task against that declaration, and the entry checks the
schema again when the task is claimed. A server-owned field is the task-input counterpart of
`serverOwned` on session state (`withSessionFields`): one concept. The board knows no field names.

```ts
// packages/harness-manager/src/kit/coder-flow.ts
import { harnessFeatureSchema } from "../manager";
import { projectAddressSchema, taskInput, workerTaskEntry } from "@flow-state-dev/workforce";

/** A model as the harness takes it: an id, or Cursor's `{ id, params }`. */
const modelSelection = z.union([
  z.string().min(1),
  z.object({ id: z.string().min(1), params: z.array(z.object({ id: z.string(), value: z.string() })).optional() }).strict(),
]);

export const codingTaskInputSchema = z // NEW (FIX-2878); its type is CodingTaskInput
  .object({
    harness: z.string().min(1).optional(), // server-owned (ER-10): the filler writes it
    model: modelSelection.optional(), // server-owned (ER-10): the filler writes it
    // server-owned (ER-10): it narrows what a run may do, so clearing it widens it. Until FIX-2599
    // moves plan mode onto it, `claude-code-plan` stays a harness id; the field's name is FIX-2878's spec's.
    plan: z.boolean().optional(),
    mode: z.string().min(1).optional(), // filer-written; checked against the app's modes at filing (ER-9)
    issue: z.string().min(1).optional(), // with mode "implement", replaces input.harnessFeature.issue
    project: projectAddressSchema.optional(), // was input.project
  })
  .strict();
export type CodingTaskInput = z.infer<typeof codingTaskInputSchema>;

/**
 * NEW (FIX-2878): a legacy row's marker, read as implement (BP-030); nothing writes it again.
 * A pre-parse step on the declaration, so filing, updateTask and claim all see `{ mode, issue }`.
 * The marker's `phase` is ignored: the old `phases` map only ever had `feature`, so every
 * well-formed marker is implement, whatever `phase` says. One with no valid `issue` is refused.
 */
const readLegacy = (raw: Record<string, unknown>): Record<string, unknown> => {
  if (!("harnessFeature" in raw)) return raw;
  const { harnessFeature, ...rest } = raw;
  const marker = harnessFeatureSchema.safeParse(harnessFeature); // { issue, phase? }
  if (!marker.success) throw new Error("this task's feature marker is malformed. Nothing ran."); // never run as an answer
  return { ...rest, mode: "implement", issue: marker.data.issue }; // `phase` dropped
};

task: {
  actions: {
    work: workerTaskEntry({
      name: `${CODER_FLOW}-work`,
      // NEW (FIX-2894): the declaration; FIX-2894's spec picks `taskInput`'s final shape.
      input: taskInput(codingTaskInputSchema, {
        serverOwned: ["harness", "model", "plan"], // every run setting that widens a run when changed; never `mode`
        dropped: ["doneWhen", "workspace"], // NEW (FIX-2878): a mode's server code, dropped from a filer's input like the above (ER-9)
        legacy: readLegacy, // NEW (FIX-2878): pre-parse, at filing, updateTask and claim
        fill: fillRunSettings, // NEW (FIX-2878): the harness kit's filler (step 3)
        check: checkMode, // NEW (FIX-2878): default mode, registered and `requires`, then the lock (section 7)
        project: options.project === true ? "required" : "optional", // was the hire's `needsProject`
      }),
      block: byHarness(`${CODER_FLOW}-by-harness`, taskWorkerInputSchema.passthrough(), (b) => b.manager, true),
    }),
  },
},
```

Filing makes one input check, and it asks the assignee's flow. It replaces `assertProjectFor`, and
the `needsProject` option goes from the hire's `WorkerFlowEntry` and from the board's options, with
no alias (BP-034). The project requirement is now part of the declaration, and the check looks for
a project in the same order `assertProjectFor` does today. The claim check is one more `tap` on
the entry's sequencer.

```ts
// packages/workforce/src/conversation-board/board.ts, inside the guarded createTask
const targeted = await withTarget(init);
const filed = await checkInputFor(targeted); // NEW (FIX-2894): replaces assertProjectFor(targeted)

/** NEW (FIX-2894): the assignee's flow's declared input, applied before anything is reserved. */
const checkInputFor = async (init: TaskInit): Promise<TaskInit> => {
  const assignee = init.assignee ?? (await soleDelegate());
  const flow = assignee === undefined ? undefined : (await reach(ctx)).available.get(assignee);
  // Read off the flow's own `work` entry, not a host option per concern. FIX-2894's spec picks the lookup.
  const declared = flow === undefined ? undefined : declaredInputOf(flow);
  if (declared === undefined) return init; // no declaration: an open record, as today
  // A filer never writes a server-owned field, whatever it sent. The board drops each one by the
  // declaration's list and calls the flow's filler; it never knows what the fields are called.
  const sent = { ...((init.input ?? {}) as Record<string, unknown>) };
  for (const name of declared.serverOwned) delete sent[name];
  const input = { ...sent, ...(await declared.fill?.(ctx, { assignee: assignee!, input: sent })) };
  const parsed = declared.schema.safeParse(input);
  if (!parsed.success) {
    throw new TaskWriteRefusedError("input_refused", `this task's input doesn't fit "${assignee}": ${parsed.error.issues[0]!.message}. Nothing was filed.`);
  }
  // Was assertProjectFor: the input's project, or the target's, the follow-up root's, the filer's
  // workstream or the row's stamp, in that order. `runProjectOf`'s `no-project` stays the backstop.
  if (declared.project === "required" && !(await hasProjectFor(init, parsed.data))) {
    throw new TaskWriteRefusedError("no_project", `"${assignee}" works in a project's files, and this conversation has no project for it to work in. Nothing was filed. ${SET_THE_FILERS_PROJECT}`);
  }
  return { ...init, input: parsed.data }; // stored parsed (FIX-2894)
};

// updateTask runs the same check but never calls the filler: it drops what the filer sent for a
// server-owned field and keeps the stored value, so a rewrite can't change the coder either.

// packages/workforce/src/conversation-board/task-entry.ts, in workerTaskEntry
const base = sequencer({ name, inputSchema: taskWorkerInputSchema })
  .tap(noteRoutedFrom)
  .tap(startAtFiledHop)
  .tap((task: TaskWorkerInput) => void options.input?.schema.parse(task.input ?? {})); // NEW (FIX-2894): again at claim
```

`needsProject` is build-time config, not a stored field, so removing it touches no task record.
The claim parses only the schema and the project requirement stays a filing check, so a task in
flight whose project came from its context is not refused at its next claim. What a task in flight
does meet is FIX-2894's own break, with one exception: an old `harnessFeature` key is read as
`mode: "implement"` with its `issue` (`readLegacy`, BP-030), and only a malformed marker is
refused. A task filed before FIX-2878 may also carry a `harness` or `model` no filler wrote. Both fall under the drain
that the FIX-2894 implementer note asks its spec to name as a deliberate exception to BP-030.

## 2 · The person's pick travels as a field, not text (FIX-2879)

The browser sends the pick beside the message. No `Coding harness:` line is added.

```ts
// labs/teammates/src/app/conversations.ts
await workforce.send(sessionId, text, {
  attachments: [...attachments],
  fields: { codeWith: { harness: picked.harness, model: picked.model, plan: picked.plan } }, // NEW (FIX-2879)
});
```

The harness kit declares the field. `sessionFields` is kit config today, so FIX-2879 turns it into
a keyed slot that another kit can fill.

```ts
// packages/harness-manager/src/kit/harnesses-kit.ts, in contributes
const codeWithSchema = z.object({ harness: z.string().min(1), model: modelSelection.optional(), plan: z.boolean().optional() }).strict();
[workforce.slots.sessionFields]: { codeWith: { schema: codeWithSchema, written: "turn" } }, // NEW (FIX-2879)
```

The default agent flow's `respond` takes the optional `fields`, the way `doorTask` adds `taskId`.
It keeps `setSessionFieldsAction`'s rules, but a `written: "turn"` field can be written again on
each turn, so the last pick wins.

```ts
// packages/workforce/src/agent-worker-flow.ts
[RESPOND_ACTION]: {
  ...doorTask(installation !== undefined ? inputSchema.strict() : inputSchema),
  ...turnFields(installation?.sessionFields), // NEW (FIX-2879): `fields?`, parsed against each declaration
  block: steerOrTalk(userTurn),
  userMessage: (input) => input.message,
  concurrency: REPLY_CONCURRENCY,
},
// The coder flow's own `respond`, the door (`harnessSessionDoor`), takes no `fields`: a door talk
// always runs on the task's frozen coder (ER-8). Another coder is a new task, filed from this turn.

/** NEW (FIX-2879): write this turn's `written: "turn"` fields before the turn runs. */
async function writeTurnFields(declared: SessionFields, fields: Record<string, unknown>, ctx: BlockContext) {
  if (ctx.user?.identity?.userId !== ctx.session.identity.userId) refuse("only the session's own user sets its fields.");
  const written: Record<string, unknown> = {};
  for (const [name, value] of Object.entries(fields)) {
    const field = declared[name];
    if (field?.written !== "turn") refuse(`"${name}" is not a field a turn writes.`);
    written[name] = field.schema.parse(value);
  }
  await ctx.session.atomicState(() => written); // a turn no user started never comes through here, so the pick stays
}
```

## 3 · Filing: the harness kit's filler writes harness, model and plan (ER-10)

The board has already dropped whatever the filer sent for `harness`, `model` and `plan` (step 1),
because the coder flow's declaration marks them server-owned: `harness` and `plan`, changed by a
filer, could widen what the run may do, and `model` is the filer-trust rule's (BP-031). The harness kit's filler writes them back in, so workforce reads no
harness-kit field. It resolves the pick in ER-10's six steps: inside a coding run, that run's
frozen triple (step 4); below one, the triple the server carried at hand-over; from another linked
session, the root conversation's current `codeWith`; from the person's own conversation, its
`codeWith`; with no pick, the server default; with no root, a refusal. `codeWith` is not carried
at hand-over, so no stale copy exists to read. The filler runs before the parse, and `updateTask`
keeps the stored values.

The filler fills only the server-owned run settings, never the assignee. Until it writes the
default on the no-pick path, FIX-2877 writes that filing's assignee (the default's worker) as an
interim; once it does, the model's assignee picks the role again, and ER-11's lock checks it at
claim (step 4). The worker the model names also brings its own `review` mode: process, not permission.

```ts
// packages/harness-manager/src/kit/coder-flow.ts: the harness kit's filler (NEW, FIX-2878)
const fillRunSettings = async (ctx: BlockContext): Promise<Partial<CodingTaskInput>> => {
  // (1) inside a coding run, or (2) below one: the run's three run settings, never `review`.
  // Never a default, never wider. Names of these lookups are FIX-2878's and FIX-2879's specs'.
  const run = (await activeRunOf(ctx)) ?? (await carriedRunOf(ctx));
  if (run !== undefined) return { harness: run.harnessId!, model: run.model ?? undefined, plan: run.plan ?? undefined };
  // (3) another linked session reads the root conversation's current pick; (4) the person's own reads its own.
  const root = await rootConversationOf(ctx); // NEW (FIX-2879): walks the session links
  if (root === undefined) throw new TaskWriteRefusedError("no_root", "no conversation this filing belongs to. Nothing was filed."); // (6)
  const picked = (root.state as { codeWith?: Partial<CodingTaskInput> }).codeWith;
  // (5) no pick: the server default, the same as the person's own no-pick turn.
  return picked ?? defaultRunSettings(); // defaultHarness, its defaultModel, the plan setting it implies
};
```

The attacks the security review raised, refused:

```ts
it("a filer cannot choose its own coder", async () => {
  await conversation.respond({ message: "Fix the flaky test", fields: { codeWith: { harness: "claude-code-plan" } } });
  // Lead's tool call, or a prompt-injected one, asks for an edit-capable harness.
  const task = await board.createTask({
    assignee: "teammates.coder",
    goal: "Fix the flaky test",
    input: { harness: "claude-code", model: "claude-opus-5-5" },
    metadata: { harness: "claude-code" },
  });
  expect(task.input).toEqual({ harness: "claude-code-plan" }); // the turn's pick; the filer's model is gone too
  expect((await runOf(task)).harness).toBe("claude-code-plan"); // read from the run, not the task
});

it("a filer cannot route around the pick by naming another worker", async () => {
  // teammates.builder is locked to claude-code; the person picked plan mode.
  await conversation.respond({ message: "Fix the flaky test", fields: { codeWith: { harness: "claude-code-plan" } } });
  const task = await board.createTask({ assignee: "teammates.builder", goal: "Fix the flaky test" });
  expect(task.input).toEqual({ harness: "claude-code-plan" }); // the assignee changes nothing the filler writes
  await expect(claimed(task)).rejects.toThrow(/always runs with harnessId claude-code; this task asked for claude-code-plan/);
});

it("a task a worker's run files inherits that run's frozen pick", async () => {
  const parent = await claimed(board, { assignee: "teammates.coder", input: {} }, { codeWith: { harness: "claude-code-plan" } });
  await conversation.respond({ message: "now use codex", fields: { codeWith: { harness: "codex" } } }); // a later pick
  const child = await asRunOf(parent).createTask({ assignee: "teammates.coder", goal: "split the fix", input: { harness: "codex" } });
  const frozen = await runOf(parent); // { harnessId: "claude-code-plan", model: its effective default, plan: true }
  expect(child.input).toEqual({ harness: frozen.harnessId, model: frozen.model, plan: true }); // the filing run's whole triple: not the later pick, not the kit default
});

it("a filer cannot clear or flip plan mode", async () => {
  await conversation.respond({ message: "Look into the flaky test", fields: { codeWith: { harness: "claude-code-plan", plan: true } } });
  // A prompt-injected model files, then rewrites, with plan mode off.
  const task = await board.createTask({ assignee: "teammates.coder", goal: "Fix the flaky test", input: { plan: false } });
  expect(task.input).toEqual({ harness: "claude-code-plan", plan: true }); // the turn's pick, not the filer's
  for (const plan of [false, null]) { // a flip, then an explicit clear: both reach the board, unlike `undefined`
    const rewritten = await board.updateTask(task.id, { input: { harness: "claude-code", plan } });
    expect(rewritten.input).toEqual({ harness: "claude-code-plan", plan: true }); // updateTask keeps the stored values
  }
  await claimed(task); // the run record holds the triple only once the task is claimed
  expect((await runOf(task)).plan).toBe(true); // read from the run: still a plan run
});
```

## 4 · One order at the claim, frozen for every route (ER-2, ER-11)

`harnessOf` resolves from the worker alone today. It is replaced by one resolver over the task.
For a harness the order is the task, then the worker, then the kit; for a model, the task, then the
harness value's own default; for plan, the task's. Until FIX-2599, `plan` never loosens the harness
id: `plan: true` on a harness that is not a plan harness fails the claim, and a plan harness is a
plan run whatever `plan` says. Only a fresh work claim runs it, and it freezes the harness, the
**effective** model (the harness default included, never a null that reads the option later) and
the plan setting as one triple, and with it `review` and the stored `mode`: together, the frozen
run settings, on the run record. A worker's lock is then checked against them, on every field the
lock names. Steer, message, door and resume read the frozen run settings, never the session's
current `codeWith` or the app's current `defaultMode`, so nothing changed after the claim reaches
a run in flight.

```ts
// packages/harness-manager/src/kit/coder-flow.ts, replacing harnessOf
const resolveRun = async (ctx: BlockContext, task: { input?: unknown } | undefined) => { // NEW (FIX-2878)
  const worker = await installation.resolveWorker(ctx, CODER_FLOW);
  const own = worker.config.harness as string | undefined;
  const asked = codingTaskInputSchema.parse(readLegacy({ ...((task?.input ?? {}) as Record<string, unknown>) }));
  const id = asked.harness ?? own ?? options.defaultHarness;
  const found = id === undefined ? undefined : built[id];
  if (found === undefined) throw new Error(`no harness "${id ?? "(none)"}" here; one of ${ids.join(", ")}. Nothing ran.`);
  // Plan: the task's, as the filler wrote it. Until FIX-2599 the harness id is the boundary, and the
  // claim reconciles the two before freezing: with no `plan`, a plan run iff the id is
  // `claude-code-plan`; `plan: true` on a non-plan harness fails; a plan harness is a plan run anyway.
  const planHarness = PLAN_HARNESS_IDS.has(id); // today { "claude-code-plan" }
  if (asked.plan === true && !planHarness) throw new Error(`${id} has no plan mode; this task asked for one. Nothing ran.`);
  const plan = planHarness || asked.plan === true;
  // Model: the task's, checked (step 5), else the harness value's own default (cursorHarness({ model })),
  // read now and frozen, so a later change to that option never reaches a retry (ER-2).
  // There is no worker-config model and no kit-default model.
  const checked = await checkModel(harnesses[id]!, asked.model);
  const triple = { harnessId: id, model: checked.model ?? harnesses[id]!.defaultModel ?? null, plan };
  // ER-11: a lock is the worker's fixed values for server-owned run settings, checked against the
  // triple. This runs for every worker that claims a coding task, not only the one the turn meant:
  // an unlocked worker runs the triple, a locked one runs it or refuses by name. So a model-written
  // assignee can't move a task onto another coder or out of plan mode (ER-10's assignee rule).
  // The lock may also pin `mode`, which is filer-written: filing checked it too (section 7).
  // Filing wrote `defaultMode` into a task that named none, so the stored mode is the one that runs;
  // only a row filed before FIX-2878, with no marker, reaches the fallback (BP-030).
  const mode = asked.mode ?? defaultMode;
  checkRequires(mode, asked); // the claim re-checks the mode's `requires` (section 7)
  const lock = (worker.config.lock ?? {}) as Partial<typeof triple & { mode: string }>; // NEW (FIX-2878): name is its spec's
  for (const [field, fixed] of Object.entries(lock)) {
    const got = { ...triple, mode }[field as keyof typeof triple | "mode"];
    if (got !== fixed) throw new Error(`worker "${worker.id}" always runs with ${field} ${fixed}; this task asked for ${got}. Nothing ran.`);
  }
  // `review` and `mode` are frozen with the triple, per task (FIX-2878 D1), but never inherited by a child filing.
  const review = (worker.config.review as boolean | undefined) ?? options.review === true;
  return { ...found, id, manager: review ? found.reviewed : found.manager, model: { ...checked, model: triple.model ?? undefined }, plan, triple, frozen: { ...triple, review, mode } };
};

/** NEW (FIX-2878): the frozen run settings a fresh work claim wrote, for every other route. */
const frozenRunOf = async (ctx: BlockContext) => {
  const filed = await board(ctx);
  const task = filed === undefined ? undefined : sessionTask(filed.tasks, ctx.session.identity.id);
  const run = task === undefined ? undefined : await readRunRecord(ctx, runTopicOf(task));
  if (run?.harnessId == null) throw new Error("this session's task has not been claimed; nothing to steer. Nothing ran.");
  const found = built[run.harnessId];
  if (found === undefined) throw new Error(`the run's harness "${run.harnessId}" is not here any more. Nothing ran.`);
  // `mode` is the frozen one, never the app's current defaultMode: a claimed implement task stays implement.
  return { ...found, id: run.harnessId, model: { model: run.model ?? undefined }, plan: run.plan, mode: run.mode };
};

// runTopicOf: new runs write `<epic>/<issue>/<modeName>`; a reader tries that key, then the legacy
// phase-value key (implement ↔ code, default ↔ the old single-phase value). No migration and no
// rewrite: a run started under the old key finishes under it. FIX-2877's spec owns the detail.

// In byHarness: only the work entry's fresh claim resolves; steer, message and door read the frozen run settings.
execute: async (input: { input?: unknown } & Record<string, unknown>, ctx: never) => {
  // A task's own input carries `goal`; a steer, a message or a door line doesn't (the door's `taskId` is a label only).
  const freshClaim = "goal" in input && route === "work"; // `route`: byHarness's own argument, one per entry
  const chosen = freshClaim ? await resolveRun(ctx, input) : await frozenRunOf(ctx);
  if (freshClaim) {
    // NEW (FIX-2878): frozen beside `sessionId`; all five fields `.nullable().default(null)` (BP-030).
    await writeRunRecord(ctx, chosen.frozen); // the effective model, never a null that reads the option later
  }
  if (ready) {
    const missing = await refusal(chosen.id);
    if (missing !== undefined) throw new Error(missing); // a refused harness fails; it never moves to another
  }
  return pick(chosen);
},
```

## 5 · The model is checked against the catalog, and resume checks the harness and plan (ER-2, ER-8)

A named model runs only when the harness's `models()` answered and lists that exact selection.
Anything else is refused by name, and the run uses the harness default. The refusal is recorded
on the run.

```ts
import { isDeepStrictEqual } from "node:util";

type ModelSelection = z.infer<typeof modelSelection>;
type Checked = { model?: ModelSelection; refused?: string };

/** NEW (FIX-2878): no catalog, a failed catalog and an unlisted Cursor param are all refusals. */
async function checkModel(harness: Harness, asked: ModelSelection | undefined): Promise<Checked> {
  if (asked === undefined) return {};
  const name = typeof asked === "string" ? asked : asked.id;
  const list: HarnessModelList = harness.models === undefined ? { status: "failed", reason: "it lists no models" } : await harness.models();
  if (list.status === "failed") return { refused: `${name} not run: ${harness.id}'s model list failed (${list.reason}). Ran its default.` };
  const listed = list.models.some((m) =>
    typeof asked === "string"
      ? m.id === asked
      : m.id === asked.id && (asked.params === undefined || ((m as { variants?: { params: unknown }[] }).variants ?? []).some((v) => isDeepStrictEqual(v.params, asked.params))),
  );
  return listed ? { model: asked } : { refused: `${harness.id} lists no ${name} with those settings. Ran its default.` };
}

// packages/harness-manager/src/manager.ts: the feed that carries it to the harness
export interface HarnessFeeds {
  // …cwd, resume, onSession, onUsage as today
  model: HarnessResolver<ModelSelection | undefined>; // NEW (FIX-2878): the same name HarnessSessionFeeds has
}

// packages/harness-manager/src/harness.ts
export interface Harness {
  // …id, agent, readiness, pass, usage, models as today
  readonly defaultModel?: ModelSelection; // NEW (FIX-2878): what runs when a task names none (cursorHarness: options.model ?? "default"), so a claim can freeze it
}
```

A session is resumed only by the harness and plan setting that started it, matched by the `id`
and `plan` frozen on the run record, never the id alone: after FIX-2599 a plan session and an edit
session can share `claude-code`, and one is never resumed as the other. `source` cannot tell
`claude-code` from `claude-code-plan`, because both report `claude-code/sdk`. The door takes no pick, and the first claim freezes the coder for the task's life, so
the only path to a different coder is a new task; the check matters only for a session recorded
before the freeze, which FIX-2878's spec never resumes.

```ts
// manager.ts, the harness block's resume feed (each manager is built for one harness id)
resume: (ctx) => {
  const state = harnessCtxState(ctx);
  // NEW (FIX-2878): the run row's frozen `harnessId` and `plan`, beside the session they name.
  const same = state?.harnessId === harnessId && state.plan === plan; // `plan`: this dispatch's frozen setting
  return same ? (state.previousSessionId ?? null) : null; // another coder, or plan flipped: a fresh session
},

// session-door.ts, the talk: the same check on the door's path
if (record.harnessId !== dispatched.id || record.plan !== dispatched.plan) throw new SessionDoorRefused("coder-changed"); // NEW (FIX-2878): its spec picks fresh or refuse
```

## 6 · The apps after FIX-2877: one coder flow, one default

Teammates keeps one knob. `TEAMMATES_HARNESS` can feed it. The agent's `harness` setting,
`LEAD_FALLBACK_HARNESS` and the `Coding harness:` line go.

```ts
// labs/teammates/host.mts
workforce({ agent: { settings: { icon: z.string().optional(), color: z.string().optional() }, showSettings: ["icon", "color", "model"] /* … */ } }),
harnesses({ workspace, defaultHarness: harness, review: true, checks, runTimeoutMs, branchPrefix: "teammates/" /* … */ }),
```

Shift Manager drops `.without(workforce.slots.workerFlows, "coder")` and deletes `coder.mts`.
`DEVFORCE_LAB_HARNESS` feeds the same one value.

```ts
// packages/shift-manager/teams/devteam/host.mts
harnesses({
  workspace: workspaceHost ?? answerHost,
  logReadiness: true,
  defaultHarness: process.env.DEVFORCE_LAB_HARNESS, // NEW here (FIX-2877)
  modes: shiftManagerModes, // NEW (FIX-2877): its split of feature work from answers (section 7)
  defaultMode: "answer", // NEW (FIX-2877): a task with no `mode` runs this; absent, `default`
}),
```

One coder worker, whose `harness:` is a default, and one locked worker:

```md
<!-- workers/coder/WORKER.md -->
---
flow: coder
harness: codex
---

<!-- workers/planner/WORKER.md -->
---
flow: coder
harness: claude-code-plan
lock:                 # NEW (FIX-2878): fixed values for server-owned run settings; the name is its spec's
  harnessId: claude-code-plan
  plan: true          # after FIX-2599 this alone holds plan mode, even on claude-code

---
```

## 7 · Modes (FIX-2877, FIX-2878)

A mode is a named kind of coding run an app registers on the harness kit: `instructions` build
the prompt, `doneWhen` is the server's done check, and `workspace` is where the run works
(ER-1). A task picks one by name with `mode`; with none, it runs in the app's default mode.
`doneWhen` and `workspace` are server code, never task fields (ER-10). The kit option is `modes`
plus `defaultMode` (absent: `default`), FIX-2877's; the task field and its checks are FIX-2878's.

A kit with no `modes` has one mode, `default`: today's single phase.

```ts
// labs/teammates/host.mts: no modes, so every task runs in `default`
harnesses({ workspace, defaultHarness: harness, review: true, checks });

// packages/harness-manager/src/kit/coder-flow.ts: the kit's own default mode (was `PHASE: PhaseSpec`)
const DEFAULT_MODE: ModeSpec = { // NEW (FIX-2877): PhaseSpec → ModeSpec, PhaseDoneVerdict → ModeDoneVerdict, codingPhase → codingMode
  instructions: (run) => codingBrief(run, { terms: [/* today's terms */] }), // was buildPrompt
  doneWhen: (run) => run.stopReport === "finished", // was isDone, with its validate and doneTimeoutMs
  workspace: options.workspace, // the kit's workspace host
};
```

An app can override part of the default mode and keep the rest:

```ts
harnesses({
  workspace,
  modes: { default: { instructions: (run) => `${teamBrief}\n\n${run.task.goal}` } }, // the kit's doneWhen and workspace stay
});
```

Shift Manager registers two modes and sets `defaultMode: "answer"` (section 6), as a task without
the feature marker is an answer today:

```ts
// packages/shift-manager/teams/devteam/modes.mts
export const shiftManagerModes = {
  implement: {
    instructions: (run) => featureBrief(run), // what coder.mts's feature phase says today
    doneWhen: (run) => hasCommitTheBaseLacks(run), // a commit the base lacks
    workspace: workspaceHost, // a repo checkout on a branch
    requires: ["issue"], // ModeSpec.requires (FIX-2877): task-input fields this mode needs, checked at filing (FIX-2878)
  },
  answer: {
    instructions: (run) => answerBrief(run),
    doneWhen: (run) => run.answer.trim() !== "" && run.stopReport !== "stopped-at-limit", // a non-empty answer
    workspace: answerHost, // the `answers` scratch host, which keeps nothing
  },
} satisfies Record<string, ModeSpec>;
```

Filing writes `defaultMode` into a task that names no mode, then checks the mode against the
registered set and its `requires`, in the coder flow's declaration (ER-9), so workforce knows no
mode name. The stored mode is what the claim runs, so a later change to `defaultMode` reaches only
tasks not yet filed; the claim re-checks `requires`:

```ts
/**
 * NEW (FIX-2878): the declaration's check, run at filing after the parse; returns the input to store.
 * Order: legacy read (pre-parse) → default mode → registered and `requires` → the assignee's lock.
 */
const checkMode = (input: CodingTaskInput, worker: { id: string; config: { lock?: { mode?: string } } }): CodingTaskInput => {
  const name = input.mode ?? defaultMode; // written in by the server, before the requires check
  checkRequires(name, input);
  const pinned = worker.config.lock?.mode; // ER-11: refused at filing here, and again at claim in resolveRun
  if (pinned !== undefined && pinned !== name) {
    throw new TaskWriteRefusedError("mode_locked", `worker "${worker.id}" always runs with mode ${pinned}; this task asked for ${name}. Nothing was filed.`);
  }
  return { ...input, mode: name };
};

/** At filing, and again at claim. */
const checkRequires = (name: string, input: CodingTaskInput) => {
  const mode = modes[name];
  if (mode === undefined) throw new TaskWriteRefusedError("unknown_mode", `no mode "${name}" here; one of ${Object.keys(modes).join(", ")}. Nothing was filed.`);
  for (const need of mode.requires ?? []) {
    if (input[need] === undefined) throw new TaskWriteRefusedError("mode_needs_input", `mode "${name}" requires ${need}; this task names none. Nothing was filed.`);
  }
};
```

Task filings, as the board stores them, in Shift Manager:

```jsonc
// No mode: filing writes the app's `defaultMode` in.
{ "goal": "Why does the nightly build skip the docs job?", "input": {} }
//   → stored: { "mode": "answer", … }
// An answer, named.
{ "goal": "Why does the nightly build skip the docs job?", "input": { "mode": "answer" } }
// A change: implement, with its issue.
{ "goal": "Make the docs job run nightly", "input": { "mode": "implement", "issue": "ENG-142" } }
// An unknown mode: refused.
{ "goal": "Review ENG-142", "input": { "mode": "review" } }
//   → refused: no mode "review" here; one of implement, answer. Nothing was filed.
// Implement with no issue: refused, never run as an answer instead.
{ "goal": "Make the docs job run nightly", "input": { "mode": "implement" } }
//   → refused: mode "implement" requires issue; this task names none. Nothing was filed.
// A filer naming its own done check or workspace: those keys are dropped, as server-owned fields are.
{ "goal": "Make the docs job run nightly", "input": { "mode": "implement", "issue": "ENG-142", "doneWhen": "always", "workspace": "/" } }
//   → stored: { "mode": "implement", "issue": "ENG-142", "harness": …, "model": …, "plan": … } — implement's own doneWhen and workspace run
```

A worker can pin its mode with the lock (ER-11), and a filing that conflicts is refused by name:

```md
<!-- workers/researcher/WORKER.md -->
---
flow: coder
lock:
  mode: answer
---
```

```jsonc
{ "assignee": "devteam.researcher", "goal": "Make the docs job run nightly", "input": { "mode": "implement", "issue": "ENG-142" } }
//   → refused: worker "devteam.researcher" always runs with mode answer; this task asked for implement. Nothing was filed.
```

A legacy row filed before FIX-2878 still carries the marker. It is read as `implement` with its
issue (BP-030) at filing, `updateTask` and claim, and nothing writes the marker again. The marker's
`phase` is ignored, so every well-formed marker is `implement`; one with no valid `issue` is
refused, never run as an answer:

```jsonc
// stored:  { "harnessFeature": { "issue": "ENG-142", "phase": "code" } }
// read as: { "mode": "implement", "issue": "ENG-142" }   (`phase` ignored, whatever it says)
// stored:  { "harnessFeature": { "phase": "code" } }   → refused: this task's feature marker is malformed. Nothing ran.
```

The task's own text is appended to the mode's instructions; per-task wording lives there, never
in a mode:

```text
── implement's instructions ──
You are working on ENG-142 in a checkout of the repo on branch devteam/ENG-142.
Commit what you change with git. You are done when the branch has a commit the base lacks.

── the task ──
Make the docs job run nightly. Keep the weekly link-check as it is.
```

`mode` is never inherited (ER-2). A child an `implement` run files with no mode gets the app's
default, not the parent's mode; only the three run settings come down:

```ts
it("a child filing takes the app's default mode, not its parent's", async () => {
  const parent = await claimed(board, { assignee: "devteam.coder", input: { mode: "implement", issue: "ENG-142" } });
  const child = await asRunOf(parent).createTask({ assignee: "devteam.coder", goal: "what does the docs job read?" });
  const frozen = await runOf(parent);
  // the three run settings, and the app's defaultMode written in at filing, not the parent's "implement"
  expect(child.input).toEqual({ harness: frozen.harnessId, model: frozen.model, plan: frozen.plan, mode: "answer" });
  await claimed(child);
  expect((await runOf(child)).mode).toBe("answer"); // Shift Manager's default
});
```

**Illustration only, not built:** a future board stage is a task on a mode. An app that wants
plan → implement → review registers three modes and files a task per stage; nothing new is needed.
"Phase" stays free for that board idea.

```ts
harnesses({ workspace, modes: { plan: planMode, implement: implementMode, review: reviewMode }, defaultMode: "plan" });
// stage 1: { mode: "plan", issue: "ENG-142" } → stage 2: { mode: "implement", issue: "ENG-142" } → stage 3: { mode: "review", issue: "ENG-142" }
```
