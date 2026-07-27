/**
 * Unit coverage for the internal `RuntimeConfig` bundle factory (FIX-696).
 *
 * `createRuntimeConfig` is the single construction point for the instance-level
 * options forwarded through the server execution chain. These tests pin its two
 * guarantees: an empty input yields an all-optional (fully `undefined`) shape,
 * and a partial input is preserved field-for-field.
 */
import { describe, expect, it } from "vitest";
import { createRuntimeConfig } from "../src/runtime-config";

describe("createRuntimeConfig", () => {
  it("produces a fully-optional shape from an empty input", () => {
    const config = createRuntimeConfig({});

    expect(config).toEqual({
      modelResolver: undefined,
      speechResolver: undefined,
      transcriptionResolver: undefined,
      settings: undefined,
      logger: undefined,
      tracingLevel: undefined,
      maxResponseBufferSize: undefined,
      defaultSseHeartbeatMs: undefined,
      onBackgroundWork: undefined
    });
  });

  it("preserves the fields present in a partial input", () => {
    const modelResolver = () => ({}) as never;
    const settings = { feature: true };

    const config = createRuntimeConfig({
      modelResolver,
      settings,
      tracingLevel: "verbose",
      defaultSseHeartbeatMs: 5_000
    });

    expect(config.modelResolver).toBe(modelResolver);
    expect(config.settings).toBe(settings);
    expect(config.tracingLevel).toBe("verbose");
    expect(config.defaultSseHeartbeatMs).toBe(5_000);
    // Unset fields remain undefined.
    expect(config.speechResolver).toBeUndefined();
    expect(config.logger).toBeUndefined();
  });
});
