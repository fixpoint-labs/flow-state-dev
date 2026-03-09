# FIX-215 — Transient Block Output

## Objective

Add a `transient` flag to block definitions. When `transient: true`, the block streams its output to connected clients normally but its items are never written to the session store. On stream resume or replay, transient items are absent.

This serves long-running or high-frequency flows where intermediate computation results have no durable value (price tick processors, polling blocks, intermediate classification steps).

## Prior Art

The framework already has item-level transience:

- `OutputItemBase` includes `transient?: boolean` (`packages/core/src/items/types.ts:20`)
- `error` and `status` items are emitted with `transient: true` (`packages/server/src/execution/runAction.ts:227,279`)
- `resource_change` items default to `transient: true` (`packages/server/src/streaming/response-emitter.ts:329`)

What's missing: a way for a **block definition** to declare that all of its emitted items should be transient. The current item-level flag is set ad-hoc per emission site. This feature promotes transience to a first-class block-level concern.

## API Surface

```ts
export const priceChecker = generator({
  transient: true,
  name: "price-checker",
  // ...rest of definition
});
```

`transient` is optional, defaults to `false`. The block executes identically. It yields stream deltas, is visible to downstream blocks via `getBlockOutput` during the same execution, and participates in sequencer/router logic. Only its output persistence is suppressed.

## Semantics

| Behavior | Transient block | Normal block |
|---|---|---|
| Items emitted to SSE clients | Yes | Yes |
| Items written to `RequestRecord.items` | **No** | Yes |
| `getBlockOutput` within same execution | Works (in-memory sibling registry) | Works |
| Items present on stream resume/replay | **No** | Yes |
| Items in `response.getItems()` in-memory | Yes (needed for streaming) | Yes |
| Block appears in flow definition | Yes | Yes |

## Implementation Plan

### Step 1: Add `transient` to `BlockConfig`

**File:** `packages/core/src/types/block.ts`

Add `transient?: boolean` to the `BlockConfig` interface (after `description`, before `inputSchema`):

```ts
export interface BlockConfig<...> {
  name: string;
  description?: string;
  transient?: boolean;  // NEW
  inputSchema?: TInputSchema;
  // ...
}
```

No changes needed to `BlockDefinition` — the `transient` flag lives on `config` and is accessed via `block.config.transient` at runtime. This keeps the public definition interface lean.

**Propagation:** The `buildBlock()` function (`packages/core/src/blocks/internal/build-block.ts`) already spreads `config` into `runtimeConfig` (line 148–152), so `transient` flows through automatically. No builder changes needed in `handler.ts`, `generator.ts`, `sequencer.ts`, or `router.ts`.

### Step 2: Stamp `transient` on emitted items

**File:** `packages/server/src/execution/executeBlock.ts`

In `emitBlockOutputItem()` (lines 75–104), set the `transient` field on the `BlockOutputItem` from the block's config:

```ts
const item: BlockOutputItem = {
  id: `item_block_output_${Date.now()}_${Math.random().toString(16).slice(2)}`,
  type: "block_output",
  status: "completed",
  transient: options.block.config.transient === true,  // NEW
  requestId: options.metadata.requestId,
  // ...rest unchanged
};
```

This stamps every `block_output` item emitted by a transient block. The item-level `transient` flag is already part of `OutputItemBase`, so no type changes are needed on the item side.

For generator blocks that emit `message`, `reasoning`, or other item types during streaming: the emission path in `createExecutionContext.ts` creates items through the response emitter. These items need the block's transient flag propagated as well. The block config is available through the execution metadata.

**File:** `packages/server/src/context/createExecutionContext.ts`

Where message/reasoning/component items are created during generator execution, set `transient: true` when the enclosing block's config has `transient: true`. The block config is accessible from the execution context's block metadata.

### Step 3: Filter transient items at persistence boundary

**File:** `packages/server/src/execution/runAction.ts`

Add a `stripTransientItems` filter alongside the existing `stripEphemeralContent`:

```ts
/**
 * Removes items flagged as transient before persistence.
 * Transient items are streamed to clients in real time but
 * produce no durable store record.
 */
function stripTransientItems(items: OutputItem[]): OutputItem[] {
  return items.filter((item) => item.transient !== true);
}
```

Update `patchRequestRecord()` to apply both filters:

```ts
const sanitized = patch.items !== undefined
  ? { ...patch, items: stripEphemeralContent(stripTransientItems(patch.items)) }
  : patch;
```

This is the single persistence gate. Both success (line 479) and error (line 526) paths flow through `patchRequestRecord`, so both are covered.

### Step 4: Verify `getBlockOutput` / `getBlockResult` (no changes)

These functions (`packages/server/src/context/createExecutionContext.ts`, lines 1635–1683) resolve from the in-memory sibling registry, not from the store. Transient blocks are still registered as siblings during execution. No changes needed — the acceptance criterion is met by the existing design.

### Step 5: Verify stream resume behavior (no changes)

On resume, the server replays events from the persisted `RequestRecord.items`. Since transient items are stripped at Step 3, they are naturally absent from replay. The resume path (`packages/server/src/streaming/resume.ts`) requires no modifications.

## File Change Summary

| File | Change |
|---|---|
| `packages/core/src/types/block.ts` | Add `transient?: boolean` to `BlockConfig` |
| `packages/server/src/execution/executeBlock.ts` | Set `transient` on `BlockOutputItem` from block config |
| `packages/server/src/context/createExecutionContext.ts` | Propagate block `transient` flag to message/reasoning items emitted by generators |
| `packages/server/src/execution/runAction.ts` | Add `stripTransientItems()`, apply in `patchRequestRecord()` |

## Test Plan

All tests in `packages/server/test/`.

### T1: Transient block produces zero persisted items

- Define a flow with a transient handler block
- Execute via `runAction` with in-memory stores
- Assert `stores.request.get(requestId).items` contains no items from the transient block
- Assert `result.items` (the in-memory return) **does** contain the transient block's items

### T2: Non-transient blocks in same flow are unaffected

- Define a flow with a sequencer containing both a transient block and a normal block
- Execute and verify the normal block's items are persisted while the transient block's are not

### T3: Connected stream client receives transient items

- Execute a flow with a transient generator block
- Capture all emitted stream events
- Assert `item.added` and `item.done` events appear for the transient block's output

### T4: `getBlockOutput` resolves for transient blocks within same execution

- Define a sequencer: transient handler A, then handler B that calls `ctx.getBlockOutput(A)`
- Assert handler B receives A's output

### T5: Stream resume excludes transient items

- Execute a flow with a transient block, persist the request record
- Call `replayRequestEvents` from the persisted record
- Assert no transient block items appear in the replayed events

## Risks and Edge Cases

**Sequencer with mixed transient/non-transient children.** A sequencer's own `block_output` item records the final output. If the sequencer itself is non-transient but contains transient children, the sequencer output is persisted while child outputs are not. This is correct behavior — transience applies per-block, not transitively.

**Router selecting a transient block.** The router emits its own `block_output` with the selected block's result. If the routed-to block is transient, its items are stripped, but the router's own output item follows the router's own `transient` setting. This is the expected composition.

**Generator tool-call items.** When a generator invokes a transient handler as a tool, the `block_output` item gets `transient: true` from the handler's config. The generator's own message items follow the generator's config. If only the tool-handler is transient, the generator's conversation items persist but the tool result does not. This may surprise users — document it.

**Replay gaps.** Transient items have `itemIndex` values assigned during execution. After filtering, the persisted `items` array has index gaps. Consumers that rely on contiguous `itemIndex` need to tolerate gaps. The existing stream resume logic uses sequence numbers, not item indices, so this is safe.

## Documentation Updates

- `docs/architecture/blocks.md` — Add "Transient blocks" section describing the flag and its persistence semantics
- `docs/architecture/streaming.md` — Update the "Transience" section to include block-level transience alongside the existing item-type rules
