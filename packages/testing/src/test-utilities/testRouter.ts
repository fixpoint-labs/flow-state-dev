import type { BlockDefinition } from "@flow-state-dev/core/types";
import { testBlock } from "./testBlock";
import type {
  TestBlockOptions,
  TestRouterResult
} from "./types";

/**
 * Executes a router block and returns the selected route name when detected.
 */
export async function testRouter<TInput, TOutput>(
  router: BlockDefinition<TInput, TOutput>,
  options: TestBlockOptions<TInput>
): Promise<TestRouterResult<TOutput>> {
  const routes = Array.isArray((router.config as unknown as { routes?: unknown }).routes)
    ? ((router.config as unknown as { routes: BlockDefinition<any, any>[] }).routes ?? [])
    : [];

  const originals = new Map<string, BlockDefinition<any, any>["run"]>();
  let selectedRoute: string | undefined;

  for (const route of routes) {
    originals.set(route.name, route.run);

    const original = route.run;
    route.run = async (input: unknown, ctx: unknown) => {
      selectedRoute = route.name;
      return original(input, ctx as any);
    };
  }

  try {
    const base = await testBlock(router, options);

    return {
      ...base,
      selectedRoute: selectedRoute ?? "unknown"
    };
  } finally {
    for (const route of routes) {
      const original = originals.get(route.name);
      if (original !== undefined) {
        route.run = original;
      }
    }
  }
}
