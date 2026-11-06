/**
 * Which models the closure's served apps answer on, and how a served app is
 * switched onto them (FIX-2541):
 *
 * - **Each app's own** (the default): every app served from its own config,
 *   its models resolved through the AI Gateway (`AI_GATEWAY_API_KEY`), its
 *   coder asks on Claude Code's own sign-in and default model.
 * - **Haiku** (`GOAL_HAIKU=1`, with the Anthropic key in
 *   `MY_ANTHROPIC_API_KEY`): every generator and evaluator in every app
 *   resolves to {@link HAIKU} on Anthropic directly (`@ai-sdk/anthropic`),
 *   whatever model it names. The app is served through {@link HAIKU_CONFIG},
 *   which loads the app's own config and swaps the resolver its runtime hands
 *   the router and the worker ({@link answerOnHaiku}). The served process gets
 *   the key as `ANTHROPIC_API_KEY`, which every app's Claude Code pass-list
 *   hands its runs, and no gateway key, so nothing reaches the gateway
 *   unnoticed. Claude Code runs on Haiku through the project's own settings
 *   ({@link claudeCodeSettings}) or, in Kitchen Sink, the session's model.
 *
 * Each sheet result is stamped with {@link ClosureModel}, and the verdict
 * refuses a pass whose sheets mix models (`asks.mts` → `sheetModelProblems`).
 *
 * The key's value is never printed, logged or written to a sheet: it travels
 * only in the served process's environment.
 */
import { join } from "node:path";
import { createAnthropic } from "@ai-sdk/anthropic";
import { createModelResolver } from "@flow-state-dev/core";
import type { ModelResolver } from "@flow-state-dev/core/types";
import type { FlowState } from "@flow-state-dev/engine";

/** Haiku's id on Anthropic, as Claude Code and `@ai-sdk/anthropic` take it. */
export const HAIKU_ID = "claude-haiku-5-5";
/** Haiku as a portable model string: what every generator resolves to on the switch, and what each result is stamped with. */
export const HAIKU = `anthropic/${HAIKU_ID}`;
/** The stamp of a result run on each app's own models. */
export const APP_MODELS = "app";
/** Which models a run's apps answer on. */
export type ClosureModel = typeof APP_MODELS | typeof HAIKU;
/** The config the switch serves in place of the app's: the app's own, on Haiku. */
export const HAIKU_CONFIG = join(import.meta.dirname, "haiku.config.mts");
/** The variable the Anthropic key is read from. */
export const KEY_VARIABLE = "MY_ANTHROPIC_API_KEY";

/** `GOAL_HAIKU` (`1`, or unset for each app's own models). On, the key must be set. */
export function closureModel(env: Record<string, string | undefined> = process.env): ClosureModel {
  const on = env.GOAL_HAIKU ?? "";
  if (on === "") return APP_MODELS;
  if (on !== "1") throw new Error(`GOAL_HAIKU must be 1 or unset (got ${JSON.stringify(on)})`);
  if ((env[KEY_VARIABLE] ?? "") === "") throw new Error(`GOAL_HAIKU=1 needs ${KEY_VARIABLE} set: the Anthropic key the apps' agents and Claude Code run on`);
  return HAIKU;
}

/**
 * A resolver that answers every model string with {@link HAIKU} on
 * `provider` (default: Anthropic, holding `apiKey`): generators and
 * evaluators alike, so a stamp of Haiku is true of every model call the
 * resolver serves.
 */
export function haikuResolver(apiKey: string, provider: unknown = createAnthropic({ apiKey })): ModelResolver {
  // `env: {}`: no `FSDEV_*` override in the environment can swap the model back.
  const base = createModelResolver({ providers: { anthropic: provider }, env: {} });
  const haiku = ((_modelId: string, blockName?: string, options?: Parameters<ModelResolver>[2]) => base(HAIKU, blockName, options)) as ModelResolver;
  haiku.resolveId = () => HAIKU;
  haiku.providerOf = () => "anthropic";
  haiku.resolveEvaluationModel = (_modelId: string, blockName?: string) => base.resolveEvaluationModel!(HAIKU, blockName);
  return haiku;
}

/**
 * Serve `app` on `resolver`: the runtime `getRuntime()` hands back is the one
 * the router and the worker are built on (engine `FlowState.getRuntime`), so
 * its resolver, swapped before the server asks for the router, is the one
 * every request resolves through.
 */
export async function answerOnHaiku(app: FlowState, resolver: ModelResolver): Promise<FlowState> {
  const { runtimeConfig } = await app.getRuntime();
  runtimeConfig.modelResolver = resolver;
  return app;
}

/**
 * What `fsdev serve` is started with for `model`: on each app's own, `args`
 * as given and nothing added; on Haiku, {@link HAIKU_CONFIG} in place of the
 * app's `--config` (which it loads, from `CLOSURE_APP_CONFIG`), the key as
 * `ANTHROPIC_API_KEY` for Claude Code, and an empty gateway key.
 */
export function servedModel(
  model: ClosureModel,
  args: readonly string[],
  env: Record<string, string | undefined> = process.env,
): { args: string[]; env: Record<string, string> } {
  if (model === APP_MODELS) return { args: [...args], env: {} };
  const at = args.indexOf("--config");
  const appConfig = at < 0 ? undefined : args[at + 1];
  if (appConfig === undefined) throw new Error("setup: serving an app on Haiku needs its --config, which the Haiku config loads");
  return {
    args: [...args.slice(0, at), "--config", HAIKU_CONFIG, ...args.slice(at + 2)],
    env: { CLOSURE_APP_CONFIG: appConfig, ANTHROPIC_API_KEY: env[KEY_VARIABLE] ?? "", AI_GATEWAY_API_KEY: "" },
  };
}

/**
 * Files for a project's repository that set a Claude Code run in it to Haiku
 * on the switch: its project settings, which every app's Claude Code loads
 * (`settingSources: ["project"]`). On each app's own models, none.
 */
export function claudeCodeSettings(model: ClosureModel): Record<string, string> {
  return model === APP_MODELS ? {} : { ".claude/settings.json": `${JSON.stringify({ model: HAIKU_ID }, null, 2)}\n` };
}
