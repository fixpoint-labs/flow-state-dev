import type { BlockTraceItem, OutputItem, StateSnapshotItem, StatusItem } from "@flow-state-dev/core/items";
import { parseBlockInstanceId } from "@flow-state-dev/core/items/internal";
import type { DevtoolItem } from "./item-types";
import type { RequestGroup } from "../components/workspace/stream-view";

/**
 * Extracts the `loopBack` generation from a deterministic blockInstanceId.
 * Steps re-executed after a `loopBack` jump carry a `loop[N]` path segment
 * (FIX-643); the generation is the last such segment (nearest enclosing loop).
 * Returns undefined for first-pass / non-looped blocks (no `loop[N]` segment).
 */
function loopGenerationFromInstanceId(instanceId: string): number | undefined {
  const parsed = parseBlockInstanceId(instanceId);
  if (!parsed) return undefined;
  const matches = [...parsed.path.matchAll(/loop\[(\d+)\]/g)];
  if (matches.length === 0) return undefined;
  const generation = Number(matches[matches.length - 1][1]);
  return Number.isInteger(generation) ? generation : undefined;
}

/** A single snapshot in a sequencer's state timeline. */
export type StateSnapshot = {
  stepName: string;
  stepIndex: number;
  state: unknown;
  version: number;
  ts: number;
};

export type TraceNode = {
  type: "request" | "block" | "item";
  id: string;
  requestId?: string;
  action?: string;
  status?: string;
  duration?: number;
  blockName?: string;
  blockKind?: string;
  blockInstanceId?: string;
  blockStatus?: string;
  blockDuration?: number;
  blockStartedAt?: number;
  blockCompletedAt?: number;
  /**
   * Execution phase from `provenance.phase`. Blocks dispatched via the work
   * queue (`.work()`, `.workIf()` truthy branch, `.forEachBackground()`, and
   * any descendants thereof) carry `phase: "work"`. Used by the trace view
   * to render a "BG" sidechain badge so background activity is visually
   * distinct from main-chain steps.
   */
  phase?: "main" | "work";
  /**
   * `loopBack` generation parsed from the block's `loop[N]` path segment
   * (FIX-643). Undefined for first-pass / non-looped blocks. Internal — the
   * display index is `iterationIndex`, set only when a labeled sibling exists.
   */
  loopGeneration?: number;
  /**
   * Iteration index to display as `[iter N]`. Set during tree assembly only
   * when this block shares a name+parent with at least one block carrying a
   * `loop[N]` segment, so non-looped same-name siblings stay unlabeled and the
   * first pass of a loop reads `[iter 0]`.
   */
  iterationIndex?: number;
  item?: DevtoolItem;
  /** The lifecycle trace item for this block (used for detail panel on click). */
  traceItem?: DevtoolItem;
  /** State snapshots for sequencer blocks, ordered by step execution. */
  stateSnapshots?: StateSnapshot[];
  children: TraceNode[];
  isExpanded: boolean;
};

export function buildTraceTree(requestGroups: RequestGroup[]): TraceNode[] {
  return requestGroups.map((group, groupIndex) => {
    const isLast = groupIndex === requestGroups.length - 1;
    const blockMap = new Map<string, TraceNode>();
    /** Tracks the parentBlockInstanceId for each block, collected during item iteration. */
    const parentOf = new Map<string, string>();
    const rootBlocks: TraceNode[] = [];
    const orphanItems: TraceNode[] = [];

    for (const item of group.items) {
      const prov = item.provenance;
      if (!prov) {
        orphanItems.push({
          type: "item",
          id: item.id,
          item,
          children: [],
          isExpanded: false,
        });
        continue;
      }

      let blockNode = blockMap.get(prov.blockInstanceId);
      if (!blockNode) {
        blockNode = {
          type: "block",
          id: `block-${prov.blockInstanceId}`,
          blockName: prov.blockName,
          blockKind: undefined,
          blockInstanceId: prov.blockInstanceId,
          blockStatus: "in_progress",
          phase: prov.phase,
          loopGeneration: loopGenerationFromInstanceId(prov.blockInstanceId),
          children: [],
          isExpanded: isLast,
        };
        blockMap.set(prov.blockInstanceId, blockNode);
      } else if (blockNode.phase === undefined && prov.phase !== undefined) {
        // First seen item didn't carry phase (defensive — provenance.phase is
        // always set today); backfill from any subsequent item that does.
        blockNode.phase = prov.phase;
      }

      // Track parent relationship from provenance so the nesting phase can
      // use it directly instead of re-scanning the items array.
      if (prov.parentBlockInstanceId && !parentOf.has(prov.blockInstanceId)) {
        parentOf.set(prov.blockInstanceId, prov.parentBlockInstanceId);
      }

      // FIX-573: block_debug items are gone. The block_trace lifecycle
      // already captures the resolved generator config (model, prompt,
      // tools, user, history) and the connected input; the detail panel
      // pulls those off `traceItem.generator` and `traceItem.input` below.

      // Drop structural status items with nothing to render. The sequencer
      // emits `status` items with an empty `message` carrying only a
      // `backgroundTasks` count (FIX-369) — those still get a synthesized
      // label in `getItemPreview`. Items with no message AND no
      // backgroundTasks have no label to render, so skip the row entirely.
      if (item.type === "status") {
        const status = item as StatusItem;
        if (!status.message && typeof status.backgroundTasks !== "number") {
          continue;
        }
      }

      // Collect state snapshots into the owning block node. Under the
      // FIX-401 keyed-update model, snapshots for the same sequencer
      // instance share `key === blockInstanceId` and represent in-place
      // updates rather than independent rows. Retain only the latest frame
      // per block so the panel renders the current state of each sequencer
      // without bookkeeping a per-step list. Terminal frames carry the final
      // state at the moment the sequencer's run ended and are rendered the
      // same way — the latest frame is what the user wants to see.
      if (item.type === "state_snapshot") {
        const snap = item as StateSnapshotItem;
        blockNode.stateSnapshots = [{
          stepName: snap.stepName,
          stepIndex: snap.stepIndex,
          state: snap.state,
          version: snap.version,
          ts: snap.ts,
        }];
        // State snapshots are trace-only metadata — don't add as visible children.
        continue;
      }

      // Extract metadata from block_output items into the block node header.
      if (item.type === "block_trace") {
        const bo = item as BlockTraceItem;
        blockNode.blockKind = blockNode.blockKind ?? bo.blockKind ?? inferBlockKind(item);
        if (bo.startedAt !== undefined) {
          blockNode.blockStartedAt = bo.startedAt;
        }
        if (bo.completedAt !== undefined) {
          blockNode.blockCompletedAt = bo.completedAt;
        }
        if (bo.duration !== undefined) {
          blockNode.blockDuration = bo.duration;
        }
        if (item.status === "completed") blockNode.blockStatus = "completed";
        if (item.status === "failed") blockNode.blockStatus = "failed";
        // block_trace is lifecycle metadata — never render as a visible child.
        // Store as traceItem so block nodes can be selected for detail. The
        // initial `added` row arrives without output; later phase patches fill
        // it in. Keep whichever has output (settled wins over in-progress).
        if (!blockNode.traceItem || bo.output !== undefined) {
          blockNode.traceItem = item;
        }
        continue;
      }
      if (item.type === "tool_output") {
        blockNode.blockKind = blockNode.blockKind ?? "generator";
      }
      if (item.type === "router_decision") {
        blockNode.blockKind = blockNode.blockKind ?? "router";
      }
      if (item.type === "error") blockNode.blockStatus = "failed";

      blockNode.children.push({
        type: "item",
        id: item.id,
        item,
        children: [],
        isExpanded: false,
      });
    }

    for (const [instanceId, blockNode] of blockMap) {
      const parentId = parentOf.get(instanceId);

      if (parentId && parentId !== instanceId && blockMap.has(parentId)) {
        const parent = blockMap.get(parentId)!;
        const insertIndex = parent.children.findIndex((c) => c.type === "item");
        if (insertIndex >= 0) {
          parent.children.splice(insertIndex, 0, blockNode);
        } else {
          parent.children.push(blockNode);
        }
      } else {
        rootBlocks.push(blockNode);
      }
    }

    // Assign per-iteration display labels (FIX-643). A loopBack worker drains
    // each task as a re-execution of the same body, so the same-name executor
    // appears once per task as a sibling under the same parent. Label such a
    // group `[iter N]` only when at least one member carries a `loop[N]`
    // segment, so genuinely distinct same-name siblings (e.g. two separate
    // `.step(foo)` steps) stay unlabeled and the loop's first pass reads
    // `[iter 0]`.
    assignIterationLabels(rootBlocks);
    for (const blockNode of blockMap.values()) {
      assignIterationLabels(blockNode.children);
    }

    // Fall back to timestamp-based duration when lifecycle metadata is not available.
    for (const blockNode of blockMap.values()) {
      if (blockNode.blockDuration !== undefined) {
        continue;
      }
      const blockItems = group.items.filter(
        (i) => i.provenance?.blockInstanceId === blockNode.blockInstanceId,
      );
      const blockTs = blockItems.map((i) => i.ts).filter(Boolean);
      if (blockTs.length >= 2) {
        blockNode.blockDuration = Math.max(...blockTs) - Math.min(...blockTs);
      }
    }

    // Propagate status to blocks that never received a block_output trace item.
    // If the request is completed/failed and a block still shows "in_progress",
    // infer its status from its children or the request.
    if (group.status === "completed" || group.status === "failed") {
      for (const blockNode of blockMap.values()) {
        if (blockNode.blockStatus === "in_progress") {
          blockNode.blockStatus = inferBlockStatus(blockNode, group.status);
        }
      }
    }

    return {
      type: "request" as const,
      id: `req-${group.requestId}`,
      requestId: group.requestId,
      action: group.action,
      status: group.status,
      duration: group.duration,
      children: [...rootBlocks, ...orphanItems],
      isExpanded: isLast,
    };
  });
}

/**
 * Sets `iterationIndex` on same-name sibling block nodes when at least one of
 * them is a `loopBack` re-execution (FIX-643). The first pass has no `loop[N]`
 * segment, so its generation reads as 0. Siblings that share a name but have no
 * looped member are left unlabeled.
 */
function assignIterationLabels(siblings: TraceNode[]): void {
  const groups = new Map<string, TraceNode[]>();
  for (const node of siblings) {
    if (node.type !== "block" || node.blockName === undefined) continue;
    const group = groups.get(node.blockName);
    if (group) {
      group.push(node);
    } else {
      groups.set(node.blockName, [node]);
    }
  }

  for (const group of groups.values()) {
    const hasLoopedMember = group.some((n) => n.loopGeneration !== undefined);
    if (!hasLoopedMember) continue;
    for (const node of group) {
      node.iterationIndex = node.loopGeneration ?? 0;
    }
  }
}

function inferBlockKind(item: DevtoolItem): string | undefined {
  if (item.type === "block_trace" && (item as BlockTraceItem).toolCall) return "generator";
  return undefined;
}

function inferBlockStatus(node: TraceNode, requestStatus: string): string {
  const childBlocks = node.children.filter((c) => c.type === "block");
  if (childBlocks.length > 0) {
    const anyFailed = childBlocks.some((c) => c.blockStatus === "failed");
    if (anyFailed) return "failed";
    const allDone = childBlocks.every(
      (c) => c.blockStatus === "completed" || c.blockStatus === "failed",
    );
    if (allDone) return "completed";
  }
  return requestStatus;
}
