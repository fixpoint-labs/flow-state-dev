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

export const codingTaskInput = z // NEW (FIX-2878)
  .object({
    harness: z.string().min(1).optional(), // server-owned (ER-10): the filler writes it
    model: modelSelection.optional(), // server-owned (ER-10): the filler writes it
    feature: harnessFeatureSchema.optional(), // was input.harnessFeature; the namespacing goes
    project: projectAddressSchema.optional(), // was input.project
  })
  .strict();

task: {
  actions: {
    work: workerTaskEntry({
      name: `${CODER_FLOW}-work`,
      // NEW (FIX-2894): the declaration; FIX-2894's spec picks `taskInput`'s final shape.
      input: taskInput(codingTaskInput, {
        serverOwned: ["harness", "model"],
        fill: fillRunSettings, // NEW (FIX-2878): the harness kit's filler (step 3)
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
does meet is FIX-2894's own break: old keys (`harnessFeature`) are refused at claim, and a task
filed before FIX-2878 may carry a `harness` or `model` no filler wrote. Both fall under the drain
that the FIX-2894 implementer note asks its spec to name as a deliberate exception to BP-030.

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

## 3 · Filing: the harness kit's filler writes harness and model (ER-10)

The board has already dropped whatever the filer sent for `harness` and `model` (step 1), because
the coder flow's declaration marks them server-owned. The harness kit's filler writes them back
in, so workforce reads no harness-kit field. From a person's turn, the pick is the session's last
`codeWith`. From a filing no person started, it is the frozen pair on the filing run's own record
(step 4), never the task session's carried copy (`carriedSessionFields`), which was taken at
hand-over and can be stale. The filler runs before the parse.

The filler fills only harness and model. It never picks the assignee: with one coder worker that
takes its harness per task, the pick has nothing to route. A model-written assignee is held at the
claim instead (step 4, ER-11): whichever worker claims the task, it runs the task's harness or
refuses it by name.

```ts
// packages/harness-manager/src/kit/coder-flow.ts: the harness kit's filler (NEW, FIX-2878)
const fillRunSettings = async (ctx: BlockContext): Promise<Partial<CodingTaskInput>> => {
  const run = await activeRunOf(ctx); // the filing session's own run record, if it is a coding run
  if (run !== undefined) {
    // A filing no person started: the filing run's frozen pair, kept exactly. Never the kit default, never wider.
    return { harness: run.harnessId!, ...(run.model == null ? {} : { model: run.model }) };
  }
  // NEW (FIX-2879): a person's turn, or a conversation turn no user started (Q-C). Until FIX-2879
  // lands there is no `codeWith`: the task carries none, and the worker's harness is used.
  return (ctx.session.state as { codeWith?: Partial<CodingTaskInput> }).codeWith ?? {};
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
  await expect(claimed(task)).rejects.toThrow(/always codes with claude-code; this task asked for claude-code-plan/);
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
  // This runs for every worker that claims a coding task, not only the one the turn meant: an
  // unlocked worker runs the task's harness, a locked one runs it or refuses. So a model-written
  // assignee can't move a task onto another coder, and the assignee needs no stamp.
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
