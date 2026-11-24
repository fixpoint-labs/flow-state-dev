// FIX-2894; epic FIX-2876 ER-9, ER-10.
/**
 * The one filing check a task's input passes on a declared flow, and the
 * claim's parse. The board calls these (`../conversation-board/board`), and
 * so do the raw handles a task session is handed (`./checked-ledger`); the
 * check names no field a flow declares.
 *
 * - **Filing** ({@link checkFiling}), in this order: `refuse` on what was
 *   sent · drop every server-owned name · `fill` them, or keep the stored
 *   values (an edit of a row filled for this flow and declaration) · the
 *   board's own rewrite of `project` · parse · `check`, handed a deep clone,
 *   and its return parsed again · **re-pin**: each server-owned value is
 *   compared with a deep clone taken before `check` and restored from it,
 *   always, a difference refused as a bug in the flow · the JSON round trip
 *   the stored row takes · the project requirement. Every refusal is a
 *   `TaskWriteRefusedError` and ends `Nothing was filed.`
 * - **The stamp** ({@link FILLED_FOR}): each row filled here names the flow
 *   and the declaration it was filled for. Stored server-owned values are
 *   trusted only while the stamp names the row's current flow and declaration.
 * - **Claim** ({@link claimInput}): the stored row through `stored`, its
 *   server-owned values filled again when its stamp is stale (`at: "claim"`),
 *   then the schema. A row that doesn't fit fails its attempt, `Nothing ran.`
 */
import type { BlockContext } from "@flow-state-dev/core/types";
import { deepEqual, isPlainObject } from "@flow-state-dev/contracts/helpers/deep-equal";
import { TaskWriteRefusedError } from "@flow-state-dev/orchestration/tasks";
import type { Task } from "@flow-state-dev/orchestration/tasks";
import type { ZodIssue } from "zod";
import type { TaskInputSchema, TaskInputRecord, TaskInputWorker } from "./declaration";

// FIX-2894; BP-030.
/**
 * The metadata key on a task the board filled for a declared flow: the flow
 * and the declaration's fingerprint, `{ flow, declaration }`. Server-written;
 * a caller's filing or patch never reaches it (`callerMetadata`). `null` on a
 * row moved onto a flow that declares nothing. **Absent** on a row filed
 * before rows carried it, which is filled again at its first claim or edit.
 */
export const FILLED_FOR = "inputFilledFor";

/** What {@link FILLED_FOR} holds. */
export interface FilledFor {
  readonly flow: string;
  readonly declaration: string;
}

/** The row's stamp, or `undefined` for none. */
export function filledForOf(task: Pick<Task, "metadata"> | undefined): FilledFor | undefined {
  const stamp = task?.metadata?.[FILLED_FOR] as { flow?: unknown; declaration?: unknown } | null | undefined;
  return stamp != null && typeof stamp.flow === "string" && typeof stamp.declaration === "string"
    ? { flow: stamp.flow, declaration: stamp.declaration }
    : undefined;
}

/** Whether the row was filled for `flow` under `declaration`, so its stored server-owned values stand. */
export function stampMatches(task: Pick<Task, "metadata"> | undefined, flow: string, declaration: TaskInputSchema): boolean {
  const stamp = filledForOf(task);
  return stamp !== undefined && stamp.flow === flow && stamp.declaration === declaration.fingerprint;
}

/**
 * The worker a task is checked for, read once: its id, the flow it runs on and
 * its configuration, all from one read of its record. The declaration a check
 * runs against, the hooks' context and the stamp all come from this one value,
 * so a record that changes between two reads can't mix two answers.
 */
export interface CheckedWorker extends TaskInputWorker {
  readonly flow: string;
}

/** What one filing check is run on. */
export interface FilingCheck {
  readonly ctx: BlockContext;
  /** The declaration `worker.flow` carries. */
  readonly declaration: TaskInputSchema;
  /** The worker the task is for, read once. */
  readonly worker: CheckedWorker;
  /** What the filer sent as the task's input (on a move with no new input, what the row carries). */
  readonly sent: unknown;
  /**
   * The server-owned values to keep instead of filling: the stored row's,
   * read through `stored`, on an edit of a row whose stamp matches.
   * `undefined` fills them.
   */
  readonly kept?: TaskInputRecord;
  /** The board's own rewrite of the input before the parse (the session's project over a named one). */
  readonly rewrite?: (input: TaskInputRecord) => TaskInputRecord;
  /** Whether the task has a project to work in, asked only for a declaration that requires one. */
  readonly hasProject?: (input: TaskInputRecord) => Promise<boolean>;
  /** The `no_project` refusal's text, for a declaration that requires a project. */
  readonly noProject?: () => string;
}

/** What the check stores: the input, and the row's stamp. */
export interface CheckedInput {
  readonly input: TaskInputRecord;
  readonly filledFor: FilledFor;
}

const NOTHING_FILED = "Nothing was filed.";

/**
 * Run the filing check.
 *
 * @throws TaskWriteRefusedError `input_refused` (a misfit, a `check` that
 *   changed a server-owned field, a value that doesn't survive being stored),
 *   `no_project`, or a code the flow's own `refuse` or `check` throws.
 */
export async function checkFiling(run: FilingCheck): Promise<CheckedInput> {
  const { declaration } = run;
  const { id: assignee, flow, config } = run.worker;
  const hooks = { ctx: run.ctx, assignee, worker: { id: assignee, config }, flow };
  // Only a missing input reads as none: `null` is an input, and the schema decides it.
  const sent = asRecord(run.sent === undefined ? {} : run.sent);
  if (sent === undefined) throw misfit(assignee, flow, "the input is not an object");
  await declaration.refuse?.(sent, hooks);
  const owned = new Set(declaration.serverOwned);
  const filerFields = Object.fromEntries(Object.entries(sent).filter(([name]) => !owned.has(name)));
  const serverValues = pick(run.kept ?? ((await declaration.fill?.({ ...hooks, at: "filing" })) ?? {}), owned);
  const rewritten = run.rewrite === undefined ? { ...filerFields, ...serverValues } : run.rewrite({ ...filerFields, ...serverValues });
  const parsed = parseOrRefuse(declaration, rewritten, assignee, flow);
  // The baseline: a deep, independent copy of each server-owned value, taken
  // before `check`, which is handed its own copy too, so nothing it does to a
  // server-owned value, in place or not, is ever stored.
  const uncopied = (what: string) =>
    new TaskWriteRefusedError(
      "input_refused",
      `this task's input for "${assignee}" (flow "${flow}") can't be copied: ${what}. Store plain JSON values. ${NOTHING_FILED}`
    );
  const baseline = clone(pick(parsed, owned), uncopied);
  let checked = parsed;
  if (declaration.check !== undefined) {
    const returned = await declaration.check(clone(parsed, uncopied), hooks);
    checked = parseOrRefuse(declaration, returned, assignee, flow);
    for (const name of owned) {
      if (!sameValue(Object.hasOwn(checked, name) ? checked[name] : undefined, Object.hasOwn(baseline, name) ? baseline[name] : undefined)) {
        throw new TaskWriteRefusedError(
          "input_refused",
          `flow "${flow}"'s check changed "${name}", which only its filler writes. This is a bug in the flow, not in the task. ${NOTHING_FILED}`
        );
      }
    }
    // Restored from the baseline whatever the comparison found: the stored value is the filler's.
    checked = { ...checked };
    for (const name of owned) {
      if (Object.hasOwn(baseline, name)) checked[name] = baseline[name];
      else delete checked[name];
    }
  }
  assertSurvivesStorage(declaration, checked, assignee, flow);
  if (declaration.project === "required" && run.hasProject !== undefined && !(await run.hasProject(checked))) {
    throw new TaskWriteRefusedError("no_project", run.noProject?.() ?? `"${assignee}" works in a project's files, and this task has no project for it to work in. ${NOTHING_FILED}`);
  }
  return { input: checked, filledFor: { flow, declaration: declaration.fingerprint } };
}

/** The facts every claim is held to, declared flow or not. */
export type ClaimAuthority = Pick<ClaimInput, "runningFlow" | "recordedFlow" | "worker"> & { readonly task: Pick<Task, "assignee"> };

/**
 * **At claim, the running entry is the authority**, for every `work` entry,
 * one that declares its input or not: the flow the hand-over recorded and
 * the worker, read once for this claim, must both name the running entry's
 * flow, or the attempt fails and nothing runs.
 *
 * @returns The worker as read, for the rest of the claim to use.
 * @throws TaskWriteRefusedError `input_refused`, ending `Nothing ran.`
 */
export function assertClaimAuthority(run: ClaimAuthority): CheckedWorker {
  const { runningFlow: flow, task, worker } = run;
  if (run.recordedFlow !== undefined && run.recordedFlow !== flow) {
    throw notRunnable(flow, `the task was handed over for flow "${run.recordedFlow}", and this is flow "${flow}"'s entry`);
  }
  if (worker === undefined || worker.id !== task.assignee || worker.flow !== flow) {
    throw notRunnable(
      flow,
      worker === undefined || worker.id !== task.assignee
        ? `its worker "${task.assignee ?? ""}" can't be read now`
        : `its worker "${worker.id}" now runs on flow "${worker.flow}"`
    );
  }
  return worker;
}

/**
 * What the claim parses a stored task with. **At claim, the running entry is
 * the authority:** the flow is the one whose `work` entry is executing, and
 * every other fact must name that same flow.
 */
export interface ClaimInput {
  readonly ctx: BlockContext;
  /** The running entry's declaration. */
  readonly declaration: TaskInputSchema;
  /** The flow whose `work` entry is executing: the one fact a roster move mid-flight can't change. */
  readonly runningFlow: string;
  /** The flow the hand-over recorded for this task session (`taskFlow`), when it recorded one. */
  readonly recordedFlow?: string;
  /** The task as stored. */
  readonly task: Pick<Task, "input" | "metadata" | "assignee">;
  /** The task's worker, read once for this claim; `undefined` when it can't be read now. */
  readonly worker: CheckedWorker | undefined;
}

/**
 * The input the worker block is handed. The claim runs only where everything
 * names the running entry's flow: the flow the hand-over recorded, and the
 * worker as read once for this claim; anything else fails the attempt. Then
 * the stored task through `stored`, its server-owned values filled again
 * (`at: "claim"`, from that one worker read, never a new one) unless its stamp
 * names this flow and declaration, and parsed. Only the schema and the stamp
 * are checked here: `check` and the project requirement are the filing's.
 *
 * @throws TaskWriteRefusedError `input_refused`, naming what didn't fit, ending `Nothing ran.`
 */
export async function claimInput(run: ClaimInput): Promise<TaskInputRecord> {
  const { declaration, runningFlow: flow, task } = run;
  const worker = assertClaimAuthority(run);
  // Only a missing input reads as none: a stored `null` fails the attempt, as a filing refuses one.
  const raw = asRecord(task.input === undefined ? {} : task.input);
  if (raw === undefined) throw notRunnable(flow, "the input is not an object");
  const read = declaration.stored === undefined ? raw : declaration.stored(raw);
  let input = read;
  if (!stampMatches(task, flow, declaration) && declaration.serverOwned.length > 0) {
    const owned = new Set(declaration.serverOwned);
    const filerFields = Object.fromEntries(Object.entries(read).filter(([name]) => !owned.has(name)));
    const filled =
      declaration.fill === undefined
        ? {}
        : pick(await declaration.fill({ ctx: run.ctx, at: "claim", assignee: worker.id, worker: { id: worker.id, config: worker.config }, flow }), owned);
    input = { ...filerFields, ...filled };
  }
  const parsed = declaration.schema.safeParse(input);
  if (!parsed.success) throw notRunnable(flow, issueText(parsed.error.issues[0]));
  return parsed.data;
}

function parseOrRefuse(declaration: TaskInputSchema, value: unknown, assignee: string, flow: string): TaskInputRecord {
  const parsed = declaration.schema.safeParse(value);
  if (!parsed.success) throw misfit(assignee, flow, issueText(parsed.error.issues[0]));
  return parsed.data;
}

function misfit(assignee: string, flow: string, what: string): TaskWriteRefusedError {
  return new TaskWriteRefusedError(
    "input_refused",
    `this task's input doesn't fit what "${assignee}" takes (flow "${flow}"): ${what}. Read what it takes with listDelegates. ${NOTHING_FILED}`
  );
}

function notRunnable(flow: string, what: string): TaskWriteRefusedError {
  return new TaskWriteRefusedError("input_refused", `this task's input no longer fits what flow "${flow}" takes: ${what}. Nothing ran.`);
}

/** One zod issue, in the refusal's words: where, and what was expected. */
function issueText(issue: ZodIssue | undefined): string {
  if (issue === undefined) return "invalid";
  const at = issue.path.length === 0 ? "" : `at "${issue.path.join(".")}", `;
  switch (issue.code) {
    case "invalid_type":
      return issue.received === "undefined" ? `${at}required` : `${at}expected ${issue.expected}, received ${issue.received}`;
    case "unrecognized_keys":
      return `${at}unrecognized key${issue.keys.length === 1 ? "" : "s"} ${issue.keys.map((key) => JSON.stringify(key)).join(", ")}`;
    case "invalid_enum_value":
      return `${at}expected ${issue.options.map((option) => JSON.stringify(option)).join(" | ")}, received ${JSON.stringify(issue.received)}`;
    case "invalid_literal":
      return `${at}expected ${JSON.stringify(issue.expected)}, received ${JSON.stringify(issue.received)}`;
    default:
      return `${at}invalid`;
  }
}

/**
 * Refuse a value whose stored form would parse differently: serialised as
 * JSON, parsed back and through the schema again, it must equal what was
 * checked. Names the first value that changes and how.
 */
function assertSurvivesStorage(declaration: TaskInputSchema, value: TaskInputRecord, assignee: string, flow: string): void {
  const unstored = (what: string) =>
    new TaskWriteRefusedError(
      "input_refused",
      `this task's input for "${assignee}" (flow "${flow}") doesn't survive being stored: ${what}. Store plain JSON values. ${NOTHING_FILED}`
    );
  const exotic = firstNonJson(value, []);
  if (exotic !== undefined) throw unstored(exotic);
  const again = declaration.schema.safeParse(JSON.parse(JSON.stringify(value)));
  if (!again.success) throw unstored(`once stored it no longer parses: ${issueText(again.error.issues[0])}`);
  const changed = firstDifference(value, again.data, []);
  if (changed !== undefined) throw unstored(changed);
}

/** The first value under `value` with no JSON form of its own, as the refusal names it. */
function firstNonJson(value: unknown, path: string[]): string | undefined {
  const at = path.length === 0 ? "" : `at "${path.join(".")}", `;
  if (value === null || typeof value === "string" || typeof value === "boolean") return undefined;
  if (typeof value === "number") return Number.isFinite(value) ? undefined : `${at}${String(value)} becomes null`;
  if (typeof value === "bigint") return `${at}a BigInt can't be stored`;
  if (value === undefined) return path.length === 0 ? `the input is undefined` : undefined;
  if (typeof value !== "object") return `${at}a ${typeof value} can't be stored`;
  if (Array.isArray(value)) {
    for (const [i, item] of value.entries()) {
      if (item === undefined) return `at "${[...path, String(i)].join(".")}", undefined becomes null`;
      const found = firstNonJson(item, [...path, String(i)]);
      if (found !== undefined) return found;
    }
    return undefined;
  }
  if (!isPlainObject(value)) {
    const type = (value as object).constructor?.name ?? "object";
    return value instanceof Date ? `${at}a Date becomes a string` : `${at}a ${type} becomes ${value instanceof Map || value instanceof Set ? "{}" : "a plain object"}`;
  }
  for (const [key, inner] of Object.entries(value)) {
    const found = firstNonJson(inner, [...path, key]);
    if (found !== undefined) return found;
  }
  return undefined;
}

/** Where `after` differs from `before`, or `undefined` when they are the same JSON value. */
function firstDifference(before: unknown, after: unknown, path: string[]): string | undefined {
  const at = path.length === 0 ? "the input" : `at "${path.join(".")}"`;
  if (isPlainObject(before) && isPlainObject(after)) {
    for (const key of new Set([...Object.keys(before), ...Object.keys(after)])) {
      if (before[key] === undefined && !Object.hasOwn(after, key)) continue;
      const found = firstDifference(before[key], after[key], [...path, key]);
      if (found !== undefined) return found;
    }
    return undefined;
  }
  if (Array.isArray(before) && Array.isArray(after) && before.length === after.length) {
    for (let i = 0; i < before.length; i++) {
      const found = firstDifference(before[i], after[i], [...path, String(i)]);
      if (found !== undefined) return found;
    }
    return undefined;
  }
  return sameValue(before, after) ? undefined : `${at}, ${JSON.stringify(before) ?? String(before)} becomes ${JSON.stringify(after) ?? String(after)}`;
}

function sameValue(a: unknown, b: unknown): boolean {
  try {
    return deepEqual(a, b);
  } catch {
    return false;
  }
}

/** A deep, independent copy; a value with no structured copy (a function) refuses the filing. */
function clone<T>(value: T, refuse: (what: string) => Error): T {
  try {
    return structuredClone(value);
  } catch (error) {
    // Never an alias: a hook handed the original could change the baseline it is compared with.
    throw refuse(error instanceof Error ? error.message : String(error));
  }
}

function asRecord(value: unknown): TaskInputRecord | undefined {
  return isPlainObject(value) ? value : undefined;
}

function pick(record: TaskInputRecord, names: ReadonlySet<string>): TaskInputRecord {
  return Object.fromEntries(Object.entries(record).filter(([name]) => names.has(name)));
}
