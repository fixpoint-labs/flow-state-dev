/**
 * Cross-gate invariant for the agent-only field guard (FIX-925).
 *
 * A `tool:` participant takes no model turn, so every agent field is
 * inapplicable to it — and that has to hold at BOTH gates:
 *
 *   1. the SKILL.md parser, which sees frontmatter (kebab) keys, and
 *   2. `materializeWorker`, which sees camelCase `AgentSpec` fields — the shape
 *      a persisted or programmatic `PatternBinding` arrives in, having never
 *      passed through the parser.
 *
 * Both derive their list from `AGENT_RESOLUTION_FIELDS` /
 * `AGENT_ONLY_TUNING_FIELDS` in core. This walks that pair and drives both gates
 * with every entry, so a field that reaches one gate but not the other fails
 * here instead of becoming a silent hole in the fail-loud guarantee: a spec
 * carrying it would pass one gate, fail the other, and which one it hit would
 * depend on how the spec reached the board.
 *
 * `SAMPLES` is typed as a COMPLETE record over those constants — adding a field
 * to either one without a sample here is a compile error, so the walk can never
 * quietly skip a key.
 */
import { describe, expect, it } from "vitest";
import {
  AGENT_ONLY_TUNING_FIELDS,
  AGENT_RESOLUTION_FIELDS,
  handler,
} from "@flow-state-dev/core";
import type { AgentSpec } from "@flow-state-dev/core";
import { z } from "zod";
import { parseSkillMd } from "../../src/skills/skill-md";
import { materializeWorker } from "../../src/skills/worker-materializer";
import type { WorkerMaterializationDeps } from "../../src/skills/worker-materializer";

/**
 * Every field a `tool:` spec must be refused for: the agent-only tuning fields,
 * plus the three resolution kinds that are agents (`tool` itself excepted).
 */
type GuardedKey =
  | keyof typeof AGENT_ONLY_TUNING_FIELDS
  | Exclude<keyof typeof AGENT_RESOLUTION_FIELDS, "tool">;

const GUARDED_KEYS = [
  ...Object.keys(AGENT_RESOLUTION_FIELDS).filter((k) => k !== "tool"),
  ...Object.keys(AGENT_ONLY_TUNING_FIELDS),
] as GuardedKey[];

/** The kebab → camel mapping both gates are built from, as one lookup. */
const CAMEL_FOR: Record<string, keyof AgentSpec> = {
  ...AGENT_RESOLUTION_FIELDS,
  ...AGENT_ONLY_TUNING_FIELDS,
};

interface Sample {
  /** The field as it appears under an `agents:` entry in SKILL.md. */
  yaml: string;
  /** The same field in its parsed (camelCase) `AgentSpec` shape. */
  spec: Partial<AgentSpec>;
}

const SAMPLES: Record<GuardedKey, Sample> = {
  prompt: { yaml: `    prompt: Fetch it.`, spec: { prompt: "Fetch it." } },
  "prompt-ref": {
    yaml: `    prompt-ref: ./p.md`,
    spec: { promptRef: "./p.md" },
  },
  "agent-ref": {
    yaml: `    agent-ref: research-analyst`,
    spec: { agentRef: "research-analyst" },
  },
  "agent-overrides": {
    yaml: `    agent-overrides:\n      model: x`,
    spec: { agentOverrides: { model: "x" } },
  },
  tools: { yaml: `    tools: [search]`, spec: { tools: ["search"] } },
  visibility: {
    yaml: `    visibility: primary`,
    spec: { itemVisibility: { client: true, history: false } },
  },
  model: {
    yaml: `    model: openai/gpt-5.4-mini`,
    spec: { model: "openai/gpt-5.4-mini" },
  },
  "context-supply": {
    yaml: `    context-supply: conversation`,
    spec: { contextSupply: "conversation" },
  },
};

function skillMd(fieldLine: string): string {
  return [
    `---`,
    `description: A delegating skill`,
    `agents:`,
    `  fetch:`,
    `    tool: httpGet`,
    fieldLine,
    `---`,
    ``,
    `body`,
  ].join("\n");
}

function materializerDeps(): WorkerMaterializationDeps {
  return {
    skillName: "demo",
    catalog: {
      httpGet: handler({
        name: "httpGet",
        description: "Fetch a URL and return its body.",
        inputSchema: z.object({ url: z.string() }),
        outputSchema: z.object({ body: z.string() }),
        execute: async (input: { url: string }) => ({ body: `body of ${input.url}` }),
      }) as never,
    },
  };
}

describe("agent-only fields on a `tool:` participant (FIX-925)", () => {
  it.each(GUARDED_KEYS)(
    "`%s` is refused by the parser AND by the materializer",
    async (yamlKey) => {
      const sample = SAMPLES[yamlKey];
      const camel = CAMEL_FOR[yamlKey]!;

      // The sample must exercise the camelCase field the constant maps this
      // frontmatter key to — otherwise gate 2 below could pass by testing a
      // field nobody declared. Pins the mapping itself (`visibility` is NOT
      // `visibility` on an AgentSpec; it is `itemVisibility`).
      expect(Object.keys(sample.spec)).toEqual([camel]);

      // Gate 1 — SKILL.md, by kebab key.
      expect(() => parseSkillMd(skillMd(sample.yaml))).toThrow(
        new RegExp(`\`${yamlKey}\``),
      );

      // Gate 2 — materialization, by camelCase AgentSpec field. This is the
      // path a persisted/programmatic binding takes; without it, `{ tool,
      // agentRef }` would fall into the agentRef branch and silently
      // materialize an AGENT under a key the author declared as a tool.
      await expect(
        materializeWorker(
          "fetch",
          { tool: "httpGet", ...sample.spec } as AgentSpec,
          materializerDeps(),
        ),
      ).rejects.toThrow(new RegExp(`\`${camel}\``));
    },
  );
});
