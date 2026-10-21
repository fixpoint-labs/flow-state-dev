/**
 * Compile-time assertions for what a `RequestStreamStore` hands back. A store
 * returns exactly the rows it was given, so its read type is the row type it
 * was created for: `OutputItem` by default, `RuntimeItem` for a store seeded
 * with trace rows. A trace row must never come back typed as `OutputItem`.
 *
 * If the store's reads are typed wider or narrower than what it holds, this
 * file fails to compile.
 */
import { createRequestStreamStore } from "../src/stream-client/request-stream-store";
import type { BlockTraceItem, OutputItem, RuntimeItem } from "@flow-state-dev/core/items";

declare const trace: BlockTraceItem;
declare const output: OutputItem;

// A default store holds OutputItem, so it refuses trace rows.
const visible = createRequestStreamStore();
// @ts-expect-error trace rows are not OutputItem
visible.loadSnapshot([trace]);
visible.loadSnapshot([output]);
const visibleRows: OutputItem[] = visible.getSorted();

// A store seeded with the full log returns RuntimeItem from every read.
const full = createRequestStreamStore<RuntimeItem>();
full.loadSnapshot([trace, output]);
full.upsert(output);

const sorted: RuntimeItem[] = full.getSorted();
const raw: RuntimeItem[] = full.getRaw();
const byId: RuntimeItem | undefined = full.getById("t1");
const owned: RuntimeItem[] = full.getOwnedBy("b1");

// @ts-expect-error getSorted can return trace rows
const sortedAsOutput: OutputItem[] = full.getSorted();
// @ts-expect-error getRaw can return trace rows
const rawAsOutput: OutputItem[] = full.getRaw();
// @ts-expect-error getById can return a trace row
const byIdAsOutput: OutputItem | undefined = full.getById("t1");
// @ts-expect-error getOwnedBy can return trace rows
const ownedAsOutput: OutputItem[] = full.getOwnedBy("b1");

void [visibleRows, sorted, raw, byId, owned, sortedAsOutput, rawAsOutput, byIdAsOutput, ownedAsOutput];
