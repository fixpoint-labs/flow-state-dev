/**
 * What an action form starts with, and so what it sends untouched.
 *
 * An optional choice must start empty: the board's `updateTask` refuses an
 * answer sent with a status, so a form that pre-picked the first status for
 * every optional choice could never answer a question from a task row.
 */
import { describe, expect, it } from "vitest";
import type { ActionInputSchema } from "@flow-state-dev/client";
import { buildInputFromForm, getDefaults } from "../src/react/components/workspace/action-bar";

const schema = {
  type: "object",
  fields: {
    id: { type: "string", required: true },
    message: { type: "string", required: false },
    status: { type: "enum", required: false, enumValues: ["pending", "cancelled"] },
    mode: { type: "enum", required: true, enumValues: ["fast", "slow"] },
  },
} as unknown as ActionInputSchema;

describe("an action form's starting values", () => {
  it("leaves an optional choice unpicked, and sends nothing for it", () => {
    const defaults = getDefaults(schema);

    expect(defaults).not.toHaveProperty("status");
    const sent = buildInputFromForm(schema, { ...defaults, id: "t1", message: "eu-west" }) as Record<string, unknown>;
    expect(sent).not.toHaveProperty("status");
    expect(sent).toMatchObject({ id: "t1", message: "eu-west" });
  });

  it("still starts a required choice on its first value", () => {
    expect(getDefaults(schema)).toMatchObject({ mode: "fast" });
  });
});
