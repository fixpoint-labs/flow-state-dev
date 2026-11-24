// FIX-2675.
/**
 * `continueWithoutReader`: a continuation started by a caller that
 * never reads its live stream (the durability sweeper, a wait's resume, a
 * parked stop) must not hold the run's events in that stream.
 */
import { describe, expect, it } from "vitest";
import { continueWithoutReader } from "../../src/execution/request-continuation";
import { createLiveRequestStream } from "../../src/streaming/live-stream";

describe("continueWithoutReader", () => {
  it("returns the continuation with its live stream holding none of the run's events", async () => {
    const liveStream = createLiveRequestStream({ requestId: "req_swept" });
    const finished = new Promise<never>(() => {});
    const continueRequest = continueWithoutReader(async (_options: { requestId: string }) => ({
      requestId: "req_swept",
      liveStream,
      finished
    }));

    const result = await continueRequest({ requestId: "req_swept" });
    expect(result.requestId).toBe("req_swept");
    expect(result.finished).toBe(finished);

    // The run goes on emitting; its events reach the emitter, not the stream.
    await liveStream.emitter.emitRequestCreated();
    expect(liveStream.emitter.getEvents()).toHaveLength(1);
    expect(await new Response(liveStream.readable).text()).toBe("");
  });
});
