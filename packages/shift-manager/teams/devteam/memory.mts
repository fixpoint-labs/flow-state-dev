/**
 * The shift coordinator's memory: the standard pack from
 * `@flow-state-dev/memory`, composed into the coordinator flow's judgment turn
 * and nowhere else.
 *
 * **Composed in, not switched on.** The built-in `agent` flow stays free of
 * memory: only the `coordinator` flow, which the chief of staff runs on, gets
 * these options, so a worker the person hires onto `agent` remembers nothing
 * of its own (`docs/architecture/workforce-default-worker-kind.md`, C5).
 *
 * **What it carries.** The capability's default presets: working memory, the
 * rolling digest, and the `memory/recall` tool, which the chief of staff names
 * in its `tools:` line. The coordinator flow keys its user-scoped storage by
 * its own copy (`isolateUserState`), so what it remembers is apart from the
 * person's other flows. Every coordinator worker on this Lab shares that copy.
 *
 * **Light by default.** Read-side only: nothing is recorded unless the Lab is
 * opened with `memoryCapture`, which runs memory's capture pipeline after each
 * answer. Either way a line in the turn's context says which, so the chief of
 * staff can tell the person whether anything said here is kept.
 */
import type { CapabilityRef, GeneratorTool } from "@flow-state-dev/core";
import { defineCapability } from "@flow-state-dev/core";
import { system } from "@flow-state-dev/memory";

/** The recall tool's catalog key: its own name, which a `tools:` line lists. */
export const RECALL_TOOL = "memory/recall";

/** What the turn's context says when capture is on. */
export const CAPTURE_ON =
  "Memory capture is on: after each answer, this conversation is recorded into your memory, so it can come back in a later conversation.";

/** What the turn's context says when capture is off. */
export const CAPTURE_OFF =
  "Memory capture is off: nothing said in this conversation is recorded into your memory. " +
  "If the person asks you to remember something for later, say you can't keep it.";

/** The options the coordinator flow's judgment turn adds for memory. */
export interface CoordinatorMemory {
  /** The recall tool, under {@link RECALL_TOOL}. */
  catalog: Record<string, GeneratorTool>;
  /** The memory capability, and the line saying whether capture is on. */
  uses: CapabilityRef[];
  isolateUserState: true;
  /** Memory's capture pipeline, only when capture is on. */
  afterAnswer?: ReturnType<typeof system>["captureFromItems"];
}

/**
 * Build the coordinator's memory.
 *
 * @param options.model The model the recall tool and the capture pipeline run on.
 * @param options.capture Record each conversation into memory after each answer.
 */
export function coordinatorMemory(options: { model: string; capture: boolean }): CoordinatorMemory {
  const mem = system({
    model: options.model,
    working: { capacity: 7 },
    episodic: true,
    semantic: true,
    digest: true,
  });
  const capture = defineCapability({
    name: "memory-capture",
    presets: {
      line: { context: { memoryCapture: options.capture ? CAPTURE_ON : CAPTURE_OFF } },
      default: ["line"],
    },
  });
  return {
    catalog: { [RECALL_TOOL]: mem.tool.recall() as GeneratorTool },
    uses: [mem.capability, capture],
    isolateUserState: true,
    ...(options.capture ? { afterAnswer: mem.captureFromItems } : {}),
  };
}
