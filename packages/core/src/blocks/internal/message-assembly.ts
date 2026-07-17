/**
 * Message-assembly seam for the generator block. Owns system-prefix
 * construction, context flattening, user-message dedup, and PromptFile
 * rendering — everything needed to produce the final `messages` array
 * the model sees, without touching the model loop itself.
 */
import type { BlockContext } from "../../types/block";
import {
  aggregateContextEntries,
} from "../context-aggregator";
import { renderTaggedContext, type TagAccumulator } from "../../prompt";
import type {
  PromptFileBrand,
  PromptFileConfigView,
} from "../../prompt/prompt-file";
import type { CachingConfig } from "../../types/model";
import { stableStringify } from "../../helpers/stable-stringify";

/**
 * Post-resolution generator-config values exposed to PromptFile templates as
 * the `config` render variable. Distinct from `ctx`: this is "what the
 * generator will run with" (resolved model/tools/caching), not "what the call
 * brought" (state/resources). The aggregated context tag map is added per
 * call (it depends on resolved context entries).
 */
export interface PromptFileConfigMeta {
  model?: string;
  intent?: string;
  tools?: string[];
  caching?: CachingConfig;
  maxTokens?: number;
  temperature?: number;
  providerOptions?: Record<string, unknown>;
}

type MaybePromise<TValue> = TValue | Promise<TValue>;

type PromptSlotEntry<TInput, TCtx = BlockContext> =
  | string
  | null
  | undefined
  | ((input: TInput, ctx: TCtx) => MaybePromise<string | null | undefined>);

type PromptSlot<TInput = unknown, TCtx = BlockContext> =
  | PromptSlotEntry<TInput, TCtx>
  | PromptSlotEntry<TInput, TCtx>[];

export interface MessageAssemblyInput<TInput = unknown, TCtx extends BlockContext = BlockContext> {
  promptValue: PromptSlot<TInput, TCtx>;
  promptFileBrand: PromptFileBrand | undefined;
  contextValues: unknown[];
  historyValues: unknown[];
  /** Resolve user-slot values given the `configView` produced by `buildSystemPrefix`. */
  resolveUserValues: (configView: PromptFileConfigView | undefined) => Promise<unknown[]>;
  configMeta: PromptFileConfigMeta;
  input: TInput;
}

export interface MessageAssemblyResult {
  messages: unknown[];
  systemPrefixCount: number;
  configView: PromptFileConfigView | undefined;
  promptText: string;
  userValues: unknown[];
}

/**
 * Assemble the full message array the model will see: system prefix
 * (prompt + context), history, and user messages — with dedup applied.
 */
export async function assembleMessages<TInput, TCtx extends BlockContext>(
  assembly: MessageAssemblyInput<TInput, TCtx>,
  ctx: TCtx,
): Promise<MessageAssemblyResult> {
  const {
    messages: systemPrefix,
    configView,
    promptText,
  } = await buildSystemPrefix(
    assembly.promptValue,
    assembly.promptFileBrand,
    assembly.contextValues,
    assembly.input,
    ctx,
    assembly.configMeta,
  );

  const userValues = await assembly.resolveUserValues(configView);
  const systemPrefixCount = systemPrefix.length;
  const userMessages = userValues.map(asUserMessage);
  const dropLeadingUserDuplicate =
    userMessages.length > 0 &&
    assembly.historyValues.length > 0 &&
    isEquivalentUserMessage(
      assembly.historyValues[assembly.historyValues.length - 1],
      userMessages[0],
    );
  const messages: unknown[] = [
    ...systemPrefix,
    ...assembly.historyValues,
    ...(dropLeadingUserDuplicate ? userMessages.slice(1) : userMessages),
  ];

  return { messages, systemPrefixCount, configView, promptText, userValues };
}

// ---------------------------------------------------------------------------
// System prefix
// ---------------------------------------------------------------------------

async function resolvePrompt<TInput, TCtx extends BlockContext>(
  value: PromptSlot<TInput, TCtx>,
  input: TInput,
  ctx: TCtx,
): Promise<string> {
  if (!Array.isArray(value)) {
    if (value == null) return "";
    return typeof value === "function" ? (await value(input, ctx)) ?? "" : value;
  }
  const parts: string[] = [];
  for (const entry of value) {
    if (entry == null) continue;
    const resolved = typeof entry === "function" ? await entry(input, ctx) : entry;
    if (resolved != null) parts.push(resolved);
  }
  return parts.join("\n");
}

function asSystemMessage(value: unknown): unknown {
  if (typeof value === "string") {
    return { role: "system", content: value };
  }
  return value;
}

function flattenAggregatedContext(tagged: TagAccumulator): Record<string, string> {
  const out: Record<string, string> = {};
  for (const key of Object.keys(tagged)) {
    const value = tagged[key]!;
    out[key] = Array.isArray(value)
      ? value.filter((s) => s.length > 0).join("\n")
      : renderTaggedContext(value, []);
  }
  return out;
}

/**
 * Build the system-message prefix from a prompt slot and a list of
 * already-resolved context entries.
 *
 * Aggregates object-form context entries under their normalized tag keys.
 * For inline prompts, resolves the prompt as today and renders the aggregated
 * context as a single XML block appended (blank-line-separated) to the prompt.
 *
 * For PromptFile prompts (`promptFileBrand` present), renders the `<system>`
 * template against `{ input, ctx, config }` where `config` carries the resolved
 * model/tools/caching plus the aggregated context map. When the template
 * declares a `<context>` block, it owns context rendering: the default XML-tag
 * append is suppressed and the rendered block is wrapped in `<context>...
 * </context>`. The constructed `config` view is returned so the caller can
 * render a PromptFile `<user>` slot against the same scope.
 *
 * Returns an empty `messages` array when both prompt and context are empty.
 */
export async function buildSystemPrefix<TInput, TCtx extends BlockContext>(
  promptValue: PromptSlot<TInput, TCtx>,
  promptFileBrand: PromptFileBrand | undefined,
  contextValues: unknown[],
  input: TInput,
  ctx: TCtx,
  configMeta: PromptFileConfigMeta,
): Promise<{ messages: unknown[]; configView: PromptFileConfigView | undefined; promptText: string }> {
  const aggregated = await aggregateContextEntries(contextValues, input, ctx);

  let promptStr: string;
  let xmlBlock: string;
  let configView: PromptFileConfigView | undefined;

  if (promptFileBrand) {
    const config: PromptFileConfigView = {
      ...configMeta,
      context: flattenAggregatedContext(aggregated.tagged),
    };
    configView = config;
    const scope = { input, ctx, config };
    promptStr = await promptFileBrand.renderSystem(scope);
    if (promptFileBrand.hasContextBlock) {
      const ctxStr = (await promptFileBrand.renderContext(scope)) ?? "";
      xmlBlock = `<context>\n${ctxStr}\n</context>`;
    } else {
      xmlBlock = renderTaggedContext(aggregated.tagged, aggregated.taggedOrder);
    }
  } else {
    promptStr = await resolvePrompt(promptValue, input, ctx);
    xmlBlock = renderTaggedContext(aggregated.tagged, aggregated.taggedOrder);
  }

  const combinedParts: string[] = [];
  if (promptStr.length > 0) combinedParts.push(promptStr);
  if (xmlBlock.length > 0) combinedParts.push(xmlBlock);
  const combinedContent = combinedParts.join("\n\n");

  const messages: unknown[] = [];
  if (combinedContent.length > 0) {
    messages.push({ role: "system", content: combinedContent });
  }
  for (const pt of aggregated.passThrough) {
    messages.push(asSystemMessage(pt));
  }
  return { messages, configView, promptText: promptStr };
}

// ---------------------------------------------------------------------------
// User-message helpers (dedup)
// ---------------------------------------------------------------------------

export function asUserMessage(value: unknown): unknown {
  if (typeof value === "string") {
    return { role: "user", content: value };
  }
  return value;
}

/**
 * Whether two values represent the same user-role LLM message. Used at
 * message-assembly time to avoid double-emitting the current turn's user
 * input when both `action.userMessage` (via live items in historyValues)
 * and the generator's `user` slot resolve to identical content.
 */
export function isEquivalentUserMessage(a: unknown, b: unknown): boolean {
  if (!isUserRoleMessage(a) || !isUserRoleMessage(b)) return false;
  return userMessageContentKey(a) === userMessageContentKey(b);
}

export function isUserRoleMessage(value: unknown): value is { role: "user"; content: unknown } {
  return (
    typeof value === "object" &&
    value !== null &&
    (value as { role?: unknown }).role === "user" &&
    "content" in (value as object)
  );
}

export function userMessageContentKey(msg: { content: unknown }): string {
  const c = msg.content;
  if (typeof c === "string") return c;
  try {
    const serialized = stableStringify(c);
    return serialized !== undefined ? serialized : String(c);
  } catch {
    return String(c);
  }
}

export { stableStringify } from "../../helpers/stable-stringify";
