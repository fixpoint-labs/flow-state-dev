/**
 * JSON config shapes for the lab catalog. These are the *authoring* types —
 * the loader compiles them into real core blocks.
 */

/** Minimal JSON Schema subset we convert to Zod at load time. */
export type JsonSchema =
  | { type: "string"; enum?: string[]; description?: string }
  | { type: "number" | "integer"; description?: string }
  | { type: "boolean"; description?: string }
  | { type: "null"; description?: string }
  | {
      type: "array";
      items?: JsonSchema;
      description?: string;
    }
  | {
      type: "object";
      properties?: Record<string, JsonSchema>;
      required?: string[];
      additionalProperties?: boolean | JsonSchema;
      description?: string;
    }
  | {
      anyOf?: JsonSchema[];
      oneOf?: JsonSchema[];
      description?: string;
    };

export type SequencerBlockConfig = {
  type: "sequencer";
  /** Ordered block ids to `.step()` in sequence. */
  steps: string[];
  inputSchema?: JsonSchema;
  outputSchema?: JsonSchema;
};

export type RouterBlockConfig = {
  type: "router";
  /**
   * Dot-path into the block input selecting the route key
   * (e.g. `$.intent` or `intent`). Own-property only.
   */
  key: string;
  /**
   * Route table. The special key `"default"` (if present) becomes the
   * keyedRouter `fallback`; every other key is a registered route name
   * mapping to a block id.
   */
  routes: Record<string, string>;
  inputSchema?: JsonSchema;
  outputSchema?: JsonSchema;
};

export type GeneratorBlockConfig = {
  type: "generator";
  prompt: string;
  /** JSON Schema converted to Zod at load; required for structured output. */
  outputSchema: JsonSchema;
  /** Model id string (resolved by the host model resolver). Optional if load options supply a default. */
  model?: string;
  inputSchema?: JsonSchema;
  user?: string;
};

export type MapBlockConfig = {
  type: "map";
  /**
   * Output object built from path expressions against the input.
   * Values are either:
   * - a path string (`$.foo.bar`) → copy that value
   * - a literal (number/boolean/null/object/array without `$` prefix) → use as-is
   * - a string that is NOT a path → use as literal string
   */
  mappings: Record<string, unknown>;
  inputSchema?: JsonSchema;
  outputSchema?: JsonSchema;
};

export type HttpBlockConfig = {
  type: "http";
  method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  /** URL; `{{path}}` or bare `$.path` segments are interpolated from input. */
  url: string;
  headers?: Record<string, string>;
  /** Body object; string values that are paths are resolved from input. */
  body?: Record<string, unknown> | string;
  /** When true (default), parse JSON response body; otherwise return text. */
  parseJson?: boolean;
  inputSchema?: JsonSchema;
  outputSchema?: JsonSchema;
};

export type ToolBlockConfig = {
  type: "tool";
  /** Host-registered tool id looked up from `LoadFlowOptions.tools`. */
  toolId: string;
  /**
   * Optional path map passed as the tool argument object.
   * When omitted, the whole block input is passed through.
   */
  args?: Record<string, unknown>;
  inputSchema?: JsonSchema;
  outputSchema?: JsonSchema;
};

export type BlockConfig =
  | SequencerBlockConfig
  | RouterBlockConfig
  | GeneratorBlockConfig
  | MapBlockConfig
  | ToolBlockConfig
  | HttpBlockConfig;

export type FlowJsonAction = {
  /** Block id in `blocks`. */
  block: string;
  description?: string;
  inputSchema?: JsonSchema;
};

export type FlowJsonConfig = {
  kind: string;
  requireUser?: boolean;
  actions: Record<string, FlowJsonAction>;
  blocks: Record<string, BlockConfig>;
  /**
   * Optional default model id applied to every generator that omits `model`.
   * Overridable via `LoadFlowOptions.defaultModel`.
   */
  defaultModel?: string;
};

export type HostTool = (
  args: unknown,
  meta: { toolId: string; blockName: string },
) => unknown | Promise<unknown>;

export type LoadFlowOptions = {
  /** Default model id for generators that omit `model`. */
  defaultModel?: string;
  /** Named host tools for `type: "tool"` blocks. */
  tools?: Record<string, HostTool>;
  /** Injected fetch for `type: "http"` (defaults to global fetch). */
  fetch?: typeof globalThis.fetch;
};
