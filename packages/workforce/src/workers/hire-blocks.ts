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
 * Standard workers are read-only: every block here refuses a standard
 * worker's id, and suggests a fork.
 */
import { handler, type JsonObject } from "@flow-state-dev/core";
import type { BlockContext, BlockDefinition, ResourceCollectionRef } from "@flow-state-dev/core/types";
import { z } from "zod";
import { AGENT_KIND } from "../agent-worker-flow";
import type { WorkerManifest } from "../manifest";
import type { WorkerInstallation } from "./installation";
import { WORKERS_RESOURCE } from "./keys";
import { standardWorkerFlow } from "./standard-workers";
import { parseWorkerRow, workerRowSchema, type WorkerRow } from "./worker-row";

const workerId = z.string().min(1).regex(/^[^/~][^/]*$/, "a worker id is one path segment and can't start with ~");

const hireInput = z
  .object({
    /** The new worker's id on the caller's roster. */
    id: workerId,
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
    flow: z.string().min(1).optional(),
    description: z.string().nullable().optional(),
    instructions: z.string().nullable().optional(),
    skills: z.array(z.string().min(1)).optional(),
    /** Replaces the stored settings whole. */
    settings: z.record(z.unknown()).optional()
  })
  .strict();

const fireInput = z.object({ id: z.string().min(1) }).strict();

const writtenOutput = z.object({ id: z.string(), flow: z.string() });

/** The four blocks, ready to mount as actions. */
export interface WorkerHireBlocks {
  /** Hire a new worker of the caller's own: `{ id, flow?, description?, instructions?, skills?, settings? }`. */
  hire: BlockDefinition<typeof hireInput, typeof writtenOutput>;
  /** Fork a standard worker, or one of the caller's own, under a new id: `{ from, id }`. */
  fork: BlockDefinition<typeof forkInput, typeof writtenOutput>;
  /** Change one of the caller's own workers: `{ id, ...fields to replace }`. */
  edit: BlockDefinition<typeof editInput, typeof writtenOutput>;
  /** Delete one of the caller's own workers: `{ id }`. */
  fire: BlockDefinition<typeof fireInput, z.ZodObject<{ id: z.ZodString }>>;
}

/** Whitespace is not instructions. */
function textOrNull(value: string | null | undefined): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value : null;
}

/** A standard worker's configuration as a row of the caller's own, copied (D3). */
function rowFromStandard(manifest: WorkerManifest): WorkerRow {
  const settings: Record<string, unknown> = { ...manifest.declared };
  delete settings.flow;
  delete settings.description;
  const description = manifest.declared.description;
  return workerRowSchema.parse({
    flow: standardWorkerFlow(manifest, AGENT_KIND),
    description: typeof description === "string" ? description : null,
    instructions: textOrNull(manifest.body),
    teamInstructions: textOrNull(manifest.teamInstructions),
    skills: (manifest.skills ?? []).map((skill) => skill.name),
    settings,
    forkedFrom: manifest.id
  });
}

/**
 * Build the hire, fork, edit and fire blocks over `installation`.
 *
 * Mount them on a flow that declares `installation.resources` (the roster
 * flow does): each reads and writes the caller's own roster through it.
 */
export function createWorkerHireBlocks(installation: WorkerInstallation): WorkerHireBlocks {
  const roster = (ctx: BlockContext): ResourceCollectionRef => {
    const collection = (ctx.resources as Record<string, unknown>)[WORKERS_RESOURCE] as
      | ResourceCollectionRef
      | undefined;
    if (collection === undefined) {
      throw new Error("The worker blocks need the worker collection: declare `installation.resources` on the flow.");
    }
    return collection;
  };

  const refuseStandard = (id: string, verb: string): void => {
    if (installation.standardWorker(id) !== undefined) {
      throw new Error(
        `"${id}" is a standard worker, which nobody can ${verb}. Fork it to get a worker of your own.`
      );
    }
  };

  const check = (id: string, row: WorkerRow): void => {
    const problems = installation.configurationProblems(id, row);
    if (problems.length > 0) {
      throw new Error(`Worker "${id}" ${problems.join("; ")}. Nothing was written.`);
    }
  };

  const write = async (ctx: BlockContext, id: string, row: WorkerRow): Promise<void> => {
    try {
      await roster(ctx).create(id, row as unknown as JsonObject);
    } catch (error) {
      if ((await roster(ctx).getOptional(id)) !== undefined) {
        throw new Error(`"${id}" is already on your roster. Pick another id. Nothing was written.`);
      }
      throw error;
    }
  };

  const readOwn = async (ctx: BlockContext, id: string): Promise<WorkerRow> => {
    const stored = await roster(ctx).getOptional(id);
    if (stored === undefined) throw new Error(`No worker "${id}" on your roster.`);
    const parsed = parseWorkerRow(stored.state);
    if ("problem" in parsed) throw new Error(`Worker "${id}" can't be read: ${parsed.problem}.`);
    return parsed.row;
  };

  const hire = handler({
    name: "workforce-hire",
    inputSchema: hireInput,
    outputSchema: writtenOutput,
    resources: { ...installation.resources },
    execute: async (input, ctx) => {
      refuseStandard(input.id, "hire over");
      const row = workerRowSchema.parse({
        flow: input.flow ?? AGENT_KIND,
        description: input.description ?? null,
        instructions: textOrNull(input.instructions),
        skills: input.skills ?? [],
        settings: input.settings ?? {}
      });
      check(input.id, row);
      await write(ctx as unknown as BlockContext, input.id, row);
      return { id: input.id, flow: row.flow };
    }
  });

  const fork = handler({
    name: "workforce-fork",
    inputSchema: forkInput,
    outputSchema: writtenOutput,
    resources: { ...installation.resources },
    execute: async (input, ctx) => {
      refuseStandard(input.id, "replace");
      const file = installation.standardWorker(input.from);
      const row =
        file !== undefined
          ? rowFromStandard(file)
          : { ...(await readOwn(ctx as unknown as BlockContext, input.from)), forkedFrom: input.from };
      check(input.id, row);
      await write(ctx as unknown as BlockContext, input.id, row);
      return { id: input.id, flow: row.flow };
    }
  });

  const edit = handler({
    name: "workforce-edit",
    inputSchema: editInput,
    outputSchema: writtenOutput,
    resources: { ...installation.resources },
    execute: async (input, ctx) => {
      refuseStandard(input.id, "edit");
      const current = await readOwn(ctx as unknown as BlockContext, input.id);
      const next: WorkerRow = {
        ...current,
        ...(input.flow !== undefined ? { flow: input.flow } : {}),
        ...(input.description !== undefined ? { description: input.description } : {}),
        ...(input.instructions !== undefined ? { instructions: textOrNull(input.instructions) } : {}),
        ...(input.skills !== undefined ? { skills: input.skills } : {}),
        ...(input.settings !== undefined ? { settings: input.settings } : {})
      };
      check(input.id, next);
      await roster(ctx as unknown as BlockContext).create(input.id, next as unknown as JsonObject, {
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
      refuseStandard(input.id, "fire");
      await readOwn(ctx as unknown as BlockContext, input.id);
      await roster(ctx as unknown as BlockContext).delete(input.id);
      return { id: input.id };
    }
  });

  return { hire, fork, edit, fire } as unknown as WorkerHireBlocks;
}
