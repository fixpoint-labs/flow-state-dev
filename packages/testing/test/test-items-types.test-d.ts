/**
 * Compile-time assertions for `testItems` selectors. The unfiltered selectors
 * return every row they were given, trace rows included, so they are typed
 * `RuntimeItem[]`. A trace row must never come back typed as `OutputItem`.
 *
 * If an unfiltered selector is typed `OutputItem[]` again, this file fails to
 * compile.
 */
import { testItems } from "../src/test-utilities/testItems";
import type { BlockTraceItem, OutputItem, RuntimeItem } from "@flow-state-dev/core/items";

declare const trace: BlockTraceItem;
const items = testItems([trace]);

const all: RuntimeItem[] = items.all();
const sideChain: RuntimeItem[] = items.sideChain();
const main: RuntimeItem[] = items.main();
const byAgent: RuntimeItem[] = items.byAgent("a");
const byVisibility: RuntimeItem[] = items.byVisibility({ client: true });

// @ts-expect-error all() can return trace rows
const allAsOutput: OutputItem[] = items.all();
// @ts-expect-error sideChain() can return trace rows
const sideChainAsOutput: OutputItem[] = items.sideChain();
// @ts-expect-error main() can return trace rows
const mainAsOutput: OutputItem[] = items.main();
// @ts-expect-error byAgent() can return trace rows
const byAgentAsOutput: OutputItem[] = items.byAgent("a");
// @ts-expect-error byVisibility() can return trace rows
const byVisibilityAsOutput: OutputItem[] = items.byVisibility({ client: true });

void [all, sideChain, main, byAgent, byVisibility];
void [allAsOutput, sideChainAsOutput, mainAsOutput, byAgentAsOutput, byVisibilityAsOutput];
