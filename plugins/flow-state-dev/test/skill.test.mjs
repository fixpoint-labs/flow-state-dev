/**
 * Sub-PR c — the install skill's rules are checkable.
 *
 * The skill is Markdown an assistant follows. There is no compiler between it
 * and the report, so these tests read the skill the way the assistant will and
 * assert the named behaviours from the spec: detection first, the allowlist,
 * the facts it acts on living on the report, the write barrier, secrets that
 * never enter the transcript, and the embedded next-steps block equalling
 * canonical through the exported comparison — never a second normalizer.
 */
import { afterAll, describe, expect, it } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { assertCanonicalNextSteps } from "@flow-state-dev/fsdev";
import { buildReport } from "../skills/install-fsd/detect/report.mjs";
import { cleanupTrees, makeTree, nextManifest } from "./helpers.mjs";

afterAll(cleanupTrees);

const skillDir = join(import.meta.dirname, "../skills/install-fsd");
const skillPath = join(skillDir, "SKILL.md");
const contractPath = join(skillDir, "wiring-contract.md");

function skillText() {
  return readFileSync(skillPath, "utf8");
}

function contractText() {
  return readFileSync(contractPath, "utf8");
}

/** The canonical next-steps copy the skill embeds, delimiters stripped. */
function embeddedNextSteps() {
  const text = skillText();
  const match = /<!-- next-steps:canonical -->\n([\s\S]*?)\n<!-- \/next-steps:canonical -->/.exec(text);
  expect(match, "SKILL.md must embed the next-steps block between next-steps:canonical markers").not.toBeNull();
  return match[1];
}

describe("the install skill exists and starts by running detection", () => {
  it("is a SKILL.md on the Claude skill spine", () => {
    expect(existsSync(skillPath)).toBe(true);
    const text = skillText();
    expect(text).toMatch(/^---\n/);
    expect(text).toMatch(/^name:\s*install-fsd/m);
    expect(text).toMatch(/^description:/m);
  });

  it("its first instruction runs the detection scripts", () => {
    const text = skillText();
    const body = text.replace(/^---[\s\S]*?---\n/, "");
    const firstCode = /```(?:bash|sh)?\n([\s\S]*?)```/.exec(body);
    expect(firstCode, "the first fenced command is how detection is invoked").not.toBeNull();
    expect(firstCode[1]).toMatch(/detect\.mjs/);
    expect(firstCode[1]).toMatch(/--json/);
  });

  it("names no fsdev init command and no plugin packaging files", () => {
    const text = skillText();
    expect(text).not.toMatch(/fsdev\s+init/);
    expect(text).not.toMatch(/plugin\.json/);
    expect(text).not.toMatch(/marketplace\.json/);
  });
});

describe("every fact the skill acts on appears in the report", () => {
  const REPORT_FACTS = [
    "host",
    "host.topology",
    "appRoot",
    "packageManager",
    "routeExtension",
    "mount",
    "routeSlots",
    "devCommand",
    "fsdevConfig",
    "secrets",
    "secretFiles",
    "ignoreFile",
    "instructionsFile",
    "refusals",
    "runtime",
    "providerKeys",
  ];

  it("names each report field, and each field exists on a real report", () => {
    const text = skillText();
    const root = makeTree({
      "package.json": nextManifest({ packageManager: "pnpm@9.0.0" }),
      "app/page.tsx": "export default function Page() { return null }\n",
    });
    const report = buildReport(root);

    for (const field of REPORT_FACTS) {
      const leaf = field.split(".").at(-1);
      expect(text, `the skill acts on ${field}`).toMatch(new RegExp(`\\b${leaf}\\b`));
      expect(report, `the report carries ${field}`).toHaveProperty(field);
    }
  });
});

describe("the instruction set names no file outside its host's allowlist", () => {
  it("enumerates seven files for next and five for node", () => {
    const text = skillText();
    const nextList = /### next \(7\)\n([\s\S]*?)(?=\n### |\n## )/.exec(text);
    const nodeList = /### node \(5\)\n([\s\S]*?)(?=\n### |\n## )/.exec(text);
    expect(nextList, "next allowlist is headed '### next (7)'").not.toBeNull();
    expect(nodeList, "node allowlist is headed '### node (5)'").not.toBeNull();

    const nextFiles = [...nextList[1].matchAll(/^[-*]\s+`([^`]+)`/gm)].map((m) => m[1]);
    const nodeFiles = [...nodeList[1].matchAll(/^[-*]\s+`([^`]+)`/gm)].map((m) => m[1]);
    expect(nextFiles).toHaveLength(7);
    expect(nodeFiles).toHaveLength(5);

    expect(nextFiles).toEqual(
      expect.arrayContaining([
        "fsdev.config.mts",
        "flows/hello/flow.mts",
        ".gitignore",
        ".env.local",
        "AGENTS.md",
      ]),
    );
    expect(nextFiles.some((f) => f.includes("appRoot") && f.includes("api/flows/route"))).toBe(true);
    expect(nextFiles.some((f) => f.includes("appRoot") && f.includes("[...path]"))).toBe(true);

    expect(nodeFiles).toEqual([
      "fsdev.config.mts",
      "flows/hello/flow.mts",
      ".gitignore",
      ".env.local",
      "AGENTS.md",
    ]);
  });

  it("the mount paths sit under the reported app root and use the reported extension", () => {
    const text = skillText();
    expect(text).toMatch(/appRoot\.path/);
    expect(text).toMatch(/routeExtension\.value/);
    expect(text).not.toMatch(/write (?:a |the )?root `app\//);
  });

  it("states which shape the host got", () => {
    const text = skillText();
    expect(text).toMatch(/mounted-route/);
    expect(text).toMatch(/second-process/);
    expect(text).toMatch(/host\.topology/);
  });

  it("writes fsdev.config.mts only when no config of any extension exists", () => {
    const text = skillText();
    expect(text).toMatch(/fsdev\.config\.mts/);
    expect(text).toMatch(/no `?fsdev\.config\.\*`/);
  });
});

describe("the write barrier and the two phases", () => {
  it("states two phases and that nothing is written in phase 1", () => {
    const text = skillText();
    expect(text).toMatch(/Phase 1/i);
    expect(text).toMatch(/Phase 2/i);
    expect(text).toMatch(/Nothing is written/i);
    expect(text).toMatch(/No refusal may originate/i);
  });

  it("refuses on a non-empty refusals array before any write", () => {
    const text = skillText();
    expect(text).toMatch(/refusals/);
    expect(text).toMatch(/stop/i);
  });
});

describe("secrets never enter the transcript", () => {
  it("never asks for, accepts, echoes, or reads back a secret value", () => {
    const text = skillText();
    expect(text).toMatch(/NEVER ask for, accept, echo or repeat/i);
    expect(text).toMatch(/never print/i);
    expect(text).toMatch(/FSD_DEMO_TOKEN/);
    expect(text).toMatch(/generate/i);
    expect(text).not.toMatch(/console\.log\(\s*token\b/);
    expect(text).not.toMatch(/console\.log\([^)]*\+\s*token\b/);
  });

  it("the generated demo token is written to the destination the report named", () => {
    const text = skillText();
    expect(text).toMatch(/secretFiles/);
    expect(text).toMatch(/FSD_DEMO_TOKEN/);
    expect(text).toMatch(/\.env\.local/);
  });
});

describe("the skill's embedded next-steps block equals canonical", () => {
  it("imports the exported comparison — the only implementation", () => {
    // This file's import of assertCanonicalNextSteps is the assertion the spec
    // names: a shipper invokes the exported comparison rather than writing one.
    expect(typeof assertCanonicalNextSteps).toBe("function");
  });

  it("equals canonical after normalization, every branch included", () => {
    expect(() => assertCanonicalNextSteps(embeddedNextSteps(), "SKILL.md")).not.toThrow();
  });

  it("fails on a copy with the second-process branch trimmed", () => {
    const trimmed = embeddedNextSteps().replace(
      /\{\{#second-process\}\}[\s\S]*?\{\{\/second-process\}\}\n/,
      "",
    );
    expect(trimmed).not.toBe(embeddedNextSteps());
    expect(() => assertCanonicalNextSteps(trimmed, "SKILL.md")).toThrow(/line \d+ differs/);
  });
});

describe("the wiring contract", () => {
  it("is skill content beside SKILL.md", () => {
    expect(existsSync(contractPath)).toBe(true);
  });

  it("covers what both entry paths share", () => {
    const text = contractText();
    expect(text).toMatch(/createNextHandler|mount pair/i);
    expect(text).toMatch(/filesystemStores/);
    expect(text).toMatch(/developmentOnly/);
    expect(text).toMatch(/modelResolver/);
    expect(text).toMatch(/createModelResolver/);
    expect(text).toMatch(/22\.18/);
    expect(text).toMatch(/zod/);
    expect(text).toMatch(/@ai-sdk\//);
    expect(text).toMatch(/@flow-state-dev\/devtool/);
    expect(text).toMatch(/FSD_DEMO_TOKEN/);
    expect(text).toMatch(/fsdev\.config\.mts/);
  });

  it("states the provider mapping as a declared contract", () => {
    const text = `${skillText()}\n${contractText()}`;
    expect(text).toMatch(/@ai-sdk\/openai/);
    expect(text).toMatch(/OPENAI_API_KEY/);
    expect(text).toMatch(/@ai-sdk\/anthropic/);
    expect(text).toMatch(/ANTHROPIC_API_KEY/);
    expect(text).toMatch(/@ai-sdk\/google/);
    expect(text).toMatch(/GOOGLE_GENERATIVE_AI_API_KEY/);
  });

  it("carries a named placeholder for the agent-instructions block and does not restate it", () => {
    const text = skillText();
    expect(text).toMatch(/\{\{AGENT_INSTRUCTIONS\}\}/);
    expect(text).toMatch(/FIX-1160/);
  });
});

describe("authored templates satisfy the contract", () => {
  const templates = join(skillDir, "templates");

  it("the config declares a development file store and a static modelResolver", () => {
    const config = readFileSync(join(templates, "fsdev.config.mts"), "utf8");
    expect(config).toMatch(/fsd:generated/);
    expect(config).toMatch(/filesystemStores/);
    expect(config).toMatch(/developmentOnly:\s*true/);
    expect(config).toMatch(/createModelResolver/);
    expect(config).toMatch(/modelResolver/);
    expect(config).toMatch(/devtool/);
    expect(config).toMatch(/FSD_DEMO_TOKEN/);
    expect(config).not.toMatch(/\bmodels\s*:/);
  });

  it("the demo flow is closed over HTTP and exposes send", () => {
    const flow = readFileSync(join(templates, "flow.mts"), "utf8");
    expect(flow).toMatch(/fsd:generated/);
    expect(flow).toMatch(/kind:\s*"hello"/);
    expect(flow).toMatch(/send/);
    expect(flow).toMatch(/createBearerSecretPrincipalResolver/);
    expect(flow).toMatch(/FSD_DEMO_TOKEN/);
    expect(flow).toMatch(/from "zod"/);
  });

  it("the mount pair uses createNextHandler and forwards the bare path", () => {
    const catchAll = readFileSync(join(templates, "route-catchall.ts"), "utf8");
    const bare = readFileSync(join(templates, "route-bare.ts"), "utf8");
    expect(catchAll).toMatch(/fsd:generated/);
    expect(bare).toMatch(/fsd:generated/);
    expect(catchAll).toMatch(/createNextHandler/);
    expect(bare).toMatch(/path:\s*\[\]/);
  });
});
