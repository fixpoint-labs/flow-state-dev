/**
 * Compile a typed config block catalog into real `@flow-state-dev/core` blocks.
 */
import {
  defineFlow,
  generator,
  handler,
  sequencer,
  utility,
  type BlockDefinition,
  type FlowType,
} from "@flow-state-dev/core";
import { z, type ZodTypeAny } from "zod";
import { jsonSchemaToZod } from "./json-schema-to-zod";
import { applyMappings, getAtPath, interpolateTemplate, isPathExpression, resolveMappingValue } from "./path";
import type {
  BlockConfig,
  FlowJsonConfig,
  HostTool,
  HttpBlockConfig,
  LoadFlowOptions,
  MapBlockConfig,
  ToolBlockConfig,
} from "./types";

export type CompiledBlocks = Record<string, BlockDefinition<any, any>>;

type CompileContext = {
  config: FlowJsonConfig;
  options: LoadFlowOptions;
  cache: Map<string, BlockDefinition<any, any>>;
  visiting: Set<string>;
};

function schemaOrUnknown(schema: BlockConfig["inputSchema"]): ZodTypeAny {
  return schema !== undefined ? jsonSchemaToZod(schema) : z.unknown();
}

function schemaOrAny(schema: BlockConfig["outputSchema"] | undefined): ZodTypeAny | undefined {
  return schema !== undefined ? jsonSchemaToZod(schema) : undefined;
}

function compileMap(name: string, block: MapBlockConfig): BlockDefinition<any, any> {
  const inputSchema = schemaOrUnknown(block.inputSchema);
  const outputSchema = schemaOrAny(block.outputSchema) ?? z.record(z.unknown());
  return handler({
    name,
    inputSchema,
    outputSchema,
    execute: (input) => applyMappings(block.mappings, input),
  });
}

function compileHttp(
  name: string,
  block: HttpBlockConfig,
  options: LoadFlowOptions,
): BlockDefinition<any, any> {
  const inputSchema = schemaOrUnknown(block.inputSchema);
  const outputSchema = schemaOrAny(block.outputSchema) ?? z.unknown();
  const method = block.method ?? "GET";
  const parseJson = block.parseJson !== false;
  const fetchImpl = options.fetch ?? globalThis.fetch;

  return handler({
    name,
    inputSchema,
    outputSchema,
    execute: async (input) => {
      if (typeof fetchImpl !== "function") {
        throw new Error(
          `http block "${name}": no fetch available. Pass LoadFlowOptions.fetch or run on a platform with global fetch.`,
        );
      }
      const url =
        block.url.includes("{{") || isPathExpression(block.url)
          ? block.url.includes("{{")
            ? interpolateTemplate(block.url, input)
            : String(getAtPath(input, block.url) ?? "")
          : block.url;

      const headers: Record<string, string> = {};
      if (block.headers !== undefined) {
        for (const [k, v] of Object.entries(block.headers)) {
          headers[k] = v.includes("{{") ? interpolateTemplate(v, input) : v;
        }
      }

      let body: string | undefined;
      if (block.body !== undefined && method !== "GET") {
        if (typeof block.body === "string") {
          body = block.body.includes("{{")
            ? interpolateTemplate(block.body, input)
            : isPathExpression(block.body)
              ? JSON.stringify(getAtPath(input, block.body))
              : block.body;
        } else {
          const resolved = resolveMappingValue(block.body, input);
          body = JSON.stringify(resolved);
          if (headers["Content-Type"] === undefined && headers["content-type"] === undefined) {
            headers["Content-Type"] = "application/json";
          }
        }
      }

      const response = await fetchImpl(url, { method, headers, body });
      const text = await response.text();
      let parsed: unknown = text;
      if (parseJson && text.length > 0) {
        try {
          parsed = JSON.parse(text);
        } catch {
          parsed = text;
        }
      }
      return {
        ok: response.ok,
        status: response.status,
        body: parsed,
      };
    },
  });
}

function compileTool(
  name: string,
  block: ToolBlockConfig,
  options: LoadFlowOptions,
): BlockDefinition<any, any> {
  const inputSchema = schemaOrUnknown(block.inputSchema);
  const outputSchema = schemaOrAny(block.outputSchema) ?? z.unknown();
  const tools = options.tools ?? {};

  return handler({
    name,
    inputSchema,
    outputSchema,
    execute: async (input) => {
      const tool: HostTool | undefined = Object.prototype.hasOwnProperty.call(tools, block.toolId)
        ? tools[block.toolId]
        : undefined;
      if (tool === undefined) {
        throw new Error(
          `tool block "${name}": no host tool registered under id "${block.toolId}". ` +
            `Available: ${Object.keys(tools).join(", ") || "(none)"}. Pass LoadFlowOptions.tools.`,
        );
      }
      const args =
        block.args !== undefined ? resolveMappingValue(block.args, input) : input;
      return tool(args, { toolId: block.toolId, blockName: name });
    },
  });
}

function compileGenerator(
  name: string,
  block: Extract<BlockConfig, { type: "generator" }>,
  ctx: CompileContext,
): BlockDefinition<any, any> {
  const inputSchema = schemaOrUnknown(block.inputSchema);
  const outputSchema = jsonSchemaToZod(block.outputSchema);
  const model =
    block.model ??
    ctx.options.defaultModel ??
    ctx.config.defaultModel;
  if (model === undefined || model === "") {
    throw new Error(
      `generator block "${name}": no model configured. Set block.model, config.defaultModel, or LoadFlowOptions.defaultModel.`,
    );
  }
  return generator({
    name,
    inputSchema,
    outputSchema,
    model,
    prompt: block.prompt,
    ...(block.user !== undefined ? { user: block.user } : {}),
  });
}

function compileRouter(
  name: string,
  block: Extract<BlockConfig, { type: "router" }>,
  ctx: CompileContext,
): BlockDefinition<any, any> {
  const inputSchema = schemaOrUnknown(block.inputSchema);
  const outputSchema = schemaOrAny(block.outputSchema);

  const routeEntries = Object.entries(block.routes);
  if (routeEntries.length === 0) {
    throw new Error(`router block "${name}": routes must not be empty`);
  }

  let fallbackId: string | undefined;
  const blocks: Record<string, BlockDefinition<any, any>> = {};
  for (const [routeKey, blockId] of routeEntries) {
    if (routeKey === "default") {
      fallbackId = blockId;
      continue;
    }
    blocks[routeKey] = compileBlockById(blockId, ctx);
  }

  const fallback =
    fallbackId !== undefined ? compileBlockById(fallbackId, ctx) : undefined;

  const keyPath = block.key;

  return utility.keyedRouter({
    name,
    inputSchema,
    ...(outputSchema !== undefined ? { outputSchema } : {}),
    blocks,
    ...(fallback !== undefined ? { fallback } : {}),
    select: (input: unknown) => {
      const value = getAtPath(input, keyPath);
      if (value === undefined || value === null) return "";
      return String(value);
    },
  });
}

function compileSequencer(
  name: string,
  block: Extract<BlockConfig, { type: "sequencer" }>,
  ctx: CompileContext,
): BlockDefinition<any, any> {
  if (!Array.isArray(block.steps) || block.steps.length === 0) {
    throw new Error(`sequencer block "${name}": steps must be a non-empty array of block ids`);
  }
  const inputSchema = schemaOrUnknown(block.inputSchema);
  let seq = sequencer({ name, inputSchema });
  for (const stepId of block.steps) {
    const child = compileBlockById(stepId, ctx);
    seq = seq.step(child);
  }
  if (block.outputSchema !== undefined) {
    // Sequencer validates structurally when `.validate()` is called; we attach
    // declared output via a final identity map only if needed. For the POC,
    // leaving inferred output is enough for registration.
  }
  return seq;
}

export function compileBlockById(id: string, ctx: CompileContext): BlockDefinition<any, any> {
  const cached = ctx.cache.get(id);
  if (cached !== undefined) return cached;

  if (ctx.visiting.has(id)) {
    throw new Error(
      `json-config-flow: cycle detected while compiling block "${id}". ` +
        `Visiting: ${[...ctx.visiting].join(" → ")} → ${id}`,
    );
  }

  const raw = ctx.config.blocks[id];
  if (raw === undefined) {
    throw new Error(
      `json-config-flow: unknown block id "${id}". Known: ${Object.keys(ctx.config.blocks).join(", ")}`,
    );
  }

  ctx.visiting.add(id);
  let compiled: BlockDefinition<any, any>;
  switch (raw.type) {
    case "sequencer":
      compiled = compileSequencer(id, raw, ctx);
      break;
    case "router":
      compiled = compileRouter(id, raw, ctx);
      break;
    case "generator":
      compiled = compileGenerator(id, raw, ctx);
      break;
    case "map":
      compiled = compileMap(id, raw);
      break;
    case "http":
      compiled = compileHttp(id, raw, ctx.options);
      break;
    case "tool":
      compiled = compileTool(id, raw, ctx.options);
      break;
    default: {
      const exhaustive: never = raw;
      throw new Error(`json-config-flow: unsupported block type ${(exhaustive as BlockConfig).type}`);
    }
  }
  ctx.visiting.delete(id);
  ctx.cache.set(id, compiled);
  return compiled;
}

/**
 * Compile every block reachable from actions (and, for inspectability, every
 * declared block once). Returns the map keyed by config block id.
 */
export function compileAllBlocks(
  config: FlowJsonConfig,
  options: LoadFlowOptions = {},
): CompiledBlocks {
  const ctx: CompileContext = {
    config,
    options,
    cache: new Map(),
    visiting: new Set(),
  };

  for (const action of Object.values(config.actions)) {
    compileBlockById(action.block, ctx);
  }
  // Also compile any unused declared blocks so author typos surface early when
  // they ask for the full graph; lazy-only would hide them until referenced.
  for (const id of Object.keys(config.blocks)) {
    compileBlockById(id, ctx);
  }

  return Object.fromEntries(ctx.cache.entries());
}

/**
 * Build a `defineFlow` factory from JSON config — registerable with the engine
 * the same way a hand-written flow is.
 */
export function loadFlowFromJson(
  config: FlowJsonConfig,
  options: LoadFlowOptions = {},
): FlowType<any, any, any, any, any, any, any> {
  if (typeof config.kind !== "string" || config.kind.length === 0) {
    throw new Error('loadFlowFromJson: config.kind must be a non-empty string');
  }
  if (config.actions === undefined || Object.keys(config.actions).length === 0) {
    throw new Error("loadFlowFromJson: config.actions must declare at least one action");
  }
  if (config.blocks === undefined || Object.keys(config.blocks).length === 0) {
    throw new Error("loadFlowFromJson: config.blocks must declare at least one block");
  }

  const compiled = compileAllBlocks(config, options);

  const actions: Record<string, { block: BlockDefinition<any, any>; description?: string; inputSchema?: ZodTypeAny }> =
    {};
  for (const [actionName, action] of Object.entries(config.actions)) {
    const block = compiled[action.block];
    if (block === undefined) {
      throw new Error(`loadFlowFromJson: action "${actionName}" references missing block "${action.block}"`);
    }
    actions[actionName] = {
      block,
      ...(action.description !== undefined ? { description: action.description } : {}),
      ...(action.inputSchema !== undefined
        ? { inputSchema: jsonSchemaToZod(action.inputSchema) }
        : {}),
    };
  }

  return defineFlow({
    kind: config.kind,
    ...(config.requireUser !== undefined ? { requireUser: config.requireUser } : {}),
    actions,
    session: { stateSchema: z.object({}) },
  });
}
