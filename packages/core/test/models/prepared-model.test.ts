/**
 * A generator model's calls read the person's files through the run's
 * `prepareMessages`, on every call shape, while the messages the caller
 * holds (and records) are left as they were.
 */
import { describe, expect, it } from "vitest";
import { withPreparedMessages } from "../../src/models/prepared-model";
import type { GeneratorModel, GeneratorModelCallOptions } from "../../src/types/model";

const prepare = async (messages: unknown[]) => messages.map((m) => ({ ...(m as object), prepared: true }));

function recording() {
  const seen: unknown[][] = [];
  const model: GeneratorModel = {
    modelId: "m",
    async generate(options) {
      seen.push(options.messages);
      return { text: "g" };
    },
    async *stream(options) {
      seen.push(options.messages);
      yield { type: "text-delta", textDelta: "s" } as never;
    },
    async generateStep(options) {
      seen.push(options.messages);
      return { text: "gs" };
    },
    async *streamStep(options) {
      seen.push(options.messages);
      yield { type: "text-delta", textDelta: "ss" } as never;
    }
  };
  return { model, seen };
}

describe("withPreparedMessages", () => {
  it("prepares the messages of generate, stream, generateStep and streamStep", async () => {
    const { model, seen } = recording();
    const wrapped = withPreparedMessages(model, prepare);
    const options: GeneratorModelCallOptions = { messages: [{ role: "user", content: "hi" }] };

    expect(await wrapped.generate(options)).toEqual({ text: "g" });
    for await (const _ of wrapped.stream!(options)) void _;
    await wrapped.generateStep!(options);
    for await (const _ of wrapped.streamStep!(options)) void _;

    expect(seen).toHaveLength(4);
    for (const messages of seen) expect(messages).toEqual([{ role: "user", content: "hi", prepared: true }]);
    // The caller's messages, which a run records, are untouched.
    expect(options.messages).toEqual([{ role: "user", content: "hi" }]);
    expect(wrapped.modelId).toBe("m");
  });

  it("keeps a model without a call shape without it, and returns the model itself with nothing to prepare", () => {
    const { model } = recording();
    const bare: GeneratorModel = { modelId: "b", generate: model.generate };
    expect(withPreparedMessages(bare, prepare).generateStep).toBeUndefined();
    expect(withPreparedMessages(model, undefined)).toBe(model);
  });
});
