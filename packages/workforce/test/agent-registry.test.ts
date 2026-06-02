import { describe, it, expect } from "vitest";
import { createAgentRegistry } from "../src/agent-registry";
import { defineAgent } from "../src/define-agent";

function makeAgent(name: string, persona = "You are a helpful assistant.") {
  return defineAgent({ name, description: `${name} agent`, persona });
}

describe("createAgentRegistry", () => {
  it("get returns a registered agent", async () => {
    const agent = makeAgent("researcher");
    const registry = createAgentRegistry([agent]);
    const found = await registry.get("researcher");
    expect(found).toBe(agent);
  });

  it("get returns undefined for an unknown name", async () => {
    const registry = createAgentRegistry([makeAgent("a")]);
    expect(await registry.get("unknown")).toBeUndefined();
  });

  it("list returns all registered agents", async () => {
    const agents = [makeAgent("a"), makeAgent("b"), makeAgent("c")];
    const registry = createAgentRegistry(agents);
    expect(await registry.list()).toEqual(agents);
  });

  it("throws on duplicate agent name", () => {
    expect(() =>
      createAgentRegistry([makeAgent("dup"), makeAgent("dup")]),
    ).toThrow('duplicate agent name "dup"');
  });
});

describe("defineAgent", () => {
  it("returns a valid Agent with a bare-string persona", () => {
    const agent = defineAgent({
      name: "analyst",
      description: "Analyzes data",
      persona: "You are a data analyst.",
    });
    expect(agent.name).toBe("analyst");
    expect(agent.persona).toBe("You are a data analyst.");
  });

  it("rejects an empty name", () => {
    expect(() =>
      defineAgent({ name: "", description: "d", persona: "p" }),
    ).toThrow("name must be a non-empty string");
  });

  it("rejects an empty bare-string persona", () => {
    expect(() =>
      defineAgent({ name: "a", description: "d", persona: "  " }),
    ).toThrow("bare-string persona must be non-empty");
  });

  it("accepts a path-based persona", () => {
    const agent = defineAgent({
      name: "a",
      description: "d",
      persona: { path: "personas/analyst" },
    });
    expect(agent.persona).toEqual({ path: "personas/analyst" });
  });

  it("accepts an inline template persona", () => {
    const agent = defineAgent({
      name: "a",
      description: "d",
      persona: { template: "Hello {{ state.name }}", state: { name: "world" } },
    });
    expect(agent.persona).toEqual({
      template: "Hello {{ state.name }}",
      state: { name: "world" },
    });
  });

  it("rejects an empty path-based persona", () => {
    expect(() =>
      defineAgent({ name: "a", description: "d", persona: { path: "" } }),
    ).toThrow("path-based persona must have a non-empty path");
  });

  it("rejects an empty inline template persona", () => {
    expect(() =>
      defineAgent({ name: "a", description: "d", persona: { template: "  " } }),
    ).toThrow("inline template persona must have a non-empty template");
  });
});
