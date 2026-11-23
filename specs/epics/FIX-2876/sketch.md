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

## 3 · Filing: the server writes harness, model and assignee (ER-10)

What the filer sent is dropped, whatever it is. Then the server writes the pick in, through a
stamper the host supplies to `createTask` and the harness kit provides, so workforce reads no
harness-kit field. From a person's turn, the pick is the session's last `codeWith`. From a filing
no person started, it is the frozen pair on the filing run's own record (step 4), never the task
session's carried copy (`carriedSessionFields`), which was taken at hand-over and can be stale. The
stamp runs before `assertInputFor`.

```ts
// packages/workforce/src/conversation-board/board.ts, inside the guarded createTask
const init = await stampRunSettings(heldAsTurnSays(ctx, asked)); // NEW: drop in FIX-2878, write in FIX-2879

/** NEW: whatever the filer's tool args, input or metadata said, harness and model are the server's. */
const stampRunSettings = async (init: TaskInit): Promise<TaskInit> => {
  const { harness: _h, model: _m, ...rest } = (init.input ?? {}) as Record<string, unknown>;
  // NEW (FIX-2879): host-supplied, beside `needsProject`; its spec picks the final name.
  const stamped = await options.runSettingsOf?.(ctx); // { pick?, assignee? }, or undefined: no harness kit here
  // ER-10: the assignee is the turn's routing's, never a model-written one. FIX-2878's spec picks refuse or restamp.
  if (stamped?.assignee !== undefined && init.assignee !== undefined && init.assignee !== stamped.assignee) {
    throw new TaskWriteRefusedError("assignee_refused", `this turn routes coding work to "${stamped.assignee}", not "${init.assignee}". Nothing was filed.`);
  }
  return { ...init, input: { ...rest, ...stamped?.pick } }; // a person's turn with no pick: none, and the worker's harness is used
};

// packages/harness-manager/src/kit/harnesses-kit.ts: the harness kit's stamper (NEW, FIX-2879)
const runSettingsOf = async (ctx: BlockContext) => {
  const assignee = await routedCoderOf(ctx); // the coding worker the authenticated turn routes to; FIX-2878's spec reads it
  const run = await activeRunOf(ctx); // the filing session's own run record, if it is a coding run
  if (run !== undefined) {
    // A filing no person started: the filing run's frozen pair, kept exactly. Never the kit default, never wider.
    return { assignee, pick: { harness: run.harnessId!, ...(run.model == null ? {} : { model: run.model }) } };
  }
  const codeWith = (ctx.session.state as { codeWith?: { harness: string; model?: unknown } }).codeWith;
  return { assignee, pick: codeWith }; // a person's turn, or a conversation turn no user started (Q-C)
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

it("a task a worker's run files inherits that run's frozen pick", async () => {
  const parent = await claimed(board, { assignee: "teammates.coder", input: {} }, { codeWith: { harness: "claude-code-plan" } });
  await conversation.respond({ message: "now use codex", fields: { codeWith: { harness: "codex" } } }); // a later pick
  const child = await asRunOf(parent).createTask({ assignee: "teammates.coder", goal: "split the fix", input: { harness: "codex" } });
  expect(child.input).toEqual({ harness: "claude-code-plan" }); // the filing run's pair: not the later pick, not the kit default
});
```

## 4 · One order at the claim, frozen for every route (ER-2, ER-11)

`harnessOf` resolves from the worker alone today. It is replaced by one resolver over the task.
For a harness the order is the task, then the worker, then the kit; for a model, the task, then the
harness value's own default. Only a fresh work claim runs it, and it freezes what it resolved on the
run record. Steer, message, door and resume read that frozen pair, never the session's current
`codeWith`, so a pick made after the claim changes nothing in flight.

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
  // Model: the task's, checked (step 5), else the harness value's own default (cursorHarness({ model })).
  // There is no worker-config model and no kit-default model (ER-2).
  return { ...found, id, manager: review ? found.reviewed : found.manager, model: await checkModel(harnesses[id]!, asked.model) };
};

/** NEW (FIX-2878): the pair a fresh work claim froze, for every other route. */
const frozenRunOf = async (ctx: BlockContext) => {
  const filed = await board(ctx);
  const task = filed === undefined ? undefined : sessionTask(filed.tasks, ctx.session.identity.id);
  const run = task === undefined ? undefined : await readRunRecord(ctx, runTopicOf(task));
  if (run?.harnessId == null) throw new Error("this session's task has not been claimed; nothing to steer. Nothing ran.");
  const found = built[run.harnessId];
  if (found === undefined) throw new Error(`the run's harness "${run.harnessId}" is not here any more. Nothing ran.`);
  return { ...found, id: run.harnessId, model: { model: run.model ?? undefined } };
};

// In byHarness: only the work entry's fresh claim resolves; steer, message and door read the frozen pair.
execute: async (input: { input?: unknown } & Record<string, unknown>, ctx: never) => {
  // A task's own input carries `goal`; a steer, a message or a door line doesn't (the door's `taskId` is a label only).
  const freshClaim = "goal" in input && route === "work"; // `route`: byHarness's own argument, one per entry
  const chosen = freshClaim ? await resolveRun(ctx, input) : await frozenRunOf(ctx);
  if (freshClaim) {
    // NEW (FIX-2878): frozen beside `sessionId`; both fields `.nullable().default(null)` (BP-030).
    await writeRunRecord(ctx, { harnessId: chosen.id, model: chosen.model.model ?? null });
  }
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

A session is resumed only by the harness that started it, matched by the `id` frozen on the run
record. `source` cannot tell `claude-code` from `claude-code-plan`, because both report
`claude-code/sdk`. The door takes no pick, so on its path the frozen harness is also the one
dispatched; the check matters when a fresh work claim resolved differently from the session on
record.

```ts
// manager.ts, the harness block's resume feed (each manager is built for one harness id)
resume: (ctx) => {
  const state = harnessCtxState(ctx);
  // NEW (FIX-2878): the run row's frozen `harnessId`, beside the session it names.
  return state?.harnessId === harnessId ? (state.previousSessionId ?? null) : null; // another coder: a fresh session
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
