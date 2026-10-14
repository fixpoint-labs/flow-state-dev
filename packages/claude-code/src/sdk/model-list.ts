/**
 * Ask Claude Code which models it offers, before anything is started on it:
 * `listClaudeModels()`.
 *
 * The same no-turn start the account probe makes (`./account-probe`): one
 * streaming-input `query()` whose input never yields, so no user message is
 * sent and no model turn starts. It asks the SDK's `supportedModels()` and
 * closes. Hand it the environment the run gets, so the list is the one the
 * run's sign-in sees.
 *
 * Each model comes back under the id the SDK resolves it to, never an alias:
 * `sonnet` and the "default" row name whatever model they point at today, and
 * a host that stores the id keeps that model after the alias moves on.
 */
import { defaultSdkImporter, type SdkImporter } from "./sdk-client";

/** One model Claude Code offers. */
export interface ClaudeModelInfo {
  /** The concrete model id, resolved from any alias. Pass it as the block's `model`. */
  id: string;
  /** Claude Code's name for it. */
  label: string;
  /** Claude Code's description of it, when it gave one. */
  description?: string;
  /** Whether this is the model Claude Code runs when none is named. */
  isDefault: boolean;
}

/** What {@link listClaudeModels} found. */
export type ClaudeModelList =
  /** Claude Code's list, de-duplicated by id, its default first. */
  | { status: "models"; models: ClaudeModelInfo[] }
  /** No list: the SDK missing, an error, no answer in time, or an empty list. `reason` is for a person. */
  | { status: "failed"; reason: string };

/** Options for {@link listClaudeModels}. */
export interface ListClaudeModelsOptions {
  /** The environment Claude Code is started with. Pass the one the run gets. */
  env: Record<string, string>;
  /** How long to wait for Claude Code's answer. Default 10 000 ms. */
  timeoutMs?: number;
  /** How the SDK module is loaded. A seam for tests; the default imports the installed SDK. */
  importSdk?: SdkImporter;
}

/** A row of the SDK's `supportedModels()`, as far as this reads it. */
interface SdkModelRow {
  value?: unknown;
  resolvedModel?: unknown;
  displayName?: unknown;
  description?: unknown;
}

/** The part of the SDK's query handle the list uses. */
interface ModelQuery {
  supportedModels(): Promise<SdkModelRow[]>;
  close?: () => void;
}

/** The value Claude Code gives the row for "whatever the default is". */
const DEFAULT_ROW = "default";

/**
 * Ask Claude Code for its models, without a model turn.
 *
 * @param options The environment to start Claude Code with, and how long to wait.
 * @returns `models`, or `failed` with a reason. Never throws.
 */
export async function listClaudeModels(options: ListClaudeModelsOptions): Promise<ClaudeModelList> {
  const timeoutMs = options.timeoutMs ?? 10_000;
  let query: (args: { prompt: AsyncIterable<never>; options: { env: Record<string, string> } }) => ModelQuery;
  try {
    const mod = await (options.importSdk ?? defaultSdkImporter)();
    if (typeof mod.query !== "function") throw new Error("the module has no `query` export");
    query = mod.query as typeof query;
  } catch (error) {
    return { status: "failed", reason: `@anthropic-ai/claude-agent-sdk could not be loaded: ${messageOf(error)}` };
  }

  let release!: () => void;
  const held = new Promise<void>((resolve) => (release = resolve));
  async function* noMessages(): AsyncGenerator<never> {
    await held;
  }

  let timer: ReturnType<typeof setTimeout> | undefined;
  let handle: ModelQuery | undefined;
  try {
    handle = query({ prompt: noMessages(), options: { env: options.env } });
    const timedOut = new Promise<"timeout">((resolve) => (timer = setTimeout(() => resolve("timeout"), timeoutMs)));
    const rows = await Promise.race([handle.supportedModels(), timedOut]);
    if (rows === "timeout") return { status: "failed", reason: `Claude Code did not list its models within ${timeoutMs} ms` };
    const models = toModels(Array.isArray(rows) ? rows : []);
    if (models.length === 0) return { status: "failed", reason: "Claude Code listed no models" };
    return { status: "models", models };
  } catch (error) {
    return { status: "failed", reason: `Claude Code could not be asked for its models: ${messageOf(error)}` };
  } finally {
    clearTimeout(timer);
    release();
    try {
      handle?.close?.();
    } catch {
      // Already closed: nothing is left running either way.
    }
  }
}

/**
 * The SDK's rows as models: each under its resolved id, one per id, the
 * default first. A named row's label wins over the default row's ("Default
 * (recommended)" names no model). A row with no id to pin is dropped: the
 * default row when the SDK doesn't say what it resolves to.
 */
function toModels(rows: readonly SdkModelRow[]): ClaudeModelInfo[] {
  const text = (value: unknown): string | undefined => (typeof value === "string" && value !== "" ? value : undefined);
  const byId = new Map<string, ClaudeModelInfo>();
  let defaultId: string | undefined;
  for (const row of rows) {
    const value = text(row.value);
    const resolved = text(row.resolvedModel);
    if (value === DEFAULT_ROW) {
      defaultId ??= resolved;
      continue;
    }
    const id = resolved ?? value;
    if (id === undefined || byId.has(id)) continue;
    const description = text(row.description);
    byId.set(id, { id, label: text(row.displayName) ?? id, ...(description === undefined ? {} : { description }), isDefault: false });
  }
  if (defaultId !== undefined) {
    const row = rows.find((r) => text(r.value) === DEFAULT_ROW);
    const named = byId.get(defaultId);
    byId.delete(defaultId);
    const description = text(row?.description);
    const first: ClaudeModelInfo = named
      ? { ...named, isDefault: true }
      : { id: defaultId, label: defaultId, ...(description === undefined ? {} : { description }), isDefault: true };
    return [first, ...byId.values()];
  }
  return [...byId.values()];
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
