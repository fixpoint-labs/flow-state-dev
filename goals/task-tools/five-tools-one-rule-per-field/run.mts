/**
 * Goal check — a worker or a screen changes a task through five task tools;
 * every field of `updateTask` follows one rule, which a refusal names; and a
 * task reaches only a worker its filer may give work to (FIX-2081).
 *
 * **Model-free.** A real `createFlowState` host on a SQLite store, with
 * Workforce's real worker flows (the built-in `agent` flow and the
 * `coordinator`), and every model turn scripted: the scripted model reads the
 * tools it was offered off each model request, and makes the calls the
 * turn's message names. Callers act over the host's HTTP router, each as a
 * verified user. Every grade reads the tools as the model got them, the tool
 * results as the model got them, or the rows through the public read actions
 * (`getTask_tasks`, `listTasks_tasks`), never the collection.
 *
 * Legs (each failure is tagged `<leg>:<assertion>`):
 *   a  the tools each worker's model is offered: a coordinator's and an agent
 *      worker's turn get the filer's four and `listDelegates`,
 *      and none of the removed six nor `dispatchTask`; only a coordinator set
 *      to `editsOwnDelegates` gets `addDelegate`, `removeDelegate`,
 *      `setFallback`; `reportProgress` and `askQuestion` only on a task
 *      turn; an inline plan step that calls `reportProgress({ output })`
 *      checkpoints its own row, and the task's result is still the answering
 *      turn's
 *   b  every `updateTask` field in every state (pending, held, pending after a
 *      retry, running, finished), by the tool and by `updateTask_tasks` as
 *      the user: an allowed write reads back changed, a refused one leaves the
 *      row unchanged and names the field and the state; a release with a
 *      reassign obeys the same table; a cancel with an edit is
 *      refused; a running task's reassign is refused and its first worker's
 *      result lands
 *   c  filing and delegates: a piece for a non-delegate is refused; under
 *      `delegates: all`, a worker hired mid-session is reachable; Bob's call
 *      to Alice's action is refused
 *
 * Controls (a scratch patch to the code under test as it loads;
 * `goals/lib/module-patch.mts`):
 *   GOAL_CONTROL=roster-reach    a task session reaches the whole roster
 *     again. Must FAIL leg c on "a piece for a non-delegate is refused".
 *   GOAL_CONTROL=edit-any-state  the field table's state rule is off. Must
 *     FAIL leg b on the running and finished columns.
 *
 * Run: pnpm tsx goals/task-tools/five-tools-one-rule-per-field/run.mts
 */
import { spawnSync } from "node:child_process";
import { rmSync } from "node:fs";
import { join } from "node:path";
import { encodeUserSegment } from "@flow-state-dev/core/types";
import { createFlowState, runAction } from "@flow-state-dev/engine";
import { sqliteStores } from "@flow-state-dev/store-sqlite";
import { createMockModelResolver, type MockGeneratorInstance } from "@flow-state-dev/testing";
import {
  ROSTER_FLOW,
  createWorkerInstallation,
  defineAgentWorkerFlow,
  defineCoordinatorFlow,
  hireWorkforce,
  type WorkerManifest
} from "@flow-state-dev/workforce";
import {
  REPO_ROOT,
  RUN_STAMP,
  assertPatched,
  describePatches,
  goalTmpDir,
  actingAs,
  modulePatchEnv,
  runGoal,
  silentLogger,
  untilIdle,
  type ModulePatch
} from "../../lib/index.mts";

const ALICE = "u_tools_alice";
const BOB = "u_tools_bob";
const ORG = "org_tools";
const CONTROL = process.env.GOAL_CONTROL ?? "";
const SCRATCH = process.env.GOAL_SCRATCH ?? goalTmpDir("five-tools-one-rule-per-field");

const PATCHES: Record<string, ModulePatch[]> = {
  // A task session's delegates are the whole roster again, as before FIX-2081.
  "roster-reach": [
    {
      module: "packages/workforce/src/delegates/worker-delegates.ts",
      from: String.raw`    const listed = currentDelegates\(ctx\.session\.state, await turnDefaults\(ctx\)\);`,
      to:
        "    const listed = typeof (ctx.session.state as Record<string, unknown> | undefined)?.taskId === \"string\"" +
        " ? { delegates: (await installation.roster(ctx as never)).map((worker) => ({ worker: worker.id })), fallback: null }" +
        " : currentDelegates(ctx.session.state, await turnDefaults(ctx));"
    }
  ],
  // The field table's state rule off: in the tool's pre-check and inside the guarded write.
  "edit-any-state": [
    {
      module: "packages/orchestration/src/skills/task-tools-capability.ts",
      from: String.raw`      const locked = ownRule \? \[\] : lockedFields\(current, edits\);`,
      to: "      const locked: TaskEditField[] = []; void ownRule;"
    },
    {
      module: "packages/orchestration/src/tasks/collection/internal.ts",
      from: String.raw`  const locked = legacyReleaseOnly\(task, patch\) \? \[\] : lockedFields\(task, patchFields\(patch\)\);\n  if \(locked\.length > 0\) return \{ decline: "started" \};\n  const declined = settingsDecline\(task\);\n  if \(declined !== undefined\) return \{ decline: declined \};`,
      to: "  void lockedFields; void settingsDecline;"
    },
    {
      module: "packages/orchestration/src/tasks/collection/resource-backed.ts",
      from: String.raw`        return decided\.patch as Partial<Task<TInput, TOutput>>;\n      \},\n      \{ declineOnTerminal: true \}`,
      to: "        return decided.patch as Partial<Task<TInput, TOutput>>;\n      },\n      { declineOnTerminal: false }"
    }
  ]
};

if (CONTROL !== "" && PATCHES[CONTROL] === undefined) {
  console.error(`unknown GOAL_CONTROL "${CONTROL}"; known: ${Object.keys(PATCHES).join(", ")}`);
  process.exit(2);
}
// A patched control runs this same file again with the patch applied as it loads.
if (PATCHES[CONTROL] !== undefined && process.env.GOAL_MODULE_PATCH === undefined) {
  const mark = join(SCRATCH, `patch-mark-${RUN_STAMP}`);
  rmSync(mark, { force: true });
  console.error(`control ${CONTROL}:\n${describePatches(PATCHES[CONTROL]!, REPO_ROOT)}`);
  const child = spawnSync(process.execPath, [...process.execArgv, ...process.argv.slice(1)], {
    stdio: "inherit",
    env: { ...process.env, GOAL_SCRATCH: SCRATCH, ...modulePatchEnv(PATCHES[CONTROL]!, REPO_ROOT, mark) }
  });
  assertPatched(PATCHES[CONTROL]!, REPO_ROOT, mark);
  process.exit(child.status ?? 1);
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const show = (value: unknown) => JSON.stringify(value);

// ---- the scripted model -----------------------------------------------------------

/** One model request as the scripted model saw it. */
type Seen = { block: string | undefined; tag: string | undefined; tools: string[]; message: string };
/** One tool call the scripted model made, and what the tool answered it. */
type Answered = { tag: string | undefined; toolName: string; args: unknown; result: unknown };

const seen: Seen[] = [];
const answered: Answered[] = [];

/** A turn's calls, carried in its message so a task's goal can carry them too: `<<CALLS:base64(json)>>`. */
const calls = (list: Array<{ toolName: string; args: unknown }>) => `<<CALLS:${Buffer.from(JSON.stringify(list)).toString("base64")}>>`;
/** A step's calls, acted on only in the step's own turn. */
const stepCalls = (list: Array<{ toolName: string; args: unknown }>) => `<<STEP:${Buffer.from(JSON.stringify(list)).toString("base64")}>>`;

function textOf(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) return content.map((part) => (typeof part === "string" ? part : String((part as { text?: unknown }).text ?? ""))).join("");
  return "";
}

/** The last user message of a model request. */
function lastUser(messages: unknown): string {
  const list = Array.isArray(messages) ? (messages as Array<{ role?: string; content?: unknown }>) : [];
  for (let i = list.length - 1; i >= 0; i -= 1) if (list[i]!.role === "user") return textOf(list[i]!.content);
  return "";
}

const tagOf = (text: string) => /#([a-z0-9-]+)#/i.exec(text)?.[1]?.toLowerCase();

function decode(text: string, kind: "CALLS" | "STEP"): Array<{ toolName: string; args: unknown }> {
  const found = new RegExp(`<<${kind}:([A-Za-z0-9+/=]+)>>`).exec(text);
  return found === null ? [] : (JSON.parse(Buffer.from(found[1]!, "base64").toString("utf8")) as Array<{ toolName: string; args: unknown }>);
}

/** The one scripted model every turn runs on. */
function scriptedModel(): MockGeneratorInstance {
  const instance: MockGeneratorInstance = {
    name: "scripted",
    calls: [],
    next(input, context) {
      const message = lastUser(input);
      const tag = tagOf(message);
      const results = context?.toolResults ?? [];
      if (results.length === 0) {
        // Calls are made only on the turn the message was written for: a message
        // that opens with its tag, or a step's own turn. A notice that quotes a
        // task's goal makes none.
        const stepping = message.startsWith("You are working a step");
        const list = stepping ? decode(message, "STEP") : message.startsWith("#") ? decode(message, "CALLS") : [];
        if (list.length > 0) return { toolCalls: list.map((call, i) => ({ toolCallId: `call-${i}`, toolName: call.toolName, args: call.args })) };
      }
      return { text: message.startsWith("The steps you filed for yourself have ended") ? `FINAL ${tag ?? ""}` : `done ${tag ?? ""}` };
    },
    reset() {}
  };
  return instance;
}

/** The scripted model, with every request's tools and every tool's answer recorded. */
function modelResolver() {
  const brain = scriptedModel();
  const base = createMockModelResolver({
    generators: { "agent-answer": brain, "agent-answer-with-activate-tool": brain, "coordinator-judgment": brain },
    policy: "default",
    unmockedDefault: { text: "ok" }
  });
  const resolver = ((modelId: string, blockName?: string) => {
    const model = (base as any)(modelId, blockName);
    const record = (options: any) => {
      const message = lastUser(options.messages);
      seen.push({ block: blockName, tag: tagOf(message), tools: (options.tools ?? []).map((t: { name: string }) => t.name), message });
      // Only a turn whose message opens with its own tag sleeps, as only it makes
      // calls: a notice that quotes a task's goal neither calls nor sleeps.
      const slow = message.startsWith("#") ? /\[slow:(\d+)\]/.exec(message) : null;
      return slow === null ? undefined : sleep(Number(slow[1]));
    };
    const wrapTools = (options: any) => {
      const tag = tagOf(lastUser(options.messages));
      return {
        ...options,
        tools: (options.tools ?? []).map((tool: any) =>
          tool.execute === undefined
            ? tool
            : {
                ...tool,
                execute: async (args: unknown, ...rest: unknown[]) => {
                  const result = await tool.execute(args, ...rest);
                  answered.push({ tag, toolName: tool.name, args, result });
                  return result;
                }
              }
        )
      };
    };
    return {
      ...model,
      generate: async (options: any) => {
        await record(options);
        return model.generate(wrapTools(options));
      },
      ...(model.stream === undefined
        ? {}
        : {
            stream: async function* (options: any) {
              await record(options);
              yield* model.stream(wrapTools(options));
            }
          })
    };
  }) as ReturnType<typeof createMockModelResolver>;
  return Object.assign(resolver, base);
}

// ---- the host ----------------------------------------------------------------------

const worker = (id: string, declared: Record<string, unknown>): WorkerManifest => ({ id, declared, body: "", skills: [] });
const WORKERS: WorkerManifest[] = [
  worker("desk", { flow: "coordinator", delegates: ["eng.a", "eng.b"], description: "The person's desk." }),
  worker("chief", { flow: "coordinator", delegates: ["eng.a"], editsOwnDelegates: true, description: "Changes its own delegates." }),
  worker("fan", { flow: "agent", delegates: "all", description: "Reaches the whole roster." }),
  worker("eng.a", { flow: "agent", delegates: ["eng.b"], description: "Splits work." }),
  worker("eng.b", { flow: "agent", description: "Does work." }),
  worker("eng.c", { flow: "agent", description: "On the roster, nobody's delegate." })
];

/** The fields `updateTask` edits, two values each: one for the tool, one for the action. */
const FIELDS = ["goal", "title", "context", "input", "deps", "priority", "labels", "metadata", "assignee", "maxAttempts"] as const;
type Field = (typeof FIELDS)[number];

function buildHost(filename: string) {
  let flows: Record<string, unknown> = {};
  const installation = createWorkerInstallation({ standardWorkers: WORKERS, workerFlows: () => flows as never });
  const agent = defineAgentWorkerFlow({ installation });
  const coordinator = defineCoordinatorFlow({ installation, routeModel: "typesafe-ai/jev" });
  flows = { agent, coordinator };
  const copies = hireWorkforce(installation);
  const instances = Object.fromEntries(copies.map((copy) => [copy.id, copy]));
  const state = createFlowState({
    flows: instances,
    stores: { default: { primary: sqliteStores({ filename }) } },
    logger: silentLogger,
    modelResolver: modelResolver(),
    resolvePrincipal: (context: any) => {
      const user = context.request?.headers.get("x-user");
      return typeof user === "string" ? { userId: user, orgId: ORG } : null;
    }
  } as never);
  return { state, instances };
}

// ---- the legs ----------------------------------------------------------------------

await runGoal(async (failures) => {
  rmSync(join(SCRATCH, "main.sqlite"), { force: true });
  const { state, instances } = buildHost(join(SCRATCH, "main.sqlite"));
  const notes: string[] = [];
  const leg = async (name: string, body: () => Promise<void>) => {
    try {
      await body();
    } catch (error) {
      failures.push(`${name}:threw — ${error instanceof Error ? error.message : String(error)}`);
    }
  };
  try {
    const runtime = await state.getRuntime();
    const router = (await state.getRouter()) as never;
    const alice = actingAs(router, ALICE);
    const bob = actingAs(router, BOB);
    const idle = () => untilIdle(runtime.stores as never);
    const until = async (check: () => Promise<boolean>, ms: number) => {
      for (const deadline = Date.now() + ms; Date.now() < deadline; await sleep(50)) if (await check()) return true;
      return check();
    };
    const word = (name: string) => `${name} ${RUN_STAMP}`;

    const desk = await alice.open("coordinator", { workerId: "desk" });
    /** A desk turn: its message, scripted. */
    const deskTurn = (message: string) => alice.act("coordinator", desk, "respond", { message });
    /** A row on the desk's board, through the public read action. */
    const get = async (id: string) => ((await alice.act("coordinator", desk, "getTask_tasks", { id })) as { ok: boolean; task?: Record<string, any> }).task;
    const deskAct = (action: string, input: unknown) => alice.act("coordinator", desk, action, input);
    /** The task session a row's run names. */
    const sessionOf = async (id: string) => (await get(id))?.run?.sessionId as string | undefined;
    const results = (tag: string, toolName?: string) =>
      answered.filter((a) => a.tag === tag.toLowerCase() && (toolName === undefined || a.toolName === toolName));

    // ---- leg a: the tools each worker's model is offered -------------------------------
    await leg("a", async () => {
      // `answerTask` and `parkOnQuestion` joined the removed list with FIX-2131.
      const REMOVED = ["addTask", "assignTask", "completeTask", "failTask", "cancelTask", "readTask", "blockTask", "answerTask", "parkOnQuestion"];
      const FOUR = ["createTask", "getTask", "listTasks", "updateTask"];
      const OWN = ["addDelegate", "removeDelegate", "setFallback"];
      /** The model requests of `tag`'s own turn: the one its message opens, or a step's. */
      const toolsAt = (tag: string) =>
        seen.filter((s) => s.tag === tag && (s.message.startsWith(`#${tag}#`) || s.message.startsWith("You are working a step")));

      await deskTurn(`#a-desk# what is on the board?`);
      const chief = await alice.open("coordinator", { workerId: "chief" });
      await alice.act("coordinator", chief, "respond", { message: `#a-chief# who are my delegates?` });
      const conv = await alice.open("agent", { workerId: "eng.a" });
      await alice.act("agent", conv, "respond", { message: `#a-conv# hello` });

      // A task for eng.a whose turn plans a step; the step checkpoints its own row.
      const checkpoint = `STEP-CHECKPOINT ${RUN_STAMP}`;
      const goal =
        `#a-task# plan it ` +
        calls([
          {
            toolName: "createTask",
            args: { goal: `#a-step# do the step ${stepCalls([{ toolName: "reportProgress", args: { statusNote: "Halfway", output: checkpoint } }])}`, title: "the step", assignee: "eng.a" }
          }
        ]);
      const filed = await deskAct("createTask_tasks", { goal, assignee: "eng.a" });
      if (filed?.ok !== true) throw new Error(`dispatching eng.a's task was refused: ${show(filed)}`);
      await until(async () => (await get(filed.taskId))?.status === "completed", 30_000);
      await idle();

      const check = (tag: string, has: string[], hasNot: string[], what: string) => {
        const turns = toolsAt(tag);
        if (turns.length === 0) {
          failures.push(`a:${what} — no model request carried #${tag}#`);
          return;
        }
        for (const turn of turns) {
          const missing = has.filter((name) => !turn.tools.includes(name));
          const extra = hasNot.filter((name) => turn.tools.includes(name));
          if (missing.length > 0 || extra.length > 0) {
            failures.push(`a:${what} — ${turn.block} at #${tag}# was offered ${show(turn.tools)}; missing ${show(missing)}, should not have ${show(extra)}`);
          }
        }
      };
      check("a-desk", [...FOUR, "listDelegates"], [...REMOVED, ...OWN, "dispatchTask", "reportProgress", "askQuestion"], "coordinator offered the four, not its own delegate tools");
      check("a-chief", [...FOUR, "listDelegates", ...OWN], [...REMOVED], "a coordinator set to manage its delegates gets addDelegate, removeDelegate, setFallback");
      check("a-conv", [...FOUR, "listDelegates"], [...REMOVED, ...OWN, "reportProgress", "askQuestion"], "no reportProgress off a task turn");
      check("a-task", [...FOUR, "listDelegates", "reportProgress", "askQuestion"], [...REMOVED, ...OWN], "a task turn offered reportProgress and askQuestion");
      check("a-step", ["reportProgress"], [...REMOVED, ...OWN], "a step turn offered reportProgress");

      // The step's own row holds the checkpoint; the task's result is the answering turn's.
      const taskSession = await sessionOf(filed.taskId);
      const steps = taskSession === undefined ? undefined : await alice.act("agent", taskSession, "listTasks_tasks", {});
      const step = (steps?.tasks ?? []).find((t: { title?: string }) => t.title === "the step");
      const stepRead = step === undefined ? undefined : (await alice.act("agent", taskSession!, "getTask_tasks", { id: step.id }))?.task;
      if (stepRead?.output !== checkpoint || stepRead?.checkpoint !== true || stepRead?.statusNote !== "Halfway") {
        failures.push(`a:the step checkpoints its own row — wanted the step's row to read output ${show(checkpoint)}, checkpoint, note "Halfway"; read ${show(stepRead)}; step turn's calls ${show(results("a-step"))}`);
      }
      const top = await get(filed.taskId);
      if (top?.status !== "completed" || !String(show(top?.output)).includes("FINAL") || top?.checkpoint === true) {
        failures.push(`a:the task's result is the answering turn's — wanted eng.a's task completed with the answering turn's FINAL answer, no checkpoint; read ${show(top)}`);
      }
      notes.push(`a: step ${step?.id} read ${show({ output: stepRead?.output, note: stepRead?.statusNote })}; task ${show({ status: top?.status, output: top?.output })}`);
    });

    // ---- leg b: every updateTask field in every state ----------------------------------
    await leg("b", async () => {
      const file = async (input: Record<string, unknown>) => {
        const out = await deskAct("createTask_tasks", input);
        if (out?.ok !== true) throw new Error(`filing ${show(input)} was refused: ${show(out)}`);
        return out.taskId as string;
      };
      const anchor = await file({ goal: word("anchor"), assignee: "eng.b", held: true });
      const anchor2 = await file({ goal: word("anchor two"), assignee: "eng.b", held: true });
      const pending = await file({ goal: word("pending"), assignee: "eng.b", deps: [anchor] });
      const held = await file({ goal: word("held"), assignee: "eng.b", held: true });
      // Pending after a retry: stored as a failed first attempt leaves it, waiting on the held anchor.
      const retried = `retried-${RUN_STAMP}`;
      const filing = (await alice.act("coordinator", desk, "listDelegates", {})).filingSessionId as string;
      const now = Date.now();
      await runtime.stores.resourceState.set(
        "user",
        `${ALICE}:~org:${ORG}`,
        `tasks/${encodeUserSegment(filing)}/${retried}`,
        {
          id: retried,
          goal: word("retried"),
          status: "pending",
          attempts: 1,
          maxAttempts: 2,
          startedAt: now - 1000,
          assignee: "eng.b",
          deps: [anchor],
          feedback: "the first attempt failed",
          createdAt: now - 2000,
          updatedAt: now - 1000,
          revision: 1,
          writeLog: []
        } as never,
        "any" as never
      );
      const running = (await deskAct("createTask_tasks", { goal: `#b-running# ${word("running")} [slow:45000]`, assignee: "eng.b" })).taskId as string;
      const finished = (await deskAct("createTask_tasks", { goal: `#b-finished# ${word("finished")}`, assignee: "eng.b" })).taskId as string;
      await until(async () => (await get(running))?.status === "in_progress", 20_000);
      await until(async () => (await get(finished))?.status === "completed", 20_000);

      const states: Array<[name: string, id: string, allowed: boolean]> = [
        ["pending", pending, true],
        ["held", held, true],
        ["pending after a retry", retried, false],
        ["running", running, false],
        ["finished", finished, false]
      ];
      const value = (field: Field, path: "tool" | "action"): unknown => {
        const n = path === "tool" ? 1 : 2;
        switch (field) {
          case "goal":
            return word(`goal by ${path}`);
          case "title":
            return `Title by ${path}`;
          case "context":
            return `context by ${path}`;
          case "input":
            return { by: path };
          case "deps":
            return path === "tool" ? [anchor2] : [anchor, anchor2];
          case "priority":
            return n * 10;
          case "labels":
            return [`by-${path}`];
          case "metadata":
            return { [`by${path}`]: n };
          case "assignee":
            return path === "tool" ? "eng.a" : "eng.b";
          case "maxAttempts":
            return n + 2;
        }
      };
      /** What a read must show for `field` set to `v`. */
      const reads = (task: Record<string, any> | undefined, field: Field, v: unknown) =>
        field === "metadata" ? Object.entries(v as object).every(([k, x]) => task?.metadata?.[k] === x) : show(task?.[field]) === show(v);
      const stable = (task: Record<string, any> | undefined) => {
        if (task === undefined) return "missing";
        const { run: _run, statusNote: _note, ...rest } = task;
        return show(rest);
      };
      const STATE_WORD: Record<string, RegExp> = {
        pending: /pending/,
        held: /held/,
        "pending after a retry": /it is pending/,
        running: /it is in_progress/,
        finished: /task_finished: task "[^"]+" is completed/
      };

      for (const [name, id, allowed] of states) {
        for (const path of ["tool", "action"] as const) {
          for (const field of FIELDS) {
            const v = value(field, path);
            const before = await get(id);
            let out: any;
            if (path === "tool") {
              const tag = `b-${path}-${field}-${name.replaceAll(" ", "-")}`.toLowerCase();
              await deskTurn(`#${tag}# ${calls([{ toolName: "updateTask", args: { id, [field]: v } }])}`);
              out = results(tag, "updateTask")[0]?.result;
            } else {
              out = await deskAct("updateTask_tasks", { id, [field]: v });
            }
            const after = await get(id);
            if (allowed) {
              if (out?.ok !== true || !reads(after, field, v)) {
                failures.push(`b:${name}:${field} by ${path} — wanted the write to land and read back; answered ${show(out)}, read ${show(after?.[field])}`);
              }
              continue;
            }
            const error = String(out?.error ?? "");
            if (out?.ok !== false || !error.includes(field) || !STATE_WORD[name]!.test(error) || !error.includes(`task "${id}"`)) {
              failures.push(`b:${name}:${field} by ${path} — wanted a refusal naming ${field} and the ${name} state; answered ${show(out)}`);
            }
            if (stable(after) !== stable(before)) {
              failures.push(`b:${name}:${field} by ${path} — the refused write changed the row: ${stable(before)} → ${stable(after)}`);
            }
          }
          // A hold, and a release, by the same path.
          const status = name === "held" ? "pending" : "held";
          const before = await get(id);
          let out: any;
          if (path === "tool") {
            const tag = `b-${path}-status-${name.replaceAll(" ", "-")}`;
            await deskTurn(`#${tag}# ${calls([{ toolName: "updateTask", args: { id, status } }])}`);
            out = results(tag, "updateTask")[0]?.result;
          } else {
            out = await deskAct("updateTask_tasks", { id, status });
          }
          const after = await get(id);
          if (allowed) {
            // Put a released row back, so the next path finds it held.
            if (out?.ok !== true || after?.status !== status) failures.push(`b:${name}:status ${status} by ${path} — wanted it to land; answered ${show(out)}, status ${after?.status}`);
            if (name === "held" && after?.status === "pending" && path === "tool") await deskAct("updateTask_tasks", { id, status: "held" });
            if (name === "pending" && after?.status === "held") await deskAct("updateTask_tasks", { id, status: "pending" });
          } else if (out?.ok !== false || stable(after) !== stable(before)) {
            failures.push(`b:${name}:status ${status} by ${path} — wanted a refusal that writes nothing; answered ${show(out)}`);
          }
        }
        // A release with a reassign, in one write: only a held row, before it starts.
        if (!allowed) {
          const before = await get(id);
          const out = await deskAct("updateTask_tasks", { id, assignee: "eng.a", status: "pending" });
          const after = await get(id);
          if (out?.ok !== false || stable(after) !== stable(before)) {
            failures.push(`b:${name}:release with a reassign — wanted a refusal that writes nothing; answered ${show(out)}, ${stable(before)} → ${stable(after)}`);
          }
        }
      }
      // A held row is released and reassigned in one write, before it starts.
      const heldForDispatch = await file({ goal: `#b-dispatched# ${word("held for a release")}`, assignee: "eng.b", held: true });
      const dispatched = await deskAct("updateTask_tasks", { id: heldForDispatch, assignee: "eng.a", status: "pending" });
      await until(async () => (await get(heldForDispatch))?.status === "completed", 20_000);
      const afterDispatch = await get(heldForDispatch);
      if (dispatched?.ok !== true || afterDispatch?.assignee !== "eng.a") {
        failures.push(`b:held:release with a reassign — wanted a held row released to eng.a; answered ${show(dispatched)}, read ${show(afterDispatch)}`);
      }

      // A cancel with an edit is refused, by tool and by action, and writes nothing.
      for (const path of ["tool", "action"] as const) {
        const before = await get(pending);
        let out: any;
        if (path === "tool") {
          await deskTurn(`#b-cancel-edit# ${calls([{ toolName: "updateTask", args: { id: pending, status: "cancelled", priority: 99 } }])}`);
          out = results("b-cancel-edit", "updateTask").at(-1)?.result;
        } else {
          out = await deskAct("updateTask_tasks", { id: pending, status: "cancelled", priority: 99 });
        }
        if (out?.ok !== false || !String(out?.error).startsWith("cancel_takes_no_edits") || stable(await get(pending)) !== stable(before)) {
          failures.push(`b:a cancel with an edit is refused by ${path} — answered ${show(out)}`);
        }
      }

      // A running task's reassign is refused, and its first worker's result lands.
      const swap = (await deskAct("createTask_tasks", { goal: `#b-swap# ${word("swap")} [slow:2500]`, assignee: "eng.b" })).taskId as string;
      await until(async () => (await get(swap))?.status === "in_progress", 20_000);
      await deskTurn(`#b-swap-tool# ${calls([{ toolName: "updateTask", args: { id: swap, assignee: "eng.a" } }])}`);
      const byTool = results("b-swap-tool", "updateTask")[0]?.result as any;
      const byAction = await deskAct("updateTask_tasks", { id: swap, assignee: "eng.a" });
      await until(async () => (await get(swap))?.status === "completed", 30_000);
      const swapped = await get(swap);
      for (const [path, out] of [["tool", byTool], ["action", byAction]] as const) {
        if (out?.ok !== false || !/one accountable worker/.test(String(out?.error))) {
          failures.push(`b:a running task's reassign is refused by ${path} — answered ${show(out)}`);
        }
      }
      const swapSession = swapped?.run?.sessionId as string | undefined;
      const swapWorker = swapSession === undefined ? undefined : (await runtime.stores.session.get(swapSession))?.state?.workerId;
      if (swapped?.status !== "completed" || swapped?.assignee !== "eng.b" || swapWorker !== "eng.b" || !String(show(swapped?.output)).includes("b-swap")) {
        failures.push(`b:its first worker's result lands — wanted the row completed by eng.b with its answer; read ${show({ status: swapped?.status, assignee: swapped?.assignee, worker: swapWorker, output: swapped?.output })}`);
      }

      // A cancel lands until a task finishes, and records that a public action made it.
      const cancelled = await deskAct("updateTask_tasks", { id: running, status: "cancelled" });
      const afterCancel = await get(running);
      if (cancelled?.ok !== true || afterCancel?.status !== "cancelled") {
        failures.push(`b:a cancel lands on a running task — answered ${show(cancelled)}, read ${afterCancel?.status}`);
      }
      notes.push(`b: ${states.length} states × ${FIELDS.length} fields × 2 paths graded; the swap ran on ${swapWorker}`);
    });

    // ---- leg c: filing and delegates ---------------------------------------------------
    await leg("c", async () => {
      // A piece for a non-delegate, from eng.a's task session: refused; for its delegate: filed.
      const goal =
        `#c-piece# split it ` +
        calls([
          { toolName: "createTask", args: { goal: `#c-to-c# ${word("for a non-delegate")}`, assignee: "eng.c" } },
          { toolName: "createTask", args: { goal: `#c-to-c2# ${word("for a non-delegate, filed")}`, assignee: "eng.c" } },
          { toolName: "createTask", args: { goal: `#c-to-b# ${word("for a delegate")}`, assignee: "eng.b" } }
        ]);
      const filed = await deskAct("createTask_tasks", { goal, assignee: "eng.a" });
      await until(async () => (await get(filed.taskId))?.status === "completed", 40_000);
      await idle();
      const tried = results("c-piece");
      const toC = tried.filter((t) => (t.args as { assignee?: string }).assignee === "eng.c");
      const toB = tried.find((t) => (t.args as { assignee?: string }).assignee === "eng.b");
      const taskSession = await sessionOf(filed.taskId);
      const pieces = taskSession === undefined ? [] : ((await alice.act("agent", taskSession, "listTasks_tasks", {}))?.tasks ?? []);
      if (toC.length !== 2 || toC.some((t) => (t.result as any)?.ok !== false || !/^unknown_assignee: "eng\.c"/.test(String((t.result as any)?.error))) || pieces.some((p: { assignee?: string }) => p.assignee === "eng.c")) {
        failures.push(`c:a piece for a non-delegate is refused — eng.a's calls for eng.c answered ${show(toC.map((t) => t.result))}; pieces on its board ${show(pieces.map((p: any) => [p.assignee, p.status]))}`);
      }
      if ((toB?.result as any)?.ok !== true || !pieces.some((p: { assignee?: string }) => p.assignee === "eng.b")) {
        failures.push(`c:a piece for a delegate is filed — answered ${show(toB?.result)}; pieces ${show(pieces.map((p: any) => [p.assignee, p.status]))}`);
      }

      // Under delegates: all, a worker hired mid-session is reachable at once.
      const fan = await alice.open("agent", { workerId: "fan" });
      const hireId = `my.new${RUN_STAMP.replace(/[^a-z0-9]/gi, "").slice(-6).toLowerCase()}`;
      await alice.act("agent", fan, "respond", { message: `#c-fan-before# ${calls([{ toolName: "createTask", args: { goal: word("before the hire"), assignee: hireId } }])}` });
      const before = results("c-fan-before", "createTask")[0]?.result as any;
      const hired = (await runAction({
        orgId: ORG,
        flow: (instances as Record<string, any>)[ROSTER_FLOW],
        actionName: "hire",
        input: { id: hireId, flow: "agent", instructions: "Hired mid-session." },
        userId: ALICE,
        sessionId: `roster-${ALICE}`,
        stores: runtime.stores,
        runtimeConfig: { ...runtime.runtimeConfig }
      } as never)) as { error?: unknown };
      if (hired.error !== undefined) throw new Error(`hiring ${hireId} failed: ${show(hired.error)}`);
      await alice.act("agent", fan, "respond", { message: `#c-fan-after# ${calls([{ toolName: "createTask", args: { goal: `#c-hired# ${word("after the hire")}`, assignee: hireId } }])}` });
      const after = results("c-fan-after", "createTask")[0]?.result as any;
      await idle();
      const hiredRow = after?.taskId === undefined ? undefined : (await alice.act("agent", fan, "getTask_tasks", { id: after.taskId }))?.task;
      if (before?.ok !== false || after?.ok !== true || hiredRow?.assignee !== hireId) {
        failures.push(`c:under all, a worker hired mid-session is reachable — before the hire ${show(before)}, after ${show(after)}, row ${show(hiredRow)}`);
      }

      // Bob's call to Alice's action is refused, and writes nothing.
      const target = await deskAct("createTask_tasks", { goal: word("alice's"), assignee: "eng.b", held: true });
      const beforeBob = show(await get(target.taskId));
      let bobs: string;
      try {
        bobs = `answered ${show(await bob.act("coordinator", desk, "updateTask_tasks", { id: target.taskId, status: "cancelled" }))}`;
      } catch (error) {
        bobs = `refused: ${error instanceof Error ? error.message.slice(0, 160) : String(error)}`;
      }
      if (!bobs.startsWith("refused") || show(await get(target.taskId)) !== beforeBob) {
        failures.push(`c:Bob's call to Alice's action is refused — ${bobs}`);
      }
      notes.push(`c: eng.c ${show(toC.map((t) => (t.result as any)?.error?.slice(0, 40)))}; ${hireId} ${show({ before: before?.error?.slice(0, 40), after: after?.ok })}; Bob ${bobs.slice(0, 60)}`);
    });

    // Removed tools are no action either.
    const actions = Object.keys((instances as Record<string, any>).coordinator?.actions ?? {});
    const stale = actions.filter((name) => /^(addTask|assignTask|completeTask|failTask|cancelTask|readTask|blockTask)_/.test(name));
    if (stale.length > 0) failures.push(`a:no removed tool's action — the coordinator flow still has ${show(stale)}`);

    return { failures, evidence: notes.join(" | ") };
  } finally {
    await state.dispose();
  }
});
