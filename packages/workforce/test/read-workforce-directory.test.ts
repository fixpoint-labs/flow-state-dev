/**
 * Specs for the convention loader: `teams/<id>/workers/<name>/` on disk becomes
 * one neutral manifest per worker.
 *
 * Every tree is built in a real temp directory and read through the real
 * function — there is no filesystem mock, because the behaviours under test
 * (what a symlink does, what a missing file does) are filesystem behaviours.
 *
 * BP-035: each failing case is exercised in the same tree as a healthy worker,
 * so a spec proves isolation and not just that the bad path errors.
 */
import {
  mkdtempSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  writeFileSync,
  symlinkSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import fsp from "node:fs/promises";
import { afterEach, describe, expect, it, vi } from "vitest";
import { readWorkforceDirectory } from "../src/loader";

const roots: string[] = [];

afterEach(() => {
  vi.restoreAllMocks();
  for (const dir of roots.splice(0)) rmSync(dir, { recursive: true, force: true });
});

/** A tree written from `{ "relative/path": contents }`. Directories are implied. */
function tree(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), "fsd-workforce-"));
  roots.push(root);
  for (const [rel, contents] of Object.entries(files)) {
    const full = join(root, rel);
    mkdirSync(join(full, ".."), { recursive: true });
    writeFileSync(full, contents);
  }
  return root;
}

/** Create an empty directory inside an existing root. */
function dir(root: string, rel: string): string {
  const full = join(root, rel);
  mkdirSync(full, { recursive: true });
  return full;
}

const LEAD_MD = `---
description: Holds the engineering board and breaks work into tasks.
flow: worker-agent
model: openai/gpt-5.4-mini
tools: [board, search]
---

You are the engineering lead. You break the request into tasks.
`;

/** A healthy worker that must survive every failure spec in the same tree. */
const HEALTHY = { "teams/engineering/workers/lead/WORKER.md": LEAD_MD };

describe("readWorkforceDirectory", () => {
  it("turns a worker folder into a manifest carrying what the file declared", async () => {
    const { workers, errors } = await readWorkforceDirectory(tree(HEALTHY));

    expect(errors).toEqual([]);
    expect(workers).toHaveLength(1);
    expect(workers[0]!.declared).toEqual({
      description: "Holds the engineering board and breaks work into tasks.",
      flow: "worker-agent",
      model: "openai/gpt-5.4-mini",
      tools: ["board", "search"],
    });
    expect(workers[0]!.body).toBe(
      "You are the engineering lead. You break the request into tasks.\n",
    );
  });

  it("mints a dot-joined, team-qualified identity from the folder", async () => {
    const { workers } = await readWorkforceDirectory(tree(HEALTHY));

    expect(workers[0]!.id).toBe("engineering.lead");
  });

  it("gives two teams' same-named workers distinct identities, and no id carries a slash", async () => {
    const { workers, errors } = await readWorkforceDirectory(
      tree({
        "teams/engineering/workers/lead/WORKER.md": LEAD_MD,
        "teams/marketing/workers/lead/WORKER.md": LEAD_MD,
      }),
    );

    expect(errors).toEqual([]);
    expect(workers.map((w) => w.id).sort()).toEqual(["engineering.lead", "marketing.lead"]);
    // The regression guard, not a restatement: a slashed id passes registration
    // and only fails at the HTTP boundary, so it has to be asserted directly.
    for (const worker of workers) expect(worker.id).not.toContain("/");
  });

  it("carries the identity once — no second spelling of it on the record", async () => {
    const { workers } = await readWorkforceDirectory(tree(HEALTHY));

    // `teamId`, `name` and `dir` are exactly the fields a helpful implementer
    // adds back. All three are derivable from `id` and the root, and derived
    // data on a record is a drift surface with no rule for which side wins.
    expect(Object.keys(workers[0]!).sort()).toEqual(["body", "declared", "id"]);
  });

  it("carries a key nothing has ever heard of, verbatim", async () => {
    const { workers } = await readWorkforceDirectory(
      tree({
        "teams/engineering/workers/lead/WORKER.md": `---
description: The lead.
team-visible: true
escalation-window: 30m
---
Body.
`,
      }),
    );

    // Retrievable from the manifest, not merely "did not throw" — a parser that
    // silently discards a key also does not throw. Asserted on keys nothing
    // reserves, because a reserved key cannot demonstrate that an *unknown* one
    // survives.
    expect(workers[0]!.declared["team-visible"]).toBe(true);
    expect(workers[0]!.declared["escalation-window"]).toBe("30m");
  });

  it("does not let a declared key reach the manifest through the prototype chain", async () => {
    const { workers } = await readWorkforceDirectory(
      tree({
        "teams/engineering/workers/lead/WORKER.md": `---
description: The lead.
__proto__:
  flow: injected-kind
---
Body.
`,
      }),
    );

    // `flow` selects which flow kind a worker runs, so a file that can make it
    // resolve without ever declaring it is a routing decision derived from
    // caller-controllable content (BP-031). No own key, no inherited one.
    const declared = workers[0]!.declared;
    expect(declared["flow"]).toBeUndefined();
    expect("flow" in declared).toBe(false);
    // And the key is still carried, as an ordinary key like any other.
    expect(Object.keys(declared)).toContain("__proto__");
  });

  it("returns an empty result when the root has no teams/ at all", async () => {
    const { workers, errors } = await readWorkforceDirectory(
      tree({ "README.md": "no workers\n" }),
    );

    expect(workers).toEqual([]);
    expect(errors).toEqual([]);
  });

  it("throws when the root itself cannot be read", async () => {
    await expect(
      readWorkforceDirectory(join(tmpdir(), "fsd-workforce-does-not-exist-9e1c")),
    ).rejects.toThrow(/Failed to read workforce directory/);
  });

  describe("a slot that cannot produce a manifest is reported, and the healthy worker still loads", () => {
    it("reports a worker folder with no WORKER.md", async () => {
      const root = tree(HEALTHY);
      dir(root, "teams/engineering/workers/intake");

      const { workers, errors } = await readWorkforceDirectory(root);

      expect(workers.map((w) => w.id)).toEqual(["engineering.lead"]);
      expect(errors).toHaveLength(1);
      expect(errors[0]!.path).toBe("teams/engineering/workers/intake");
      expect(errors[0]!.error.message).toMatch(/has no WORKER\.md/);
    });

    it("reports a folder holding only a worker.ts, naming the document and the kinds route", async () => {
      // A worker folder is a folder with a `WORKER.md` in it. A folder holding
      // only code occupies a worker slot and produces no manifest, so it is
      // named — the framework cannot run it, and pretending it loaded is the
      // silent-short-roster failure in a different coat.
      const { workers, errors } = await readWorkforceDirectory(
        tree({ ...HEALTHY, "teams/engineering/workers/router/worker.ts": "export default {};\n" }),
      );

      expect(workers.map((w) => w.id)).toEqual(["engineering.lead"]);
      expect(errors).toHaveLength(1);
      expect(errors[0]!.path).toBe("teams/engineering/workers/router");

      // An author who put code in a worker slot has a route, and the refusal is
      // the only place they are standing. It has to carry all three steps —
      // define the flow, pass it in `kinds`, name it in `flow:` — because each
      // one alone leaves them guessing at the next.
      const { message } = errors[0]!.error;
      expect(message).toMatch(/has no WORKER\.md/);
      expect(message).toContain("hireWorkforce");
      expect(message).toContain("kinds");
      expect(message).toContain("flow:");
    });

    it("reports a WORKER.md with no frontmatter", async () => {
      const { workers, errors } = await readWorkforceDirectory(
        tree({
          ...HEALTHY,
          "teams/engineering/workers/intake/WORKER.md": "Just prose, no settings.\n",
        }),
      );

      expect(workers.map((w) => w.id)).toEqual(["engineering.lead"]);
      expect(errors).toHaveLength(1);
      expect(errors[0]!.path).toBe("teams/engineering/workers/intake");
      expect(errors[0]!.error.message).toMatch(/no frontmatter/);
    });

    it("reports a WORKER.md with no description", async () => {
      const { workers, errors } = await readWorkforceDirectory(
        tree({
          ...HEALTHY,
          "teams/engineering/workers/intake/WORKER.md": "---\nflow: intake\n---\nBody.\n",
        }),
      );

      expect(workers.map((w) => w.id)).toEqual(["engineering.lead"]);
      expect(errors).toHaveLength(1);
      expect(errors[0]!.error.message).toMatch(/non-empty `description`/);
      // An author who wrote a document is not told how to define a flow kind.
      // That route belongs to the slot holding no document at all.
      expect(errors[0]!.error.message).not.toContain("hireWorkforce");
    });

    it("reports a WORKER.md whose description is not prose", async () => {
      const { workers, errors } = await readWorkforceDirectory(
        tree({
          ...HEALTHY,
          "teams/engineering/workers/intake/WORKER.md": "---\ndescription: 42\n---\nBody.\n",
        }),
      );

      expect(workers.map((w) => w.id)).toEqual(["engineering.lead"]);
      expect(errors).toHaveLength(1);
      expect(errors[0]!.error.message).toMatch(/non-empty `description`/);
    });

    it("reports a WORKER.md declaring the refused `persona:` key, naming the file and the spelling to use", async () => {
      const { workers, errors } = await readWorkforceDirectory(
        tree({
          ...HEALTHY,
          "teams/engineering/workers/intake/WORKER.md":
            "---\ndescription: The front door.\nflow: intake\npersona: You greet people.\n---\nBody.\n",
        }),
      );

      // Reported, not loaded. The healthy worker still comes back, and the
      // refused slot produces no manifest at all — a record carrying a refused
      // key must not reach a caller who could hire it.
      expect(workers.map((w) => w.id)).toEqual(["engineering.lead"]);
      expect(errors).toHaveLength(1);
      expect(errors[0]!.path).toBe("teams/engineering/workers/intake");

      const { message } = errors[0]!.error;
      // The file, the key, and what to write instead — all three, because an
      // author fixing this has to find the file and know the new spelling.
      expect(message).toContain("WORKER.md");
      expect(message).toContain("intake/");
      expect(message).toContain("persona");
      expect(message).toContain("not a setting a worker declares");
      expect(message).toContain("instructions");
    });

    it("refuses the refused key rather than carrying it verbatim like an unknown one", async () => {
      // The contrast that gives the spec above its meaning: this loader's rule
      // is to carry what it does not recognise. A refused key is the one thing
      // it must NOT carry, so the two behaviours are asserted against the same
      // parser in the same shape.
      const carried = await readWorkforceDirectory(
        tree({
          "teams/engineering/workers/intake/WORKER.md":
            "---\ndescription: The front door.\nnot-a-real-key: kept\n---\nBody.\n",
        }),
      );
      expect(carried.errors).toEqual([]);
      expect(carried.workers[0]!.declared["not-a-real-key"]).toBe("kept");

      const refused = await readWorkforceDirectory(
        tree({
          "teams/engineering/workers/intake/WORKER.md":
            "---\ndescription: The front door.\npersona: kept\n---\nBody.\n",
        }),
      );
      expect(refused.workers).toEqual([]);
      expect(refused.errors).toHaveLength(1);
    });

    it("reports a worker segment breaking the name rules, with the rule in the message", async () => {
      const { workers, errors } = await readWorkforceDirectory(
        tree({ ...HEALTHY, "teams/engineering/workers/Platform_Eng/WORKER.md": LEAD_MD }),
      );

      expect(workers.map((w) => w.id)).toEqual(["engineering.lead"]);
      expect(errors).toHaveLength(1);
      expect(errors[0]!.path).toBe("teams/engineering/workers/Platform_Eng");
      expect(errors[0]!.error.message).toMatch(/lowercase letters, digits, and single hyphens/);
      // Worker-worded, not borrowed from the skills validator.
      expect(errors[0]!.error.message).not.toMatch(/Skill name/);
    });

    it("reports a team segment breaking the name rules", async () => {
      const { workers, errors } = await readWorkforceDirectory(
        tree({ ...HEALTHY, "teams/Platform_Eng/workers/lead/WORKER.md": LEAD_MD }),
      );

      expect(workers.map((w) => w.id)).toEqual(["engineering.lead"]);
      expect(errors).toHaveLength(1);
      expect(errors[0]!.path).toBe("teams/Platform_Eng/workers/lead");
      expect(errors[0]!.error.message).toMatch(/^Team folder name/);
    });

    it("rejects a folder name containing a dot, so an id always splits back cleanly", async () => {
      const { workers, errors } = await readWorkforceDirectory(
        tree({
          ...HEALTHY,
          "teams/a.b/workers/lead/WORKER.md": LEAD_MD,
          "teams/engineering/workers/b.lead/WORKER.md": LEAD_MD,
        }),
      );

      expect(workers.map((w) => w.id)).toEqual(["engineering.lead"]);
      expect(errors.map((e) => e.path).sort()).toEqual([
        "teams/a.b/workers/lead",
        "teams/engineering/workers/b.lead",
      ]);
      for (const { error } of errors) expect(error.message).toMatch(/single hyphens/);
    });

    it("reports a reserved segment name", async () => {
      const { workers, errors } = await readWorkforceDirectory(
        tree({ ...HEALTHY, "teams/engineering/workers/_meta/WORKER.md": LEAD_MD }),
      );

      expect(workers.map((w) => w.id)).toEqual(["engineering.lead"]);
      expect(errors).toHaveLength(1);
      expect(errors[0]!.error.message).toMatch(/is reserved/);
    });

    it("reports a segment longer than 64 characters", async () => {
      const long = "a".repeat(65);
      const { workers, errors } = await readWorkforceDirectory(
        tree({ ...HEALTHY, [`teams/engineering/workers/${long}/WORKER.md`]: LEAD_MD }),
      );

      expect(workers.map((w) => w.id)).toEqual(["engineering.lead"]);
      expect(errors).toHaveLength(1);
      expect(errors[0]!.error.message).toMatch(/exceeds 64 characters/);
    });

    it("refuses a symlinked worker folder", async () => {
      const root = tree(HEALTHY);
      const real = dir(root, "outside/borrowed");
      writeFileSync(join(real, "WORKER.md"), LEAD_MD);
      symlinkSync(real, join(root, "teams/engineering/workers/borrowed"));

      const { workers, errors } = await readWorkforceDirectory(root);

      expect(workers.map((w) => w.id)).toEqual(["engineering.lead"]);
      expect(errors).toHaveLength(1);
      expect(errors[0]!.path).toBe("teams/engineering/workers/borrowed");
      expect(errors[0]!.error.message).toMatch(/refused for safety/);
    });

    it("refuses a symlinked teams/ rather than reading a tree outside the root", async () => {
      // The boundary case: `readdir` follows a directory symlink, so without a
      // check here the loader reads worker files from outside the configured
      // root and reports nothing.
      const root = tree({ "outside/teams/engineering/workers/lead/WORKER.md": LEAD_MD });
      symlinkSync(join(root, "outside/teams"), join(root, "teams"));

      const { workers, errors } = await readWorkforceDirectory(root);

      expect(workers).toEqual([]);
      expect(errors).toHaveLength(1);
      expect(errors[0]!.path).toBe("teams");
      expect(errors[0]!.error.message).toMatch(/refused for safety/);
    });

    it("refuses a symlinked team folder instead of dropping its workers", async () => {
      const root = tree({ ...HEALTHY, "outside/marketing/workers/lead/WORKER.md": LEAD_MD });
      symlinkSync(join(root, "outside/marketing"), join(root, "teams/marketing"));

      const { workers, errors } = await readWorkforceDirectory(root);

      expect(workers.map((w) => w.id)).toEqual(["engineering.lead"]);
      expect(errors).toHaveLength(1);
      expect(errors[0]!.path).toBe("teams/marketing");
      expect(errors[0]!.error.message).toMatch(/refused for safety/);
    });

    it("refuses a symlinked workers/ folder", async () => {
      const root = tree({ ...HEALTHY, "outside/workers/lead/WORKER.md": LEAD_MD });
      dir(root, "teams/marketing");
      symlinkSync(join(root, "outside/workers"), join(root, "teams/marketing/workers"));

      const { workers, errors } = await readWorkforceDirectory(root);

      expect(workers.map((w) => w.id)).toEqual(["engineering.lead"]);
      expect(errors).toHaveLength(1);
      expect(errors[0]!.path).toBe("teams/marketing/workers");
    });

    it("reports a worker slot it cannot stat instead of dropping it", async () => {
      // The slot exists — `readdir` lists it — but `lstat` fails for a reason
      // that is not absence. Treating that as "absent" takes the seat out of
      // the roster with `errors` empty, which the caller's fatal-on-errors
      // guard cannot see.
      //
      // The real-world route is a directory that is readable but not
      // searchable (`r--` rather than `r-x`): `readdir` enumerates its children
      // fine, then every `lstat` on one fails with EACCES — an ordinary
      // permission mistake on a deploy, not exotic I/O.
      //
      // It is injected rather than provoked because the suite runs as root,
      // which bypasses the search-permission check, so a chmod would not
      // reproduce it here. What this proves is the branch: "not ENOENT" is
      // reported rather than read as absence.
      const root = tree({ ...HEALTHY, "teams/engineering/workers/locked/WORKER.md": LEAD_MD });
      const locked = join(root, "teams/engineering/workers/locked");
      const real = fsp.lstat.bind(fsp);
      vi.spyOn(fsp, "lstat").mockImplementation(((target: Parameters<typeof real>[0]) => {
        if (String(target) === locked) {
          const err = new Error(`EACCES: permission denied, lstat '${locked}'`);
          (err as NodeJS.ErrnoException).code = "EACCES";
          return Promise.reject(err);
        }
        return real(target);
      }) as unknown as typeof fsp.lstat);

      const { workers, errors } = await readWorkforceDirectory(root);

      expect(workers.map((w) => w.id)).toEqual(["engineering.lead"]);
      expect(errors).toHaveLength(1);
      expect(errors[0]!.path).toBe("teams/engineering/workers/locked");
      expect(errors[0]!.error.message).toMatch(/could not be read/i);
    });

    it("reports a directory it cannot read instead of treating it as empty", async () => {
      // Only genuine absence may read as empty. Every other `readdir` failure
      // has to stay visible, or a whole team drops out of the roster with the
      // caller's fatal-on-errors guard unable to see it. ENOTDIR stands in for
      // the class here because the suite runs as root, where a permission bit
      // would not deny us anything; EACCES takes the same branch.
      const { workers, errors } = await readWorkforceDirectory(
        tree({ ...HEALTHY, "teams/marketing/workers": "not a directory\n" }),
      );

      expect(workers.map((w) => w.id)).toEqual(["engineering.lead"]);
      expect(errors).toHaveLength(1);
      expect(errors[0]!.path).toBe("teams/marketing/workers");
      expect(errors[0]!.error.message).toMatch(/could not be read/i);
    });

    it("refuses a symlinked WORKER.md rather than reading through it", async () => {
      const root = tree({ ...HEALTHY, "outside/stolen.md": LEAD_MD });
      dir(root, "teams/engineering/workers/borrowed");
      symlinkSync(
        join(root, "outside/stolen.md"),
        join(root, "teams/engineering/workers/borrowed/WORKER.md"),
      );

      const { workers, errors } = await readWorkforceDirectory(root);

      expect(workers.map((w) => w.id)).toEqual(["engineering.lead"]);
      expect(errors).toHaveLength(1);
      expect(errors[0]!.error.message).toMatch(/Symlinked WORKER\.md/);
    });
  });

  describe("the near-miss asymmetry", () => {
    it("passes over everything outside a worker slot in silence", async () => {
      const root = tree({
        ...HEALTHY,
        // The rest of the locked tree: a team's knowledge siblings, an
        // org-level shared workers folder, and a stray file under workers/.
        "teams/engineering/resources/handbook.md": "# Handbook\n",
        "teams/engineering/skills/triage/SKILL.md":
          "---\nname: triage\ndescription: Triage.\n---\nBody.\n",
        "teams/engineering/tools/board.ts": "export default {};\n",
        "teams/engineering/workers/README.md": "Workers live here.\n",
        "workers/shared-reviewer/WORKER.md": LEAD_MD,
        "resources/org-handbook.md": "# Org\n",
      });
      dir(root, "teams/marketing/resources");

      const { workers, errors } = await readWorkforceDirectory(root);

      expect(errors).toEqual([]);
      expect(workers.map((w) => w.id)).toEqual(["engineering.lead"]);
    });

    it("reports exactly one error for an empty folder inside a worker slot", async () => {
      const root = tree({
        ...HEALTHY,
        "teams/engineering/resources/handbook.md": "# Handbook\n",
        "workers/shared-reviewer/WORKER.md": LEAD_MD,
      });
      dir(root, "teams/engineering/workers/intake");

      const { errors } = await readWorkforceDirectory(root);

      expect(errors.map((e) => e.path)).toEqual(["teams/engineering/workers/intake"]);
    });
  });
});

describe("the loader's boundary", () => {
  it("builds nothing runtime — no agent, no registry, no flow", async () => {
    const dir = join(import.meta.dirname, "..", "src", "loader");
    const sources = readdirSync(dir)
      .filter((f) => f.endsWith(".ts"))
      .map((f) => readFileSync(join(dir, f), "utf8"));

    // The defect this loader exists to avoid: handing back a species the seat
    // factory owns. Asserted on the module's imports rather than left to prose,
    // because a return type can drift back one helpful commit at a time.
    for (const source of sources) {
      expect(source).not.toMatch(/createAgentRegistry|materializeAgent|defineAgent|defineFlow/);
      expect(source).not.toMatch(/\bAgent\b/);
    }
  });

  it("declares no field that is a runtime object", async () => {
    const { workers } = await readWorkforceDirectory(tree(HEALTHY));

    for (const value of Object.values(workers[0]!)) {
      expect(typeof value === "string" || typeof value === "object").toBe(true);
    }
    expect(JSON.parse(JSON.stringify(workers[0]))).toEqual(workers[0]);
  });
});
