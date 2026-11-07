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
 * The SDK is asked in a process whose environment is exactly `env`
 * (`runtime/cursor-models-child.mjs`), as a run with that `env` runs in one
 * (`./child-runtime`). So the list is the account the run signs in as: its
 * `CURSOR_API_KEY`, or else the stored login under its `HOME`, and never the
 * server's own key, which such a run doesn't get.
 */
import { spawn } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
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
  /** The environment a run gets: the asking process's whole environment. Nothing else is inherited. */
  env: Readonly<Record<string, string>>;
  /** How long to wait for Cursor's answer. Default 10 000 ms. */
  timeoutMs?: number;
  /** The module the asking process loads the SDK from. Default `@cursor/sdk`. A test seam. */
  sdkModule?: string;
}

/** The asking script, beside the runtime's child script (one directory up from `src/` or `dist/`). */
const MODELS_SCRIPT = join(dirname(fileURLToPath(import.meta.url)), "..", "runtime", "cursor-models-child.mjs");

/** What the asking script prints. */
type Answer = { rows: unknown } | { loadError: string } | { listError: string };

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

/**
 * Ask Cursor for the models the account can run, without a run.
 *
 * @returns `models` in Cursor's order, or `failed` with a reason. Never throws.
 */
export async function listCursorModels(
  options: ListCursorModelsOptions,
): Promise<HarnessModelList<HarnessModelInfo & { variants: CursorModelVariant[] }>> {
  const timeoutMs = options.timeoutMs ?? 10_000;
  const answer = await ask(options.env, options.sdkModule ?? "@cursor/sdk", timeoutMs);
  if ("failed" in answer) return { status: "failed", reason: answer.failed };
  if ("loadError" in answer) return { status: "failed", reason: `The Cursor SDK could not be loaded: ${answer.loadError}` };
  if ("listError" in answer) return { status: "failed", reason: `Cursor could not list its models: ${answer.listError}` };
  const models = toModels(Array.isArray(answer.rows) ? (answer.rows as ModelRow[]) : []);
  if (models.length === 0) return { status: "failed", reason: "Cursor listed no models" };
  return { status: "models", models };
}

/**
 * Run the asking script with exactly `env`, and read its one line. A process
 * that can't start, says nothing, or outlives `timeoutMs` is `failed`.
 */
function ask(env: Readonly<Record<string, string>>, sdkModule: string, timeoutMs: number): Promise<Answer | { failed: string }> {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [MODELS_SCRIPT, sdkModule], {
      // A copy, so nothing a caller adds to its object later reaches the process.
      env: { ...env },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8").on("data", (chunk: string) => (stdout += chunk));
    child.stderr.setEncoding("utf8").on("data", (chunk: string) => (stderr = (stderr + chunk).slice(-500)));
    let late = false;
    const timer = setTimeout(() => {
      late = true;
      child.kill("SIGKILL");
    }, timeoutMs);
    child.on("error", (error) => {
      clearTimeout(timer);
      resolve({ failed: `Cursor's model list could not be asked: ${error.message}` });
    });
    child.on("close", (code, signal) => {
      clearTimeout(timer);
      if (late) return resolve({ failed: `Cursor did not list its models within ${timeoutMs} ms` });
      try {
        return resolve(JSON.parse(stdout.trim().split("\n").at(-1) ?? "") as Answer);
      } catch {
        const how = signal !== null ? `was ended by ${signal}` : `exited with code ${String(code)}`;
        const said = stderr.trim();
        resolve({ failed: `Cursor's model list ${how} without an answer${said === "" ? "" : `: ${said}`}` });
      }
    });
  });
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
