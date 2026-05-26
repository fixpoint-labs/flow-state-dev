/**
 * Isomorphic `.md` prompt-file parser and LiquidJS renderer.
 *
 * Generators can author their prompt prose in a separate `.md` file instead of
 * inline TypeScript strings. The file carries YAML frontmatter (metadata +
 * scalar config) and a body split into `<system>` / `<user>` / `<context>`
 * role-tagged sections. Section bodies are LiquidJS templates rendered at
 * generator-call time against `{ input, ctx, config }`.
 *
 * This module is browser-safe — it never imports `node:fs`. The Node-only
 * loader that reads files from disk and auto-discovers sibling partials lives
 * in `load-prompt-file.node.ts`. Browser/bundled consumers pass the raw text
 * (e.g. via Vite's `?raw`) and a `partials` map directly to `parsePromptFile`.
 *
 * Presence of a `<context>` block signals the template owns context rendering:
 * the framework's default XML-tag context append is suppressed and the template
 * renders the aggregated context map (`config.context`) in author-chosen order.
 */

import matter from "gray-matter";
import { Liquid, type Template } from "liquidjs";
import { z } from "zod";
import type { BlockContext } from "../types/block";
import type { CachingConfig } from "../types/model";

/** Brand key carried on the `prompt` closure a PromptFile produces. The
 * generator reads it to detect PromptFile-sourced prompts and route them
 * through template-aware composition. */
export const PROMPT_FILE_BRAND: unique symbol = Symbol.for("@flow-state-dev/prompt-file");

/** Liquid filter implementation. First argument is the piped value; the rest
 * are filter arguments. May return a Promise (resolved by async render). */
export type PromptFileFilter = (input: unknown, ...args: unknown[]) => unknown;

/** Custom Liquid filters, keyed by the name templates invoke them under. */
export type PromptFileFilters = Record<string, PromptFileFilter>;

/** Pre-registered partials, keyed by the name `{% render %}` references them
 * under (filename without the `.md` extension). */
export type PromptFilePartials = Record<string, string>;

/** Caching config accepted in frontmatter: `true` for framework defaults, or
 * the explicit object form. */
const CachingConfigSchema = z
  .object({
    enabled: z.boolean().optional(),
    breakpoints: z.enum(["auto", "manual"]).optional(),
    ttl: z.enum(["5m", "1h"]).optional(),
  })
  .strict();

/** Zod schema for prompt-file frontmatter. Metadata + scalar config only —
 * no schemas, no tools, no capabilities (those stay in TypeScript). */
export const PromptFileFrontmatter = z
  .object({
    name: z.string().min(1).optional(),
    description: z.string().max(1024).optional(),
    intent: z.string().optional(),
    model: z.string().optional(),
    caching: z.union([z.boolean(), CachingConfigSchema]).optional(),
    maxTokens: z.number().int().positive().optional(),
    temperature: z.number().min(0).max(2).optional(),
  })
  .strict();

export type PromptFileFrontmatterData = z.infer<typeof PromptFileFrontmatter>;

/** The post-resolution generator-config view exposed to templates as `config`.
 * Constructed by the generator at call time — not the raw config the developer
 * wrote. `context` is the aggregated FIX-434 tag map. */
export interface PromptFileConfigView {
  /** Aggregated context tag map, keyed by XML tag name. Each value is the
   * rendered string the framework would otherwise place inside the tag. */
  readonly context: Record<string, string>;
  /** Resolved concrete model id (post-intent-resolution). */
  readonly model?: string;
  /** Original intent string, if the generator declared one. */
  readonly intent?: string;
  /** Resolved tool names. */
  readonly tools?: string[];
  /** Resolved caching config. */
  readonly caching?: CachingConfig;
  readonly maxTokens?: number;
  readonly temperature?: number;
  readonly providerOptions?: Record<string, unknown>;
}

/** Render scope passed to each section template. `input` + `ctx` match what a
 * TypeScript prompt fn receives today; `config` is the template-only view. */
export interface PromptFileRenderScope {
  readonly input: unknown;
  readonly ctx: BlockContext;
  readonly config: PromptFileConfigView;
}

/** A section renderer: compiles once at parse time, renders per call. */
type SectionRenderer = (scope: PromptFileRenderScope) => Promise<string>;

/** The brand handle the generator reads off a PromptFile's `prompt` closure to
 * drive template-aware composition. */
export interface PromptFileBrand {
  /** Source path (or `"(inline)"`), used in error messages and trace capture. */
  readonly source: string;
  /** Raw `.md` file text, surfaced in the DevTool trace alongside the render. */
  readonly rawText: string;
  readonly frontmatter: Record<string, unknown>;
  readonly hasUserBlock: boolean;
  readonly hasContextBlock: boolean;
  /** Render the `<system>` body against the given scope. */
  renderSystem(scope: PromptFileRenderScope): Promise<string>;
  /** Render the `<user>` body, or `undefined` when no `<user>` block. */
  renderUser(scope: PromptFileRenderScope): Promise<string> | undefined;
  /** Render the `<context>` body, or `undefined` when no `<context>` block. */
  renderContext(scope: PromptFileRenderScope): Promise<string> | undefined;
}

/** A prompt slot value that carries the PromptFile brand. */
export type BrandedPromptSlot = ((
  input: unknown,
  ctx: BlockContext,
  config?: PromptFileConfigView
) => Promise<string>) & { [PROMPT_FILE_BRAND]: PromptFileBrand };

/** Parsed prompt file. `prompt` / `user` are async renderers wired into the
 * generator config; `_meta` carries the brand handle and parse metadata. */
export interface PromptFile {
  readonly name?: string;
  readonly description?: string;
  /** System-section renderer. Branded so the generator detects it. */
  readonly prompt: BrandedPromptSlot;
  /** User-section renderer, present only when the file declares `<user>`. */
  readonly user?: (
    input: unknown,
    ctx: BlockContext,
    config?: PromptFileConfigView
  ) => Promise<string>;
  readonly caching?: boolean | CachingConfig;
  readonly maxTokens?: number;
  readonly temperature?: number;
  readonly _meta: {
    readonly source: string;
    readonly frontmatter: PromptFileFrontmatterData;
    readonly hasUserBlock: boolean;
    readonly hasContextBlock: boolean;
  };
}

/** Spreadable subset of a PromptFile that slots into a generator config.
 * `caching` is normalized to the object form the generator config accepts
 * (frontmatter's `caching: true` / `false` becomes `{ enabled: ... }`). */
export interface PromptFileConfig {
  readonly name?: string;
  readonly description?: string;
  readonly prompt: BrandedPromptSlot;
  readonly user?: (
    input: unknown,
    ctx: BlockContext,
    config?: PromptFileConfigView
  ) => Promise<string>;
  readonly caching?: CachingConfig;
  readonly maxTokens?: number;
  readonly temperature?: number;
}

/** Options for {@link parsePromptFile}. */
export interface ParsePromptFileOptions {
  /** Source path, used in error messages and trace capture. */
  sourcePath?: string;
  /** Custom Liquid filters, scoped to this PromptFile (no global registry). */
  filters?: PromptFileFilters;
  /** Pre-registered partials. The Node loader populates this from sibling
   * `.md` files; browser consumers pass it explicitly. */
  partials?: PromptFilePartials;
}

/** Thrown when a prompt file cannot be read from disk. */
export class PromptFileLoadError extends Error {
  readonly sourcePath?: string;
  constructor(message: string, options?: { cause?: unknown; sourcePath?: string }) {
    super(message, options?.cause !== undefined ? { cause: options.cause } : undefined);
    this.name = "PromptFileLoadError";
    this.sourcePath = options?.sourcePath;
  }
}

/** Thrown when a prompt file's frontmatter, body grammar, or templates are
 * invalid. Carries the source path and the underlying cause. */
export class PromptFileParseError extends Error {
  readonly sourcePath?: string;
  constructor(message: string, options?: { cause?: unknown; sourcePath?: string }) {
    super(message, options?.cause !== undefined ? { cause: options.cause } : undefined);
    this.name = "PromptFileParseError";
    this.sourcePath = options?.sourcePath;
  }
}

const SECTION_TAGS = ["system", "user", "context"] as const;
type SectionTag = (typeof SECTION_TAGS)[number];

/** Extract a single line-anchored `<tag>...</tag>` section body. Throws if the
 * tag appears more than once. Returns `undefined` if absent. */
function extractSection(body: string, tag: SectionTag, sourcePath?: string): string | undefined {
  const re = new RegExp(`^<${tag}>([\\s\\S]*?)</${tag}>`, "gm");
  const matches = [...body.matchAll(re)];
  if (matches.length > 1) {
    throw new PromptFileParseError(
      `Multiple <${tag}> blocks found; at most one is allowed.`,
      { sourcePath }
    );
  }
  if (matches.length === 0) return undefined;
  return matches[0]![1]!.replace(/^\n+/, "").replace(/\n+$/, "");
}

/** Static partial names referenced by `{% render 'x' %}` / `{% include 'x' %}`
 * in a template body. Dynamic (variable) references are not detected. */
function referencedPartials(body: string): string[] {
  const re = /\{%-?\s*(?:render|include)\s+['"]([^'"]+)['"]/g;
  const names: string[] = [];
  for (const m of body.matchAll(re)) names.push(m[1]!);
  return names;
}

/** In-memory Liquid filesystem backing `{% render %}` / `{% include %}` against
 * a partials map. Keys are partial names (filename without `.md`). */
function makePartialFs(partials: PromptFilePartials) {
  const lookup = (filepath: string): string | undefined => {
    const key = filepath.replace(/\.md$/, "");
    return partials[key];
  };
  return {
    sep: "/",
    dirname: (_p: string) => "",
    resolve: (_root: string, file: string, _ext: string) => file.replace(/\.md$/, ""),
    contains: async () => true,
    containsSync: () => true,
    exists: async (p: string) => lookup(p) !== undefined,
    existsSync: (p: string) => lookup(p) !== undefined,
    readFile: async (p: string) => lookup(p) ?? "",
    readFileSync: (p: string) => lookup(p) ?? "",
  };
}

/**
 * Parse `.md` prompt-file text into a {@link PromptFile}.
 *
 * Runs gray-matter over the text, validates frontmatter against the Zod schema,
 * splits the body into role-tagged sections, and compiles each section as a
 * LiquidJS template (custom `filters` and `partials` registered first). Section
 * templates render per call against `{ input, ctx, config }`.
 *
 * @throws {@link PromptFileParseError} on frontmatter parse/validation failure,
 * missing or duplicate `<system>`/`<user>`/`<context>` tags, an empty `<system>`
 * block, an unknown filter, or a referenced partial that is not registered.
 */
export function parsePromptFile(
  text: string,
  options?: ParsePromptFileOptions
): PromptFile {
  const sourcePath = options?.sourcePath;
  const partials = options?.partials ?? {};

  let parsed: matter.GrayMatterFile<string>;
  try {
    parsed = matter(text);
  } catch (cause) {
    throw new PromptFileParseError(
      `Failed to parse frontmatter: ${(cause as Error).message}`,
      { cause, sourcePath }
    );
  }

  const fmResult = PromptFileFrontmatter.safeParse(parsed.data ?? {});
  if (!fmResult.success) {
    throw new PromptFileParseError(
      `Invalid frontmatter: ${fmResult.error.issues
        .map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`)
        .join("; ")}`,
      { cause: fmResult.error, sourcePath }
    );
  }
  const frontmatter = fmResult.data;

  const body = parsed.content;
  const systemBody = extractSection(body, "system", sourcePath);
  const userBody = extractSection(body, "user", sourcePath);
  const contextBody = extractSection(body, "context", sourcePath);

  if (systemBody === undefined) {
    throw new PromptFileParseError(
      "<system> block required; file appears to be empty.",
      { sourcePath }
    );
  }
  if (systemBody.trim().length === 0) {
    throw new PromptFileParseError("<system> block is empty.", { sourcePath });
  }

  // Build per-PromptFile engines so filters/partials never leak across files.
  // `<system>`/`<user>` render under strictVariables so author typos in
  // `input` / `ctx` / `config` throw. The `<context>` block renders under a
  // lenient engine: it exists to reorder and conditionally include a dynamic,
  // capability-contributed `config.context` map, and probing an absent key
  // (`{% if config.context.foo %}`) must not throw. Both engines keep
  // strictFilters so an unknown filter still fails at parse.
  const partialFs = makePartialFs(partials);
  const engine = new Liquid({
    extname: ".md",
    strictVariables: true,
    strictFilters: true,
    fs: partialFs,
  });
  const contextEngine = new Liquid({
    extname: ".md",
    strictVariables: false,
    strictFilters: true,
    fs: partialFs,
  });
  for (const [filterName, impl] of Object.entries(options?.filters ?? {})) {
    engine.registerFilter(filterName, impl);
    contextEngine.registerFilter(filterName, impl);
  }

  // Parse-time validation: every statically-referenced partial must exist.
  for (const sectionBody of [systemBody, userBody, contextBody]) {
    if (sectionBody === undefined) continue;
    for (const name of referencedPartials(sectionBody)) {
      if (!(name in partials)) {
        throw new PromptFileParseError(
          `Referenced partial "${name}" is not registered. ` +
            `Add a sibling ${name}.md (Node) or pass it in the partials map (browser).`,
          { sourcePath }
        );
      }
    }
  }

  const compile = (sectionBody: string, withEngine: Liquid): Template[] => {
    try {
      return withEngine.parse(sectionBody);
    } catch (cause) {
      throw new PromptFileParseError(
        `Template compile failed: ${(cause as Error).message}`,
        { cause, sourcePath }
      );
    }
  };

  const systemTpl = compile(systemBody, engine);
  const userTpl = userBody !== undefined ? compile(userBody, engine) : undefined;
  const contextTpl =
    contextBody !== undefined ? compile(contextBody, contextEngine) : undefined;

  const makeRenderer = (tpl: Template[], withEngine: Liquid): SectionRenderer => {
    return async (scope) => {
      const out = await withEngine.render(tpl, {
        input: scope.input,
        ctx: scope.ctx,
        config: scope.config,
      });
      return String(out);
    };
  };

  const renderSystem = makeRenderer(systemTpl, engine);
  const renderUser = userTpl !== undefined ? makeRenderer(userTpl, engine) : undefined;
  const renderContext =
    contextTpl !== undefined ? makeRenderer(contextTpl, contextEngine) : undefined;

  const source = sourcePath ?? "(inline)";
  const hasUserBlock = userTpl !== undefined;
  const hasContextBlock = contextTpl !== undefined;

  const brand: PromptFileBrand = {
    source,
    rawText: text,
    frontmatter,
    hasUserBlock,
    hasContextBlock,
    renderSystem,
    renderUser: renderUser
      ? (scope) => renderUser(scope)
      : () => undefined,
    renderContext: renderContext
      ? (scope) => renderContext(scope)
      : () => undefined,
  };

  const emptyConfig: PromptFileConfigView = { context: {} };

  const promptFn = ((input: unknown, ctx: BlockContext, config?: PromptFileConfigView) =>
    renderSystem({ input, ctx, config: config ?? emptyConfig })) as BrandedPromptSlot;
  Object.defineProperty(promptFn, PROMPT_FILE_BRAND, {
    value: brand,
    enumerable: false,
  });

  const userFn = renderUser
    ? (input: unknown, ctx: BlockContext, config?: PromptFileConfigView) =>
        renderUser({ input, ctx, config: config ?? emptyConfig })
    : undefined;
  // Brand the user fn too, so the generator can tell a PromptFile-owned `user`
  // slot from one the author overrode after `...definePromptFile(pf)` — the
  // override should win (spread precedence), matching `prompt`.
  if (userFn) {
    Object.defineProperty(userFn, PROMPT_FILE_BRAND, {
      value: brand,
      enumerable: false,
    });
  }

  return {
    name: frontmatter.name,
    description: frontmatter.description,
    prompt: promptFn,
    user: userFn,
    caching: frontmatter.caching,
    maxTokens: frontmatter.maxTokens,
    temperature: frontmatter.temperature,
    _meta: {
      source,
      frontmatter,
      hasUserBlock,
      hasContextBlock,
    },
  };
}

/**
 * Wrap a {@link PromptFile} into the spreadable subset that slots into a
 * generator config: `{ ...definePromptFile(pf), model, tools, ... }`. Spread
 * order wins on overlapping fields (e.g. an inline `prompt` after the spread
 * overrides the file's prompt).
 */
export function definePromptFile(promptFile: PromptFile): PromptFileConfig {
  const config: {
    -readonly [K in keyof PromptFileConfig]: PromptFileConfig[K];
  } = {
    prompt: promptFile.prompt,
  };
  if (promptFile.name !== undefined) config.name = promptFile.name;
  if (promptFile.description !== undefined) config.description = promptFile.description;
  if (promptFile.user !== undefined) config.user = promptFile.user;
  if (promptFile.caching !== undefined) {
    // Generator config takes `CachingConfig` (object), not a bare boolean.
    // Normalize frontmatter's `caching: true|false` to `{ enabled }`.
    config.caching =
      typeof promptFile.caching === "boolean"
        ? { enabled: promptFile.caching }
        : promptFile.caching;
  }
  if (promptFile.maxTokens !== undefined) config.maxTokens = promptFile.maxTokens;
  if (promptFile.temperature !== undefined) config.temperature = promptFile.temperature;
  return config;
}

/**
 * Narrow an unknown value to a {@link PromptFile}: a parsed-file object whose
 * `prompt` slot carries the brand. Distinguishes a whole PromptFile passed
 * directly as a generator's `prompt` (`prompt: pf`) from a bare branded slot
 * (`prompt: pf.prompt`), a string, a resolver function, or an array.
 */
export function isPromptFile(value: unknown): value is PromptFile {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    getPromptFileBrand((value as { prompt?: unknown }).prompt) !== undefined
  );
}

/** Read the PromptFile brand off a prompt-slot value, if present. Scans array
 * slots for the first branded entry. Returns `undefined` for inline prompts. */
export function getPromptFileBrand(value: unknown): PromptFileBrand | undefined {
  if (typeof value === "function") {
    const brand = (value as Partial<BrandedPromptSlot>)[PROMPT_FILE_BRAND];
    return brand as PromptFileBrand | undefined;
  }
  if (Array.isArray(value)) {
    for (const entry of value) {
      const brand = getPromptFileBrand(entry);
      if (brand) return brand;
    }
  }
  return undefined;
}
