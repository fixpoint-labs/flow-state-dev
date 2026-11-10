/**
 * A generator model whose every call first passes its messages through the
 * run's `ModelResolver.prepareMessages`: the person's files, held as
 * references everywhere a run records its conversation, become bytes only in
 * the request that goes to the provider.
 */
import type { AttachmentAccepts } from "../attachments";
import type { GeneratorModel, GeneratorModelCallOptions } from "../types/model";

type Prepare = (messages: unknown[], target?: { accepts: AttachmentAccepts }) => Promise<unknown[]>;

const CALLS = new Set(["generate", "stream", "generateStep", "streamStep"]);

/**
 * `model`, with `prepare` applied to the messages of each call it makes
 * (`generate`, `stream`, `generateStep`, `streamStep`). Every other property
 * reads through unchanged. `prepare` undefined returns `model` itself.
 * `accepts`, what the model's provider reads as files, is passed to each
 * call's `prepare`; left out, the call names no target.
 */
export function withPreparedMessages(model: GeneratorModel, prepare: Prepare | undefined, accepts?: AttachmentAccepts): GeneratorModel {
  if (prepare === undefined) return model;
  const named = accepts === undefined ? undefined : { accepts };
  const prepared = (messages: unknown[]) => (named === undefined ? prepare(messages) : prepare(messages, named));
  return new Proxy(model, {
    get(target, prop, receiver) {
      const value = Reflect.get(target, prop, receiver) as unknown;
      if (typeof value !== "function" || !CALLS.has(String(prop))) return value;
      const call = value as (options: GeneratorModelCallOptions) => unknown;
      if (prop === "stream" || prop === "streamStep") {
        return (options: GeneratorModelCallOptions) =>
          (async function* () {
            const messages = await prepared(options.messages);
            yield* call.call(target, { ...options, messages }) as AsyncIterable<unknown>;
          })();
      }
      return async (options: GeneratorModelCallOptions) =>
        call.call(target, { ...options, messages: await prepared(options.messages) });
    }
  });
}
