/**
 * A generator model whose every call first passes its messages through the
 * run's `ModelResolver.prepareMessages`: the person's files, held as
 * references everywhere a run records its conversation, become bytes only in
 * the request that goes to the provider.
 */
import type { AttachmentAccepts } from "../attachments";
import type { GeneratorModel, GeneratorModelCallOptions } from "../types/model";

/** A run's message preparation: files by reference in, the parts the target reads out. */
export type PrepareMessages = (messages: unknown[], target?: { accepts: AttachmentAccepts }) => Promise<unknown[]>;

/**
 * Set on a model that tries several candidates (a fallback group): it returns
 * a copy of itself that prepares each candidate's call for that candidate's
 * own provider, so the one a call falls back to is not handed messages built
 * for another.
 */
export const PREPARE_EACH_CANDIDATE = Symbol.for("fsd.prepareEachCandidate");

type PreparesEachCandidate = { [PREPARE_EACH_CANDIDATE]?: (prepare: PrepareMessages) => GeneratorModel };

const CALLS = new Set(["generate", "stream", "generateStep", "streamStep"]);

/**
 * `model`, with `prepare` applied to the messages of each call it makes
 * (`generate`, `stream`, `generateStep`, `streamStep`). Every other property
 * reads through unchanged. `prepare` undefined returns `model` itself.
 * `accepts`, what the model's provider reads as files, is passed to each
 * call's `prepare`; left out, the call names no target. A fallback group
 * ignores `accepts` and prepares each candidate for its own provider.
 */
export function withPreparedMessages(
  model: GeneratorModel,
  prepare: PrepareMessages | undefined,
  accepts?: AttachmentAccepts
): GeneratorModel {
  if (prepare === undefined) return model;
  const eachCandidate = (model as PreparesEachCandidate)[PREPARE_EACH_CANDIDATE];
  if (eachCandidate !== undefined) return eachCandidate(prepare);
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
