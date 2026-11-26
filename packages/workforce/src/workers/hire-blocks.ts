/**
 * Hire, fork, edit and fire, as blocks: each a write to the caller's own
 * roster, the user-scoped worker collection. Nothing is registered, and
 * nothing restarts: the next turn on any process reads the row.
 *
 * Every write is checked before it is made, the way the worker's flow would
 * check it on a turn: the flow must be a worker flow that isn't kept for
 * standard workers, and the configuration must pass the flow's own schema
 * with every name it gives resolved. A refused write changes nothing.
 *
 * A standard worker's file is never written. Hire, fork and fire refuse a
 * standard worker's id. Edit on one makes the caller's own copy of it under
 * the same id, the copy a fork makes, which the turn and the
 * roster then read before the file; reset deletes that copy.
 *
 * A hire or an edit is also refused when anything it writes looks like an API
 * key (core's `containsSecret`), and, when the app lists the models a worker
 * may run on (`HireChecks.models`), when the model it names isn't listed or
 * has no key or gateway in this server's environment.
 */
import { containsSecret, handler, type JsonObject } from "@flow-state-dev/core";
import { describeModelRoute } from "@flow-state-dev/core/models";
import type { BlockDefinition, ResourceCollectionRef } from "@flow-state-dev/core/types";
import { z } from "zod";
import { AGENT_FLOW } from "../agent-worker-flow";
import type { WorkerManifest } from "../manifest";
import { problemsClause, type WorkerInstallation } from "./installation";
import { WORKERS_RESOURCE } from "./keys";
import { standardWorkerFlow, workerDisplayName } from "./standard-workers";
import { parseWorkerResourceState, workerResourceStateSchema, type WorkerResourceState } from "./worker-row";

const workerId = z.string().min(1).regex(/^[^/~][^/]*$/, "a worker id is one path segment and can't start with ~");

const hireInput = z
  .object({
    /** The new worker's id on the caller's roster. */
    id: workerId,
    /** The name a user reads it by. Not an address: the id stays its address. */
    name: z.string().optional(),
    /** The worker flow it runs on. Omitted, `agent`. */
    flow: z.string().min(1).optional(),
    description: z.string().optional(),
    instructions: z.string().optional(),
    /** Skills by name, resolved against the installation's skills. */
    skills: z.array(z.string().min(1)).optional(),
    /** The keys a `WORKER.md` frontmatter accepts other than `flow` and `description`. */
    settings: z.record(z.unknown()).optional()
  })
  .strict();

const forkInput = z
  .object({
    /** The worker to fork: a standard worker, or one of the caller's own. */
    from: z.string().min(1),
    /** The new worker's id. */
    id: workerId
  })
  .strict();

const editInput = z
  .object({
    id: z.string().min(1),
    /** A new display name; `null` clears it. The id never changes. */
    name: z.string().nullable().optional(),
    /** A new flow. A standard worker keeps its file's: naming another is refused. */
    flow: z.string().min(1).optional(),
    description: z.string().nullable().optional(),
    instructions: z.string().nullable().optional(),
    skills: z.array(z.string().min(1)).optional(),
    /** Replaces the stored settings whole. */
    settings: z.record(z.unknown()).optional(),
    /** Sets the settings it names over the stored ones, keeping the rest. Not with `settings`. */
    settingsPatch: z.record(z.unknown()).optional()
  })
  .strict()
  .refine((input) => input.settings === undefined || input.settingsPatch === undefined, {
    message: "Give settings (replace them whole) or settingsPatch (change the ones named), not both."
  });

const fireInput = z.object({ id: z.string().min(1) }).strict();

const resetInput = z.object({ id: z.string().min(1) }).strict();

const writtenOutput = z.object({ id: z.string(), flow: z.string() });

/** The five blocks, ready to mount as actions. */
export interface WorkerHireBlocks {
  /** Hire a new worker of the caller's own: `{ id, flow?, description?, instructions?, skills?, settings? }`. */
  hire: BlockDefinition<typeof hireInput, typeof writtenOutput>;
  /** Fork a standard worker, or one of the caller's own, under a new id: `{ from, id }`. */
  fork: BlockDefinition<typeof forkInput, typeof writtenOutput>;
  /**
   * Change one of the caller's own workers: `{ id, ...fields to replace }`.
   * On a standard worker's id, it first copies that worker onto the caller's
   * roster under the same id, unless the caller already has the copy.
   */
  edit: BlockDefinition<typeof editInput, typeof writtenOutput>;
  /** Delete one of the caller's own workers: `{ id }`. */
  fire: BlockDefinition<typeof fireInput, z.ZodObject<{ id: z.ZodString }>>;
  /** Delete the caller's copy of a standard worker, so the file is read again: `{ id }`. */
  reset: BlockDefinition<typeof resetInput, z.ZodObject<{ id: z.ZodString }>>;
}

/** What every hire and edit is checked against beyond the worker's flow: the kit's `hire` config. */
export interface HireChecks {
  /**
   * The models a worker may name in `settings.model`, as model strings
   * (`openai/gpt-6-luna`, `openrouter:nvidia/…`). Each must also have a key or
   * gateway in the server's environment (`describeModelRoute`): a key handed
   * to a model resolver in code isn't seen. Omitted: any model the flow takes.
   */
  models?: readonly string[];
}

/** The hire input, as the roster's `hire` action and the `hire` tool take it. */
export type HireInput = z.infer<typeof hireInput>;

/**
 * Why `model` can't be written under `checks`, or `undefined` when it can.
 * Only a model a write names is checked: a worker naming none runs on its
 * flow's default.
 */
function modelProblem(model: unknown, checks: HireChecks): string | undefined {
  if (checks.models === undefined || typeof model !== "string") return undefined;
  if (!checks.models.includes(model)) {
    return `runs on "${model}", which isn't a model this app runs workers on (${checks.models.join(", ") || "none"})`;
  }
  const route = describeModelRoute(model, { ...process.env });
  return route.available ? undefined : `runs on "${model}", which can't run on this server: ${route.reason}`;
}

/** Refuse a write of `fields` and `model` for worker `id`: a credential in any of them, or a model `checks` refuses. */
function refuseUnsafe(id: string, fields: unknown, model: unknown, checks: HireChecks): void {
  if (containsSecret(JSON.stringify(fields ?? null))) {
    throw new Error(
      `Worker "${id}" carries something shaped like an API key. A key never goes on a worker: the server reads it from its environment. Nothing was written.`
    );
  }
  const problem = modelProblem(model, checks);
  if (problem !== undefined) throw new Error(`Worker "${id}" ${problem}. Nothing was written.`);
}

/** Refuse a write that names a setting `flow` retired. */
function refuseRetired(installation: WorkerInstallation, id: string, flow: string, settings: Record<string, unknown> | undefined): void {
  const named = Object.keys(settings ?? {}).filter((key) => retiredOn(installation, flow).includes(key));
  if (named.length > 0) {
    throw new Error(
      `Worker "${id}" sets ${named.map((key) => `"${key}"`).join(", ")}, which flow "${flow}" no longer takes. Leave it out. Nothing was written.`
    );
  }
}

// BP-030.
/** The settings `flow` retired: a stored row reads without them, and a write naming one is refused. */
function retiredOn(installation: WorkerInstallation, flow: string): readonly string[] {
  return installation.workerFlows()[flow]?.retiredSettings ?? [];
}

/** Refuse `worker` under `id` when its flow would refuse it on a turn. */
function refuseProblems(installation: WorkerInstallation, id: string, worker: WorkerResourceState): void {
  const problems = installation.configurationProblems(id, worker);
  if (problems.length > 0) {
    throw new Error(`Worker "${id}" ${problemsClause(problems)}. Nothing was written.`);
  }
}

/**
 * The worker a hire of `input` writes, after every check the write makes short
 * of the roster itself (an id already there): a standard worker's id, a
 * credential, a refused model, a retired setting, and the flow's own schema.
 *
 * @throws With the reason, when any check refuses. Nothing is written.
 */
export function checkedHire(installation: WorkerInstallation, input: HireInput, checks: HireChecks = {}): WorkerResourceState {
  if (installation.standardWorker(input.id) !== undefined) {
    throw new Error(`"${input.id}" is a standard worker, which nobody can hire over. Fork it to get a worker of your own.`);
  }
  refuseUnsafe(input.id, input, input.settings?.model, checks);
  const worker = workerResourceStateSchema.parse({
    flow: input.flow ?? AGENT_FLOW,
    name: textOrNull(input.name),
    description: input.description ?? null,
    instructions: textOrNull(input.instructions),
    skills: input.skills ?? [],
    settings: input.settings ?? {}
  });
  refuseRetired(installation, input.id, worker.flow, input.settings);
  refuseProblems(installation, input.id, worker);
  return worker;
}

/** Whitespace is not instructions. */
function textOrNull(value: string | null | undefined): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value : null;
}

/**
 * A standard worker's configuration as a row of the caller's own, copied (D3).
 * Its file's `name:` becomes the row's name only for the copy under the same
 * id (`keepName`); a fork under a new id starts with none.
 */
function rowFromStandard(manifest: WorkerManifest, keepName = false): WorkerResourceState {
  const settings: Record<string, unknown> = { ...manifest.declared };
  delete settings.flow;
  delete settings.description;
  delete settings.name;
  const description = manifest.declared.description;
  return workerResourceStateSchema.parse({
    flow: standardWorkerFlow(manifest, AGENT_FLOW),
    name: keepName ? workerDisplayName(manifest) : null,
    description: typeof description === "string" ? description : null,
    instructions: textOrNull(manifest.body),
    teamInstructions: textOrNull(manifest.teamInstructions),
    skills: (manifest.skills ?? []).map((skill) => skill.name),
    settings,
    forkedFrom: manifest.id
  });
}

/**
 * Build the hire, fork, edit, fire and reset blocks over `installation`.
 * `checks` adds the app's own refusals to hire and edit.
 *
 * Each block declares the worker collection through the installation and
 * reads or writes the caller's own roster.
 */
export function createWorkerHireBlocks(installation: WorkerInstallation, checks: HireChecks = {}): WorkerHireBlocks {
  const refuseStandard = (id: string, verb: string): void => {
    if (installation.standardWorker(id) !== undefined) {
      throw new Error(
        `"${id}" is a standard worker, which nobody can ${verb}. Fork it to get a worker of your own.`
      );
    }
  };

  /** `settings` without the ones `flow` retired. */
  const withoutRetired = (flow: string, settings: Record<string, unknown>): Record<string, unknown> =>
    Object.fromEntries(Object.entries(settings).filter(([key]) => !retiredOn(installation, flow).includes(key)));

  const check = (id: string, row: WorkerResourceState): void => refuseProblems(installation, id, row);

  const write = async (workers: ResourceCollectionRef, id: string, row: WorkerResourceState): Promise<void> => {
    try {
      await workers.create(id, row as unknown as JsonObject);
    } catch (error) {
      if ((await workers.getOptional(id)) !== undefined) {
        throw new Error(`"${id}" is already on your roster. Pick another id. Nothing was written.`);
      }
      throw error;
    }
  };

  const readOwn = async (workers: ResourceCollectionRef, id: string): Promise<WorkerResourceState> => {
    const stored = await workers.getOptional(id);
    if (stored === undefined) throw new Error(`No worker "${id}" on your roster.`);
    const parsed = parseWorkerResourceState(stored.state);
    if ("problem" in parsed) throw new Error(`Worker "${id}" can't be read: ${parsed.problem}.`);
    return parsed.worker;
  };

  const hire = handler({
    name: "workforce-hire",
    inputSchema: hireInput,
    outputSchema: writtenOutput,
    resources: { ...installation.resources },
    execute: async (input, ctx) => {
      const worker = checkedHire(installation, input, checks);
      await write(ctx.resources[WORKERS_RESOURCE], input.id, worker);
      return { id: input.id, flow: worker.flow };
    }
  });

  const fork = handler({
    name: "workforce-fork",
    inputSchema: forkInput,
    outputSchema: writtenOutput,
    resources: { ...installation.resources },
    execute: async (input, ctx) => {
      const workers = ctx.resources[WORKERS_RESOURCE];
      refuseStandard(input.id, "replace");
      // The caller's own row first: an edited standard worker forks as they edited it.
      const file = installation.standardWorker(input.from);
      const own = file === undefined ? undefined : await workers.getOptional(input.from);
      const row =
        file !== undefined && own === undefined
          ? rowFromStandard(file)
          : { ...(await readOwn(workers, input.from)), forkedFrom: input.from, name: null };
      check(input.id, row);
      await write(workers, input.id, row);
      return { id: input.id, flow: row.flow };
    }
  });

  const edit = handler({
    name: "workforce-edit",
    inputSchema: editInput,
    outputSchema: writtenOutput,
    resources: { ...installation.resources },
    execute: async (input, ctx) => {
      const workers = ctx.resources[WORKERS_RESOURCE];
      // A standard worker's first edit starts from the copy a fork makes, under its own id.
      const file = installation.standardWorker(input.id);
      const stored = file === undefined ? undefined : await workers.getOptional(input.id);
      const copying = file !== undefined && stored === undefined;
      const current = copying ? { ...rowFromStandard(file, true), forkedFrom: input.id } : await readOwn(workers, input.id);
      // The file's worker as it stands, before the edit: a flow kept for standard
      // workers stays read-only even when the edit names another flow.
      if (copying) check(input.id, current);
      // Board tasks reach a standard worker on its file's flow, so its copy stays there.
      const fileFlow = file === undefined ? undefined : rowFromStandard(file).flow;
      if (fileFlow !== undefined && input.flow !== undefined && input.flow !== fileFlow) {
        throw new Error(`"${input.id}" runs on "${fileFlow}", as its file declares, so its flow can't be changed. Nothing was written.`);
      }
      const edited: WorkerResourceState = {
        ...current,
        ...(input.name !== undefined ? { name: textOrNull(input.name) } : {}),
        ...(input.flow !== undefined ? { flow: input.flow } : {}),
        ...(input.description !== undefined ? { description: input.description } : {}),
        ...(input.instructions !== undefined ? { instructions: textOrNull(input.instructions) } : {}),
        ...(input.skills !== undefined ? { skills: input.skills } : {}),
        ...(input.settings !== undefined ? { settings: input.settings } : {}),
        ...(input.settingsPatch !== undefined ? { settings: { ...current.settings, ...input.settingsPatch } } : {})
      };
      refuseRetired(installation, input.id, edited.flow, { ...input.settings, ...input.settingsPatch });
      refuseUnsafe(input.id, input, input.settingsPatch?.model ?? input.settings?.model, checks);
      // A setting stored before its flow retired it goes with this write.
      const next: WorkerResourceState = { ...edited, settings: withoutRetired(edited.flow, edited.settings) };
      check(input.id, next);
      await workers.create(input.id, next as unknown as JsonObject, {
        replace: true
      });
      return { id: input.id, flow: next.flow };
    }
  });

  const fire = handler({
    name: "workforce-fire",
    inputSchema: fireInput,
    outputSchema: z.object({ id: z.string() }),
    resources: { ...installation.resources },
    execute: async (input, ctx) => {
      const workers = ctx.resources[WORKERS_RESOURCE];
      refuseStandard(input.id, "fire");
      await readOwn(workers, input.id);
      await workers.delete(input.id);
      return { id: input.id };
    }
  });

  const reset = handler({
    name: "workforce-reset",
    inputSchema: resetInput,
    outputSchema: z.object({ id: z.string() }),
    resources: { ...installation.resources },
    execute: async (input, ctx) => {
      const workers = ctx.resources[WORKERS_RESOURCE];
      if (installation.standardWorker(input.id) === undefined) {
        throw new Error(`"${input.id}" isn't a standard worker, so there is no default to reset it to. Nothing was written.`);
      }
      if ((await workers.getOptional(input.id)) === undefined) {
        throw new Error(`You haven't edited "${input.id}", so it already matches its file. Nothing was written.`);
      }
      await workers.delete(input.id);
      return { id: input.id };
    }
  });

  return { hire, fork, edit, fire, reset } as unknown as WorkerHireBlocks;
}
