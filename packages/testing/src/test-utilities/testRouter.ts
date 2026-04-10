import type { BlockDefinition } from "@flow-state-dev/core/types";
import { testBlock } from "./testBlock";
import type {
  BlockInput,
  BlockOutput,
  TestBlockOptions,
  TestRouterResult
} from "./types";

/**
 * Executes a router block and returns the selected route name when detected.
 *
 * Wraps the router's `.run` to inject an `onRouteSelected` hook that captures
 * the selected route name. This works transparently with connectInput (which
 * creates a new block but preserves the original name).
 */
export async function testRouter<TBlock extends BlockDefinition<any, any>>(
  router: TBlock,
  options: TestBlockOptions<BlockInput<TBlock>>
): Promise<TestRouterResult<BlockOutput<TBlock>>> {
  let selectedRoute: string | undefined;

  const originalRun = router.run;
  router.run = async (input: unknown, ctx: unknown) => {
    const blockCtx = ctx as { _runtimeHooks?: Record<string, Function> };
    const existingOnRouteSelected = blockCtx._runtimeHooks?.onRouteSelected;
    blockCtx._runtimeHooks = {
      ...blockCtx._runtimeHooks,
      onRouteSelected: (routerName: string, routeName: string, instanceId?: string) => {
        selectedRoute = routeName;
        existingOnRouteSelected?.(routerName, routeName, instanceId);
      }
    };
    return originalRun(input, ctx as any);
  };

  try {
    const base = await testBlock(router, options);

    return {
      ...base,
      selectedRoute: selectedRoute ?? "unknown"
    };
  } finally {
    router.run = originalRun;
  }
}
