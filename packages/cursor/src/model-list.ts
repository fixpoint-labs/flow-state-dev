/**
 * Ask Cursor which models the signed-in account can run, with no run:
 * `listCursorModels()`, over the SDK's `Cursor.models.list()`.
 *
 * Each model comes back in core's shared shape, with the variants Cursor runs
 * it at beside it (Grok's reasoning effort is one): a variant's `params` go
 * into the block's model selection as they are. Cursor's catalog marks a
 * default variant within a model, never a default model, so no model is
 * `isDefault`.
 *
 * The key is the run's: `env.CURSOR_API_KEY` when it is set. Without one the
 * SDK answers from its stored login, read under this process's own `HOME`, as
 * `cursorSignIn` does.
 */
import type { HarnessModelInfo, HarnessModelList } from "@flow-state-dev/core/harness";
import type { CursorModelSelection } from "./types";

/** One way Cursor runs a model: the settings to hand it, and Cursor's name for them. */
export interface CursorModelVariant {
  /** The model's settings for this variant. Hand them as the selection's `params`. */
  params: NonNullable<CursorModelSelection["params"]>;
  /** Cursor's name for the variant. */
  label: string;
  /** Cursor's description of it, when it gave one. */
  description?: string;
  /** Whether Cursor runs the model this way when no settings are named. */
  isDefault: boolean;
}

/** Options for {@link listCursorModels}. */
export interface ListCursorModelsOptions {
  /** The environment a run gets. Only its `CURSOR_API_KEY` is read. */
  env: Readonly<Record<string, string>>;
  /** How long to wait for Cursor's answer. Default 10 000 ms. */
  timeoutMs?: number;
  /** How the SDK module is loaded. A seam for tests; the default imports the installed `@cursor/sdk`. */
  importSdk?: () => Promise<unknown>;
}

/** The SDK module path. A variable so bundlers don't eagerly resolve it. */
const SDK_MODULE = "@cursor/sdk";

/** A row of `Cursor.models.list()`, as far as this reads it. */
interface ModelRow {
  id?: unknown;
  displayName?: unknown;
  description?: unknown;
  variants?: unknown;
}

/** A variant of a row, as far as this reads it. */
interface VariantRow {
  params?: unknown;
  displayName?: unknown;
  description?: unknown;
  isDefault?: unknown;
}

/** The part of the SDK this reads. */
interface CursorStatics {
  models?: { list?: (options?: { apiKey?: string }) => Promise<unknown> };
}

/**
 * Ask Cursor for the models the account can run, without a run.
 *
 * @returns `models` in Cursor's order, or `failed` with a reason. Never throws.
 */
export async function listCursorModels(
  options: ListCursorModelsOptions,
): Promise<HarnessModelList<HarnessModelInfo & { variants: CursorModelVariant[] }>> {
  const timeoutMs = options.timeoutMs ?? 10_000;
  const importSdk = options.importSdk ?? (() => import(/* @vite-ignore */ SDK_MODULE));
  let list: NonNullable<NonNullable<CursorStatics["models"]>["list"]>;
  try {
    const mod = (await importSdk()) as { Cursor?: CursorStatics };
    const found = mod.Cursor?.models?.list;
    if (typeof found !== "function") throw new Error("it exports no Cursor.models.list");
    list = found.bind(mod.Cursor!.models);
  } catch (error) {
    return { status: "failed", reason: `The Cursor SDK could not be loaded: ${messageOf(error)}` };
  }

  const key = options.env.CURSOR_API_KEY ?? "";
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<"late">((resolve) => {
    timer = setTimeout(() => resolve("late"), timeoutMs);
  });
  try {
    const rows = await Promise.race([list(key === "" ? {} : { apiKey: key }), late]);
    if (rows === "late") return { status: "failed", reason: `Cursor did not list its models within ${timeoutMs} ms` };
    const models = toModels(Array.isArray(rows) ? (rows as ModelRow[]) : []);
    if (models.length === 0) return { status: "failed", reason: "Cursor listed no models" };
    return { status: "models", models };
  } catch (error) {
    return { status: "failed", reason: `Cursor could not list its models: ${messageOf(error)}` };
  } finally {
    clearTimeout(timer);
  }
}

/** Cursor's rows as models, one per id, in Cursor's order. */
function toModels(rows: readonly ModelRow[]): Array<HarnessModelInfo & { variants: CursorModelVariant[] }> {
  const byId = new Map<string, HarnessModelInfo & { variants: CursorModelVariant[] }>();
  for (const row of rows) {
    const id = text(row.id);
    if (id === undefined || byId.has(id)) continue;
    const description = text(row.description);
    byId.set(id, {
      id,
      label: text(row.displayName) ?? id,
      ...(description === undefined ? {} : { description }),
      isDefault: false,
      variants: Array.isArray(row.variants) ? (row.variants as VariantRow[]).map(toVariant) : [],
    });
  }
  return [...byId.values()];
}

/** One of a row's variants. */
function toVariant(row: VariantRow): CursorModelVariant {
  const params = Array.isArray(row.params)
    ? (row.params as Array<{ id?: unknown; value?: unknown }>).flatMap((p) => {
        const id = text(p.id);
        return id !== undefined && typeof p.value === "string" ? [{ id, value: p.value }] : [];
      })
    : [];
  const description = text(row.description);
  return {
    params,
    label: text(row.displayName) ?? params.map((p) => p.value).join(" · "),
    ...(description === undefined ? {} : { description }),
    isDefault: row.isDefault === true,
  };
}

/** A non-empty string, or `undefined`. */
function text(value: unknown): string | undefined {
  return typeof value === "string" && value !== "" ? value : undefined;
}

/** An error's message, or the thrown value as text. */
function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
