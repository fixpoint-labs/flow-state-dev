/**
 * The approval pieces a flow composes (FIX-2389): what a held call is, the
 * grant rule, the stop it waits on, and what its answer means for the run.
 */
import { describe, expect, it } from "vitest";
import {
  ALLOW_FOR_RUN,
  grantMatches,
  heldToolCallOf,
  heldToolDecision,
  toolApprovalOutcome,
  toolApprovalStop,
  toolApprovalYesSchema,
} from "../src/tool-approval";

const CWD = "/work/run-1";

describe("a held tool call", () => {
  it("names the command or file the call touches, by the progress note's keys", () => {
    expect(heldToolCallOf({ toolName: "Bash", input: { command: "touch marker", description: "x" } }, CWD)).toEqual({
      toolName: "Bash",
      touches: "touch marker",
      key: "touch marker",
      cwd: CWD,
    });
    expect(heldToolCallOf({ toolName: "Edit", input: { file_path: "src/a.ts", old_string: "a" } }, CWD).touches).toBe("src/a.ts");
  });

  it("keys a call that names neither by its whole arguments, in a stable order", () => {
    const a = heldToolCallOf({ toolName: "Fetchy", input: { b: 1, a: 2 } }, CWD);
    const b = heldToolCallOf({ toolName: "Fetchy", input: { a: 2, b: 1 } }, CWD);
    expect(a.touches).toBeNull();
    expect(a.key).toBe(b.key);
    expect(a.key).not.toBe(heldToolCallOf({ toolName: "Fetchy", input: { a: 3, b: 1 } }, CWD).key);
  });

  it("is held, not denied: the decision stops the call for a person", () => {
    expect(heldToolDecision(heldToolCallOf({ toolName: "Bash", input: { command: "ls" } }, CWD))).toMatchObject({ decision: "held" });
  });
});

describe("the grant rule: the same tool with the same command or file", () => {
  const call = heldToolCallOf({ toolName: "Bash", input: { command: "pnpm test" } }, CWD);
  const grant = { toolName: "Bash", key: call.key };

  it("lets the same call through", () => {
    expect(grantMatches(grant, heldToolCallOf({ toolName: "Bash", input: { command: "pnpm test" } }, CWD))).toBe(true);
  });

  it("asks again for another command of the same tool: a grant never covers the tool alone", () => {
    expect(grantMatches(grant, heldToolCallOf({ toolName: "Bash", input: { command: "pnpm test -- foo" } }, CWD))).toBe(false);
  });

  it("asks again for another tool on the same thing", () => {
    const edit = heldToolCallOf({ toolName: "Write", input: { file_path: "pnpm test" } }, CWD);
    expect(grantMatches(grant, edit)).toBe(false);
  });
});

describe("the stop a held call waits on", () => {
  const call = heldToolCallOf({ toolName: "Bash", input: { command: "touch marker" } }, CWD);
  const stop = toolApprovalStop(call);

  it("is an approval naming the tool, the command and the folder, with Allow for this run as an extra yes", () => {
    expect(stop.kind).toBe("approval");
    expect(stop.prompt).toContain("Bash");
    expect(stop.prompt).toContain("touch marker");
    expect(stop.prompt).toContain(CWD);
    expect(stop.data).toEqual({ tool: "Bash", touches: "touch marker", cwd: CWD, approveOptions: [ALLOW_FOR_RUN] });
  });

  it("takes only the run scope as a yes's data", () => {
    expect(toolApprovalYesSchema.safeParse(ALLOW_FOR_RUN.data).success).toBe(true);
    expect(toolApprovalYesSchema.safeParse({ scope: "tool" }).success).toBe(false);
  });
});

describe("what an answer means for the run", () => {
  const call = heldToolCallOf({ toolName: "Bash", input: { command: "touch marker" } }, CWD);

  it("grants a plain yes once, and tells the session to make the call again", () => {
    const out = toolApprovalOutcome({ cancelled: false, approved: true }, call);
    expect(out.grant).toEqual({ toolName: "Bash", key: "touch marker", scope: "once" });
    expect(out.prompt).toContain("Make the call again");
  });

  it("grants Allow for this run for the run", () => {
    expect(toolApprovalOutcome({ cancelled: false, approved: true, answer: ALLOW_FOR_RUN.data }, call).grant?.scope).toBe("run");
  });

  it("grants nothing on a no, and carries the person's note", () => {
    const out = toolApprovalOutcome({ cancelled: false, approved: false, deadline: false, answer: { note: "not on main" } }, call);
    expect(out.grant).toBeNull();
    expect(out.prompt).toContain("did not allow");
    expect(out.prompt).toContain("not on main");
  });

  it("reads nobody answering by the deadline as a no", () => {
    const out = toolApprovalOutcome({ cancelled: false, approved: false, deadline: true }, call);
    expect(out.grant).toBeNull();
    expect(out.prompt).toContain("in time");
  });
});
