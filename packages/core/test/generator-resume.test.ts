/**
 * Generator resume conversation reconstruction (FIX-814).
 *
 * These fixtures encode the *intent* of resume: rebuild the exact conversation
 * the model produced from the durable item log — one assistant message per
 * step (not per tool call), reading each result's persisted `modelOutput`,
 * classifying failed `tool_output`s three ways, and matching the pending gate
 * by forward-constructed path (prefix, reserved-char-safe) rather than parsing.
 * The reconstruction is visibility-agnostic, so a `history:false` generator's
 * turns are never dropped.
 */
import { describe, it, expect } from "vitest";
import { reconstructGeneratorResume, readPersistedPreludePrefixCount } from "../src/blocks/internal/generator-resume";
import { GeneratorToolUnavailableError, validateResumableTool } from "../src/blocks/internal/generator-resume";
import { blockPathTool, extendBlockPath } from "../src/blocks/internal/block-instance-id";
import type { RuntimeItem } from "../src/items/internal";

const REQ = "req1";
const BASE = "root/step[0]"; // the generator's blockPath
const GEN_LOGICAL = `${REQ}:${BASE}`;
const GEN_INSTANCE = `${REQ}:${BASE}:0`;

let idc = 0;
const nid = () => `item_${idc++}`;

function stepArtifact(
  stepNumber: number,
  toolCalls: Array<{ toolCallId: string; toolName: string; alias?: string; arguments?: unknown }>,
  opts: { text?: string; prelude?: unknown[]; itemIndex?: number } = {},
): RuntimeItem {
  return {
    id: nid(),
    type: "generator_step",
    status: "completed",
    requestId: REQ,
    itemIndex: opts.itemIndex ?? stepNumber * 10,
    provenance: { blockName: "gen", blockInstanceId: GEN_INSTANCE, phase: "main" },
    ts: Date.now(),
    blockInstanceId: GEN_INSTANCE,
    stepNumber,
    ...(opts.text !== undefined ? { text: opts.text } : {}),
    toolCalls: toolCalls.map((c) => ({
      toolCallId: c.toolCallId,
      toolName: c.toolName,
      alias: c.alias ?? c.toolName,
      arguments: c.arguments ?? {},
    })),
    ...(opts.prelude !== undefined ? { prelude: opts.prelude } : {}),
  } as unknown as RuntimeItem;
}

function toolOutput(
  callId: string,
  name: string,
  status: "completed" | "failed",
  opts: {
    output?: unknown;
    modelOutput?: unknown;
    alias?: string;
    errorMessage?: string;
    errorCode?: string;
    itemIndex?: number;
    stepNumber?: number;
  } = {},
): RuntimeItem {
  return {
    id: nid(),
    type: "tool_output",
    status,
    requestId: REQ,
    itemIndex: opts.itemIndex ?? 100,
    provenance: { blockName: "gen", blockInstanceId: GEN_INSTANCE, phase: "main" },
    ts: Date.now(),
    blockName: name,
    output: opts.output,
    ...(opts.modelOutput !== undefined ? { modelOutput: opts.modelOutput } : {}),
    toolCall: {
      callId,
      name,
      alias: opts.alias ?? name,
      arguments: "{}",
      generatorBlock: "gen",
      ...(opts.stepNumber !== undefined ? { stepNumber: opts.stepNumber } : {}),
    },
    ...(status === "failed"
      ? {
          error: {
            message: opts.errorMessage ?? "err",
            ...(opts.errorCode !== undefined ? { code: opts.errorCode } : {}),
          },
        }
      : {}),
  } as unknown as RuntimeItem;
}

/** The pending suspension's logical id for a given step/name/callId. */
const gateLogical = (step: number, name: string, callId: string): string =>
  `${REQ}:${extendBlockPath(BASE, blockPathTool(name, `${step}:${callId}`))}`;

const run = (items: RuntimeItem[], pending: string | undefined) =>
  reconstructGeneratorResume({
    items,
    requestId: REQ,
    generatorLogicalId: GEN_LOGICAL,
    generatorToolBasePath: BASE,
    pendingBlockLogicalId: pending,
  });

describe("reconstructGeneratorResume (FIX-814)", () => {
  it("returns undefined when there are no generator_step artifacts", () => {
    expect(run([], undefined)).toBeUndefined();
  });

  it("rebuilds ONE assistant message per multi-tool step, not N pairs", () => {
    const items = [
      stepArtifact(
        0,
        [
          { toolCallId: "a", toolName: "search", alias: "search" },
          { toolCallId: "b", toolName: "lookup", alias: "lookup" },
        ],
        { text: "thinking", prelude: [{ role: "system", content: "sys" }] },
      ),
      toolOutput("a", "search", "completed", { output: "ra" }),
      toolOutput("b", "lookup", "completed", { output: "rb" }),
      // Step 1 holds the pending gate so step 0 is treated as fully-recorded.
      stepArtifact(1, [{ toolCallId: "g", toolName: "approve", alias: "approve" }]),
      toolOutput("g", "approve", "failed", { errorCode: "SUSPENSION" }),
    ];
    const r = run(items, gateLogical(1, "approve", "g"))!;
    expect(r).toBeDefined();

    // prelude + ONE assistant message + TWO tool-result messages for step 0.
    expect(r.preludeIncluded).toBe(true);
    const [prelude, assistant, res1, res2] = r.messages;
    expect((prelude as any).role).toBe("system");
    expect((assistant as any).role).toBe("assistant");
    const toolCallParts = (assistant as any).content.filter((p: any) => p.type === "tool-call");
    expect(toolCallParts).toHaveLength(2);
    expect((assistant as any).content.some((p: any) => p.type === "text" && p.text === "thinking")).toBe(true);
    expect((res1 as any).role).toBe("tool");
    expect((res2 as any).role).toBe("tool");
    expect(r.messages).toHaveLength(4);

    // Step 1 is the resume step.
    expect(r.resumeStep?.stepNumber).toBe(1);
    expect(r.resumeStep?.calls.find((c) => c.kind === "pending")?.toolName).toBe("approve");
    expect(r.priorSteps).toHaveLength(1);
  });

  it("reproduces the live content envelope from a mapper's persisted modelOutput", () => {
    const items = [
      stepArtifact(0, [{ toolCallId: "a", toolName: "t", alias: "t" }]),
      // A mapper redacted a non-string output to a string; the LIVE path wraps
      // that in the v7 content envelope, and resume must match — not emit a
      // bare text result — and must not leak the raw {secret}.
      toolOutput("a", "t", "completed", { output: { secret: true }, modelOutput: "REDACTED" }),
      stepArtifact(1, [{ toolCallId: "g", toolName: "gate", alias: "gate" }]),
      toolOutput("g", "gate", "failed", { errorCode: "SUSPENSION" }),
    ];
    const r = run(items, gateLogical(1, "gate", "g"))!;
    const res = r.messages.find((m: any) => m.role === "tool") as any;
    expect(res.content[0].output).toEqual({ type: "content", value: [{ type: "text", text: "REDACTED" }] });
  });

  it("classifies a step's failed tool_outputs three ways: pending / losing / ordinary", () => {
    const items = [
      stepArtifact(0, [
        { toolCallId: "p", toolName: "gate", alias: "gate" },
        { toolCallId: "l", toolName: "gate2", alias: "gate2" },
        { toolCallId: "e", toolName: "boom", alias: "boom" },
        { toolCallId: "ok", toolName: "done", alias: "done" },
      ]),
      toolOutput("p", "gate", "failed", { errorCode: "SUSPENSION" }),
      toolOutput("l", "gate2", "failed", { errorCode: "SUSPENSION" }),
      toolOutput("e", "boom", "failed", { errorMessage: "kaboom" }),
      toolOutput("ok", "done", "completed", { output: "done!" }),
    ];
    const r = run(items, gateLogical(0, "gate", "p"))!;
    const kinds = Object.fromEntries(r.resumeStep!.calls.map((c) => [c.toolName, c.kind]));
    expect(kinds).toEqual({ gate: "pending", gate2: "losing", boom: "failed", done: "completed" });
    expect(
      r.resumeStep!.calls.find((c) => c.toolName === "boom")?.errorMessage,
    ).toBe("kaboom");
  });

  it("matches the pending gate when the call id contains reserved characters", () => {
    const callId = "abc]/x[:";
    const items = [
      stepArtifact(0, [{ toolCallId: callId, toolName: "gate", alias: "gate" }]),
      toolOutput(callId, "gate", "failed", { errorCode: "SUSPENSION" }),
    ];
    const r = run(items, gateLogical(0, "gate", callId))!;
    expect(r.resumeStep?.calls[0]?.kind).toBe("pending");
  });

  it("does NOT misclassify a sibling as nested under another (escaped prefix)", () => {
    // Two sibling calls; the pending gate is the FIRST. A naive prefix match
    // over an unescaped scheme could match the second under the first.
    const items = [
      stepArtifact(0, [
        { toolCallId: "abc", toolName: "gate", alias: "gate" },
        { toolCallId: "abc]/nested", toolName: "gate", alias: "gate" },
      ]),
      toolOutput("abc", "gate", "failed", { errorCode: "SUSPENSION", itemIndex: 1 }),
      toolOutput("abc]/nested", "gate", "failed", { errorCode: "SUSPENSION", itemIndex: 2 }),
    ];
    // Pending is the SECOND call.
    const r = run(items, gateLogical(0, "gate", "abc]/nested"))!;
    const pending = r.resumeStep!.calls.filter((c) => c.kind === "pending");
    expect(pending).toHaveLength(1);
    expect(pending[0]!.toolCallId).toBe("abc]/nested");
  });

  it("prefix-matches a composite tool that suspends BELOW its own scope", () => {
    const items = [
      stepArtifact(0, [{ toolCallId: "c1", toolName: "composite", alias: "composite" }]),
      toolOutput("c1", "composite", "failed", { errorCode: "SUSPENSION" }),
    ];
    // The recorded suspension path extends past the tool's own scope path.
    const nested = gateLogical(0, "composite", "c1") + "/step[0]";
    const r = run(items, nested)!;
    expect(r.resumeStep?.calls[0]?.kind).toBe("pending");
  });

  it("is visibility-agnostic — reconstruction never consults itemVisibility", () => {
    // Items marked history:false must still reconstruct.
    const withVis = (item: RuntimeItem): RuntimeItem =>
      ({ ...(item as any), itemVisibility: { client: false, history: false } }) as RuntimeItem;
    const items = [
      withVis(stepArtifact(0, [{ toolCallId: "a", toolName: "t", alias: "t" }])),
      withVis(toolOutput("a", "t", "completed", { output: "x" })),
      withVis(stepArtifact(1, [{ toolCallId: "g", toolName: "gate", alias: "gate" }])),
      withVis(toolOutput("g", "gate", "failed", { errorCode: "SUSPENSION" })),
    ];
    const r = run(items, gateLogical(1, "gate", "g"))!;
    expect(r.messages.some((m: any) => m.role === "assistant")).toBe(true);
    expect(r.messages.some((m: any) => m.role === "tool")).toBe(true);
  });

  it("prefers a completed tool_output over an earlier failed one for the same call (multi-cycle)", () => {
    const items = [
      stepArtifact(0, [{ toolCallId: "a", toolName: "gate", alias: "gate" }]),
      // Cycle-0 suspended record...
      toolOutput("a", "gate", "failed", { errorCode: "SUSPENSION", itemIndex: 5 }),
      // ...superseded by the cycle-1 completed record.
      toolOutput("a", "gate", "completed", { output: "real", itemIndex: 50 }),
      // A later, second gate is now pending.
      stepArtifact(1, [{ toolCallId: "b", toolName: "gate2", alias: "gate2" }]),
      toolOutput("b", "gate2", "failed", { errorCode: "SUSPENSION" }),
    ];
    const r = run(items, gateLogical(1, "gate2", "b"))!;
    // Step 0's gate is now completed → injected, not re-entered.
    const res = r.messages.find((m: any) => m.role === "tool") as any;
    expect(res.content[0].output).toEqual({ type: "text", value: "real" });
    expect(r.resumeStep?.stepNumber).toBe(1);
  });

  it("disambiguates a provider call id reused across two steps by stepNumber", () => {
    // Step 0 and step 1 of ONE generator reuse call id "c1". The step-0
    // completed output must pair with step 0, and step 1's pending gate must
    // NOT be satisfied by step 0's completed output.
    const items = [
      stepArtifact(0, [{ toolCallId: "c1", toolName: "a", alias: "a" }]),
      toolOutput("c1", "a", "completed", { output: "STEP0", stepNumber: 0, itemIndex: 10 }),
      stepArtifact(1, [{ toolCallId: "c1", toolName: "gate", alias: "gate" }]),
      toolOutput("c1", "gate", "failed", { errorCode: "SUSPENSION", stepNumber: 1, itemIndex: 20 }),
    ];
    const r = run(items, gateLogical(1, "gate", "c1"))!;
    // Step 0 resolved to its own completed output (not the step-1 record).
    const res = r.messages.find((m: any) => m.role === "tool") as any;
    expect(res.content[0].output).toEqual({ type: "text", value: "STEP0" });
    // Step 1 is the resume step and its call is pending (re-enter), not
    // completed from step 0's output.
    expect(r.resumeStep?.stepNumber).toBe(1);
    expect(r.resumeStep?.calls[0]?.kind).toBe("pending");
  });

  it("ignores another generator's tool_output that shares a call id (cross-generator scope)", () => {
    // Two generators in one request that happen to share a provider call id.
    // The OTHER generator's completed output must not satisfy THIS generator's
    // pending gate — otherwise the approved tool is silently skipped.
    const foreign = {
      ...(toolOutput("g", "gate", "completed", { output: "FOREIGN", itemIndex: 200 }) as any),
      provenance: { blockName: "other", blockInstanceId: `${REQ}:root/step[1]:0`, phase: "main" },
    } as RuntimeItem;
    const items = [
      stepArtifact(0, [{ toolCallId: "g", toolName: "gate", alias: "gate" }]),
      foreign,
      toolOutput("g", "gate", "failed", { errorCode: "SUSPENSION", itemIndex: 5 }),
    ];
    const r = run(items, gateLogical(0, "gate", "g"))!;
    // The pending gate must re-enter, NOT be classified completed from the
    // foreign generator's output.
    expect(r.resumeStep?.calls[0]?.kind).toBe("pending");
  });

  it("treats a crash-persisted in_progress tool_output as incomplete → re-run, not a model error", () => {
    // A crash mid-tool leaves `item.added` (in_progress) but never `item.done`.
    // The call must re-run on resume (like the absent case), NOT be surfaced to
    // the model as an ordinary failure. (§4.6)
    const inProgress: RuntimeItem = {
      id: nid(),
      type: "tool_output",
      status: "in_progress",
      requestId: REQ,
      itemIndex: 100,
      provenance: { blockName: "gen", blockInstanceId: GEN_INSTANCE, phase: "main" },
      ts: Date.now(),
      blockName: "charge",
      output: undefined,
      toolCall: { callId: "c", name: "charge", alias: "charge", arguments: "{}", generatorBlock: "gen" },
    } as unknown as RuntimeItem;
    const items = [stepArtifact(0, [{ toolCallId: "c", toolName: "charge", alias: "charge" }]), inProgress];
    const r = run(items, undefined)!;
    // No pending gate, but the incomplete call makes step 0 a resume step that
    // re-runs the call rather than replaying a failure.
    expect(r.resumeStep?.stepNumber).toBe(0);
    expect(r.resumeStep?.calls[0]?.kind).toBe("missing");
  });

  it("uses the persisted step-0 prelude verbatim (never a freshly-recomputed one)", () => {
    // The prelude captured before suspension is authoritative on resume, so a
    // dynamic prompt/context resolver whose output drifts across the suspend
    // window can't change what the resumed model sees. (§4.3 round-8)
    const persistedPrelude = [{ role: "system", content: "ORIGINAL-SYSTEM-PROMPT" }];
    const items = [
      stepArtifact(0, [{ toolCallId: "g", toolName: "gate", alias: "gate" }], { prelude: persistedPrelude }),
      toolOutput("g", "gate", "failed", { errorCode: "SUSPENSION" }),
    ];
    const r = run(items, gateLogical(0, "gate", "g"))!;
    expect(r.preludeIncluded).toBe(true);
    expect((r.messages[0] as any).content).toBe("ORIGINAL-SYSTEM-PROMPT");
  });
});

describe("readPersistedPreludePrefixCount (FIX-814)", () => {
  const withPrefix = (art: RuntimeItem, systemPrefixCount: number): RuntimeItem =>
    ({ ...(art as any), systemPrefixCount }) as RuntimeItem;

  it("returns the step-0 artifact's persisted prefix count for this generator", () => {
    const items = [
      withPrefix(stepArtifact(0, [{ toolCallId: "a", toolName: "t", alias: "t" }], { prelude: [{}] }), 3),
      stepArtifact(1, [{ toolCallId: "g", toolName: "gate", alias: "gate" }]),
    ];
    expect(readPersistedPreludePrefixCount(items, GEN_LOGICAL)).toBe(3);
  });

  it("returns undefined for a different generator's artifact, and when absent", () => {
    const foreign = {
      ...(withPrefix(stepArtifact(0, [{ toolCallId: "a", toolName: "t", alias: "t" }]), 5) as any),
      blockInstanceId: `${REQ}:root/step[9]:0`,
    } as RuntimeItem;
    expect(readPersistedPreludePrefixCount([foreign], GEN_LOGICAL)).toBeUndefined();
    // Present artifact but no persisted count (older record) → undefined.
    expect(
      readPersistedPreludePrefixCount([stepArtifact(0, [{ toolCallId: "a", toolName: "t", alias: "t" }])], GEN_LOGICAL),
    ).toBeUndefined();
  });
});

describe("validateResumableTool (FIX-814)", () => {
  it("throws when the pending tool is no longer resolvable", () => {
    expect(() => validateResumableTool("gen", "gate", new Set(["other"]))).toThrow(
      GeneratorToolUnavailableError,
    );
  });

  it("passes when the tool is present", () => {
    expect(() => validateResumableTool("gen", "gate", new Set(["gate"]))).not.toThrow();
  });
});
