/**
 * A generator model whose every call first passes its messages through the
 * run's `ModelResolver.prepareMessages`: the person's files, held as
 * references everywhere a run records its conversation, become bytes only in
 * the request that goes to the provider.
 */
import type { GeneratorModel, GeneratorModelCallOptions } from "../types/model";

type Prepare = (messages: unknown[]) => Promise<unknown[]>;

const CALLS = new Set(["generate", "stream", "generateStep", "streamStep"]);

/**
 * `model`, with `prepare` applied to the messages of each call it makes
 * (`generate`, `stream`, `generateStep`, `streamStep`). Every other property
 * reads through unchanged. `prepare` undefined returns `model` itself.
 */
export function withPreparedMessages(model: GeneratorModel, prepare: Prepare | undefined): GeneratorModel {
  if (prepare === undefined) return model;
  return new Proxy(model, {
    get(target, prop, receiver) {
      const value = Reflect.get(target, prop, receiver) as unknown;
      if (typeof value !== "function" || !CALLS.has(String(prop))) return value;
      const call = value as (options: GeneratorModelCallOptions) => unknown;
      if (prop === "stream" || prop === "streamStep") {
        return (options: GeneratorModelCallOptions) =>
          (async function* () {
            const messages = await prepare(options.messages);
            yield* call.call(target, { ...options, messages }) as AsyncIterable<unknown>;
          })();
      }
      return async (options: GeneratorModelCallOptions) =>
        call.call(target, { ...options, messages: await prepare(options.messages) });
    }
  });
}
