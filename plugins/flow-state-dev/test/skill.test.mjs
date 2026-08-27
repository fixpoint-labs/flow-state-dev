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
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync, existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { assertCanonicalNextSteps, renderNextSteps } from "@flow-state-dev/fsdev";
import { buildReport } from "../skills/install-fsd/detect/report.mjs";
import { cleanupTrees, makeTree, nextManifest } from "./helpers.mjs";

afterAll(cleanupTrees);

const skillDir = join(import.meta.dirname, "../skills/install-fsd");
const skillPath = join(skillDir, "SKILL.md");
const contractPath = join(skillDir, "wiring-contract.md");

function skillText() {
  return readFileSync(skillPath, "utf8");
}

/** Destinations an `-e` snippet takes: after `--` when present, else skip argv[0], drop `[eval]`. */
function destsFromSnippet(snippet, argv) {
  const destsLine = /const dests = process\.argv[\s\S]*?\.filter\(\(p\) => p !== "\[eval\]"\);/.exec(snippet);
  expect(destsLine, "dests must take argv after -- and drop [eval]").not.toBeNull();
  return new Function("process", `${destsLine[0]}\nreturn dests;`)({ argv });
}

/** The body of the `-e` fence whose script contains `marker`. */
function evalSnippetContaining(marker) {
  const matches = skillText().matchAll(/node --input-type=module -e '\n([\s\S]*?)\n' -- [^\n]+/g);
  for (const match of matches) {
    if (match[1].includes(marker)) return match[1];
  }
  return null;
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
    "devCommand.needsSeparator",
    "fsdevConfig",
    "fsdevConfig.winner",
    "fsdevConfig.winnerIsOurs",
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

  it("does not print the registration line when the winning config is ours", () => {
    const text = skillText();
    expect(text).toMatch(/winnerIsOurs/);
    expect(text).toMatch(/do \*\*not\*\* print the registration line/);
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

  it("preflight refuses only authored-whole files, not existing append or secret targets", () => {
    const text = skillText();
    const preflight = /4\. \*\*PREFLIGHT[\s\S]*?(?=\n5\. )/.exec(text);
    expect(preflight, "step 4 is the allowlist preflight").not.toBeNull();
    expect(preflight[0]).toMatch(/authored-whole/);
    expect(preflight[0]).toMatch(/config, flow, and the mount pair/);
    expect(preflight[0]).toMatch(/`\.gitignore`/);
    expect(preflight[0]).toMatch(/`\.env\.local`/);
    expect(preflight[0]).toMatch(/`AGENTS\.md`/);
    expect(preflight[0]).toMatch(/does \*\*not\*\* refuse the run/);
    expect(preflight[0]).toMatch(/any other authored-whole file of theirs/);
    expect(preflight[0]).not.toMatch(/anything else of theirs/);
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
    expect(text).toMatch(/including reuse dests/);
    expect(text).toMatch(/Do not mint a second one/);
  });

  it("re-runs detection with --provider after the developer chooses one", () => {
    const text = skillText();
    expect(text).toMatch(/--provider OPENAI_API_KEY/);
    expect(text).toMatch(/ANTHROPIC_API_KEY/);
    expect(text).toMatch(/GOOGLE_GENERATIVE_AI_API_KEY/);
  });

  it("the generate-token snippet does not treat [eval] as a dest", () => {
    const text = skillText();
    const snippet = evalSnippetContaining("randomBytes");
    expect(snippet, "the generate-token -e script is extractable").not.toBeNull();
    expect(text).not.toMatch(/const dests = process\.argv\.slice\(1\)/);

    const destsFrom = (argv) => destsFromSnippet(snippet, argv);

    expect(destsFrom(["/usr/bin/node", "[eval]", "--", "/tmp/.env.local"])).toEqual([
      "/tmp/.env.local",
    ]);
    expect(destsFrom(["/usr/bin/node", "--", "/tmp/.env.local"])).toEqual(["/tmp/.env.local"]);
    expect(destsFrom(["/usr/bin/node", "[eval]"])).toEqual([]);
    expect(destsFrom(["/usr/bin/node", "/tmp/.env.local"])).toEqual(["/tmp/.env.local"]);
    expect(destsFrom(["/usr/bin/node", "[eval]", "--", "/tmp/.env.local"])).not.toContain("[eval]");
  });

  it("running the generate-token snippet writes the dest and never a file named [eval]", () => {
    const snippet = evalSnippetContaining("randomBytes");
    expect(snippet, "the generate-token -e script is extractable").not.toBeNull();

    const root = makeTree({});
    const dest = join(root, ".env.local");
    const stdout = execFileSync(
      process.execPath,
      ["--input-type=module", "-e", snippet, "--", dest],
      { encoding: "utf8", cwd: root },
    );

    expect(existsSync(join(root, "[eval]"))).toBe(false);
    expect(readdirSync(root)).not.toContain("[eval]");
    const body = readFileSync(dest, "utf8");
    expect(body).toMatch(/^FSD_DEMO_TOKEN=[0-9a-f]{64}\n$/);
    const value = body.slice("FSD_DEMO_TOKEN=".length).trim();
    expect(stdout).not.toContain(value);
    expect(stdout).not.toMatch(/console\.log\(\s*token\b/);
  });

  it("the generate-token snippet copies a reused dest onto a generate dest and never prints it", () => {
    const snippet = evalSnippetContaining("randomBytes");
    expect(snippet, "the generate-token -e script is extractable").not.toBeNull();

    const root = makeTree({});
    const reused = join(root, ".env.development.local");
    const generate = join(root, ".env.local");
    const existing = "already-reused-demo-token";
    writeFileSync(reused, `FSD_DEMO_TOKEN=${existing}\n`);

    const stdout = execFileSync(
      process.execPath,
      ["--input-type=module", "-e", snippet, "--", reused, generate],
      { encoding: "utf8", cwd: root },
    );

    expect(readFileSync(reused, "utf8")).toBe(`FSD_DEMO_TOKEN=${existing}\n`);
    expect(readFileSync(generate, "utf8")).toBe(`FSD_DEMO_TOKEN=${existing}\n`);
    expect(stdout).not.toContain(existing);
    expect(stdout).not.toMatch(/console\.log\(\s*token\b/);
    expect(readdirSync(root)).not.toContain("[eval]");
  });

  it("the generate-token snippet refuses when two dests already disagree, without printing either value", () => {
    const snippet = evalSnippetContaining("randomBytes");
    expect(snippet, "the generate-token -e script is extractable").not.toBeNull();

    const root = makeTree({});
    const first = join(root, ".env.development.local");
    const second = join(root, ".env.local");
    const a = "first-demo-token-value";
    const b = "second-demo-token-value";
    writeFileSync(first, `FSD_DEMO_TOKEN=${a}\n`);
    writeFileSync(second, `FSD_DEMO_TOKEN=${b}\n`);

    try {
      execFileSync(process.execPath, ["--input-type=module", "-e", snippet, "--", first, second], {
        encoding: "utf8",
        cwd: root,
      });
      expect.fail("expected the snippet to refuse when dests disagree");
    } catch (err) {
      expect(err.status).toBe(1);
      const output = `${err.stdout ?? ""}${err.stderr ?? ""}`;
      expect(output).toMatch(/refusing to write a second one/);
      expect(output).not.toContain(a);
      expect(output).not.toContain(b);
    }
    expect(readFileSync(first, "utf8")).toBe(`FSD_DEMO_TOKEN=${a}\n`);
    expect(readFileSync(second, "utf8")).toBe(`FSD_DEMO_TOKEN=${b}\n`);
  });

  it("fills a whitespace-only FSD_DEMO_TOKEN assignment in place, without appending a second one", () => {
    const snippet = evalSnippetContaining("randomBytes");
    expect(snippet, "the generate-token -e script is extractable").not.toBeNull();

    const root = makeTree({});
    const dest = join(root, ".env.local");
    writeFileSync(dest, "OTHER=keep\nFSD_DEMO_TOKEN=   \t\n");

    const stdout = execFileSync(
      process.execPath,
      ["--input-type=module", "-e", snippet, "--", dest],
      { encoding: "utf8", cwd: root },
    );

    const body = readFileSync(dest, "utf8");
    expect(body).toMatch(/^OTHER=keep\nFSD_DEMO_TOKEN=[0-9a-f]{64}\n$/);
    expect(body.match(/FSD_DEMO_TOKEN=/g)).toHaveLength(1);
    const value = /FSD_DEMO_TOKEN=([0-9a-f]{64})/.exec(body)[1];
    expect(stdout).not.toContain(value);
    expect(stdout).toMatch(/Filled an empty FSD_DEMO_TOKEN line/);
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

  it("emits the block through the exported renderer after install", () => {
    const text = skillText();
    expect(text).toMatch(/renderNextSteps/);
    expect(text).toMatch(/from "@flow-state-dev\/fsdev"/);
    expect(text).toMatch(/packageManager\.value/);
    expect(text).toMatch(/host\.topology/);
  });

  it("presents fsdev dev and fsdev serve as alternatives on second-process", () => {
    const text = skillText();
    const afterRender = text.slice(text.indexOf("' -- \"$REPORT_JSON\""));
    const instruction = afterRender.slice(0, afterRender.indexOf("<!-- next-steps:canonical -->"));
    expect(instruction).toMatch(/Verify one server path/);
    expect(instruction).toMatch(/alternatives/);
    expect(instruction).toMatch(/Run one of them, not both/);
    expect(instruction).not.toMatch(/Run every command that output printed/);
  });

  it("the renderNextSteps snippet does not treat [eval] as the report path", () => {
    const snippet = evalSnippetContaining("renderNextSteps");
    expect(snippet, "the renderNextSteps -e script is extractable").not.toBeNull();
    expect(snippet).not.toMatch(/readFileSync\(process\.argv\[1\]/);

    const destsFrom = (argv) => destsFromSnippet(snippet, argv);
    const report = "/tmp/report.json";

    expect(destsFrom(["/usr/bin/node", "[eval]", "--", report])).toEqual([report]);
    expect(destsFrom(["/usr/bin/node", "--", report])).toEqual([report]);
    expect(destsFrom(["/usr/bin/node", "[eval]"])).toEqual([]);
    expect(destsFrom(["/usr/bin/node", report])).toEqual([report]);
    expect(destsFrom(["/usr/bin/node", "[eval]", "--", report])).not.toContain("[eval]");
  });

  it("running the renderNextSteps dests line reads the report and never a file named [eval]", () => {
    const snippet = evalSnippetContaining("renderNextSteps");
    expect(snippet, "the renderNextSteps -e script is extractable").not.toBeNull();

    const root = makeTree({});
    const reportPath = join(root, "report.json");
    const decoy = join(root, "[eval]");
    writeFileSync(
      reportPath,
      JSON.stringify({
        host: { topology: "mounted-route" },
        packageManager: { value: "pnpm" },
        devCommand: { script: "dev", url: "http://localhost:3000" },
        mount: { path: "/api/fsd" },
      }),
    );
    writeFileSync(decoy, "not-json");

    const dests = destsFromSnippet(snippet, [process.execPath, "[eval]", "--", reportPath]);
    expect(dests).toEqual([reportPath]);
    expect(dests).not.toContain("[eval]");

    const report = JSON.parse(readFileSync(dests[0], "utf8"));
    const stdout = renderNextSteps({
      topology: report.host.topology,
      packageManager: report.packageManager.value,
      devScript: report.devCommand.script ?? undefined,
      devUrl: report.devCommand.url ?? undefined,
      mountPath: report.mount.path ?? undefined,
    });

    expect(stdout).toMatch(/Next steps/);
    expect(stdout).toMatch(/pnpm run/);
    expect(stdout).toMatch(/\/api\/fsd/);
    expect(stdout).not.toMatch(/FSD_DEMO_TOKEN=/);
    expect(stdout).not.toMatch(/OPENAI_API_KEY=/);
    expect(readFileSync(decoy, "utf8")).toBe("not-json");
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
    expect(flow).toMatch(/principal === null/);
    expect(flow).not.toMatch(/Action request requires non-empty userId/);
  });

  it("the mount pair uses createNextHandler and forwards the bare path", () => {
    const catchAll = readFileSync(join(templates, "route-catchall.ts"), "utf8");
    const bare = readFileSync(join(templates, "route-bare.ts"), "utf8");
    expect(catchAll).toMatch(/fsd:generated/);
    expect(bare).toMatch(/fsd:generated/);
    expect(catchAll).toMatch(/createNextHandler/);
    expect(bare).toMatch(/path:\s*\[\]/);
  });

  it("the skill points the mount import at the CLI winner, not a hardcoded .mts", () => {
    const text = skillText();
    expect(text).toMatch(/fsdevConfig\.winner/);
    expect(text).toMatch(/CONFIG_IMPORT/);
  });
});
