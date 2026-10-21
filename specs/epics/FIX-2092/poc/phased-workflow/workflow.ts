/**
 * FIX-2092 POC candidate: `defineWorkflow`, a phased workflow as a template
 * that only files tasks.
 *
 * Experimental evidence retained with the epic spec. Not production code, not
 * a workspace package, outside every default build, test, lint and fallow scan.
 * Kept portable on purpose: this is the piece an implementer could start from;
 * `run.ts` is the throwaway shell around it.
 *
 * What it does, and all it does:
 * - `start` files every step as a task on the delegation board it is handed,
 *   with fan-in dependencies (each step depends on every step, or the gate, of
 *   the phase before), deterministic ids `<featureTaskId>:<stepKey>`, and writes
 *   a session-state record `{ name, policy, phases, steps: { key → taskId } }`.
 * - `addStep` files a late step and re-wires the next layer that hasn't started.
 * - `view` derives "step N of M", per-phase status and "next" from the rows plus
 *   the record, and nothing else.
 *
 * Where today's code has no field or write for what the plan needs, this file
 * uses a named stand-in (search for STAND-IN):
 * - no `phase` on a task → the phase rides in `metadata.phase`;
 * - no held start → a gate row is filed `undispatched` (a recorded row the
 *   board never claims) and released with the ref's `dispatch`;
 * - no `updateTask({ deps })` → `rewireDeps` writes `deps` on the durable row
 *   through the resource layer, refusing a row that has started.
 */
import { handler } from "../../../../../packages/core/src/index";
import type { BlockContext } from "../../../../../packages/core/src/types";
import { resolveResourceCollection } from "../../../../../packages/orchestration/src/tasks";
import type { Task, TaskCollectionRef } from "../../../../../packages/orchestration/src/tasks";
import { z } from "zod";

// ---------------------------------------------------------------------------
// Definition
// ---------------------------------------------------------------------------

/** One step: a task one delegate does. */
export interface StepDef {
  readonly key: string;
  /** The delegate (board assignee) the step is filed for. */
  readonly assignee: string;
  /** `"new"` (default): a fresh session. `{ followUpOf }`: that earlier step's session. */
  readonly session?: "new" | { readonly followUpOf: string };
  readonly goal?: string;
}

/**
 * A gate after a phase: one held row the next phase depends on.
 * `user`: a person releases it (the approval). `worker`: the feature worker
 * releases it from its `onTaskSettled` once the phase passed; the only way this
 * POC found to make a loop-back safe (see README, check 2).
 */
export interface GateDef {
  readonly by: "user" | "worker";
  readonly prompt?: string;
}

export interface PhaseDef {
  readonly name: string;
  readonly label?: string;
  readonly steps: readonly StepDef[];
  readonly gate?: GateDef;
}

export interface WorkflowDef {
  readonly name: string;
  /** Opaque to the template; stored in the record for the worker's decisions. */
  readonly policy: Record<string, unknown>;
  readonly phases: readonly PhaseDef[];
}

/** The session-state record. A cache of membership and order; status always comes from rows. */
export interface WorkflowRecord {
  name: string;
  featureTaskId: string;
  policy: Record<string, unknown>;
  phases: Array<{ name: string; label?: string; stepKeys: string[]; gate?: { by: "user" | "worker"; key: string } }>;
  /** Every step and gate the workflow filed, by key → task id. Late steps included. */
  steps: Record<string, string>;
}

/** What the template is bound to: the board it files on, and a control switch. */
export interface WorkflowBinding {
  /** The delegation board the feature worker files on. */
  readonly tasks: (ctx: BlockContext) => Promise<TaskCollectionRef>;
  /** The ledger's resource id, for the `updateTask({ deps })` stand-in. */
  readonly ledgerId: string;
  /** CONTROL: file every step with no dependencies (`GOAL_CONTROL=no-fanin`). */
  readonly fanIn?: boolean;
}

/** Session-state key the record lives under. */
export const WORKFLOW_STATE_KEY = "workflows";

/** Metadata every workflow row carries. STAND-IN for a `phase` field: the phase rides here. */
export interface WorkflowRowMeta {
  workflow: string;
  feature: string;
  phase: string;
  step: string;
  kind: "step" | "gate";
  round: number;
  gateBy?: "user" | "worker";
}

export const stepTaskId = (featureTaskId: string, key: string) => `${featureTaskId}:${key}`;
const gateKey = (phase: string) => `gate-${phase}`;

function validate(def: WorkflowDef): void {
  const seen = new Set<string>();
  for (const phase of def.phases) {
    if (phase.steps.length === 0) throw new Error(`phase "${phase.name}" has no steps`);
    for (const step of phase.steps) {
      if (seen.has(step.key)) throw new Error(`step key "${step.key}" is used twice`);
      if (typeof step.session === "object" && !seen.has(step.session.followUpOf)) {
        throw new Error(`step "${step.key}" follows up "${step.session.followUpOf}", which is not an earlier step`);
      }
      seen.add(step.key);
    }
  }
}

function freshRecord(def: WorkflowDef, featureTaskId: string): WorkflowRecord {
  const record: WorkflowRecord = { name: def.name, featureTaskId, policy: def.policy, phases: [], steps: {} };
  for (const phase of def.phases) {
    const stepKeys = phase.steps.map((s) => s.key);
    for (const key of stepKeys) record.steps[key] = stepTaskId(featureTaskId, key);
    const entry: WorkflowRecord["phases"][number] = { name: phase.name, stepKeys };
    if (phase.label !== undefined) entry.label = phase.label;
    if (phase.gate !== undefined) {
      const key = gateKey(phase.name);
      entry.gate = { by: phase.gate.by, key };
      record.steps[key] = stepTaskId(featureTaskId, key);
    }
    record.phases.push(entry);
  }
  return record;
}

/** The rows a phase hands on to the next one: its gate, or else its steps. */
function exitsOf(record: WorkflowRecord, phaseIndex: number): string[] {
  const phase = record.phases[phaseIndex]!;
  if (phase.gate !== undefined) return [record.steps[phase.gate.key]!];
  return phase.stepKeys.map((k) => record.steps[k]!);
}

/** Layers in run order: each phase's steps, then its gate. */
function layers(record: WorkflowRecord): Array<{ phaseIndex: number; ids: string[] }> {
  const out: Array<{ phaseIndex: number; ids: string[] }> = [];
  record.phases.forEach((phase, phaseIndex) => {
    out.push({ phaseIndex, ids: phase.stepKeys.map((k) => record.steps[k]!) });
    if (phase.gate !== undefined) out.push({ phaseIndex, ids: [record.steps[phase.gate.key]!] });
  });
  return out;
}

export function readRecords(ctx: BlockContext): Record<string, WorkflowRecord> {
  const state = (ctx.session.state ?? {}) as Record<string, unknown>;
  // A copy, never the live object: a record mutated in place and patched back
  // compares equal to the state it came from, and the write is dropped.
  return structuredClone((state[WORKFLOW_STATE_KEY] as Record<string, WorkflowRecord> | undefined) ?? {});
}

async function writeRecord(ctx: BlockContext, record: WorkflowRecord): Promise<void> {
  const records = readRecords(ctx);
  records[record.featureTaskId] = record;
  await ctx.session.patchState({ [WORKFLOW_STATE_KEY]: records } as never);
}

const isEnded = (t: Pick<Task, "status">) => t.status === "completed" || t.status === "errored" || t.status === "cancelled";
const hasStarted = (t: Pick<Task, "status" | "startedAt">) => t.status !== "pending" || t.startedAt !== undefined;

/**
 * STAND-IN for FIX-2056's `updateTask({ deps })`, "allowed before it starts".
 * Today a task's `deps` are written once, at filing; no ref method changes them.
 * This writes the durable row through the resource layer and refuses a row that
 * has started, which is the rule the real field must keep.
 */
async function rewireDeps(ctx: BlockContext, ledgerId: string, taskId: string, add: string[]): Promise<"rewired" | "started"> {
  const collection = resolveResourceCollection(ctx, ledgerId);
  if (collection === undefined) throw new Error(`ledger "${ledgerId}" is not registered on this flow`);
  const row = await collection.getOptional(taskId);
  if (row === undefined) throw new Error(`no row "${taskId}" to re-wire`);
  let verdict: "rewired" | "started" = "rewired";
  await row.updateState((state) => {
    const task = state as unknown as Task;
    if (hasStarted(task)) {
      verdict = "started";
      return state;
    }
    const deps = Array.from(new Set([...(task.deps ?? []), ...add]));
    return { ...state, deps } as typeof state;
  });
  return verdict;
}

// ---------------------------------------------------------------------------
// The template
// ---------------------------------------------------------------------------

export interface AddStepInput {
  readonly featureTaskId: string;
  readonly phase: string;
  readonly key: string;
  readonly assignee: string;
  readonly goal?: string;
  /** Step keys the late step waits on. Default: the exits of the phase before. */
  readonly after?: readonly string[];
  /** `{ followUpOf }`: run in that step's session (a follow-up). */
  readonly session?: "new" | { readonly followUpOf: string };
  readonly round?: number;
  readonly input?: unknown;
}

export interface AddStepResult {
  readonly taskId: string;
  readonly filed: boolean;
  /** Rows whose deps now include the late step. */
  readonly rewired: string[];
  /** Rows the late step should have held back but which had already started. */
  readonly startedEarly: string[];
}

export function defineWorkflow(def: WorkflowDef, binding: WorkflowBinding) {
  validate(def);
  const fanIn = binding.fanIn !== false;

  async function start(ctx: BlockContext, featureTaskId: string): Promise<{ filed: string[]; existing: string[]; record: WorkflowRecord }> {
    const ref = await binding.tasks(ctx);
    // A replay keeps the record it finds (late steps included) and files only
    // what is missing. Ids are deterministic, so "missing" is a lookup.
    const record = readRecords(ctx)[featureTaskId] ?? freshRecord(def, featureTaskId);
    const filed: string[] = [];
    const existing: string[] = [];

    for (let p = 0; p < def.phases.length; p += 1) {
      const phase = def.phases[p]!;
      const deps = p === 0 || !fanIn ? [] : exitsOf(record, p - 1);
      for (const step of phase.steps) {
        const id = record.steps[step.key]!;
        if (ref.get(id) !== undefined) {
          existing.push(id);
          continue;
        }
        const meta: WorkflowRowMeta = { workflow: def.name, feature: featureTaskId, phase: phase.name, step: step.key, kind: "step", round: 1 };
        await ref.addTask({
          id,
          goal: step.goal ?? `${phase.name}: ${step.key}`,
          title: step.key,
          assignee: step.assignee,
          deps,
          input: {},
          metadata: meta as unknown as Record<string, unknown>,
          ...(typeof step.session === "object" ? { followUpOf: record.steps[step.session.followUpOf]! } : {})
        });
        filed.push(id);
      }
      if (phase.gate !== undefined) {
        const key = gateKey(phase.name);
        const id = record.steps[key]!;
        if (ref.get(id) !== undefined) {
          existing.push(id);
        } else {
          const meta: WorkflowRowMeta = {
            workflow: def.name, feature: featureTaskId, phase: phase.name, step: key, kind: "gate", round: 1, gateBy: phase.gate.by
          };
          // STAND-IN for a held task: `undispatched` is a recorded row the
          // board never claims until `dispatch` readies it.
          await ref.addTask({
            id,
            goal: phase.gate.prompt ?? `approve ${phase.name}`,
            title: key,
            assignee: "gate",
            deps: fanIn ? phase.steps.map((s) => record.steps[s.key]!) : [],
            input: {},
            undispatched: true,
            metadata: meta as unknown as Record<string, unknown>
          });
          filed.push(id);
        }
      }
    }
    await writeRecord(ctx, record);
    return { filed, existing, record };
  }

  async function addStep(ctx: BlockContext, step: AddStepInput): Promise<AddStepResult> {
    const ref = await binding.tasks(ctx);
    const record = readRecords(ctx)[step.featureTaskId];
    if (record === undefined) throw new Error(`no workflow record for "${step.featureTaskId}"`);
    const phaseIndex = record.phases.findIndex((p) => p.name === step.phase);
    if (phaseIndex < 0) throw new Error(`no phase "${step.phase}"`);
    const id = stepTaskId(step.featureTaskId, step.key);

    let filed = false;
    if (ref.get(id) === undefined) {
      const deps = step.after !== undefined ? step.after.map((k) => record.steps[k]!) : phaseIndex === 0 ? [] : exitsOf(record, phaseIndex - 1);
      const meta: WorkflowRowMeta = {
        workflow: record.name, feature: step.featureTaskId, phase: step.phase, step: step.key, kind: "step", round: step.round ?? 1
      };
      await ref.addTask({
        id,
        goal: step.goal ?? `${step.phase}: ${step.key}`,
        title: step.key,
        assignee: step.assignee,
        deps: fanIn ? deps : [],
        input: step.input ?? {},
        metadata: meta as unknown as Record<string, unknown>,
        ...(typeof step.session === "object" ? { followUpOf: record.steps[step.session.followUpOf]! } : {})
      });
      filed = true;
    }
    if (!record.phases[phaseIndex]!.stepKeys.includes(step.key)) record.phases[phaseIndex]!.stepKeys.push(step.key);
    record.steps[step.key] = id;

    // Re-wire the first layer after this phase's steps that hasn't ended.
    // Unstarted: its rows wait on the late step too. Started: too late.
    const rewired: string[] = [];
    const startedEarly: string[] = [];
    const all = layers(record);
    const own = all.findIndex((l) => l.phaseIndex === phaseIndex && l.ids.includes(id));
    for (const layer of all.slice(own + 1)) {
      const rows = layer.ids.map((x) => ref.get(x)).filter((t): t is NonNullable<typeof t> => t !== undefined);
      if (rows.length > 0 && rows.every(isEnded)) continue;
      for (const row of rows) {
        if (row.deps?.includes(id)) continue;
        const verdict = fanIn ? await rewireDeps(ctx, binding.ledgerId, row.id, [id]) : "rewired";
        (verdict === "rewired" ? rewired : startedEarly).push(row.id);
      }
      break;
    }
    await writeRecord(ctx, record);
    return { taskId: id, filed, rewired, startedEarly };
  }

  /**
   * Release a gate: STAND-IN for answering a held task (FIX-2058's approval).
   * `dispatch` clears `undispatched`; the board then runs the gate row like any
   * other, through a no-op `gate` assignee, and its ending satisfies the next
   * phase's dependency.
   */
  async function releaseGate(ctx: BlockContext, featureTaskId: string, phase: string, call: string) {
    const ref = await binding.tasks(ctx);
    const id = stepTaskId(featureTaskId, gateKey(phase));
    if (ref.dispatch === undefined) throw new Error("this ref has no dispatch");
    return ref.dispatch(id, { call });
  }

  /** A ready handler for a `work` entry's `.step()`: starts the workflow for the task in its input. */
  const startBlock = handler({
    name: `${def.name}-start`,
    inputSchema: z.object({ featureTaskId: z.string() }),
    outputSchema: z.object({ filed: z.array(z.string()), existing: z.array(z.string()) }),
    execute: async (input, ctx) => {
      const { filed, existing } = await start(ctx as BlockContext, input.featureTaskId);
      return { filed, existing };
    }
  });

  return { definition: def, start, addStep, releaseGate, startBlock };
}

// ---------------------------------------------------------------------------
// The display: rows + record, nothing else
// ---------------------------------------------------------------------------

export type PhaseStatus = "done" | "running" | "awaiting-approval" | "awaiting-worker" | "ready" | "waiting";

export interface WorkflowView {
  /** 1-based position of the first step that hasn't ended; M+1 once all have. */
  stepN: number;
  stepM: number;
  phases: Array<{ name: string; status: PhaseStatus; steps: Array<{ key: string; status: string }> }>;
  current: string | null;
  next: string[];
  approvalsWaiting: string[];
}

/**
 * Derive the display from the stored rows and the record. Pure: it reads no
 * context, no store, no clock. If this can't say something, the rows and the
 * record don't carry it.
 */
export function view(record: WorkflowRecord, rows: readonly Task[]): WorkflowView {
  const byId = new Map(rows.map((r) => [r.id, r]));
  const row = (key: string) => byId.get(record.steps[key]!);
  const ordered = record.phases.flatMap((p) => p.stepKeys);
  const firstOpen = ordered.findIndex((k) => {
    const r = row(k);
    return r === undefined || !isEnded(r);
  });
  const phases = record.phases.map((p) => {
    const steps = p.stepKeys.map((k) => ({ key: k, status: row(k)?.status ?? "missing" }));
    const gate = p.gate === undefined ? undefined : row(p.gate.key);
    let status: PhaseStatus;
    if (steps.some((s) => s.status === "in_progress")) status = "running";
    else if (steps.every((s) => s.status === "completed")) {
      if (gate === undefined || gate.status === "completed") status = "done";
      else if (gate.undispatched === true) status = p.gate!.by === "user" ? "awaiting-approval" : "awaiting-worker";
      else status = "running";
    } else {
      const startable = p.stepKeys.some((k) => {
        const r = row(k);
        return r !== undefined && r.status === "pending" && (r.deps ?? []).every((d) => byId.get(d)?.status === "completed");
      });
      status = startable ? "ready" : "waiting";
    }
    return { name: p.name, status, steps };
  });
  const current = phases.find((p) => p.status !== "done")?.name ?? null;
  const next = ordered.filter((k) => {
    const r = row(k);
    return r !== undefined && r.status === "pending";
  }).slice(0, 3);
  const approvalsWaiting = record.phases
    .filter((p) => p.gate?.by === "user" && row(p.gate.key)?.undispatched === true && p.stepKeys.every((k) => row(k)?.status === "completed"))
    .map((p) => p.gate!.key);
  return { stepN: firstOpen < 0 ? ordered.length + 1 : firstOpen + 1, stepM: ordered.length, phases, current, next, approvalsWaiting };
}
