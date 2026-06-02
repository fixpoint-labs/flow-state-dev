/**
 * Redis pub/sub implementation of StreamBridge. Publisher side writes
 * events to a channel; subscriber side reads from it. Abort is signaled
 * via a separate channel.
 *
 * Key invariant: the bridge is best-effort live push. Late/reconnecting
 * clients recover from the store.
 */
import Redis from "ioredis";
import type { RedisOptions } from "ioredis";
import type {
  StreamBridge,
  StreamPublisher,
  StreamSubscriber,
  StreamEvent,
  ExecutionResult,
} from "@flow-state-dev/server";

export interface CreateRedisStreamBridgeOptions {
  /** ioredis connection (URL string or options object). */
  connection: string | RedisOptions;
  /** Redis channel prefix. Default "fsd:stream". */
  channelPrefix?: string;
}

const DEFAULT_CHANNEL_PREFIX = "fsd:stream";

/**
 * Creates a Redis pub/sub StreamBridge. Each requestId gets its own
 * channel pair: one for events and one for abort signals.
 */
export function createRedisStreamBridge(
  options: CreateRedisStreamBridgeOptions
): StreamBridge {
  const channelPrefix = options.channelPrefix ?? DEFAULT_CHANNEL_PREFIX;
  const connOpts = options.connection;

  function eventChannel(requestId: string) {
    return `${channelPrefix}:${requestId}`;
  }
  function abortChannel(requestId: string) {
    return `${channelPrefix}:abort:${requestId}`;
  }

  function createRedisClient(): Redis {
    if (typeof connOpts === "string") {
      return new Redis(connOpts);
    }
    return new Redis(connOpts);
  }

  return {
    createPublisher(requestId: string): StreamPublisher {
      const pub = createRedisClient();
      const channel = eventChannel(requestId);
      let closed = false;

      return {
        async publishEvent(event: StreamEvent) {
          if (closed) return;
          await pub.publish(channel, JSON.stringify(event));
        },
        async publishTerminal(result: ExecutionResult) {
          if (closed) return;
          await pub.publish(
            channel,
            JSON.stringify({ event: "terminal", data: JSON.stringify(result) })
          );
        },
        async close() {
          if (closed) return;
          closed = true;
          await pub.quit();
        },
      };
    },

    createSubscriber(requestId: string): StreamSubscriber {
      const sub = createRedisClient();
      const abortPub = createRedisClient();
      const channel = eventChannel(requestId);
      const abortCh = abortChannel(requestId);
      let closed = false;

      const eventBuffer: StreamEvent[] = [];
      let pendingResolve:
        | ((value: IteratorResult<StreamEvent>) => void)
        | null = null;
      let terminalResult: ExecutionResult | undefined;
      let terminalResolve: ((result: ExecutionResult) => void) | undefined;
      const completedPromise = new Promise<ExecutionResult>((res) => {
        terminalResolve = res;
      });

      sub.subscribe(channel, abortCh);
      sub.on("message", (_ch: string, message: string) => {
        try {
          const parsed = JSON.parse(message) as StreamEvent;
          if (parsed.event === "terminal") {
            terminalResult = JSON.parse(parsed.data) as ExecutionResult;
            terminalResolve?.(terminalResult);
            // Signal end of iteration
            if (pendingResolve) {
              pendingResolve({ value: undefined as never, done: true });
              pendingResolve = null;
            }
            return;
          }
          if (pendingResolve) {
            pendingResolve({ value: parsed, done: false });
            pendingResolve = null;
          } else {
            eventBuffer.push(parsed);
          }
        } catch {
          // Ignore malformed messages
        }
      });

      return {
        events(): AsyncIterable<StreamEvent> {
          return {
            [Symbol.asyncIterator]() {
              return {
                next(): Promise<IteratorResult<StreamEvent>> {
                  if (
                    terminalResult !== undefined &&
                    eventBuffer.length === 0
                  ) {
                    return Promise.resolve({
                      value: undefined as never,
                      done: true,
                    });
                  }
                  if (eventBuffer.length > 0) {
                    return Promise.resolve({
                      value: eventBuffer.shift()!,
                      done: false,
                    });
                  }
                  return new Promise<IteratorResult<StreamEvent>>((res) => {
                    pendingResolve = res;
                  });
                },
              };
            },
          };
        },
        completed: completedPromise,
        abort() {
          abortPub.publish(abortCh, "abort").catch(() => {});
        },
        async close() {
          if (closed) return;
          closed = true;
          await sub.unsubscribe(channel, abortCh);
          await sub.quit();
          await abortPub.quit();
        },
      };
    },
  };
}
