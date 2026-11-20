// @vitest-environment happy-dom
/**
 * Jump to's documents (FIX-2775): read from each listed flow's manifest, and
 * read again when a flow appears in the session list. While that read is out
 * the section is unread, never the previous flow set's documents, which would
 * leave out the new flow's as if it served none.
 *
 * The client's manifest reads and the session list are the test's; the hook is
 * the app's.
 */
import { renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

const doc = (ref: string) => ({ kind: "single", ref, client: { content: { read: true } } });
/** Each flow's manifest; a flow whose answer is held resolves when the test says. */
const manifests: Record<string, Promise<{ resources: unknown[] }>> = {};
const client = {
  userId: "u_1",
  resources: { getResourceManifest: (sessionId: string) => manifests[sessionId.replace(/^s-/, "")]! },
};
vi.mock("../src/lib/lab-data", () => ({ useLab: () => ({ client }) }));
let listed: Array<{ id: string; flowKind: string; flowId?: string }> = [];
vi.mock("../src/lib/directory", () => ({ useSessions: () => ({ list: listed, failure: undefined, refresh: () => {} }) }));

import { useDocuments } from "../src/lib/documents";

describe("Jump to's documents", () => {
  it("are unread while a new flow's manifest is read, then list every flow's", async () => {
    manifests.alpha = Promise.resolve({ resources: [doc("alpha-notes")] });
    listed = [{ id: "s-alpha", flowKind: "alpha" }];
    const { result, rerender } = renderHook(() => useDocuments());
    await waitFor(() => expect(result.current).toEqual({ ok: true, value: [{ ref: "alpha-notes", sessionId: "s-alpha" }] }));

    let answerBeta!: (manifest: { resources: unknown[] }) => void;
    manifests.beta = new Promise((resolve) => (answerBeta = resolve));
    listed = [...listed, { id: "s-beta", flowKind: "beta" }];
    rerender();
    expect(result.current).toBeUndefined();

    answerBeta({ resources: [doc("beta-notes")] });
    await waitFor(() =>
      expect(result.current).toEqual({
        ok: true,
        value: [
          { ref: "alpha-notes", sessionId: "s-alpha" },
          { ref: "beta-notes", sessionId: "s-beta" },
        ],
      }),
    );
  });

  it("move to another session of the same flow when the one they were read through is deleted", async () => {
    manifests.gamma = Promise.resolve({ resources: [doc("gamma-notes")] });
    listed = [
      { id: "s-gamma", flowKind: "gamma" },
      { id: "s-gamma-2", flowKind: "gamma" },
    ];
    const { result, rerender } = renderHook(() => useDocuments());
    await waitFor(() => expect(result.current).toEqual({ ok: true, value: [{ ref: "gamma-notes", sessionId: "s-gamma" }] }));

    // The same flow set, but the session the document was addressed through is gone: opening it
    // through that id would be a dead link.
    listed = [{ id: "s-gamma-2", flowKind: "gamma" }];
    rerender();
    await waitFor(() => expect(result.current).toEqual({ ok: true, value: [{ ref: "gamma-notes", sessionId: "s-gamma-2" }] }));
  });
});
