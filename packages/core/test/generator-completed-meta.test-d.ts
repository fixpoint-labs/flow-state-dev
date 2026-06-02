/**
 * Compile-time assertions for the per-kind `onCompleted` signature.
 *
 * Generator `onCompleted` receives a third `meta: GeneratorCompletedMeta`
 * argument. Handler `onCompleted` stays at 2-arg — no `meta` parameter.
 */
import type { BlockContext, GeneratorCompletedMeta, ModelIdentity } from "@flow-state-dev/core";
import { generator, handler } from "@flow-state-dev/core";

// --- Generator: 3-arg onCompleted compiles ---
generator({
  name: "gen-3-arg",
  model: "test",
  prompt: "go",
  onCompleted: async (_output: string, _ctx: BlockContext, meta: GeneratorCompletedMeta) => {
    const _model: ModelIdentity = meta.model;
    const _actual: string = meta.model.actual;
    void _model;
    void _actual;
  },
});

// --- Generator: 2-arg onCompleted still compiles (back-compat) ---
generator({
  name: "gen-2-arg",
  model: "test",
  prompt: "go",
  onCompleted: async (_output: string, _ctx: BlockContext) => {},
});

// --- Handler: 2-arg onCompleted compiles ---
handler({
  name: "handler-2-arg",
  execute: (v: string) => v,
  onCompleted: async (_output: string, _ctx: BlockContext) => {},
});

// --- GeneratorCompletedMeta.model is required (not optional) ---
type _ModelRequired = GeneratorCompletedMeta["model"];
type _AssertModelIdentity = _ModelRequired extends ModelIdentity ? true : never;
const _check: _AssertModelIdentity = true;
void _check;
