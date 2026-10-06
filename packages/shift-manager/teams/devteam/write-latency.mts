/**
 * A store adapter wrapper that holds every version-checked resource write for
 * a while before it reaches the store, for goal checks only.
 *
 * A write's expected version is the one its request read earlier, so holding
 * the write widens the window in which another request can commit first. On
 * an in-memory store a served Lab's writes are otherwise so quick that
 * concurrent requests almost never overlap, and a check that a burst lands
 * whole would pass whether or not anything absorbs a lost race. With the
 * hold, a burst really races, and only a retry that keeps going lands it.
 *
 * The lab turns it on from `DEVFORCE_LAB_WRITE_LATENCY_MS` (see `host.mts`).
 * Nothing outside `goals/` uses it.
 */

type Adapter = { capabilities?: unknown; resolve(...args: unknown[]): Promise<Record<string, unknown>> };

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * Wrap `adapter` so each resource `set` or `delete` with a checked expected
 * version waits a random 0 to `maxMs` milliseconds first. Unchecked writes
 * (`"any"`) and every read pass straight through.
 */
export function withWriteLatency<T>(adapter: T, maxMs: number): T {
  const inner = adapter as unknown as Adapter;
  let wrapped: Promise<Record<string, unknown>> | undefined;
  return {
    ...inner,
    resolve: (...args: unknown[]) => {
      wrapped ??= inner.resolve(...args).then((registry) => {
        const resourceState = registry.resourceState as Record<string, (...a: unknown[]) => Promise<unknown>>;
        const held = new Proxy(resourceState, {
          get(target, prop, receiver) {
            const value = Reflect.get(target, prop, receiver);
            if ((prop !== "set" && prop !== "delete") || typeof value !== "function") return value;
            return async (...callArgs: unknown[]) => {
              const expected = prop === "set" ? callArgs[4] : callArgs[3];
              if (expected !== "any") await sleep(Math.random() * maxMs);
              return (value as (...a: unknown[]) => Promise<unknown>).apply(target, callArgs);
            };
          },
        });
        return new Proxy(registry, {
          get: (target, prop, receiver) => (prop === "resourceState" ? held : Reflect.get(target, prop, receiver)),
        });
      });
      return wrapped;
    },
  } as unknown as T;
}
