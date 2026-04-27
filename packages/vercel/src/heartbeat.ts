/**
 * SSE heartbeat injection for long-lived streams.
 *
 * Wraps a ReadableStream to inject periodic SSE comment frames (`: ping\n\n`)
 * that keep intermediate proxies and load balancers from closing idle connections.
 */

const encoder = new TextEncoder();
const PING_FRAME = encoder.encode(": ping\n\n");

/**
 * Wraps an SSE ReadableStream to inject periodic heartbeat comments.
 *
 * The heartbeat timer runs independently of data flow — it fires even during
 * long pauses between events (e.g. while an LLM is thinking). When the source
 * stream closes or the consumer cancels, the timer is cleaned up.
 */
export function injectHeartbeat(
  stream: ReadableStream<Uint8Array>,
  intervalMs: number
): ReadableStream<Uint8Array> {
  const reader = stream.getReader();
  let timer: ReturnType<typeof setInterval> | undefined;
  let done = false;

  function cleanup(): void {
    done = true;
    if (timer !== undefined) {
      clearInterval(timer);
      timer = undefined;
    }
  }

  return new ReadableStream<Uint8Array>({
    start(controller) {
      // Heartbeat timer — fires independently of data flow.
      timer = setInterval(() => {
        if (done) return;
        try {
          controller.enqueue(PING_FRAME);
        } catch {
          // Controller closed (client disconnected). Clean up.
          cleanup();
        }
      }, intervalMs);

      // Pump source stream data into this stream.
      void (async () => {
        try {
          for (;;) {
            const result = await reader.read();
            if (result.done || done) break;
            controller.enqueue(result.value);
          }
        } catch (err) {
          if (!done) {
            try {
              controller.error(err);
            } catch {
              // Already errored or closed.
            }
          }
        } finally {
          cleanup();
          try {
            controller.close();
          } catch {
            // Already closed.
          }
        }
      })();
    },

    cancel() {
      cleanup();
      reader.cancel().catch(() => {});
    }
  });
}
