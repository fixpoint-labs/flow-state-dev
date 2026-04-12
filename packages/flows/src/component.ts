/**
 * componentFlow — AI-enabled UI component.
 *
 * For UI components that have AI-powered actions: a text editor with
 * "Improve Writing", "Make Shorter", "Fix Grammar" buttons, a content
 * area with "Summarize", "Translate" actions, etc.
 *
 * Each action is a named content transformation. The user provides content
 * and optionally extra instructions; the LLM applies the action's prompt
 * and returns the transformed text.
 *
 * @example
 * ```ts
 * import { componentFlow } from "@flow-state-dev/flows";
 *
 * const flow = componentFlow({
 *   actions: {
 *     improve: "Improve the writing quality while preserving meaning.",
 *     shorten: "Make this more concise without losing key information.",
 *     fixGrammar: "Fix grammar, spelling, and punctuation errors.",
 *     expand: "Expand with more detail and supporting examples.",
 *   },
 * })({ id: "text-editor" });
 *
 * // With a base prompt and custom model
 * const flow = componentFlow({
 *   model: "anthropic/claude-sonnet-4-20250514",
 *   prompt: "You are a professional editor for technical documentation.",
 *   actions: {
 *     simplify: "Rewrite for a non-technical audience.",
 *     formalize: "Rewrite in a formal, professional tone.",
 *   },
 * })({ id: "doc-editor" });
 * ```
 */
import { z } from "zod";
import {
  defineFlow,
  generator,
} from "@flow-state-dev/core";
import type {
  ActionConfig,
  FlowType,
} from "@flow-state-dev/core";

import {
  DEFAULT_MODEL,
  componentInputSchema,
} from "./shared";

/** Configuration options for {@link componentFlow}. */
export interface ComponentFlowConfig {
  /** LLM model identifier. Default: `"openai/gpt-4o-mini"`. */
  model?: string;
  /**
   * Base system prompt prepended to every action. Use this for shared
   * context like tone, audience, or domain constraints.
   */
  prompt?: string;
  /**
   * Named actions. Each key becomes an action on the flow. Values are
   * either a prompt string or a config object with prompt and optional
   * output schema.
   *
   * @example
   * ```ts
   * actions: {
   *   improve: "Improve the writing quality.",
   *   extract: {
   *     prompt: "Extract key entities from the text.",
   *     outputSchema: z.object({ entities: z.array(z.string()) }),
   *   },
   * }
   * ```
   */
  actions: Record<string, string | ComponentActionConfig>;
}

/** Per-action configuration for component flows. */
export interface ComponentActionConfig {
  /** Action-specific instruction appended to the base prompt. */
  prompt: string;
  /** Structured output schema. Default: plain text (string). */
  outputSchema?: z.ZodTypeAny;
}

function normalizeAction(value: string | ComponentActionConfig): ComponentActionConfig {
  return typeof value === "string" ? { prompt: value } : value;
}

/**
 * Creates a component flow with multiple named content-transformation actions.
 *
 * Each action accepts `{ content: string, instruction?: string }` and
 * returns transformed text (or structured output if `outputSchema` is set).
 * There is no conversation history — each action is a single-shot generation.
 */
export function componentFlow(config: ComponentFlowConfig): FlowType {
  const {
    model = DEFAULT_MODEL,
    prompt: basePrompt,
    actions: actionDefs,
  } = config;

  const flowActions: Record<string, ActionConfig> = {};

  for (const [name, raw] of Object.entries(actionDefs)) {
    const actionConfig = normalizeAction(raw);

    const systemPrompt = basePrompt
      ? `${basePrompt}\n\n${actionConfig.prompt}`
      : actionConfig.prompt;

    const gen = generator({
      name: `${name}-generator`,
      model,
      prompt: systemPrompt,
      inputSchema: componentInputSchema,
      user: (input: { content: string; instruction?: string }) => {
        if (input.instruction) {
          return `${input.content}\n\nAdditional instruction: ${input.instruction}`;
        }
        return input.content;
      },
      outputSchema: actionConfig.outputSchema,
    });

    flowActions[name] = {
      inputSchema: componentInputSchema,
      block: gen,
    };
  }

  return defineFlow({
    kind: "component",
    requireUser: true,
    actions: flowActions,
  });
}
