/**
 * SKILL.md parser/serializer and runtime substitution helpers.
 *
 * The SKILL.md format is YAML frontmatter (kebab-case) followed by Markdown
 * body. Frontmatter is converted to camelCase for TypeScript ergonomics; the
 * inverse mapping is preserved so we can round-trip back to disk without
 * losing fields. Unknown frontmatter keys are preserved on
 * `state._preservedFields` so user data survives a parse/serialize cycle.
 *
 * Substitution is intentionally separated from parsing — the body is stored
 * verbatim, and `$ARGUMENTS` / `${SKILL_DIR}` are resolved per-invocation
 * inside `substitute()`.
 */

import type {
  AgentOverrides,
  ItemVisibility,
  PatternBinding,
  Skill,
  SkillContextMode,
  SkillState,
  TaskInitYaml,
  WorkerSpec,
} from "@flow-state-dev/core";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Maximum allowed `description` length, mirroring Claude's contract. */
export const MAX_DESCRIPTION_LENGTH = 1024;

/** Maximum allowed skill name length. */
export const MAX_NAME_LENGTH = 64;

/** Names disallowed as skill names (reserved by the framework). */
const RESERVED_NAMES = new Set(["_meta", ""]);

/** Pattern a valid skill name must match. */
const NAME_PATTERN = /^[a-z0-9][a-z0-9-]*$/;

/**
 * Frontmatter keys the framework knows about. All other keys are preserved
 * on `_preservedFields`. Keys are kebab-case as they appear on disk.
 */
const KNOWN_KEYS = new Set([
  "description",
  "allowed-tools",
  "context",
  "disable-model-invocation",
  "output-schema",
  "when_to_use",
  "argument-hint",
  "keywords",
  // Pattern binding (this work)
  "pattern",
  "collection",
  "workers",
  "initial-tasks",
  "pattern-config",
  // Claude-Code-only fields we explicitly capture/warn about
  "user-invocable",
  "paths",
  "hooks",
  "shell",
  "model",
  "effort",
  // Open-standard fields preserved as metadata
  "name",
  "license",
  "compatibility",
  "metadata",
]);

/** Worker-spec sub-keys recognized at parse time. */
const WORKER_KNOWN_KEYS = new Set([
  "prompt",
  "prompt-ref",
  "block-ref",
  "agent-ref",
  "agent-overrides",
  "tools",
  "visibility",
  "model",
]);

/** Sub-keys of `agent-overrides`. */
const AGENT_OVERRIDES_KEYS = new Set(["tools", "model", "visibility"]);

/** Sub-keys of an `initial-tasks` entry. */
const INITIAL_TASK_KEYS = new Set([
  "id",
  "goal",
  "assignee",
  "deps",
  "priority",
  "max-attempts",
  "metadata",
]);

/** Mutually-exclusive worker resolution fields. Exactly one must be set. */
const WORKER_RESOLUTION_FIELDS = [
  "prompt",
  "prompt-ref",
  "block-ref",
  "agent-ref",
] as const;

/**
 * Claude-Code fields we silently ignore at runtime but warn about so users
 * understand what carried over from an imported skill.
 */
const WARN_IGNORED_KEYS = new Set([
  "paths",
  "hooks",
  "shell",
  "model",
  "effort",
]);

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Result of parsing a SKILL.md text. */
export interface ParsedSkillMd {
  /** Parsed state — the camelCase frontmatter representation. */
  state: SkillState;
  /** Raw Markdown body (no frontmatter). */
  body: string;
  /** Warnings the parser surfaced (ignored fields, soft validations). */
  warnings: string[];
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

/** Validate a skill name. Throws on invalid input. */
export function validateSkillName(name: string): void {
  if (typeof name !== "string" || name.length === 0) {
    throw new Error("Skill name must be a non-empty string");
  }
  if (name.length > MAX_NAME_LENGTH) {
    throw new Error(`Skill name "${name}" exceeds ${MAX_NAME_LENGTH} chars`);
  }
  if (RESERVED_NAMES.has(name)) {
    throw new Error(`Skill name "${name}" is reserved`);
  }
  if (!NAME_PATTERN.test(name)) {
    throw new Error(
      `Skill name "${name}" must match /^[a-z0-9][a-z0-9-]*$/`,
    );
  }
}

// ---------------------------------------------------------------------------
// Pattern binding parser
// ---------------------------------------------------------------------------

/** Pattern a worker key must match. Kebab/snake-case, ASCII alphanumeric. */
const WORKER_KEY_PATTERN = /^[a-z0-9][a-z0-9_-]*$/;

/**
 * Parse the pattern-binding-related keys from raw frontmatter into a typed
 * PatternBinding. Throws with a precise message on validation failure.
 *
 * The caller has already confirmed `raw["pattern"]` is present and non-null.
 */
function parsePatternBinding(raw: Record<string, unknown>): PatternBinding {
  const patternKey = raw["pattern"];
  if (typeof patternKey !== "string" || patternKey.trim().length === 0) {
    throw new Error("SKILL.md `pattern:` must be a non-empty string");
  }

  // Top-level required fields when `pattern` is set.
  if (!("workers" in raw) || raw["workers"] === null) {
    throw new Error(
      `SKILL.md \`pattern: ${patternKey}\` requires a \`workers:\` map`,
    );
  }
  if (!("initial-tasks" in raw) || raw["initial-tasks"] === null) {
    throw new Error(
      `SKILL.md \`pattern: ${patternKey}\` requires an \`initial-tasks:\` list`,
    );
  }

  const collection = parseCollectionField(raw["collection"]);
  const workers = parseWorkersField(raw["workers"]);
  const workerKeys = new Set(Object.keys(workers));
  const initialTasks = parseInitialTasksField(raw["initial-tasks"], workerKeys);
  const patternConfig = parsePatternConfigField(raw["pattern-config"]);

  const binding: PatternBinding = {
    pattern: patternKey.trim(),
    workers,
    initialTasks,
  };
  if (collection) binding.collection = collection;
  if (patternConfig) binding.patternConfig = patternConfig;
  return binding;
}

function parseCollectionField(
  v: unknown,
): { scope: "request" | "session" } | undefined {
  if (v === undefined || v === null) return undefined;
  if (typeof v !== "object" || Array.isArray(v)) {
    throw new Error("SKILL.md `collection:` must be a mapping with a `scope` field");
  }
  const obj = v as Record<string, unknown>;
  const scope = obj["scope"];
  if (scope === undefined || scope === null) {
    return undefined;
  }
  if (scope !== "request" && scope !== "session") {
    throw new Error(
      `SKILL.md \`collection.scope\` must be "request" or "session" — got ${JSON.stringify(scope)}`,
    );
  }
  return { scope };
}

function parseWorkersField(v: unknown): Record<string, WorkerSpec> {
  if (typeof v !== "object" || v === null || Array.isArray(v)) {
    throw new Error("SKILL.md `workers:` must be a mapping of worker key → spec");
  }
  const out: Record<string, WorkerSpec> = {};
  for (const [key, value] of Object.entries(v)) {
    if (!WORKER_KEY_PATTERN.test(key)) {
      throw new Error(
        `SKILL.md worker key "${key}" must match /^[a-z0-9][a-z0-9_-]*$/`,
      );
    }
    out[key] = parseWorkerSpec(key, value);
  }
  if (Object.keys(out).length === 0) {
    throw new Error("SKILL.md `workers:` must contain at least one entry");
  }
  return out;
}

function parseWorkerSpec(key: string, v: unknown): WorkerSpec {
  if (typeof v !== "object" || v === null || Array.isArray(v)) {
    throw new Error(`SKILL.md worker \`${key}\` must be a mapping`);
  }
  const obj = v as Record<string, unknown>;
  for (const k of Object.keys(obj)) {
    if (!WORKER_KNOWN_KEYS.has(k)) {
      throw new Error(
        `SKILL.md worker \`${key}\`: unknown field \`${k}\` (allowed: ${[...WORKER_KNOWN_KEYS].join(", ")})`,
      );
    }
  }

  const setResolution = WORKER_RESOLUTION_FIELDS.filter((f) => f in obj && obj[f] !== null && obj[f] !== undefined);
  if (setResolution.length === 0) {
    throw new Error(
      `SKILL.md worker \`${key}\`: exactly one of \`prompt\`, \`prompt-ref\`, \`block-ref\`, \`agent-ref\` required`,
    );
  }
  if (setResolution.length > 1) {
    throw new Error(
      `SKILL.md worker \`${key}\`: fields ${setResolution.map((f) => `\`${f}\``).join(", ")} are mutually exclusive — set exactly one`,
    );
  }

  if ("agent-overrides" in obj && !("agent-ref" in obj)) {
    throw new Error(
      `SKILL.md worker \`${key}\`: \`agent-overrides\` requires \`agent-ref\``,
    );
  }

  const spec: WorkerSpec = {};
  if (typeof obj["prompt"] === "string") spec.prompt = obj["prompt"];
  if (typeof obj["prompt-ref"] === "string") spec.promptRef = obj["prompt-ref"];
  if (typeof obj["block-ref"] === "string") spec.blockRef = obj["block-ref"];
  if (typeof obj["agent-ref"] === "string") spec.agentRef = obj["agent-ref"];

  if ("agent-overrides" in obj) {
    spec.agentOverrides = parseAgentOverrides(key, obj["agent-overrides"]);
  }

  if ("tools" in obj) {
    const t = obj["tools"];
    if (!Array.isArray(t) || !t.every((x) => typeof x === "string")) {
      throw new Error(`SKILL.md worker \`${key}\`: \`tools\` must be a string list`);
    }
    spec.tools = t as string[];
  }

  if ("visibility" in obj) {
    spec.itemVisibility = parseVisibilityField(`worker \`${key}\``, obj["visibility"]);
  }

  if ("model" in obj) {
    const m = obj["model"];
    if (typeof m !== "string") {
      throw new Error(`SKILL.md worker \`${key}\`: \`model\` must be a string`);
    }
    spec.model = m;
  }

  return spec;
}

function parseAgentOverrides(workerKey: string, v: unknown): AgentOverrides {
  if (typeof v !== "object" || v === null || Array.isArray(v)) {
    throw new Error(`SKILL.md worker \`${workerKey}\`: \`agent-overrides\` must be a mapping`);
  }
  const obj = v as Record<string, unknown>;
  for (const k of Object.keys(obj)) {
    if (!AGENT_OVERRIDES_KEYS.has(k)) {
      throw new Error(
        `SKILL.md worker \`${workerKey}\`: unknown agent-overrides field \`${k}\` (allowed: ${[...AGENT_OVERRIDES_KEYS].join(", ")})`,
      );
    }
  }
  const out: AgentOverrides = {};
  if ("tools" in obj) {
    const t = obj["tools"];
    if (!Array.isArray(t) || !t.every((x) => typeof x === "string")) {
      throw new Error(`SKILL.md worker \`${workerKey}\`: \`agent-overrides.tools\` must be a string list`);
    }
    out.tools = t as string[];
  }
  if ("model" in obj) {
    const m = obj["model"];
    if (typeof m !== "string") {
      throw new Error(`SKILL.md worker \`${workerKey}\`: \`agent-overrides.model\` must be a string`);
    }
    out.model = m;
  }
  if ("visibility" in obj) {
    out.itemVisibility = parseVisibilityField(`worker \`${workerKey}\` agent-overrides`, obj["visibility"]);
  }
  return out;
}

function parseInitialTasksField(
  v: unknown,
  workerKeys: Set<string>,
): TaskInitYaml[] {
  if (!Array.isArray(v)) {
    throw new Error("SKILL.md `initial-tasks:` must be a list");
  }
  const tasks: TaskInitYaml[] = v.map((entry, idx) => {
    if (typeof entry !== "object" || entry === null || Array.isArray(entry)) {
      throw new Error(`SKILL.md \`initial-tasks[${idx}]\` must be a mapping`);
    }
    const obj = entry as Record<string, unknown>;
    for (const k of Object.keys(obj)) {
      if (!INITIAL_TASK_KEYS.has(k)) {
        throw new Error(
          `SKILL.md \`initial-tasks[${idx}]\`: unknown field \`${k}\` (allowed: ${[...INITIAL_TASK_KEYS].join(", ")})`,
        );
      }
    }
    const goal = obj["goal"];
    if (typeof goal !== "string" || goal.trim().length === 0) {
      throw new Error(`SKILL.md \`initial-tasks[${idx}].goal\` is required and must be a non-empty string`);
    }
    const out: TaskInitYaml = { goal };
    if (typeof obj["id"] === "string") out.id = obj["id"];
    if ("assignee" in obj) {
      const a = obj["assignee"];
      if (a !== undefined && a !== null) {
        if (typeof a !== "string") {
          throw new Error(`SKILL.md \`initial-tasks[${idx}].assignee\` must be a string`);
        }
        out.assignee = a;
      }
    }
    if ("deps" in obj) {
      const d = obj["deps"];
      if (d !== undefined && d !== null) {
        if (!Array.isArray(d) || !d.every((x) => typeof x === "string")) {
          throw new Error(`SKILL.md \`initial-tasks[${idx}].deps\` must be a string list`);
        }
        out.deps = d as string[];
      }
    }
    if ("priority" in obj) {
      const p = obj["priority"];
      if (typeof p !== "number") {
        throw new Error(`SKILL.md \`initial-tasks[${idx}].priority\` must be a number`);
      }
      out.priority = p;
    }
    if ("max-attempts" in obj) {
      const m = obj["max-attempts"];
      if (typeof m !== "number") {
        throw new Error(`SKILL.md \`initial-tasks[${idx}].max-attempts\` must be a number`);
      }
      out.maxAttempts = m;
    }
    if ("metadata" in obj) {
      const md = obj["metadata"];
      if (md !== null && md !== undefined) {
        if (typeof md !== "object" || Array.isArray(md)) {
          throw new Error(`SKILL.md \`initial-tasks[${idx}].metadata\` must be a mapping`);
        }
        out.metadata = md as Record<string, unknown>;
      }
    }
    return out;
  });

  // Auto-assign ids for tasks that don't declare one (so deps can still
  // reference them via the assignee+position fallback isn't needed — every
  // task gets a stable id either author-declared or synthesized).
  const usedIds = new Set<string>();
  for (const t of tasks) {
    if (t.id !== undefined) {
      if (usedIds.has(t.id)) {
        throw new Error(`SKILL.md \`initial-tasks\` contains duplicate id "${t.id}"`);
      }
      usedIds.add(t.id);
    }
  }
  for (let i = 0; i < tasks.length; i++) {
    if (tasks[i]!.id === undefined) {
      let candidate = `task-${i + 1}`;
      let n = i + 1;
      while (usedIds.has(candidate)) {
        n++;
        candidate = `task-${n}`;
      }
      tasks[i]!.id = candidate;
      usedIds.add(candidate);
    }
  }

  // Assignees must refer to a known worker key.
  for (const [i, t] of tasks.entries()) {
    if (t.assignee !== undefined && !workerKeys.has(t.assignee)) {
      throw new Error(
        `SKILL.md \`initial-tasks[${i}].assignee\` references unknown worker "${t.assignee}"`,
      );
    }
  }

  // Deps must reference known task ids; the graph must be acyclic.
  const idIndex = new Map(tasks.map((t, i) => [t.id!, i]));
  for (const [i, t] of tasks.entries()) {
    if (!t.deps) continue;
    for (const d of t.deps) {
      if (!idIndex.has(d)) {
        throw new Error(
          `SKILL.md \`initial-tasks[${i}].deps\` references unknown task id "${d}"`,
        );
      }
    }
  }
  assertAcyclic(tasks);

  return tasks;
}

function assertAcyclic(tasks: TaskInitYaml[]): void {
  // Kahn's algorithm decides acyclicity; on failure, walk one of the
  // surviving SCC nodes back to itself via DFS to surface a concrete
  // cycle path (more debuggable than "involves a, b, c, ...").
  const indeg = new Map<string, number>();
  const adj = new Map<string, string[]>();
  for (const t of tasks) {
    indeg.set(t.id!, 0);
    adj.set(t.id!, []);
  }
  for (const t of tasks) {
    for (const d of t.deps ?? []) {
      adj.get(d)!.push(t.id!);
      indeg.set(t.id!, (indeg.get(t.id!) ?? 0) + 1);
    }
  }
  const queue: string[] = [];
  for (const [id, n] of indeg) if (n === 0) queue.push(id);
  let visited = 0;
  while (queue.length > 0) {
    const id = queue.shift()!;
    visited++;
    for (const next of adj.get(id) ?? []) {
      indeg.set(next, (indeg.get(next) ?? 0) - 1);
      if (indeg.get(next) === 0) queue.push(next);
    }
  }
  if (visited !== tasks.length) {
    const remaining = [...indeg.entries()].filter(([, n]) => n > 0).map(([id]) => id);
    const cycle = findCyclePath(adj, remaining) ?? remaining;
    throw new Error(
      `SKILL.md \`initial-tasks\` deps form a cycle: ${cycle.join(" → ")}`,
    );
  }
}

/** DFS from each surviving node to find one closed cycle path. */
function findCyclePath(
  adj: Map<string, string[]>,
  surviving: string[],
): string[] | undefined {
  const set = new Set(surviving);
  for (const start of surviving) {
    const stack: string[] = [start];
    const onStack = new Set<string>([start]);
    const visit = (node: string): string[] | undefined => {
      for (const next of adj.get(node) ?? []) {
        if (!set.has(next)) continue;
        if (onStack.has(next)) {
          const cycleStart = stack.indexOf(next);
          return [...stack.slice(cycleStart), next];
        }
        stack.push(next);
        onStack.add(next);
        const result = visit(next);
        if (result) return result;
        stack.pop();
        onStack.delete(next);
      }
      return undefined;
    };
    const result = visit(start);
    if (result) return result;
  }
  return undefined;
}

function parsePatternConfigField(v: unknown): Record<string, unknown> | undefined {
  if (v === undefined || v === null) return undefined;
  if (typeof v !== "object" || Array.isArray(v)) {
    throw new Error("SKILL.md `pattern-config:` must be a mapping");
  }
  return v as Record<string, unknown>;
}

/**
 * Parse a `visibility` YAML value into an `ItemVisibility` object.
 *
 * Accepts either:
 *   - A mapping with `client` and `history` boolean fields.
 *   - A legacy string shorthand: `"primary"` | `"sub"` | `"trace"`.
 */
function parseVisibilityField(location: string, v: unknown): ItemVisibility {
  if (typeof v === "object" && v !== null && !Array.isArray(v)) {
    const obj = v as Record<string, unknown>;
    if (typeof obj["client"] !== "boolean" || typeof obj["history"] !== "boolean") {
      throw new Error(
        `SKILL.md ${location}: \`visibility\` mapping requires boolean \`client\` and \`history\` fields`,
      );
    }
    return { client: obj["client"] as boolean, history: obj["history"] as boolean };
  }
  if (typeof v === "string") {
    switch (v) {
      case "primary": return { client: true, history: true };
      case "sub": return { client: true, history: false };
      case "trace": return { client: false, history: false };
      default:
        throw new Error(
          `SKILL.md ${location}: \`visibility\` string must be "primary" | "sub" | "trace" — got ${JSON.stringify(v)}`,
        );
    }
  }
  throw new Error(
    `SKILL.md ${location}: \`visibility\` must be a mapping ({ client, history }) or a shorthand string`,
  );
}

// ---------------------------------------------------------------------------
// Minimal YAML frontmatter parser
// ---------------------------------------------------------------------------

/**
 * Tiny YAML-subset parser sufficient for SKILL.md frontmatter.
 *
 * Supports:
 *   - Scalar `key: value` pairs.
 *   - Inline arrays `[a, b, c]` and inline objects (preserved as strings).
 *   - Block arrays of scalars (`- a` per line).
 *   - Block arrays of mappings (`- key: value` followed by indented fields).
 *   - Block-scalar literals (`|` / `|-`) for multi-line strings.
 *   - Nested mappings to arbitrary depth via indentation.
 *
 * NOT a general-purpose YAML implementation — intentionally narrow to keep
 * this package dependency-free.
 */
function parseFrontmatterYaml(text: string): Record<string, unknown> {
  const rawLines = text.split(/\r?\n/);
  // Strip comments (full-line and trailing `#` outside strings) but preserve
  // intra-string content. Block scalars (`|`) are handled later and must
  // ignore comment stripping inside their bodies.
  const result = parseBlock(rawLines, 0, rawLines.length, 0) as Record<string, unknown>;
  return result;
}

/** Number of leading space characters on a line. Tabs count as one space. */
function indentOf(line: string): number {
  let n = 0;
  while (n < line.length && (line[n] === " " || line[n] === "\t")) n++;
  return n;
}

/**
 * Parse a contiguous YAML block delimited by `[start, end)` whose entries
 * all sit at indentation `>= baseIndent`. Returns a mapping (object) when
 * the block's first non-blank line is a `key:` pair, or an array when it's
 * a `- item` sequence.
 */
function parseBlock(
  lines: string[],
  start: number,
  end: number,
  baseIndent: number,
): unknown {
  let i = start;
  while (i < end && (lines[i]!.trim() === "" || lines[i]!.trim().startsWith("#"))) i++;
  if (i >= end) return {};
  const first = lines[i]!;
  const trimmed = first.trim();
  if (trimmed.startsWith("- ") || trimmed === "-") {
    return parseSequenceBlock(lines, start, end, baseIndent);
  }
  return parseMappingBlock(lines, start, end, baseIndent);
}

function parseMappingBlock(
  lines: string[],
  start: number,
  end: number,
  baseIndent: number,
): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  let i = start;
  while (i < end) {
    const line = lines[i]!;
    const trimmed = line.trim();
    if (trimmed === "" || trimmed.startsWith("#")) {
      i++;
      continue;
    }
    const indent = indentOf(line);
    if (indent < baseIndent) break;
    if (indent > baseIndent) {
      // Lines at deeper indent without a preceding key are skipped to stay
      // resilient against partial inputs.
      i++;
      continue;
    }

    const colonIdx = findKeyColon(trimmed);
    if (colonIdx === -1) {
      i++;
      continue;
    }
    const key = trimmed.slice(0, colonIdx).trim();
    const rest = trimmed.slice(colonIdx + 1).trim();

    if (rest === "|" || rest === "|-" || rest === ">" || rest === ">-") {
      const [value, next] = readBlockScalar(lines, i + 1, end, baseIndent, rest);
      result[key] = value;
      i = next;
      continue;
    }

    if (rest === "" || rest === "~" || rest.toLowerCase() === "null") {
      // Either a null scalar or a nested block.
      const childStart = i + 1;
      const childIndent = nextNonBlankIndent(lines, childStart, end);
      if (childIndent !== -1 && childIndent > baseIndent) {
        const nested = parseBlock(lines, childStart, end, childIndent);
        result[key] = nested;
        i = consumeBlock(lines, childStart, end, childIndent);
        continue;
      }
      result[key] = rest === "" ? null : null;
      i++;
      continue;
    }

    result[key] = parseScalar(rest);
    i++;
  }
  return result;
}

function parseSequenceBlock(
  lines: string[],
  start: number,
  end: number,
  baseIndent: number,
): unknown[] {
  const out: unknown[] = [];
  let i = start;
  while (i < end) {
    const line = lines[i]!;
    const trimmed = line.trim();
    if (trimmed === "" || trimmed.startsWith("#")) {
      i++;
      continue;
    }
    const indent = indentOf(line);
    if (indent < baseIndent) break;
    if (indent > baseIndent) {
      i++;
      continue;
    }
    if (!(trimmed.startsWith("- ") || trimmed === "-")) break;

    // Item body — what follows the `- ` marker.
    const after = trimmed === "-" ? "" : trimmed.slice(2);
    // A sequence-of-mappings item looks like `- key: value` and may carry
    // further fields on subsequent lines indented deeper than this dash.
    const dashColumn = indent;
    const itemIndent = dashColumn + 2;

    if (after === "") {
      // Either empty item or a nested mapping/sequence on the next lines.
      const childStart = i + 1;
      const childIndent = nextNonBlankIndent(lines, childStart, end);
      if (childIndent !== -1 && childIndent > dashColumn) {
        out.push(parseBlock(lines, childStart, end, childIndent));
        i = consumeBlock(lines, childStart, end, childIndent);
        continue;
      }
      out.push(null);
      i++;
      continue;
    }

    const afterColon = findKeyColon(after);
    if (afterColon === -1) {
      // Plain scalar item.
      out.push(parseScalar(after));
      i++;
      continue;
    }

    // Mapping item: rebuild a virtual block whose first line is the `- ` part
    // re-indented to `itemIndent`, plus subsequent lines that are indented
    // deeper than the dash column.
    const firstLineRebuilt = " ".repeat(itemIndent) + after;
    const virtual: string[] = [firstLineRebuilt];
    let j = i + 1;
    while (j < end) {
      const nl = lines[j]!;
      const nt = nl.trim();
      if (nt === "" || nt.startsWith("#")) {
        virtual.push(nl);
        j++;
        continue;
      }
      const ni = indentOf(nl);
      if (ni <= dashColumn) break;
      virtual.push(nl);
      j++;
    }
    const itemMap = parseMappingBlock(virtual, 0, virtual.length, itemIndent);
    out.push(itemMap);
    i = j;
  }
  return out;
}

/** Locate the indent of the next non-blank line, or -1 if none. */
function nextNonBlankIndent(lines: string[], start: number, end: number): number {
  for (let k = start; k < end; k++) {
    const t = lines[k]!.trim();
    if (t === "" || t.startsWith("#")) continue;
    return indentOf(lines[k]!);
  }
  return -1;
}

/** Advance past every line at `>= blockIndent`. */
function consumeBlock(
  lines: string[],
  start: number,
  end: number,
  blockIndent: number,
): number {
  let i = start;
  while (i < end) {
    const line = lines[i]!;
    const trimmed = line.trim();
    if (trimmed === "" || trimmed.startsWith("#")) {
      i++;
      continue;
    }
    if (indentOf(line) < blockIndent) break;
    i++;
  }
  return i;
}

/**
 * Read a `|` / `|-` / `>` / `>-` block scalar. Returns `[bodyText, nextIndex]`.
 * Folded (`>`) scalars collapse interior newlines to spaces; literal (`|`)
 * scalars preserve them. The trailing-newline indicator (`-`) strips the
 * final newline.
 */
function readBlockScalar(
  lines: string[],
  start: number,
  end: number,
  parentIndent: number,
  marker: string,
): [string, number] {
  const literal = marker.startsWith("|");
  const strip = marker.endsWith("-");
  const collected: string[] = [];
  let bodyIndent = -1;
  let i = start;
  while (i < end) {
    const line = lines[i]!;
    if (line.trim() === "") {
      collected.push("");
      i++;
      continue;
    }
    const ind = indentOf(line);
    if (ind <= parentIndent) break;
    if (bodyIndent === -1) bodyIndent = ind;
    collected.push(line.slice(Math.min(ind, bodyIndent)));
    i++;
  }
  // Trim trailing blank lines.
  while (collected.length > 0 && collected[collected.length - 1] === "") {
    collected.pop();
  }
  let body = literal
    ? collected.join("\n")
    : collected.reduce((acc, l, idx) => {
        if (idx === 0) return l;
        if (l === "") return acc + "\n";
        return acc.endsWith("\n") ? acc + l : acc + " " + l;
      }, "");
  if (!strip) body += "\n";
  return [body, i];
}

/**
 * Find the index of the `:` that ends a YAML mapping key. Skips colons
 * inside `[...]` / `{...}` / quotes so inline structures don't false-match.
 */
function findKeyColon(text: string): number {
  let depth = 0;
  let quote: string | null = null;
  for (let i = 0; i < text.length; i++) {
    const c = text[i]!;
    if (quote) {
      if (c === quote) quote = null;
      continue;
    }
    if (c === '"' || c === "'") {
      quote = c;
      continue;
    }
    if (c === "[" || c === "{") depth++;
    else if (c === "]" || c === "}") depth--;
    else if (c === ":" && depth === 0) {
      // Must be followed by whitespace or end-of-line to count as the
      // mapping colon (avoids matching `http://...` etc).
      if (i + 1 >= text.length || text[i + 1] === " " || text[i + 1] === "\t") {
        return i;
      }
    }
  }
  return -1;
}

/** Parse a single scalar, inline array, or quoted string. */
function parseScalar(raw: string): unknown {
  const text = raw.trim();
  if (text.length === 0) return "";

  // Inline array: [a, b, c]
  if (text.startsWith("[") && text.endsWith("]")) {
    const inner = text.slice(1, -1).trim();
    if (inner.length === 0) return [];
    return splitTopLevelCommas(inner).map((item) => parseScalar(item));
  }

  // Inline object: { a: 1, b: 2 } — coerce to a string for forward-compat
  if (text.startsWith("{") && text.endsWith("}")) {
    return text;
  }

  // Quoted string
  if (
    (text.startsWith('"') && text.endsWith('"')) ||
    (text.startsWith("'") && text.endsWith("'"))
  ) {
    return text.slice(1, -1);
  }

  // Booleans
  if (text === "true") return true;
  if (text === "false") return false;
  if (text === "null" || text === "~") return null;

  // Numbers
  if (/^-?\d+$/.test(text)) return parseInt(text, 10);
  if (/^-?\d+\.\d+$/.test(text)) return parseFloat(text);

  // Bare string
  return text;
}

/** Split a string on commas not inside brackets/braces/quotes. */
function splitTopLevelCommas(input: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let quote: string | null = null;
  let buf = "";

  for (let k = 0; k < input.length; k++) {
    const c = input[k]!;
    if (quote) {
      buf += c;
      if (c === quote) quote = null;
      continue;
    }
    if (c === '"' || c === "'") {
      quote = c;
      buf += c;
      continue;
    }
    if (c === "[" || c === "{") {
      depth++;
      buf += c;
      continue;
    }
    if (c === "]" || c === "}") {
      depth--;
      buf += c;
      continue;
    }
    if (c === "," && depth === 0) {
      out.push(buf.trim());
      buf = "";
      continue;
    }
    buf += c;
  }
  if (buf.trim().length > 0) out.push(buf.trim());
  return out;
}

// ---------------------------------------------------------------------------
// Frontmatter extraction
// ---------------------------------------------------------------------------

/**
 * Split a SKILL.md text into a YAML frontmatter block and the remaining body.
 * Frontmatter is delimited by `---` lines at the start of the file.
 */
function splitFrontmatter(text: string): { yaml: string; body: string } {
  // Normalize leading whitespace but preserve trailing for body fidelity.
  if (!text.startsWith("---")) {
    return { yaml: "", body: text };
  }

  // Find the closing `---` on its own line.
  const lines = text.split(/\r?\n/);
  if (lines[0]?.trim() !== "---") {
    return { yaml: "", body: text };
  }

  let endIdx = -1;
  for (let i = 1; i < lines.length; i++) {
    if (lines[i]?.trim() === "---") {
      endIdx = i;
      break;
    }
  }

  if (endIdx === -1) {
    return { yaml: "", body: text };
  }

  const yaml = lines.slice(1, endIdx).join("\n");
  // Drop the leading newline after the closing `---`.
  const body = lines.slice(endIdx + 1).join("\n").replace(/^\r?\n/, "");
  return { yaml, body };
}

// ---------------------------------------------------------------------------
// kebab-case ↔ camelCase
// ---------------------------------------------------------------------------

/** Convert a kebab-case key to camelCase. Underscores are preserved as-is. */
export function kebabToCamel(key: string): string {
  return key.replace(/-([a-z0-9])/g, (_, c) => c.toUpperCase());
}

/** Convert a camelCase key to kebab-case. */
export function camelToKebab(key: string): string {
  return key.replace(/([A-Z])/g, (_, c) => `-${c.toLowerCase()}`);
}

// ---------------------------------------------------------------------------
// Public: parse
// ---------------------------------------------------------------------------

/**
 * Parse a SKILL.md text into structured state + raw body.
 *
 * Required field: `description`. Throws if missing or invalid.
 * Unknown frontmatter keys are preserved (camelCased) under `_preservedFields`.
 * Claude-Code-only keys we don't honor at runtime produce warnings.
 */
export function parseSkillMd(text: string): ParsedSkillMd {
  const { yaml, body } = splitFrontmatter(text);
  const warnings: string[] = [];

  if (yaml.trim().length === 0) {
    throw new Error(
      "SKILL.md must begin with YAML frontmatter (--- delimited) including a `description`",
    );
  }

  const raw = parseFrontmatterYaml(yaml);

  const description = raw["description"];
  if (typeof description !== "string" || description.trim().length === 0) {
    throw new Error("SKILL.md frontmatter requires a non-empty `description`");
  }
  if (description.length > MAX_DESCRIPTION_LENGTH) {
    throw new Error(
      `SKILL.md description exceeds ${MAX_DESCRIPTION_LENGTH} chars`,
    );
  }
  if (/<[a-zA-Z][^>]*>/.test(description)) {
    throw new Error("SKILL.md description must not contain XML tags");
  }

  const state: SkillState = { description };

  if ("allowed-tools" in raw) {
    const v = raw["allowed-tools"];
    if (Array.isArray(v) && v.every((x) => typeof x === "string")) {
      state.allowedTools = v as string[];
    } else if (typeof v === "string") {
      // Accept comma-separated form for forward-compat with Claude variants
      state.allowedTools = v
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
    } else if (v !== undefined && v !== null) {
      warnings.push("`allowed-tools` must be a list of strings — ignored");
    }
  }

  if ("context" in raw) {
    const v = raw["context"];
    if (v === "fork" || v === "inline" || v === "pattern") {
      state.contextMode = v as SkillContextMode;
    } else if (v !== undefined && v !== null) {
      warnings.push(
        `\`context\` must be "inline", "fork", or "pattern" — got ${JSON.stringify(v)}; defaulting to inline`,
      );
    }
  }

  if ("disable-model-invocation" in raw) {
    const v = raw["disable-model-invocation"];
    if (typeof v === "boolean") {
      state.disableModelInvocation = v;
    }
  }

  if ("when_to_use" in raw && typeof raw["when_to_use"] === "string") {
    state.whenToUse = raw["when_to_use"] as string;
  }

  if ("argument-hint" in raw && typeof raw["argument-hint"] === "string") {
    state.argumentHint = raw["argument-hint"] as string;
  }

  if ("keywords" in raw) {
    const v = raw["keywords"];
    if (Array.isArray(v) && v.every((x) => typeof x === "string")) {
      // Normalize to lowercase here so the tier-2 scan can do plain
      // case-sensitive substring matches without per-call lowercasing.
      state.keywords = (v as string[]).map((s) => s.toLowerCase());
    } else if (typeof v === "string") {
      // Comma-separated form for forward-compat with hand-written frontmatter
      state.keywords = v
        .split(",")
        .map((s) => s.trim().toLowerCase())
        .filter(Boolean);
    } else if (v !== undefined && v !== null) {
      warnings.push("`keywords` must be a list of strings — ignored");
    }
  }

  if ("output-schema" in raw) {
    state.outputSchema = raw["output-schema"];
  }

  // Pattern binding. When `pattern:` is present, build a typed binding and
  // set contextMode to "pattern". Otherwise, warn if pattern-only fields
  // appear so authors notice they're being ignored.
  const hasPatternField = "pattern" in raw && raw["pattern"] !== null && raw["pattern"] !== undefined;
  const orphanPatternKeys = ["workers", "initial-tasks", "pattern-config", "collection"].filter(
    (k) => k in raw && !hasPatternField,
  );
  if (orphanPatternKeys.length > 0) {
    warnings.push(
      `frontmatter contains [${orphanPatternKeys.join(", ")}] without \`pattern\` — ignored`,
    );
  }
  if (hasPatternField) {
    if (state.contextMode && state.contextMode !== "pattern") {
      throw new Error(
        `SKILL.md frontmatter sets both \`pattern\` and \`context: ${state.contextMode}\` — context modes are mutually exclusive`,
      );
    }
    state.patternBinding = parsePatternBinding(raw);
    state.contextMode = "pattern";
  } else if (state.contextMode === "pattern") {
    throw new Error(
      "SKILL.md frontmatter sets `context: pattern` but no `pattern:` field is declared",
    );
  }

  // Warn about ignored Claude-Code fields.
  for (const key of WARN_IGNORED_KEYS) {
    if (key in raw) {
      warnings.push(`SKILL.md field \`${key}\` is preserved but not honored at runtime`);
    }
  }

  // Preserve unknown fields (and the ignored ones we still want round-tripped)
  // under camelCase keys. Required/known fields above are NOT preserved.
  const preservedKnownButNotMapped = new Set(["user-invocable", "name", "license", "compatibility", "metadata", ...WARN_IGNORED_KEYS]);
  const preserved: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(raw)) {
    if (!KNOWN_KEYS.has(k) || preservedKnownButNotMapped.has(k)) {
      preserved[kebabToCamel(k)] = v;
    }
  }
  if (Object.keys(preserved).length > 0) {
    state._preservedFields = preserved;
  }

  return { state, body, warnings };
}

// ---------------------------------------------------------------------------
// Public: serialize
// ---------------------------------------------------------------------------

/**
 * Serialize a parsed state + body back to SKILL.md text. Inverse of
 * `parseSkillMd` for the fields we model; preserved fields round-trip via
 * `_preservedFields` (camelCase → kebab-case).
 */
export function serializeSkillMd(state: SkillState, body: string): string {
  const lines: string[] = ["---", `description: ${yamlScalar(state.description)}`];

  if (state.allowedTools && state.allowedTools.length > 0) {
    lines.push(`allowed-tools: [${state.allowedTools.map((t: string) => yamlScalar(t)).join(", ")}]`);
  }
  if (state.contextMode) {
    lines.push(`context: ${state.contextMode}`);
  }
  if (state.disableModelInvocation !== undefined) {
    lines.push(`disable-model-invocation: ${state.disableModelInvocation}`);
  }
  if (state.whenToUse !== undefined) {
    lines.push(`when_to_use: ${yamlScalar(state.whenToUse)}`);
  }
  if (state.argumentHint !== undefined) {
    lines.push(`argument-hint: ${yamlScalar(state.argumentHint)}`);
  }
  if (state.keywords && state.keywords.length > 0) {
    lines.push(`keywords: [${state.keywords.map((k: string) => yamlScalar(k)).join(", ")}]`);
  }

  if (state.patternBinding) {
    serializePatternBinding(lines, state.patternBinding);
  }

  if (state._preservedFields) {
    for (const [k, v] of Object.entries(state._preservedFields)) {
      lines.push(`${camelToKebab(k)}: ${yamlValue(v)}`);
    }
  }

  lines.push("---", "", body);
  // Avoid trailing newlines beyond a single one for stable round-trip.
  return lines.join("\n").replace(/\n+$/, "\n");
}

function serializePatternBinding(lines: string[], binding: PatternBinding): void {
  lines.push(`pattern: ${yamlScalar(binding.pattern)}`);
  if (binding.collection) {
    lines.push("collection:");
    lines.push(`  scope: ${binding.collection.scope}`);
  }
  lines.push("workers:");
  for (const [key, spec] of Object.entries(binding.workers)) {
    lines.push(`  ${key}:`);
    if (spec.promptRef !== undefined) lines.push(`    prompt-ref: ${yamlScalar(spec.promptRef)}`);
    if (spec.prompt !== undefined) {
      // Use literal block scalar for prompts so multi-line values survive
      // a round-trip exactly.
      lines.push("    prompt: |");
      for (const ln of spec.prompt.split("\n")) lines.push(`      ${ln}`);
    }
    if (spec.blockRef !== undefined) lines.push(`    block-ref: ${yamlScalar(spec.blockRef)}`);
    if (spec.agentRef !== undefined) lines.push(`    agent-ref: ${yamlScalar(spec.agentRef)}`);
    if (spec.agentOverrides) {
      lines.push("    agent-overrides:");
      if (spec.agentOverrides.tools)
        lines.push(`      tools: [${spec.agentOverrides.tools.map((t) => yamlScalar(t)).join(", ")}]`);
      if (spec.agentOverrides.model !== undefined)
        lines.push(`      model: ${yamlScalar(spec.agentOverrides.model)}`);
      if (spec.agentOverrides.itemVisibility !== undefined) {
        lines.push("      visibility:");
        lines.push(`        client: ${spec.agentOverrides.itemVisibility.client}`);
        lines.push(`        history: ${spec.agentOverrides.itemVisibility.history}`);
      }
    }
    if (spec.tools)
      lines.push(`    tools: [${spec.tools.map((t) => yamlScalar(t)).join(", ")}]`);
    if (spec.itemVisibility !== undefined) {
      lines.push("    visibility:");
      lines.push(`      client: ${spec.itemVisibility.client}`);
      lines.push(`      history: ${spec.itemVisibility.history}`);
    }
    if (spec.model !== undefined) lines.push(`    model: ${yamlScalar(spec.model)}`);
  }
  lines.push("initial-tasks:");
  for (const task of binding.initialTasks) {
    lines.push(`  - id: ${yamlScalar(task.id ?? "")}`);
    lines.push(`    goal: ${yamlScalar(task.goal)}`);
    if (task.assignee !== undefined) lines.push(`    assignee: ${yamlScalar(task.assignee)}`);
    if (task.deps && task.deps.length > 0)
      lines.push(`    deps: [${task.deps.map((d) => yamlScalar(d)).join(", ")}]`);
    if (task.priority !== undefined) lines.push(`    priority: ${task.priority}`);
    if (task.maxAttempts !== undefined) lines.push(`    max-attempts: ${task.maxAttempts}`);
    if (task.metadata !== undefined) lines.push(`    metadata: ${yamlValue(task.metadata)}`);
  }
  if (binding.patternConfig) {
    lines.push("pattern-config:");
    for (const [k, v] of Object.entries(binding.patternConfig)) {
      lines.push(`  ${k}: ${yamlValue(v)}`);
    }
  }
}

function yamlScalar(value: string): string {
  if (/^[a-zA-Z0-9 _.,/?!@#$%^&*()=+:;]+$/.test(value) && !/^[\-?:]/.test(value)) {
    return value;
  }
  // Quote strings containing special chars; escape embedded quotes.
  return `"${value.replace(/"/g, '\\"')}"`;
}

function yamlValue(value: unknown): string {
  if (value === null) return "null";
  if (typeof value === "boolean" || typeof value === "number") return String(value);
  if (typeof value === "string") return yamlScalar(value);
  if (Array.isArray(value)) {
    return `[${value.map((v) => yamlValue(v)).join(", ")}]`;
  }
  // For nested objects (rare in frontmatter), JSON-encode for round-trip.
  return JSON.stringify(value);
}

// ---------------------------------------------------------------------------
// Public: substitution
// ---------------------------------------------------------------------------

export interface SubstitutionContext {
  /** The full argument string passed via `runSkill({ input })`. */
  arguments?: string;
  /** Absolute path the skill folder is mounted at, e.g. `/workspace/.fsdev/skills/pptx`. */
  skillDir?: string;
}

/**
 * Apply skill body substitutions: `$ARGUMENTS`, `$1..$9`, and `${SKILL_DIR}`.
 * Unset substitutions resolve to empty strings.
 *
 * `${CLAUDE_SKILL_DIR}` is preserved as a working alias for `${SKILL_DIR}`
 * so skill folders authored against Claude Code's skills format drop in
 * unchanged. New skills should use `${SKILL_DIR}`.
 */
export function substitute(body: string, ctx: SubstitutionContext): string {
  const args = ctx.arguments ?? "";
  const skillDir = ctx.skillDir ?? "";

  let out = body;
  out = out.replace(/\$\{SKILL_DIR\}/g, skillDir);
  out = out.replace(/\$\{CLAUDE_SKILL_DIR\}/g, skillDir);
  out = out.replace(/\$ARGUMENTS\b/g, args);

  if (/\$[1-9]\b/.test(out)) {
    const tokens = args.length > 0 ? args.split(/\s+/) : [];
    out = out.replace(/\$([1-9])\b/g, (_, n) => tokens[Number(n) - 1] ?? "");
  }

  return out;
}

// ---------------------------------------------------------------------------
// Public: assemble Skill descriptor
// ---------------------------------------------------------------------------

/** Compose a Skill record from its name, parsed state, and body. */
export function toSkill(name: string, state: SkillState, body: string): Skill {
  validateSkillName(name);
  return {
    name,
    body,
    description: state.description,
    allowedTools: state.allowedTools,
    contextMode: state.contextMode,
    disableModelInvocation: state.disableModelInvocation,
    whenToUse: state.whenToUse,
    argumentHint: state.argumentHint,
    keywords: state.keywords,
  };
}
