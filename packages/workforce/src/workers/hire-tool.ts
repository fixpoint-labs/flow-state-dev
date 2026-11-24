/**
 * Hiring from a conversation: `hireWorker`, a tool that adds a worker to the
 * user's own roster on their approval.
 *
 * It writes through the roster flow's `hire` block (`hire-blocks.ts`), the
 * same write a user's *Hire* form makes, so the new worker is checked against
 * its flow's schema the same way and shows on the roster at once. What the
 * tool adds in front of that write:
 *
 * - **Only on the user's own turn.** A turn a delivered event, a worker's
 *   message, a routine or a task started can't hire: text read there could
 *   ask for one. The same mark gates the standing-rule tools.
 * - **Checks before asking.** The id is new (not a standard worker's, not
 *   already on the roster), the model is one of the app's listed models and
 *   can run on this server's keys, the tools are names the worker's flow
 *   knows, and nothing given looks like a credential. A refusal says why and
 *   asks nothing.
 * - **The user's approval.** A stock `user_approval` shows the whole hire: the
 *   id, the role, the model, the tools and the instructions it will keep;
 *   reject throws out of the tool before the write.
 *   Without durable execution there is nobody to ask, so it refuses.
 *
 * A model reaches a provider through the key the server already holds in its
 * environment. The tool never takes a key and never repeats one: a refusal
 * names the environment variable at most.
 *
 * Its one preset, `tool`, is off until a worker's own file names it:
 *
 * ```yaml
 * capabilities:
 *   hireWorkers: [tool]
 * ```
 */
import { containsSecret, defineCapability, handler, sequencer } from "@flow-state-dev/core";
import { describeModelRoute } from "@flow-state-dev/core/models";
import type { BlockContext, ResourceCollectionRef } from "@flow-state-dev/core/types";
import { z } from "zod";
import { AGENT_DEFAULT_MODEL, AGENT_FLOW } from "../agent-worker-flow";
import { isUserTurn } from "../standing-rules/user-turn";
import { createWorkerHireBlocks } from "./hire-blocks";
import { problemsClause, type WorkerInstallation } from "./installation";
import { WORKERS_RESOURCE } from "./keys";
import { workerResourceStateSchema } from "./worker-row";

/** The capability's name, as a worker file names it. */
const HIRE_WORKERS_CAPABILITY = "hireWorkers";
/** The tool's name, as the model calls it. */
const HIRE_WORKER_TOOL = "hireWorker";

/** What {@link hireWorkersCapability} is built with: the kit's `hire` config. */
export interface HireWorkersOptions {
  /**
   * The models a hired worker may run on, as model strings (`openai/gpt-6-luna`, `openrouter:nvidia/…`).
   * Omitted: the agent flow's model alone. Each must also have a key or gateway in the environment
   * (`describeModelRoute`): a key the app hands its model resolver in code isn't seen here.
   */
  models?: readonly string[];
  /** The catalog tools a hire gets when the call names none. Omitted: none. */
  tools?: readonly string[];
  /** Where provider keys are looked up, by name only. Default `process.env`, read on each call. */
  env?: Readonly<Record<string, string | undefined>>;
}

/** What the model passes. Strict: a key, or any field not listed, is refused. */
const hireWorkerInputSchema = z
  .object({
    id: z
      .string()
      .regex(/^[a-z][a-z0-9-]{0,39}$/, "an id is 1 to 40 lowercase letters, digits and hyphens, starting with a letter")
      .describe("The new teammate's id, its address for messages and tasks: lowercase, such as `analyst`."),
    name: z.string().min(1).max(60).optional().describe("The name the user reads it by. Omitted, its id."),
    description: z.string().min(1).max(200).describe("One line on what it does, which tells the team when to ask it."),
    instructions: z.string().min(1).max(4_000).describe("Its guidance: how it works and what it answers. The user reads all of it before approving."),
    provider: z.string().min(1).describe("The model's provider or route, such as `openai` or `openrouter`."),
    model: z.string().min(1).describe("The model id at that provider, such as `gpt-6-luna`."),
    tools: z
      .array(z.string().min(1))
      .optional()
      .describe("The tools it may use, by name. Omitted, the read-only default. Grant more only when the user asks.")
  })
  .strict();

type HireWorkerInput = z.infer<typeof hireWorkerInputSchema>;

/** A hire that passed every check, waiting on the user. */
const checkedSchema = z.object({
  checked: z.literal(true),
  id: z.string(),
  name: z.string().optional(),
  description: z.string(),
  instructions: z.string(),
  model: z.string(),
  tools: z.array(z.string())
});
type Checked = z.infer<typeof checkedSchema>;

/** What the tool answers: the hire, or why nothing was hired. */
const answerSchema = z.union([
  z.object({ hired: z.literal(true), id: z.string(), model: z.string(), tools: z.array(z.string()) }),
  z.object({ hired: z.literal(false), reason: z.string() })
]);

/** The listed model `provider` and `model` name: `provider/model`, else the named route `provider:model`. */
const listedModel = (models: readonly string[], provider: string, model: string): string | undefined =>
  [`${provider}/${model}`, `${provider}:${model}`].find((candidate) => models.includes(candidate));

/**
 * `hireWorker` over `installation`, as a capability with one preset, `tool`.
 * `agentModel` is the agent flow's model, the default model list.
 */
export function hireWorkersCapability(installation: WorkerInstallation, options: HireWorkersOptions = {}, agentModel: string = AGENT_DEFAULT_MODEL) {
  const models = options.models ?? [agentModel];
  const defaultTools = [...(options.tools ?? [])];
  const { hire } = createWorkerHireBlocks(installation);

  const check = handler({
    name: "workforce-hire-worker-check",
    inputSchema: hireWorkerInputSchema,
    outputSchema: z.union([checkedSchema, answerSchema]),
    resources: { ...installation.resources },
    execute: async (input: HireWorkerInput, ctx: BlockContext) => {
      const refuse = (reason: string) => ({ hired: false as const, reason: `${reason} Nothing was hired.` });
      if (!isUserTurn(ctx)) return refuse("A teammate is hired only on a turn the user's own message started; this one can't hire.");
      if (Object.values(input).some((value) => containsSecret(Array.isArray(value) ? value.join(" ") : String(value)))) {
        return refuse("Something in the hire looks like an API key. Never pass a key: the server reads it from its environment variable, such as <PROVIDER>_API_KEY.");
      }
      if (ctx.suspend === undefined) return refuse("This server can't ask the user to confirm, and a hire needs their yes.");
      // Looser than the roster's own check on purpose: a bare `researcher` beside `teammates.researcher`
      // would leave the model two teammates it addresses by the same name.
      const standard = installation.standardWorker(input.id) ?? installation.standardWorkers().find((worker) => worker.id.endsWith(`.${input.id}`));
      if (standard !== undefined) return refuse(`"${input.id}" is taken: ${standard.id} is already on the team. Pick another id.`);
      const roster = (ctx.resources as Record<string, unknown>)[WORKERS_RESOURCE] as ResourceCollectionRef;
      if ((await roster.getOptional(input.id)) !== undefined) return refuse(`"${input.id}" is already on the roster. Pick another id.`);
      const model = listedModel(models, input.provider, input.model);
      if (model === undefined) {
        return refuse(
          `Provider "${input.provider}" with model "${input.model}" isn't one this app runs teammates on. ` +
            `It runs them on: ${models.join(", ") || "none"}. Another model is the operator's to add, with its provider's key in an environment variable.`
        );
      }
      const route = describeModelRoute(model, { ...(options.env ?? process.env) });
      if (!route.available) return refuse(`"${model}" can't run on this server: ${route.reason}.`);
      const tools = input.tools ?? defaultTools;
      const worker = workerResourceStateSchema.parse({ flow: AGENT_FLOW, description: input.description, instructions: input.instructions, settings: { model, tools } });
      const problems = installation.configurationProblems(input.id, worker);
      if (problems.length > 0) return refuse(`"${input.id}" ${problemsClause(problems)}.`);
      return { checked: true as const, id: input.id, ...(input.name === undefined ? {} : { name: input.name }), description: input.description, instructions: input.instructions, model, tools };
    }
  });

  // The user approves the whole hire, instructions included. Reject throws out of the tool before the write.
  const approve = handler({
    name: "workforce-hire-worker-approve",
    inputSchema: checkedSchema,
    outputSchema: z.void(),
    execute: async (hiring: Checked, ctx: BlockContext) => {
      await ctx.suspend!({
        reason: "user_approval",
        message:
          `Hire ${hiring.name ?? hiring.id} (${hiring.id}): ${hiring.description} It runs on ${hiring.model}, with ${hiring.tools.length === 0 ? "no tools" : `tools ${hiring.tools.join(", ")}`}.` +
          `\n\nIts instructions:\n${hiring.instructions}`,
        data: { id: hiring.id, model: hiring.model, tools: hiring.tools, instructions: hiring.instructions },
        allow: ["approve", "reject"]
      });
    }
  });

  // The roster's `hire` is a tap, so the checked hire carries through to the answer. An id taken
  // while the user decided makes the roster's write throw, writing nothing.
  const approved = sequencer({ name: "workforce-hire-worker-approved", inputSchema: checkedSchema, outputSchema: answerSchema })
    .tap(approve)
    .tap(
      (hiring: Checked) => ({
        id: hiring.id,
        ...(hiring.name === undefined ? {} : { name: hiring.name }),
        description: hiring.description,
        instructions: hiring.instructions,
        settings: { model: hiring.model, tools: hiring.tools }
      }),
      hire
    )
    .map((hiring: Checked) => ({ hired: true as const, id: hiring.id, model: hiring.model, tools: hiring.tools }));

  const tool = sequencer({
    name: HIRE_WORKER_TOOL,
    description:
      "Hire a new teammate onto the user's team: its id, one line on what it does, its instructions, the model it runs on (provider and model id) " +
      "and its tools (read-only by default). Only when the user asks for one. Everything is checked first, then the user approves the exact hire " +
      "before it is made; a refusal says why. Never pass an API key.",
    inputSchema: hireWorkerInputSchema,
    outputSchema: answerSchema
  })
    .step(check)
    .stepIf((checked: unknown) => (checked as { checked?: unknown }).checked === true, approved);

  return defineCapability({
    name: HIRE_WORKERS_CAPABILITY,
    resources: { ...installation.resources },
    presets: { tool: { tools: [tool] }, default: [] }
  });
}
