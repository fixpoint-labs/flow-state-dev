/**
 * Dedup-logic test for the streaming-vs-batch race in `useVoice` (FIX-523).
 *
 * The hook keeps a `(itemId, contentIndex)` set written EAGERLY (before any
 * async work) in the `onContentAudioDelta` handler. The batch-path
 * `session.items` scanner consults the set and skips any
 * `OutputAudioContent` whose key it contains, so a streamed turn doesn't
 * double-play when the final `content.added` snapshot arrives.
 *
 * Rendering the real hook would require @testing-library/react, which is
 * not a dependency of this package. Instead we model the two execution
 * paths as plain functions sharing a Set, and assert the desired
 * invariant: under the streaming-then-snapshot order, the player receives
 * chunks and does NOT receive a whole-buffer enqueue for the same
 * (itemId, contentIndex).
 */
import { describe, expect, it } from "vitest";

type FakePlayerCall =
  | { kind: "chunk"; itemId: string; contentIndex: number }
  | { kind: "whole"; itemId: string; contentIndex: number };

type FakeMessageItem = {
  id: string;
  type: "message";
  role: "assistant";
  content: Array<{ type: "output_audio"; audio: string; mediaType: string }>;
};

function createScenario() {
  const calls: FakePlayerCall[] = [];
  const streamingAudioParts = new Set<string>();

  function onContentAudioDelta(event: {
    itemId: string;
    contentIndex: number;
  }): void {
    // EAGER write — must happen before any await, so the batch-path scanner
    // never observes an OutputAudioContent without its dedup entry.
    streamingAudioParts.add(`${event.itemId}:${event.contentIndex}`);
    calls.push({ kind: "chunk", itemId: event.itemId, contentIndex: event.contentIndex });
  }

  function scanItems(items: FakeMessageItem[]): void {
    for (const item of items) {
      if (item.type !== "message") continue;
      if (item.role !== "assistant") continue;
      for (let i = 0; i < item.content.length; i++) {
        const part = item.content[i];
        if (part?.type !== "output_audio") continue;

        const streamKey = `${item.id}:${i}`;
        if (streamingAudioParts.has(streamKey)) continue;

        calls.push({ kind: "whole", itemId: item.id, contentIndex: i });
      }
    }
  }

  return { calls, onContentAudioDelta, scanItems };
}

describe("FIX-523 — useVoice dedup", () => {
  it("streaming chunks suppress the batch-path whole-buffer enqueue for the same content part", () => {
    const { calls, onContentAudioDelta, scanItems } = createScenario();

    // Streaming path fires first (chunks arrive on the wire).
    onContentAudioDelta({ itemId: "msg_0", contentIndex: 0 });
    onContentAudioDelta({ itemId: "msg_0", contentIndex: 0 });

    // Then the pipeline emits the final OutputAudioContent snapshot via
    // content.added — the batch scanner sees it on the next render.
    scanItems([
      {
        id: "msg_0",
        type: "message",
        role: "assistant",
        content: [{ type: "output_audio", audio: "AQID", mediaType: "audio/mpeg" }]
      }
    ]);

    expect(calls.filter((c) => c.kind === "chunk")).toHaveLength(2);
    expect(calls.filter((c) => c.kind === "whole")).toHaveLength(0);
  });

  it("batch-only providers still get the whole-buffer enqueue (no chunks ever arrived)", () => {
    const { calls, scanItems } = createScenario();

    scanItems([
      {
        id: "msg_0",
        type: "message",
        role: "assistant",
        content: [{ type: "output_audio", audio: "AQID", mediaType: "audio/mpeg" }]
      }
    ]);

    expect(calls).toEqual([{ kind: "whole", itemId: "msg_0", contentIndex: 0 }]);
  });

  it("dedup is keyed per (itemId, contentIndex) — independent parts are not affected", () => {
    const { calls, onContentAudioDelta, scanItems } = createScenario();

    onContentAudioDelta({ itemId: "msg_0", contentIndex: 0 });

    scanItems([
      {
        id: "msg_0",
        type: "message",
        role: "assistant",
        content: [
          { type: "output_audio", audio: "AQID", mediaType: "audio/mpeg" },
          { type: "output_audio", audio: "BAUG", mediaType: "audio/mpeg" }
        ]
      }
    ]);

    // Part 0 streamed → suppressed. Part 1 did not → batch-path plays it.
    expect(calls).toEqual([
      { kind: "chunk", itemId: "msg_0", contentIndex: 0 },
      { kind: "whole", itemId: "msg_0", contentIndex: 1 }
    ]);
  });
});
