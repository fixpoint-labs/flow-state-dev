# FIX-2876 · Sketch: one request through the set

[Spec](SPEC.md) · [Decisions](DECISIONS.md) · **Sketch**

Illustrative TypeScript, not shipping code. It follows one request from a person's *Code with*
pick to the run that uses it, on the APIs `main` has at `3bdcd2817`. Every name without a mark
is real today. `// NEW (FIX-xxxx)` marks what a child adds. Where a child's spec picks the name
or the shape, the comment says so. Nothing here decides anything [DECISIONS](DECISIONS.md) leaves
to a child.

## 1 · The coder flow declares what its tasks take (FIX-2894, FIX-2878)

The `work` entry names a schema. Filing checks a task against it, and the entry checks it again
when the task is claimed. `harness` and `model` are on the schema, but only the server writes
them (step 3).

```ts
// packages/harness-manager/src/kit/coder-flow.ts
import { harnessFeatureSchema } from "../manager";
import { projectAddressSchema, workerTaskEntry } from "@flow-state-dev/workforce";

/** A model as the harness takes it: an id, or Cursor's `{ id, params }`. */
const modelSelection = z.union([
  z.string().min(1),
  z.object({ id: z.string().min(1), params: z.array(z.object({ id: z.string(), value: z.string() })).optional() }).strict(),
]);

export const codingTaskInput = z // NEW (FIX-2878)
  .object({
    harness: z.string().min(1).optional(), // written by the server only (ER-10)
    model: modelSelection.optional(), // written by the server only (ER-10)
    feature: harnessFeatureSchema.optional(), // was input.harnessFeature; the namespacing goes
    project: projectAddressSchema.optional(), // was input.project
  })
  .strict();

task: {
  actions: {
    work: workerTaskEntry({
      name: `${CODER_FLOW}-work`,
      input: codingTaskInput, // NEW (FIX-2894): declared, so filing and claim can check it
      block: byHarness(`${CODER_FLOW}-by-harness`, taskWorkerInputSchema.passthrough(), (b) => b.manager, true),
    }),
  },
},
```

Filing uses the same hook the board already has for projects (`assertProjectFor`). The claim
check is one more `tap` on the entry's sequencer.

```ts
// packages/workforce/src/conversation-board/board.ts, inside the guarded createTask
const targeted = await withTarget(init);
await assertInputFor(targeted); // NEW (FIX-2894)
await assertProjectFor(targeted);

/** NEW (FIX-2894): the assignee's flow's declared input, checked before anything is reserved. */
const assertInputFor = async (init: TaskInit): Promise<void> => {
  const assignee = init.assignee ?? (await soleDelegate());
  const flow = assignee === undefined ? undefined : (await reach(ctx)).available.get(assignee);
  const declared = flow === undefined ? undefined : options.declaredInput?.(flow); // NEW, beside options.needsProject
  if (declared === undefined) return; // no declaration: an open record, as today
  const parsed = declared.safeParse(init.input ?? {});
  if (!parsed.success) {
    throw new TaskWriteRefusedError("input_refused", `this task's input doesn't fit "${assignee}": ${parsed.error.issues[0]!.message}. Nothing was filed.`);
  }
};

// packages/workforce/src/conversation-board/task-entry.ts, in workerTaskEntry
const base = sequencer({ name, inputSchema: taskWorkerInputSchema })
  .tap(noteRoutedFrom)
  .tap(startAtFiledHop)
  .tap((task: TaskWorkerInput) => void options.input?.parse(task.input ?? {})); // NEW (FIX-2894): again at claim
```

## 2 · The person's pick travels as a field, not text (FIX-2879)

The browser sends the pick beside the message. No `Coding harness:` line is added.

```ts
// labs/teammates/src/app/conversations.ts
await workforce.send(sessionId, text, {
  attachments: [...attachments],
  fields: { codeWith: { harness: picked.harness, model: picked.model } }, // NEW (FIX-2879)
});
```

The harness kit declares the field. `sessionFields` is kit config today, so FIX-2879 turns it into
a keyed slot that another kit can fill.

```ts
// packages/harness-manager/src/kit/harnesses-kit.ts, in contributes
const codeWithSchema = z.object({ harness: z.string().min(1), model: modelSelection.optional() }).strict();
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

## 3 · Filing: the server writes harness and model (ER-10)

What the filer sent is dropped, whatever it is. Then the session's last pick is written in. A
hand-over carries `codeWith` into the task's session (`carriedSessionFields`), so a task filed by a
worker carries it too. The stamp runs before `assertInputFor`.

```ts
// packages/workforce/src/conversation-board/board.ts, inside the guarded createTask
const init = stampRunSettings(heldAsTurnSays(ctx, asked)); // NEW: drop in FIX-2878, write in FIX-2879

/** NEW: whatever the filer's tool args, input or metadata said, harness and model are the turn's. */
const stampRunSettings = (init: TaskInit): TaskInit => {
  const { harness: _h, model: _m, ...rest } = (init.input ?? {}) as Record<string, unknown>;
  // FIX-2879: the pick the session holds. The hook's shape (how workforce reads a harness-kit
  // field without knowing the harness kit) is the spec set's to choose.
  const pick = options.runSettingsOf?.(ctx.session.state); // NEW (FIX-2879)
  return { ...init, input: { ...rest, ...pick } }; // no pick: the task carries none, and the worker's harness is used
};
```

The attack the security review raised, refused:

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
```

## 4 · One order, on every route (ER-2, ER-11)

`harnessOf` resolves from the worker alone today. It is replaced by one resolver over the task.
The order is the task, then the worker, then the kit. The work and steer routes are handed the
task. The message and door routes find it from the session.

```ts
// packages/harness-manager/src/kit/coder-flow.ts, replacing harnessOf
const resolveRun = async (ctx: BlockContext, task: { input?: unknown } | undefined) => { // NEW (FIX-2878)
  const worker = await installation.resolveWorker(ctx, CODER_FLOW);
  const own = worker.config.harness as string | undefined;
  const asked = codingTaskInput.parse(task?.input ?? {});
  // ER-11: a locked worker refuses a different pick by name. It never runs it, and never ignores it.
  if (worker.config.harnessLocked === true && asked.harness !== undefined && asked.harness !== own) { // NEW (FIX-2878): name is its spec's
    throw new Error(`worker "${worker.id}" always codes with ${own}; this task asked for ${asked.harness}. Nothing ran.`);
  }
  const id = asked.harness ?? own ?? options.defaultHarness;
  const found = id === undefined ? undefined : built[id];
  if (found === undefined) throw new Error(`no harness "${id ?? "(none)"}" here; one of ${ids.join(", ")}. Nothing ran.`);
  const review = (worker.config.review as boolean | undefined) ?? options.review === true;
  // Model: the task's, checked (step 5), else the harness's own default. ER-2 also names worker and
  // kit layers for a model; neither has a model field today, so none is drawn here.
  return { ...found, id, manager: review ? found.reviewed : found.manager, model: await checkModel(harnesses[id]!, asked.model) };
};

/** The task this session works, for the routes that are handed none (a message, the door). */
const sessionTaskOf = async (ctx: BlockContext) => {
  const filed = await board(ctx);
  return filed === undefined ? undefined : sessionTask(filed.tasks, ctx.session.identity.id);
};

// In byHarness: work and steer are handed the task; message and door look it up.
execute: async (input: { input?: unknown } & Record<string, unknown>, ctx: never) => {
  // A task's own input carries `goal`; a message or a door line doesn't (the door's `taskId` is a label only).
  const chosen = await resolveRun(ctx, "goal" in input ? input : await sessionTaskOf(ctx));
  if (ready) {
    const missing = await refusal(chosen.id);
    if (missing !== undefined) throw new Error(missing); // a refused harness fails; it never moves to another
  }
  return pick(chosen);
},
```

## 5 · The model is checked against the catalog, and resume checks the harness (ER-2, ER-8)

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
```

A session is resumed only by the harness that started it, matched by its `id`. `source` cannot
tell `claude-code` from `claude-code-plan`, because both report `claude-code/sdk`.

```ts
// manager.ts, the harness block's resume feed (each manager is built for one harness id)
resume: (ctx) => {
  const state = harnessCtxState(ctx);
  // NEW (FIX-2878): the run row records `previousHarness` beside the session it names.
  return state?.previousHarness === harnessId ? (state.previousSessionId ?? null) : null; // another coder: a fresh session
},

// session-door.ts, the talk: the same check on the door's path
if (record.harnessId !== dispatched) throw new SessionDoorRefused("coder-changed"); // NEW (FIX-2878): its spec picks fresh or refuse
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
  // + the coder option for its split of feature work from answers. FIX-2877's spec shapes it.
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
harnessLocked: true   # NEW (FIX-2878): a pick naming another harness is refused by name
---
```
