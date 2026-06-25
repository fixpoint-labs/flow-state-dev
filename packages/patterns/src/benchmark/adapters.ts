/**
 * Pattern benchmark adapters.
 *
 * Each adapter materialises one shipped pattern into a `BenchmarkSubject` from
 * shared `BenchmarkAdapterOptions` (a single `model`, optional `uses`). The
 * benchmark engine drives every subject's `sequencer` against the same task and
 * uses `mapTask` to project the generic `BenchmarkTask` onto the pattern's input
 * shape (`{ goal }` for most, `{ question }` for debate).
 *
 * Every pattern is wired with `sharedDefaultWorker` (or, for patterns that build
 * their own internal agents, the same `model`) so the only thing that varies
 * across subjects is the coordination shape — see `./sharedWorker`.
 */
import type {
  BenchmarkAdapter,
  BenchmarkSubject,
  BenchmarkAdapterOptions,
  BenchmarkTask,
} from "@flow-state-dev/core";
import { createWorkspace } from "../routedSpecialists";
import { supervisor } from "../supervisor";
import { planAndExecute } from "../plan-and-execute";
import { parallelTasks } from "../parallelTasks";
import { roundRobin } from "../round-robin";
import { debate } from "../debate";
import { routedSpecialists } from "../routedSpecialists";
import { z } from "zod";
import { sharedDefaultWorker } from "./sharedWorker";

/** Project a benchmark task onto the common `{ goal }` input shape. */
const mapTaskToGoal = (task: BenchmarkTask): { goal: string } => ({
  goal: task.prompt,
});

/**
 * Supervisor adapter — plan → per-task review → synthesize. Wired with the
 * shared worker as the uniform reviewed worker.
 */
export const supervisorBenchmarkAdapter: BenchmarkAdapter = {
  patternName: "supervisor",
  build: ({ model, uses }: BenchmarkAdapterOptions): BenchmarkSubject => ({
    name: "supervisor",
    kind: "pattern",
    model,
    sequencer: supervisor({
      name: "bench-supervisor",
      worker: sharedDefaultWorker("bench-supervisor-worker", model),
      ...(uses ? { uses } : {}),
    }),
    mapTask: mapTaskToGoal,
  }),
};

/**
 * Plan-and-execute adapter — planner / executor / synthesizer all default
 * internally from the shared `model`.
 */
export const planAndExecuteBenchmarkAdapter: BenchmarkAdapter = {
  patternName: "plan-and-execute",
  build: ({ model, uses }: BenchmarkAdapterOptions): BenchmarkSubject => ({
    name: "plan-and-execute",
    kind: "pattern",
    model,
    sequencer: planAndExecute({
      name: "bench-plan-and-execute",
      model,
      ...(uses ? { uses } : {}),
    }),
    mapTask: mapTaskToGoal,
  }),
};

/**
 * Parallel-tasks adapter — fan-out / fan-in over the shared worker, then the
 * default combiner.
 */
export const parallelTasksBenchmarkAdapter: BenchmarkAdapter = {
  patternName: "parallel-tasks",
  build: ({ model }: BenchmarkAdapterOptions): BenchmarkSubject => ({
    name: "parallel-tasks",
    kind: "pattern",
    model,
    sequencer: parallelTasks({
      name: "bench-parallel-tasks",
      worker: sharedDefaultWorker("bench-parallel-tasks-worker", model),
    }),
    mapTask: mapTaskToGoal,
  }),
};

/**
 * Round-robin adapter — a 3-seat roster whose agents the pattern builds from
 * the shared `model` (roster entries omit `block`).
 */
export const roundRobinBenchmarkAdapter: BenchmarkAdapter = {
  patternName: "round-robin",
  build: ({ model, uses }: BenchmarkAdapterOptions): BenchmarkSubject => ({
    name: "round-robin",
    kind: "pattern",
    model,
    sequencer: roundRobin({
      name: "bench-round-robin",
      roster: [{ name: "alpha" }, { name: "beta" }, { name: "gamma" }],
      model,
      ...(uses ? { uses } : {}),
    }),
    mapTask: mapTaskToGoal,
  }),
};

/**
 * Debate adapter — pro/con debaters the pattern builds from the shared `model`
 * (debater entries omit `block`), then a judge + synthesizer. Maps the task
 * prompt onto `{ question }`.
 */
export const debateBenchmarkAdapter: BenchmarkAdapter = {
  patternName: "debate",
  build: ({ model, uses }: BenchmarkAdapterOptions): BenchmarkSubject => ({
    name: "debate",
    kind: "pattern",
    model,
    sequencer: debate({
      name: "bench-debate",
      debaters: [
        { name: "pro", stance: "argue in favor" },
        { name: "con", stance: "argue against" },
      ],
      model,
      ...(uses ? { uses } : {}),
    }),
    mapTask: (task: BenchmarkTask): { question: string } => ({
      question: task.prompt,
    }),
  }),
};

/**
 * Routed-specialists adapter — a controller picks among two shared-worker
 * specialists over a `{ goal }` workspace. The bare `{ goal }` task reaches the
 * pattern via `initialState`, which seeds the workspace from the input; the
 * default controller reads the workspace and picks specialists by name.
 */
export const routedSpecialistsBenchmarkAdapter: BenchmarkAdapter = {
  patternName: "routed-specialists",
  build: ({ model, uses }: BenchmarkAdapterOptions): BenchmarkSubject => {
    const workspace = createWorkspace(
      z.object({ goal: z.string().default("") }),
    );
    return {
      name: "routed-specialists",
      kind: "pattern",
      model,
      sequencer: routedSpecialists({
        name: "bench-routed-specialists",
        workspace,
        specialists: {
          researcher: sharedDefaultWorker(
            "bench-routed-specialists-researcher",
            model,
          ),
          writer: sharedDefaultWorker(
            "bench-routed-specialists-writer",
            model,
          ),
        },
        initialState: (input: unknown) => ({
          goal: (input as { goal?: string } | null)?.goal ?? "",
        }),
        model,
        ...(uses ? { uses } : {}),
      }),
      mapTask: mapTaskToGoal,
    };
  },
};
