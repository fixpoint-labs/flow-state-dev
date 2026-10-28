/**
 * What Codex mode's New session offers, read off the real Codex program: its
 * app-server's `model/list` over a fresh Codex home. No network is needed:
 * signed out, Codex answers from the catalog it ships with.
 *
 * It matters because the picker is Codex's own list for the sign-in a run
 * gets, so it can only be checked against what the real program answers.
 */
import { mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { listCodexModels } from "@flow-state-dev/codex";

import { codexModelChoices } from "@/lib/codex-mode";

let home: string;

beforeAll(() => {
  home = realpathSync(mkdtempSync(join(tmpdir(), "ks-codex-models-")));
});

afterAll(() => {
  rmSync(home, { recursive: true, force: true });
});

// A cold first start of the Codex program can take seconds, as in `codex-mode.test.ts`.
describe("Codex mode's model list, on the real Codex program", { timeout: 30_000 }, () => {
  it("offers Codex's own models, its default preselected and listed first", async () => {
    const choices = await codexModelChoices((env) => listCodexModels({ env: { ...env, HOME: home, CODEX_HOME: home } }));
    expect(choices.reason).toBeNull();
    expect(choices.models.length).toBeGreaterThan(1);
    expect(choices.defaultId).toBe(choices.models[0]!.id);
    // Each model under the id a run takes and Codex's name for it.
    for (const model of choices.models) {
      expect(model.id).toMatch(/^[a-z0-9][a-z0-9.-]*$/);
      expect(model.label).not.toBe("");
    }
  });
});
