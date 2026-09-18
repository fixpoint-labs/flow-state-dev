/**
 * One-shot wrappers: input is state, output is one typed answer.
 */
import { describe, expect, it } from "vitest";
import { testBlock } from "@flow-state-dev/testing";
import { z } from "zod";
import { systemOneChoice, systemOneNoul, systemOneScore } from "../src/oneshot";
import { BILLING_RESULT, scriptedClient } from "./scripted-client";

const inputSchema = z.object({ message: z.string() });

describe("systemOne one-shots", () => {
  it("systemOneChoice unwraps the named choice answer", async () => {
    const { client, calls } = scriptedClient(BILLING_RESULT);
    const block = systemOneChoice({
      name: "department",
      inputSchema,
      instructions: "Which team?",
      criteria: { billing: "Payments", technical: "Bugs" },
      client,
    });

    const result = await testBlock(block, {
      input: { message: "charged twice" },
    });

    expect(block.kind).toBe("handler");
    expect(result.error).toBeNull();
    expect(result.output).toEqual(BILLING_RESULT.answers.department);
    expect(calls[0]?.request.state).toEqual({ message: "charged twice" });
    expect(calls[0]?.request.questions.department).toMatchObject({
      type: "choice",
      instructions: "Which team?",
    });
  });

  it("systemOneNoul unwraps the named noul answer", async () => {
    const { client } = scriptedClient(BILLING_RESULT);
    const block = systemOneNoul({
      name: "is_urgent",
      inputSchema,
      instructions: "Urgent?",
      client,
    });
    const result = await testBlock(block, {
      input: { message: "ASAP" },
    });
    expect(result.output).toEqual({ type: "noul", noul: 0.95 });
  });

  it("systemOneScore unwraps the named score answer", async () => {
    const { client } = scriptedClient(BILLING_RESULT);
    const block = systemOneScore({
      name: "frustration",
      inputSchema,
      instructions: "How frustrated?",
      criteria: ["Calm", "Frustrated", "Very angry"],
      client,
    });
    const result = await testBlock(block, {
      input: { message: "ASAP" },
    });
    expect(result.output).toEqual(BILLING_RESULT.answers.frustration);
  });
});
