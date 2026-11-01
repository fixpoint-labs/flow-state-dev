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

  it("covers every call of the tool on the file it named, as the stop says", () => {
    const allowed = heldToolCallOf({ toolName: "Edit", input: { file_path: "src/a.ts", old_string: "a", new_string: "b" } }, CWD);
    const next = heldToolCallOf({ toolName: "Edit", input: { file_path: "src/a.ts", old_string: "b", new_string: "c" } }, CWD);
    expect(grantMatches({ toolName: "Edit", key: allowed.key }, next)).toBe(true);
    expect(grantMatches({ toolName: "Edit", key: allowed.key }, heldToolCallOf({ toolName: "Edit", input: { file_path: "src/b.ts" } }, CWD))).toBe(false);
  });

  it("asks again for the same query with other arguments: a query is not a reach", () => {
    const tool = "mcp__docs__search";
    const allowed = heldToolCallOf({ toolName: tool, input: { query: "grants", mode: "read" } }, CWD);
    expect(allowed.touches).toBe("grants");
    const grantQuery = { toolName: tool, key: allowed.key };
    expect(grantMatches(grantQuery, heldToolCallOf({ toolName: tool, input: { mode: "read", query: "grants" } }, CWD))).toBe(true);
    expect(grantMatches(grantQuery, heldToolCallOf({ toolName: tool, input: { query: "grants", mode: "write" } }, CWD))).toBe(false);
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

  it("says how far Allow for this run reaches: the file or command, else this exact call", () => {
    expect(stop.prompt).toContain("Allow for this run lets every **Bash** call on `touch marker` through");
    const edit = toolApprovalStop(heldToolCallOf({ toolName: "Edit", input: { file_path: "src/a.ts", new_string: "x" } }, CWD));
    expect(edit.prompt).toContain("Allow for this run lets every **Edit** call on `src/a.ts` through");
    const search = toolApprovalStop(heldToolCallOf({ toolName: "mcp__docs__search", input: { query: "grants", mode: "read" } }, CWD));
    expect(search.prompt).toContain("Allow for this run lets this exact call through again");
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
