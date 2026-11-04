import { describe, expect, it } from "vitest";
import { topic } from "../src";

describe("wire topics", () => {
  it("name a session by its id, and the caller's user and org by nothing", () => {
    expect(topic.session("s1")).toEqual({ scope: "session", id: "s1" });
    // No id: the server fills the user and org from the caller it verified,
    // so a client cannot ask for someone else's scope by naming it.
    expect(topic.user()).toEqual({ scope: "user" });
    expect(topic.org()).toEqual({ scope: "org" });
    expect(Object.keys(topic.user())).not.toContain("id");
  });

  it("narrow to one resource under the scope", () => {
    expect(topic.session("s1", { resource: "tasks" })).toEqual({ scope: "session", id: "s1", resource: "tasks" });
    expect(topic.org({ resource: "roster" })).toEqual({ scope: "org", resource: "roster" });
  });
});
