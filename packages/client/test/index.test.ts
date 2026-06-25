import { describe, expect, it } from "vitest";
import {
  clientPackageMarker,
  createClient,
  createTypedClient,
  createSessionClient,
  createSSEClient,
  createUserSSEClient,
  createRequestStreamStore,
  bindStoreToCallbacks,
  compareItemOrder,
  ClientHttpError
} from "../src";

describe("@flow-state-dev/client", () => {
  it("exports scaffold marker", () => {
    expect(clientPackageMarker).toBe("@flow-state-dev/client");
  });

  it("exports client runtime primitives", () => {
    expect(typeof createClient).toBe("function");
    expect(typeof createTypedClient).toBe("function");
    expect(typeof createSessionClient).toBe("function");
    expect(typeof createSSEClient).toBe("function");
    expect(typeof createUserSSEClient).toBe("function");
    expect(typeof ClientHttpError).toBe("function");
  });

  it("exports the shared request-stream store and binder", () => {
    expect(typeof createRequestStreamStore).toBe("function");
    expect(typeof bindStoreToCallbacks).toBe("function");
    expect(typeof compareItemOrder).toBe("function");
  });
});
