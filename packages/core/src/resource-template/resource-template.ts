/**
 * Isomorphic resource-template parser and renderer.
 *
 * A resource template is a `.md` file in the FIX-669 format (YAML frontmatter
 * + optional `<system>/<user>/<context>` role tags) rendered against a resource's
 * own `{ state }` scope via hardened LiquidJS. The `<system>` section (or the
 * full body when untagged) becomes the resource's content body on each read.
 *
 * This module is browser-safe — no `node:fs` imports. The Node-only loader
 * lives in `load-resource-template.node.ts`.
 */

import { Liquid } from "liquidjs";
import { z } from "zod";
import type { JsonObject } from "../schema/common";
import {
  parseRoleTaggedMarkdown,
  RoleTaggedMarkdownParseError,
} from "../markdown/role-tagged";

const MAX_TEMPLATE_LENGTH = 512 * 1024; // 512 KB
const RENDER_LIMIT_MS = 5_000;
const MEMORY_LIMIT = 1e8; // 100M

/** Keys recognized in resource-template frontmatter. */
const ResourceTemplateFrontmatter = z
  .object({
    name: z.string().min(1).optional(),
    description: z.string().max(1024).optional(),
  })
  .passthrough();

const GENERATOR_ONLY_KEYS = new Set([
  "model",
  "intent",
  "caching",
  "maxTokens",
  "temperature",
]);

export class ResourceTemplateParseError extends Error {
  readonly sourcePath?: string;
  constructor(message: string, options?: { cause?: unknown; sourcePath?: string }) {
    super(message, options?.cause !== undefined ? { cause: options.cause } : undefined);
    this.name = "ResourceTemplateParseError";
    this.sourcePath = options?.sourcePath;
  }
}

export class ResourceTemplateRenderError extends Error {
  readonly sourcePath?: string;
  constructor(message: string, options?: { cause?: unknown; sourcePath?: string }) {
    super(message, options?.cause !== undefined ? { cause: options.cause } : undefined);
    this.name = "ResourceTemplateRenderError";
    this.sourcePath = options?.sourcePath;
  }
}

export class ResourceTemplateResolutionError extends Error {
  readonly ref: string;
  readonly consumer: string;
  constructor(ref: string, consumer: string) {
    super(`Cannot resolve contentTemplateRef "${ref}" for resource "${consumer}" — template resource not found in scope chain`);
    this.name = "ResourceTemplateResolutionError";
    this.ref = ref;
    this.consumer = consumer;
  }
}

export interface ResourceTemplate {
  readonly name?: string;
  readonly description?: string;
  readonly sections: { system: string; user?: string; context?: string };
  readonly source: string;
  readonly inertKeys: readonly string[];
}

/** Pre-registered partials, keyed by name (filename without `.md`). */
export type ResourceTemplatePartials = Record<string, string>;

function makePartialFs(partials: ResourceTemplatePartials) {
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
 * Parse role-tagged Markdown into a ResourceTemplate (isomorphic).
 *
 * @throws {ResourceTemplateParseError} on frontmatter or body parse failure.
 */
export function parseResourceTemplate(
  text: string,
  options?: { sourcePath?: string; partials?: ResourceTemplatePartials }
): ResourceTemplate {
  const sourcePath = options?.sourcePath;

  if (text.length > MAX_TEMPLATE_LENGTH) {
    throw new ResourceTemplateParseError(
      `Template exceeds maximum length (${MAX_TEMPLATE_LENGTH} characters)`,
      { sourcePath }
    );
  }

  let roleTagged;
  try {
    roleTagged = parseRoleTaggedMarkdown(text, { sourcePath });
  } catch (cause) {
    if (cause instanceof RoleTaggedMarkdownParseError) {
      throw new ResourceTemplateParseError(cause.message, { cause, sourcePath });
    }
    throw cause;
  }

  const fmResult = ResourceTemplateFrontmatter.safeParse(roleTagged.frontmatter);
  if (!fmResult.success) {
    throw new ResourceTemplateParseError(
      `Invalid frontmatter: ${fmResult.error.issues
        .map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`)
        .join("; ")}`,
      { cause: fmResult.error, sourcePath }
    );
  }

  const inertKeys: string[] = [];
  for (const key of Object.keys(roleTagged.frontmatter)) {
    if (GENERATOR_ONLY_KEYS.has(key)) {
      inertKeys.push(key);
    }
  }

  if (inertKeys.length > 0 && typeof process !== "undefined" && process.env?.NODE_ENV !== "production") {
    console.warn(
      `[resource-template] Generator-only frontmatter keys ignored in resource context: ${inertKeys.join(", ")}` +
        (sourcePath ? ` (${sourcePath})` : "")
    );
  }

  const systemBody = roleTagged.sections.system;
  const body = systemBody ?? roleTagged.body.trim();

  if (roleTagged.sections.user !== undefined && typeof process !== "undefined" && process.env?.NODE_ENV !== "production") {
    console.warn(
      `[resource-template] <user> section is generator-only; ignored for resource content` +
        (sourcePath ? ` (${sourcePath})` : "")
    );
  }
  if (roleTagged.sections.context !== undefined && typeof process !== "undefined" && process.env?.NODE_ENV !== "production") {
    console.warn(
      `[resource-template] <context> section is generator-only; ignored for resource content` +
        (sourcePath ? ` (${sourcePath})` : "")
    );
  }

  // Validate that the template compiles (catch Liquid syntax errors at parse time).
  const partials = options?.partials ?? {};
  const partialFs = makePartialFs(partials);
  try {
    const testEngine = new Liquid({
      extname: ".md",
      strictVariables: false,
      strictFilters: true,
      ownPropertyOnly: true,
      fs: partialFs,
    });
    testEngine.parse(body);
  } catch (cause) {
    throw new ResourceTemplateParseError(
      `Template compile failed: ${(cause as Error).message}`,
      { cause, sourcePath }
    );
  }

  return {
    name: fmResult.data.name,
    description: fmResult.data.description,
    sections: {
      system: body,
      user: roleTagged.sections.user,
      context: roleTagged.sections.context,
    },
    source: text,
    inertKeys,
  };
}

/**
 * Render a ResourceTemplate's body against resource state (deterministic, no model call).
 *
 * @throws {ResourceTemplateRenderError} on strict-variable miss, limit exceeded, etc.
 */
export function renderResourceTemplate(
  template: ResourceTemplate,
  state: JsonObject,
  options?: { partials?: ResourceTemplatePartials }
): string {
  const partials = options?.partials ?? {};
  const partialFs = makePartialFs(partials);

  const engine = new Liquid({
    extname: ".md",
    strictVariables: true,
    strictFilters: true,
    ownPropertyOnly: true,
    lenientIf: true,
    parseLimit: MAX_TEMPLATE_LENGTH,
    renderLimit: RENDER_LIMIT_MS,
    memoryLimit: MEMORY_LIMIT,
    fs: partialFs,
  });

  try {
    return engine.parseAndRenderSync(template.sections.system, { state });
  } catch (cause) {
    throw new ResourceTemplateRenderError(
      `Template render failed: ${(cause as Error).message}`,
      { cause, sourcePath: template.source.slice(0, 100) }
    );
  }
}
