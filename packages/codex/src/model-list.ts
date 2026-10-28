/**
 * Ask Codex which models it offers, with no run: `listCodexModels()`.
 *
 * Codex's app-server answers `model/list` with the catalog its own model
 * picker shows for the sign-in it runs on, its default marked. This starts a
 * short-lived `codex app-server` (`./app-server`), asks, and stops it, as
 * `readCodexUsage` does. Hand it the run's environment, so the list and the
 * run see one sign-in.
 *
 * **Local only**, like the usage read: OpenAI permits the app-server's ChatGPT
 * sign-in on a person's own machine, not in a hosted service.
 */
import { ReadStopped, startAppServer } from "./app-server";
import { findCodexProgram, type CodexProgram } from "./usage";

/** One model Codex offers. */
export interface CodexModelInfo {
  /** The id a run takes. Pass it as the block's `model`. */
  id: string;
  /** Codex's name for it. */
  label: string;
  /** Codex's description of it, when it gave one. */
  description?: string;
  /** Whether this is the model Codex runs when none is named. */
  isDefault: boolean;
}

/** What {@link listCodexModels} found. */
export type CodexModelList =
  /** The models Codex's picker shows, its default first. */
  | { status: "models"; models: CodexModelInfo[] }
  /** No list: Codex missing, an error, no answer in time, or an empty list. `reason` is for a person. */
  | { status: "failed"; reason: string };

/** Options for {@link listCodexModels}. */
export interface ListCodexModelsOptions {
  /** The environment Codex is started with. Pass the one the run gets. */
  env: Record<string, string>;
  /** How long to wait for Codex's answers. Default 10 000 ms. */
  timeoutMs?: number;
  /**
   * The program to start as `<path> app-server`. A seam for tests; the
   * default is {@link findCodexProgram}'s answer.
   */
  program?: CodexProgram;
}

/** A row of `model/list`, as far as this reads it. */
interface ModelRow {
  id?: unknown;
  model?: unknown;
  displayName?: unknown;
  description?: unknown;
  hidden?: unknown;
  isDefault?: unknown;
}

/** A page of `model/list`. */
interface ModelPage {
  data?: unknown;
  nextCursor?: unknown;
}

/** Pages read before the list is taken as complete; Codex's whole catalog fits in one. */
const MAX_PAGES = 10;

/**
 * Ask Codex for the models its picker offers, without a run.
 *
 * @returns `models`, the default first, or `failed` with a reason. Never throws.
 */
export async function listCodexModels(options: ListCodexModelsOptions): Promise<CodexModelList> {
  const timeoutMs = options.timeoutMs ?? 10_000;
  let program: CodexProgram;
  try {
    program = options.program ?? (await findCodexProgram(options.env));
  } catch {
    return { status: "failed", reason: "The Codex CLI could not be found: is @openai/codex-sdk installed?" };
  }

  const session = startAppServer(program, options.env);
  const timer = setTimeout(() => session.stop(`Codex did not list its models within ${timeoutMs / 1000} s`), timeoutMs);
  try {
    await session.request("initialize", { clientInfo: { name: "flow-state-dev", title: null, version: "0" }, capabilities: null });
    session.notify("initialized");
    const rows: ModelRow[] = [];
    let cursor: string | null = null;
    for (let page = 0; page < MAX_PAGES; page++) {
      const answer = (await session.request("model/list", cursor === null ? {} : { cursor })) as ModelPage;
      if (Array.isArray(answer.data)) rows.push(...(answer.data as ModelRow[]));
      cursor = typeof answer.nextCursor === "string" && answer.nextCursor !== "" ? answer.nextCursor : null;
      if (cursor === null) break;
    }
    const models = toModels(rows);
    if (models.length === 0) return { status: "failed", reason: "Codex listed no models" };
    return { status: "models", models };
  } catch (error) {
    return { status: "failed", reason: error instanceof ReadStopped ? error.message : "Codex could not list its models" };
  } finally {
    clearTimeout(timer);
    session.stop("done");
  }
}

/** Codex's rows as models: the ones its picker shows, one per id, the default first. */
function toModels(rows: readonly ModelRow[]): CodexModelInfo[] {
  const text = (value: unknown): string | undefined => (typeof value === "string" && value !== "" ? value : undefined);
  const byId = new Map<string, CodexModelInfo>();
  for (const row of rows) {
    if (row.hidden === true) continue;
    const id = text(row.model) ?? text(row.id);
    if (id === undefined || byId.has(id)) continue;
    const description = text(row.description);
    byId.set(id, { id, label: text(row.displayName) ?? id, ...(description === undefined ? {} : { description }), isDefault: row.isDefault === true });
  }
  const models = [...byId.values()];
  const first = models.findIndex((model) => model.isDefault);
  return first <= 0 ? models : [models[first]!, ...models.slice(0, first), ...models.slice(first + 1)];
}
