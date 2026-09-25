/**
 * A memory-capturing conversation on the real engine, for the
 * memory-evaluator-seam goals.
 *
 * Each `say(text)` is one request through `runAction`, on stores shared across
 * the conversation: the text becomes the user's message item, and capture runs
 * as a side chain after it, the way an app wires `.sideChain(mem.capture)`. The
 * observer and any evaluator resolve through the app's default model resolver,
 * so a model string reaches the real provider.
 *
 * A turn reports only what a reader of the trace and the stores can see: the
 * rows the capture traced, the capture's own error, the evaluator's answer if
 * one ran, and what was added to working and episodic memory.
 */
import {
  DEFAULT_ORG_ID,
  defineFlow,
  sequencer,
  type BlockDefinition,
} from "@flow-state-dev/core";
import type { BlockTraceItem } from "@flow-state-dev/core/items";
import {
  createInMemoryStores,
  createModelResolver,
  createResponseEmitter,
  runAction,
} from "@flow-state-dev/engine";
import { z } from "zod";
import { system, type CaptureEvaluatorBlock } from "../../packages/memory/src/index.ts";

const USER = "goal_user";

/** What one captured turn left behind. */
export type Turn = {
  text: string;
  /** Names of the blocks the capture traced, in order. */
  rows: string[];
  /** Kinds of the traced rows, in the same order. */
  kinds: string[];
  /** The capture's error message, when the capture failed. */
  captureError?: string;
  /** The evaluator's `capture` choice, when an evaluator row traced. */
  answer?: string;
  /** Whether the observer ran on this turn. */
  observed: boolean;
  /** Working-memory entries added by this turn (content). */
  addedEntries: string[];
  /** Episodes added by this turn. */
  addedEpisodes: number;
};

export type ConversationOptions = {
  /** The observer's model: a portable id resolved by the default resolver. */
  model: string;
  /** The evaluator slot, or none for today's capture. */
  evaluator?: CaptureEvaluatorBlock;
  /**
   * An evaluator run BEFORE capture but not given to it: the answers appear in
   * the trace, and capture never reads them. Only the ignore-evaluator control
   * uses this, to stand in for an implementation that ignores its evaluator.
   */
  ignoredEvaluator?: BlockDefinition<any, any>;
};

function unwrap(value: unknown): unknown {
  const v = value as { kind?: string; value?: unknown } | undefined;
  return v?.kind === "inline" ? v.value : value;
}

export async function conversation(options: ConversationOptions) {
  const mem = system({
    model: options.model,
    working: true,
    episodic: true,
    ...(options.evaluator ? { evaluator: options.evaluator } : {}),
  });

  let turnBlock: any = sequencer({ name: "turn", inputSchema: z.string() });
  if (options.ignoredEvaluator) {
    turnBlock = turnBlock.tap((text: string) => `[user] ${text}`, options.ignoredEvaluator);
  }
  turnBlock = turnBlock.sideChain(mem.capture);

  const flow = defineFlow({
    kind: "memory-evaluator-seam-goal",
    actions: {
      say: { block: turnBlock, inputSchema: z.string(), userMessage: (text: string) => text },
    },
    resources: { ...mem.sessionResources, ...mem.userResources },
  } as any)();

  const stores = createInMemoryStores();
  const modelResolver = createModelResolver();
  const sessionId = `goal_session_${Date.now()}`;
  let n = 0;

  async function read(scope: "session" | "user", id: string, key: string): Promise<any> {
    return (await stores.resourceState.get(scope, id, key))?.state;
  }

  async function snapshot() {
    const working = await read("session", sessionId, "workingMemory");
    const episodic = await read("user", USER, "episodicMemory");
    return {
      entryIds: new Set<string>((working?.entries ?? []).map((e: { id: string }) => e.id)),
      entries: (working?.entries ?? []) as Array<{ id: string; content: string }>,
      episodes: (episodic?.episodes ?? []).length as number,
    };
  }

  return {
    async say(text: string): Promise<Turn> {
      const before = await snapshot();
      const requestId = `req_memory_seam_${++n}_${Date.now()}`;
      const response = createResponseEmitter({ requestId, now: () => Date.now() });
      const result = await runAction({
        orgId: DEFAULT_ORG_ID,
        flow,
        actionName: "say",
        input: text,
        requestId,
        userId: USER,
        sessionId,
        stores,
        responseEmitter: response,
        runtimeConfig: { modelResolver },
      });
      if (result.error !== undefined) throw new Error(`turn "${text}" failed: ${result.error.message}`);

      const traces = (response.getItems() as unknown as BlockTraceItem[]).filter((i) => i.type === "block_trace");
      const rows = traces.map((t) => t.blockName);
      const capture = traces.find((t) => t.blockName === "memory/capture");
      const evaluatorRow = traces.find((t) => t.blockKind === "evaluator");
      const answer = (unwrap(evaluatorRow?.output) as { answers?: { capture?: { choice?: string } } } | undefined)
        ?.answers?.capture?.choice;
      const after = await snapshot();
      return {
        text,
        rows,
        kinds: traces.map((t) => t.blockKind),
        captureError: (capture as { error?: { message: string } } | undefined)?.error?.message,
        answer,
        observed: rows.includes("memory/observe"),
        addedEntries: after.entries.filter((e) => !before.entryIds.has(e.id)).map((e) => e.content),
        addedEpisodes: after.episodes - before.episodes,
      };
    },
  };
}
