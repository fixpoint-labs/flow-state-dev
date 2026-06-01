import { describe, it, expect } from "vitest";
import { renderContent } from "../src/resources/internal";
import { parseResourceTemplate } from "@flow-state-dev/core/resource-template";
import type { ResourceConfig, ResourceCollectionConfig } from "@flow-state-dev/core/types";

describe("renderContent with template fields", () => {
  const template = parseResourceTemplate(
    `<system>You are {{ state.name }}, a {{ state.role }}.</system>`
  );

  it("renders static contentTemplate against state", async () => {
    const config: Partial<ResourceConfig> = {
      scope: "session",
      contentTemplate: template,
    };
    const result = await renderContent(
      config as ResourceConfig,
      undefined,
      { name: "Alice", role: "analyst" }
    );
    expect(result).toBe("You are Alice, a analyst.");
  });

  it("renders contentTemplateRef via pre-resolved templateRaw", async () => {
    const config: Partial<ResourceConfig> = {
      scope: "session",
      contentTemplateRef: "templates/persona",
    };
    const templateRaw = `<system>Hello {{ state.greeting }}</system>`;
    const result = await renderContent(
      config as ResourceConfig,
      undefined,
      { greeting: "world" },
      templateRaw
    );
    expect(result).toBe("Hello world");
  });

  it("returns null when templateRaw is undefined for contentTemplateRef", async () => {
    const config: Partial<ResourceConfig> = {
      scope: "session",
      contentTemplateRef: "templates/missing",
    };
    const result = await renderContent(
      config as ResourceConfig,
      undefined,
      { greeting: "world" },
      undefined
    );
    expect(result).toBeNull();
  });

  it("still renders via render hook for non-template resources", async () => {
    const config: Partial<ResourceConfig> = {
      scope: "session",
      render: (content, state) => `Rendered: ${content} for ${(state as any).name}`,
    };
    const result = await renderContent(
      config as ResourceConfig,
      "raw content",
      { name: "Bob" }
    );
    expect(result).toBe("Rendered: raw content for Bob");
  });

  it("returns raw content when no render/template is configured", async () => {
    const config: Partial<ResourceConfig> = { scope: "session" };
    const result = await renderContent(
      config as ResourceConfig,
      "just raw",
      {}
    );
    expect(result).toBe("just raw");
  });

  it("works with collection config contentTemplate", async () => {
    const config: Partial<ResourceCollectionConfig> = {
      pattern: "personas/*",
      scope: "session",
      contentTemplate: template,
    };
    const result = await renderContent(
      config as ResourceCollectionConfig,
      undefined,
      { name: "Charlie", role: "engineer" }
    );
    expect(result).toBe("You are Charlie, a engineer.");
  });

  it("skips template branch when contentTemplate is an unresolved string path", async () => {
    const config: Partial<ResourceConfig> = {
      scope: "session",
      contentTemplate: "./templates/persona.md" as any,
    };
    const result = await renderContent(
      config as ResourceConfig,
      "fallback raw",
      { name: "Dave" }
    );
    expect(result).toBe("fallback raw");
  });
});
