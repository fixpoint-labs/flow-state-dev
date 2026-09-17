/**
 * Specs for the resources convention loader: a Markdown file in a `resources/`
 * folder becomes one neutral document record.
 *
 * Same discipline as the worker reader's specs — every tree is a real temp
 * directory read through the real function, because the behaviours under test
 * (what a symlink does, what an unreadable folder does) are filesystem
 * behaviours. BP-035: each failing case sits in the same tree as a healthy
 * document, so a spec proves isolation and not just that the bad path errors.
 */
import { mkdtempSync, mkdirSync, writeFileSync, symlinkSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import fsp from "node:fs/promises";
import { afterEach, describe, expect, it, vi } from "vitest";
import { readResourcesDirectory, readWorkforceDirectory } from "../src/loader";
import { DERIVED_KEY_CASES } from "./derived-key-cases";

const roots: string[] = [];

afterEach(() => {
  vi.restoreAllMocks();
  for (const dir of roots.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

/** A tree written from `{ "relative/path": contents }`. Directories are implied. */
function tree(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), "fsd-resources-"));
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

const HANDBOOK = `---
description: How the engineering team works.
llmReadable: true
---

# Engineering handbook

Escalate anything customer-visible within 15 minutes.
`;

/**
 * A minimal `WORKER.md`. Present in the worker-root specs only to make the
 * fixtures read like a real tree — this reader never opens it (D3), which is
 * exactly what one of those specs pins.
 */
const WORKER_MD = `---
description: Runs reconnaissance.
---

Find things out.
`;

/** A healthy team document that must survive every failure spec in the same tree. */
const HEALTHY = { "teams/engineering/resources/handbook.md": HANDBOOK };

describe("readResourcesDirectory", () => {
  it("turns a team's Markdown file into a document carrying what the file declared", async () => {
    const { documents, errors } = await readResourcesDirectory(tree(HEALTHY));

    expect(errors).toEqual([]);
    expect(documents).toHaveLength(1);
    expect(documents[0]!.declared).toEqual({
      description: "How the engineering team works.",
      llmReadable: true,
    });
    expect(documents[0]!.body).toBe(
      "# Engineering handbook\n\nEscalate anything customer-visible within 15 minutes.\n",
    );
  });

  it("keys an org document by its bare name and a team's by its path", async () => {
    const { documents, errors } = await readResourcesDirectory(
      tree({
        "org/resources/code-of-conduct.md": HANDBOOK,
        "teams/engineering/resources/handbook.md": HANDBOOK,
        "teams/marketing/resources/handbook.md": HANDBOOK,
      }),
    );

    expect(errors).toEqual([]);
    expect(documents.map((d) => d.ref).sort()).toEqual([
      "code-of-conduct",
      "teams/engineering/handbook",
      "teams/marketing/handbook",
    ]);
  });

  it("reads a root that has only one of the two roots, and an empty root", async () => {
    const orgOnly = await readResourcesDirectory(tree({ "org/resources/coc.md": HANDBOOK }));
    expect(orgOnly.errors).toEqual([]);
    expect(orgOnly.documents.map((d) => d.ref)).toEqual(["coc"]);

    const empty = await readResourcesDirectory(tree({ "README.md": "not a tree" }));
    expect(empty.errors).toEqual([]);
    expect(empty.documents).toEqual([]);
  });

  it("throws only when the root itself cannot be read", async () => {
    await expect(
      readResourcesDirectory(join(tmpdir(), "fsd-resources-absent-root")),
    ).rejects.toThrow(/Failed to read/);
  });

  it("refuses a symlinked root without following it", async () => {
    // The root is the one level a bare `readdir` would follow. Every nested
    // structural folder is classified first, so `org -> /outside` is refused;
    // a root that is itself a link has to be refused the same way, or the whole
    // tree comes from somewhere the caller never configured.
    const root = tree({ "real/teams/engineering/resources/handbook.md": HANDBOOK });
    symlinkSync(join(root, "real"), join(root, "linked"));

    // Control: the tree behind the link is a perfectly loadable one, so the
    // refusal below is the symlink and not a broken fixture.
    const direct = await readResourcesDirectory(join(root, "real"));
    expect(direct.documents.map((d) => d.ref)).toEqual(["teams/engineering/handbook"]);

    await expect(readResourcesDirectory(join(root, "linked"))).rejects.toThrow(/Symlinked/);
  });

  // R1 — the worker reader's error contract, on both resource roots. Each case
  // shares a tree with the healthy document, which must still load.
  describe("honours the worker reader's error contract", () => {
    it("reports a file with no frontmatter, under its own path", async () => {
      const root = tree({ ...HEALTHY, "org/resources/stray.md": "# Just a body\n" });
      const { documents, errors } = await readResourcesDirectory(root);

      expect(documents.map((d) => d.ref)).toEqual(["teams/engineering/handbook"]);
      expect(errors).toHaveLength(1);
      expect(errors[0]!.path).toBe("org/resources/stray.md");
      expect(errors[0]!.kind).toBe("document-load-failed");
      expect(errors[0]!.error.message).toMatch(/no frontmatter/);
    });

    it("reports a file whose `description` is missing or empty", async () => {
      const root = tree({
        ...HEALTHY,
        "org/resources/no-desc.md": "---\nllmReadable: true\n---\n\nbody\n",
        "teams/engineering/resources/blank-desc.md": '---\ndescription: "   "\n---\n\nbody\n',
      });
      const { documents, errors } = await readResourcesDirectory(root);

      expect(documents.map((d) => d.ref)).toEqual(["teams/engineering/handbook"]);
      expect(errors.map((e) => e.path).sort()).toEqual([
        "org/resources/no-desc.md",
        "teams/engineering/resources/blank-desc.md",
      ]);
      for (const entry of errors) {
        expect(entry.error.message).toMatch(/non-empty `description`/);
        expect(entry.kind).toBe("document-load-failed");
      }
    });

    it("reports a document file name that breaks the segment rules", async () => {
      const root = tree({ ...HEALTHY, "org/resources/Not Valid.md": HANDBOOK });
      const { documents, errors } = await readResourcesDirectory(root);

      expect(documents.map((d) => d.ref)).toEqual(["teams/engineering/handbook"]);
      expect(errors).toHaveLength(1);
      expect(errors[0]!.path).toBe("org/resources/Not Valid.md");
      expect(errors[0]!.kind).toBe("document-load-failed");
      expect(errors[0]!.error.message).toMatch(/lowercase letters, digits, and single hyphens/);
    });

    it("reports a team folder name that breaks the segment rules", async () => {
      const root = tree({ ...HEALTHY, "teams/Engineering/resources/handbook.md": HANDBOOK });
      const { documents, errors } = await readResourcesDirectory(root);

      expect(documents.map((d) => d.ref)).toEqual(["teams/engineering/handbook"]);
      expect(errors).toHaveLength(1);
      expect(errors[0]!.path).toBe("teams/Engineering/resources/handbook.md");
      expect(errors[0]!.kind).toBe("document-load-failed");
      expect(errors[0]!.error.message).toMatch(/lowercase letters, digits, and single hyphens/);
    });

    it("refuses a symlinked document without following it", async () => {
      const root = tree({ ...HEALTHY, "outside/secret.md": HANDBOOK });
      dir(root, "org/resources");
      symlinkSync(join(root, "outside/secret.md"), join(root, "org/resources/linked.md"));

      const { documents, errors } = await readResourcesDirectory(root);

      expect(documents.map((d) => d.ref)).toEqual(["teams/engineering/handbook"]);
      expect(errors).toHaveLength(1);
      expect(errors[0]!.path).toBe("org/resources/linked.md");
      expect(errors[0]!.kind).toBe("document-load-failed");
      expect(errors[0]!.error.message).toMatch(/Symlinked/);
    });

    it("refuses a symlinked resources slot without following it", async () => {
      const root = tree({ ...HEALTHY, "outside/handbook.md": HANDBOOK });
      dir(root, "teams/marketing");
      symlinkSync(join(root, "outside"), join(root, "teams/marketing/resources"));

      const { documents, errors } = await readResourcesDirectory(root);

      expect(documents.map((d) => d.ref)).toEqual(["teams/engineering/handbook"]);
      expect(errors).toHaveLength(1);
      expect(errors[0]!.path).toBe("teams/marketing/resources");
      expect(errors[0]!.kind).toBe("unreadable-slot");
      expect(errors[0]!.error.message).toMatch(/Symlinked/);
    });

    it("refuses a symlinked team folder instead of dropping its documents", async () => {
      // One level above the `resources/` case, and the level the shared team
      // walk has to carry the refusal at: a symlinked team reads a whole team's
      // documents from outside the configured root.
      const root = tree({
        ...HEALTHY,
        "outside/marketing/resources/handbook.md": HANDBOOK,
      });
      symlinkSync(join(root, "outside/marketing"), join(root, "teams/marketing"));

      const { documents, errors } = await readResourcesDirectory(root);

      expect(documents.map((d) => d.ref)).toEqual(["teams/engineering/handbook"]);
      expect(errors).toHaveLength(1);
      expect(errors[0]!.path).toBe("teams/marketing");
      expect(errors[0]!.kind).toBe("unreadable-slot");
      expect(errors[0]!.error.message).toBe(
        'Symlinked team folder "marketing" — refused for safety',
      );
    });

    it("reports a team folder it cannot stat rather than dropping its documents", async () => {
      // `absent` and `unreadable` stay apart at the team level for the reason
      // they do at the file level: folded together, a team we cannot stat is
      // skipped in silence and every document under it disappears with `errors`
      // empty for the caller's fatal check to look at.
      //
      // Injected rather than provoked because the suite runs as root, where a
      // permission bit denies us nothing. The real route is a `teams/` that is
      // readable but not searchable (`r--` rather than `r-x`): `readdir` lists
      // the team fine, then `lstat` on it fails with EACCES.
      const root = tree({
        ...HEALTHY,
        "teams/marketing/resources/handbook.md": HANDBOOK,
      });
      const locked = join(root, "teams/marketing");
      const real = fsp.lstat.bind(fsp);
      vi.spyOn(fsp, "lstat").mockImplementation(((target: Parameters<typeof real>[0]) => {
        if (String(target) === locked) {
          const err = new Error(`EACCES: permission denied, lstat '${locked}'`);
          (err as NodeJS.ErrnoException).code = "EACCES";
          return Promise.reject(err);
        }
        return real(target);
      }) as unknown as typeof fsp.lstat);

      const { documents, errors } = await readResourcesDirectory(root);

      expect(documents.map((d) => d.ref)).toEqual(["teams/engineering/handbook"]);
      expect(errors).toHaveLength(1);
      expect(errors[0]!.path).toBe("teams/marketing");
      expect(errors[0]!.kind).toBe("unreadable-slot");
      expect(errors[0]!.error.message).toMatch(/^Team folder "marketing" could not be read: /);
    });

    it("reports a structural folder that exists and cannot be listed, under its own path", async () => {
      // Only genuine absence may read as empty. Every other `readdir` failure
      // has to stay visible, or a whole team's documents drop out with the
      // caller's fatal-on-errors guard unable to see it. ENOTDIR stands in for
      // the class here because the suite runs as root, where a permission bit
      // would not deny us anything; EACCES takes the same branch.
      const { documents, errors } = await readResourcesDirectory(
        tree({ ...HEALTHY, "teams/marketing/resources": "not a directory\n" }),
      );

      expect(documents.map((d) => d.ref)).toEqual(["teams/engineering/handbook"]);
      expect(errors).toHaveLength(1);
      expect(errors[0]!.path).toBe("teams/marketing/resources");
      expect(errors[0]!.kind).toBe("unreadable-slot");
      expect(errors[0]!.error.message).toMatch(/could not be read/i);
    });

    it("reports an unreadable document file rather than skipping it", async () => {
      const root = tree({ ...HEALTHY, "org/resources/locked.md": HANDBOOK });
      const locked = join(root, "org/resources/locked.md");
      const real = fsp.lstat.bind(fsp);
      vi.spyOn(fsp, "lstat").mockImplementation(((target: Parameters<typeof real>[0]) => {
        if (String(target) === locked) {
          const err = new Error(`EACCES: permission denied, lstat '${locked}'`);
          (err as NodeJS.ErrnoException).code = "EACCES";
          return Promise.reject(err);
        }
        return real(target);
      }) as unknown as typeof fsp.lstat);

      const { documents, errors } = await readResourcesDirectory(root);

      expect(documents.map((d) => d.ref)).toEqual(["teams/engineering/handbook"]);
      expect(errors).toHaveLength(1);
      expect(errors[0]!.path).toBe("org/resources/locked.md");
      expect(errors[0]!.kind).toBe("document-load-failed");
      expect(errors[0]!.error.message).toMatch(/could not be read/i);
    });

    it("ignores editor and OS droppings", async () => {
      const root = tree({ ...HEALTHY, "org/resources/.DS_Store": "junk" });
      const { documents, errors } = await readResourcesDirectory(root);

      expect(errors).toEqual([]);
      expect(documents.map((d) => d.ref)).toEqual(["teams/engineering/handbook"]);
    });
  });

  // R2 — the two consequences of Decision 1 (a resource is a file, not a
  // folder). The inversion of the worker reader's skip rule is the point.
  describe("the file-not-folder shape", () => {
    it("reports a directory in a resources slot, naming the file convention", async () => {
      const root = tree({
        ...HEALTHY,
        "teams/marketing/resources/handbook/RESOURCE.md": HANDBOOK,
      });

      const { documents, errors } = await readResourcesDirectory(root);

      expect(documents.map((d) => d.ref)).toEqual(["teams/engineering/handbook"]);
      expect(errors).toHaveLength(1);
      expect(errors[0]!.path).toBe("teams/marketing/resources/handbook");
      expect(errors[0]!.kind).toBe("folder-where-file-belongs");
      // The author who made this mistake arrived from `workers/`; the message
      // has to tell them the shape, not just that something went wrong.
      expect(errors[0]!.error.message).toContain("handbook.md");
      expect(errors[0]!.error.message).toMatch(/file, not a folder/i);
    });

    it("skips a non-`.md` file in silence", async () => {
      const root = tree({
        ...HEALTHY,
        "teams/engineering/resources/notes.txt": "scratch",
        "teams/engineering/resources/diagram.png": "PNG",
      });

      const { documents, errors } = await readResourcesDirectory(root);

      expect(errors).toEqual([]);
      expect(documents.map((d) => d.ref)).toEqual(["teams/engineering/handbook"]);
    });
  });

  // R4, reader door — every field the convention derives is refused by name.
  // These are the regressions for F1a-F1c: each of these keys, carried
  // verbatim, could redirect a storage row or replace the document body.
  describe("refuses every field the convention derives", () => {
    // Shared with the install door's spec: the claim is that both doors refuse
    // the SAME set, which two separately-spelled tables cannot encode.
    it.each(DERIVED_KEY_CASES)(
      "reports a file declaring `$key` under its own path",
      async ({ key, yaml }) => {
        const root = tree({
          ...HEALTHY,
          "org/resources/overreach.md":
            `---\ndescription: Tries to declare what the convention derives.\n${yaml}\n---\n\nbody\n`,
        });

        const { documents, errors } = await readResourcesDirectory(root);

        expect(documents.map((d) => d.ref)).toEqual(["teams/engineering/handbook"]);
        expect(errors).toHaveLength(1);
        expect(errors[0]!.path).toBe("org/resources/overreach.md");
        expect(errors[0]!.kind).toBe("refused-declaration");
        expect(errors[0]!.error.message).toContain("overreach.md");
        expect(errors[0]!.error.message).toContain(`\`${key}:\``);
      },
    );

    it("refuses a lazy prefetchMode with the reason, because defineFlow would reject the flow", async () => {
      const root = tree({
        ...HEALTHY,
        "org/resources/lazy.md":
          "---\ndescription: Wants to be loaded on demand.\nprefetchMode: lazy\n---\n\nbody\n",
      });

      const { documents, errors } = await readResourcesDirectory(root);

      expect(documents.map((d) => d.ref)).toEqual(["teams/engineering/handbook"]);
      expect(errors).toHaveLength(1);
      expect(errors[0]!.path).toBe("org/resources/lazy.md");
      expect(errors[0]!.kind).toBe("refused-declaration");
      expect(errors[0]!.error.message).toMatch(/prefetchMode/);
      expect(errors[0]!.error.message).toMatch(/flow level/);
    });

    it("carries an eager prefetchMode verbatim — only lazy is refused", async () => {
      const root = tree({
        "org/resources/eager.md":
          "---\ndescription: Loaded up front, which is the default anyway.\nprefetchMode: eager\n---\n\nbody\n",
      });

      const { documents, errors } = await readResourcesDirectory(root);

      expect(errors).toEqual([]);
      expect(documents[0]!.declared["prefetchMode"]).toBe("eager");
    });

    it("carries every key outside the derived set verbatim", async () => {
      const root = tree({
        "org/resources/rich.md": `---
description: Everything the convention does not own arrives unchanged.
llmReadable: true
llmWritable: false
writable: true
allowedExtensions: [md, txt]
metadata:
  owner: platform
somethingNobodyHasClaimedYet: 7
---

body
`,
      });

      const { documents, errors } = await readResourcesDirectory(root);

      expect(errors).toEqual([]);
      expect(documents[0]!.declared).toEqual({
        description: "Everything the convention does not own arrives unchanged.",
        llmReadable: true,
        llmWritable: false,
        writable: true,
        allowedExtensions: ["md", "txt"],
        metadata: { owner: "platform" },
        somethingNobodyHasClaimedYet: 7,
      });
    });
  });

  // R5 — the third root (FIX-1368). A worker folder's `resources/` reads under
  // both parents, and every rule the other two roots keep, this one keeps too.
  //
  // Every failing case sits in a tree that also holds the healthy TEAM document
  // and a healthy WORKER document, so a spec proves the failure is contained to
  // its own level rather than that the reader stopped.
  describe("the worker root", () => {
    /** A healthy worker document that must survive every failure spec below. */
    const HEALTHY_WORKER = {
      "teams/engineering/workers/recon/WORKER.md": WORKER_MD,
      "teams/engineering/workers/recon/resources/runbook.md": HANDBOOK,
    };

    /** The refs a tree of `HEALTHY` + `HEALTHY_WORKER` loads when nothing is wrong. */
    const HEALTHY_REFS = [
      "teams/engineering/handbook",
      "teams/engineering/workers/recon/runbook",
    ];

    // V2 · BR-1 — the happy path, under both parents.
    it("keys a team worker's document by its worker-qualified ref, and an org worker's without `org/`", async () => {
      const { documents, errors } = await readResourcesDirectory(
        tree({
          "org/resources/code-of-conduct.md": HANDBOOK,
          "teams/engineering/resources/handbook.md": HANDBOOK,
          "teams/engineering/workers/recon/resources/runbook.md": HANDBOOK,
          "org/workers/infra/resources/runbook.md": HANDBOOK,
        }),
      );

      expect(errors).toEqual([]);
      expect(documents.map((d) => d.ref).sort()).toEqual([
        "code-of-conduct",
        "teams/engineering/handbook",
        "teams/engineering/workers/recon/runbook",
        "workers/infra/runbook",
      ]);
    });

    // V2 · BR-1 — a worker document is read exactly as the other two levels read one.
    it("reads a worker document's frontmatter and body exactly as the other levels do", async () => {
      const { documents, errors } = await readResourcesDirectory(
        tree({ "teams/engineering/workers/recon/resources/runbook.md": HANDBOOK }),
      );

      expect(errors).toEqual([]);
      expect(documents[0]!.declared).toEqual({
        description: "How the engineering team works.",
        llmReadable: true,
      });
      expect(documents[0]!.body).toBe(
        "# Engineering handbook\n\nEscalate anything customer-visible within 15 minutes.\n",
      );
    });

    // V2 · BR-2, BR-3 — the silences. Most seats have no documents at all.
    it("is silent for a worker with no resources slot, a team with no workers folder, and a root with no org workers", async () => {
      const { documents, errors } = await readResourcesDirectory(
        tree({
          ...HEALTHY,
          "teams/engineering/workers/recon/WORKER.md": WORKER_MD,
          "teams/marketing/resources/handbook.md": HANDBOOK,
        }),
      );

      expect(errors).toEqual([]);
      expect(documents.map((d) => d.ref).sort()).toEqual([
        "teams/engineering/handbook",
        "teams/marketing/handbook",
      ]);
    });

    // V2 · BR-13 — droppings and non-documents, at the new level too.
    it("passes over a dropping and a non-`.md` file in a worker's resources slot", async () => {
      const { documents, errors } = await readResourcesDirectory(
        tree({
          ...HEALTHY_WORKER,
          "teams/engineering/workers/recon/resources/.DS_Store": "junk",
          "teams/engineering/workers/recon/resources/notes.txt": "not a document",
        }),
      );

      expect(errors).toEqual([]);
      expect(documents.map((d) => d.ref)).toEqual([
        "teams/engineering/workers/recon/runbook",
      ]);
    });

    // V1 · BR-4 — four levels, four refs, no shadowing. There is no precedence
    // rule here because there is no collision to resolve.
    it("lets one bare name exist at all four levels at once", async () => {
      const { documents, errors } = await readResourcesDirectory(
        tree({
          "org/resources/handbook.md": HANDBOOK,
          "teams/engineering/resources/handbook.md": HANDBOOK,
          "teams/engineering/workers/recon/resources/handbook.md": HANDBOOK,
          "org/workers/infra/resources/handbook.md": HANDBOOK,
        }),
      );

      expect(errors).toEqual([]);
      expect(documents.map((d) => d.ref).sort()).toEqual([
        "handbook",
        "teams/engineering/handbook",
        "teams/engineering/workers/recon/handbook",
        "workers/infra/handbook",
      ]);
    });

    // V1 · BR-11 — an address that cannot be minted has nothing to key a record
    // under, so the file is never opened. Reported under the file's own path,
    // the way a bad TEAM folder name already is.
    it("reports a worker folder name that breaks the segment rules, without reading the file", async () => {
      const { documents, errors } = await readResourcesDirectory(
        tree({
          ...HEALTHY_WORKER,
          "teams/engineering/workers/Recon Two/resources/runbook.md": HANDBOOK,
        }),
      );

      expect(documents.map((d) => d.ref)).toEqual(HEALTHY_REFS.slice(1));
      expect(errors).toHaveLength(1);
      expect(errors[0]!.path).toBe(
        "teams/engineering/workers/Recon Two/resources/runbook.md",
      );
      expect(errors[0]!.kind).toBe("document-load-failed");
      expect(errors[0]!.error.message).toMatch(
        /Worker folder name "Recon Two" must be lowercase letters, digits, and single hyphens/,
      );
    });

    // V3 · BR-6 — the slot is decided by POSITION, not by spelling, and
    // `resources` gets no exception at the `workers/` level. `validateSegment`
    // reserves only `_meta`, so `teams/<t>/workers/resources/` is a legal seat:
    // the roster reader hires it and `readSeatSkills` reads its skills. A name
    // check here would leave exactly one seat in the tree whose documents are
    // read by nothing and reported by nothing.
    //
    // Asserted under both parents, because the walk is one function called
    // twice and an exception in one caller would not be in the other.
    it("reads a worker legitimately named `resources` like any other worker", async () => {
      const { documents, errors } = await readResourcesDirectory(
        tree({
          ...HEALTHY_WORKER,
          "teams/engineering/workers/resources/WORKER.md": WORKER_MD,
          "teams/engineering/workers/resources/resources/deeper.md": HANDBOOK,
          "org/workers/resources/WORKER.md": WORKER_MD,
          "org/workers/resources/resources/deeper.md": HANDBOOK,
        }),
      );

      expect(errors).toEqual([]);
      expect(documents.map((d) => d.ref).sort()).toEqual([
        "teams/engineering/workers/recon/runbook",
        "teams/engineering/workers/resources/deeper",
        "workers/resources/deeper",
      ]);
    });

    // V3 · BR-6 — the other half, and the reason a name check looked appealing:
    // an author writing a document one level too high, at
    // `workers/resources/stray.md`. That file is passed over — but by the rule
    // that was always doing the work, not by its name: it sits BESIDE a
    // `resources/` slot rather than in one, exactly as `workers/README.md`
    // does. Pinned in the same tree as a healthy worker so the silence is
    // isolation and not an empty walk.
    it("passes over a document written one level too high, beside the worker folders", async () => {
      const { documents, errors } = await readResourcesDirectory(
        tree({
          ...HEALTHY_WORKER,
          "teams/engineering/workers/resources/stray.md": HANDBOOK,
          "org/workers/resources/stray.md": HANDBOOK,
        }),
      );

      expect(errors).toEqual([]);
      expect(documents.map((d) => d.ref)).toEqual([
        "teams/engineering/workers/recon/runbook",
      ]);
    });

    // V3 · BR-6 — the invariant a per-reader fix would satisfy and still leave
    // broken: the two readers must agree about which folders are seats. Written
    // as a comparison rather than as two literal lists, because what is under
    // test is the AGREEMENT — pinning one reader's expected output would go
    // green again if someone made the other reader refuse the name instead.
    it("reads a document root for every seat the roster hires, `resources` included", async () => {
      const root = tree({
        "teams/engineering/workers/recon/WORKER.md": WORKER_MD,
        "teams/engineering/workers/recon/resources/runbook.md": HANDBOOK,
        "teams/engineering/workers/resources/WORKER.md": WORKER_MD,
        "teams/engineering/workers/resources/resources/runbook.md": HANDBOOK,
      });

      const roster = await readWorkforceDirectory(root);
      const { documents, errors } = await readResourcesDirectory(root);

      expect(roster.errors).toEqual([]);
      expect(errors).toEqual([]);

      // Every hired seat's `runbook` is addressable under that seat's ref.
      const hired = roster.workers.map((w) => w.id).sort();
      expect(hired).toEqual(["engineering.recon", "engineering.resources"]);
      expect(documents.map((d) => d.ref).sort()).toEqual(
        hired.map((id) => `teams/${id.replace(".", "/workers/")}/runbook`),
      );
    });

    // V4 · BR-7 — a directory where a document belongs. Asserted by comparing
    // the two levels' messages rather than by re-typing the sentence: what is
    // under test is that the worker level shares the team level's wording, and
    // a copied string would pass a match and still be a second copy.
    it("reports a directory in a worker's resources slot in the team level's exact wording", async () => {
      const root = tree({ ...HEALTHY, ...HEALTHY_WORKER });
      dir(root, "teams/engineering/resources/handbook");
      dir(root, "teams/engineering/workers/recon/resources/handbook");

      const { documents, errors } = await readResourcesDirectory(root);

      expect(documents.map((d) => d.ref).sort()).toEqual(HEALTHY_REFS);
      expect(errors).toHaveLength(2);

      const atTeam = errors.find((e) => e.path === "teams/engineering/resources/handbook")!;
      const atWorker = errors.find(
        (e) => e.path === "teams/engineering/workers/recon/resources/handbook",
      )!;
      expect(atWorker.kind).toBe("folder-where-file-belongs");
      expect(atWorker.kind).toBe(atTeam.kind);
      expect(atWorker.error.message).toBe(atTeam.error.message);
    });

    // V4 · BR-8 — a symlinked `resources/` slot, refused unopened at the new level.
    it("refuses a symlinked worker resources slot in the shared symlink wording", async () => {
      const root = tree({ ...HEALTHY, ...HEALTHY_WORKER, "outside/handbook.md": HANDBOOK });
      dir(root, "teams/engineering/workers/scout");
      symlinkSync(
        join(root, "outside"),
        join(root, "teams/engineering/workers/scout/resources"),
      );

      const { documents, errors } = await readResourcesDirectory(root);

      expect(documents.map((d) => d.ref).sort()).toEqual(HEALTHY_REFS);
      expect(errors).toHaveLength(1);
      expect(errors[0]!.path).toBe("teams/engineering/workers/scout/resources");
      expect(errors[0]!.kind).toBe("unreadable-slot");
      expect(errors[0]!.error.message).toBe(
        'Symlinked directory "teams/engineering/workers/scout/resources" — refused for safety',
      );
    });

    // V4 · BR-12 — the derived set is refused identically at the new level. Same
    // comparison discipline as BR-7: the two levels' messages must be one string.
    it("refuses a derived declaration in a worker document in the other levels' exact wording", async () => {
      const declaring = `---
description: A document that declares what the convention derives.
ref: somewhere-else
---

body
`;
      const { documents, errors } = await readResourcesDirectory(
        tree({
          ...HEALTHY_WORKER,
          "teams/engineering/resources/handbook.md": declaring,
          "teams/engineering/workers/recon/resources/handbook.md": declaring,
        }),
      );

      expect(documents.map((d) => d.ref)).toEqual([
        "teams/engineering/workers/recon/runbook",
      ]);
      expect(errors).toHaveLength(2);

      const atTeam = errors.find((e) => e.path === "teams/engineering/resources/handbook.md")!;
      const atWorker = errors.find(
        (e) => e.path === "teams/engineering/workers/recon/resources/handbook.md",
      )!;
      expect(atWorker.kind).toBe("refused-declaration");
      expect(atWorker.kind).toBe(atTeam.kind);
      expect(atWorker.error.message).toBe(atTeam.error.message);
    });

    // V4 · BR-12a — the fence's half of the same door. `flowIsolation` is NOT a
    // derived key, so a worker document declaring it is accepted and carried
    // verbatim. This spec goes red the moment someone "tidies" the refused set
    // by adding the key to it — which would refuse it at all three levels and
    // silently un-fence every isolated document in the tree.
    it("carries `flowIsolation: true` through from a worker document rather than refusing it", async () => {
      const { documents, errors } = await readResourcesDirectory(
        tree({
          "teams/engineering/workers/recon/resources/diary.md": `---
description: The seat's own diary.
flowIsolation: true
---

body
`,
        }),
      );

      expect(errors).toEqual([]);
      expect(documents[0]!.ref).toBe("teams/engineering/workers/recon/diary");
      expect(documents[0]!.declared["flowIsolation"]).toBe(true);
    });

    // V5 · BR-9 — a symlinked worker FOLDER. Reported once, under the folder's
    // own path, and nothing beneath it is read.
    it("refuses a symlinked worker folder once, reading nothing beneath it", async () => {
      const root = tree({
        ...HEALTHY,
        ...HEALTHY_WORKER,
        "outside/scout/resources/runbook.md": HANDBOOK,
      });
      symlinkSync(join(root, "outside/scout"), join(root, "teams/engineering/workers/scout"));

      const { documents, errors } = await readResourcesDirectory(root);

      expect(documents.map((d) => d.ref).sort()).toEqual(HEALTHY_REFS);
      expect(errors).toHaveLength(1);
      expect(errors[0]!.path).toBe("teams/engineering/workers/scout");
      expect(errors[0]!.kind).toBe("unreadable-slot");
      expect(errors[0]!.error.message).toBe(
        'Symlinked worker folder "scout" — refused for safety',
      );
    });

    // V5 · BR-10 — a `workers/` level that is there and cannot be listed. That
    // team's worker documents are all missing; its own documents still load.
    it("reports a team's unlistable workers level once, keeping the team's own documents", async () => {
      const { documents, errors } = await readResourcesDirectory(
        tree({ ...HEALTHY, "teams/engineering/workers": "not a directory\n" }),
      );

      expect(documents.map((d) => d.ref)).toEqual(["teams/engineering/handbook"]);
      expect(errors).toHaveLength(1);
      expect(errors[0]!.path).toBe("teams/engineering/workers");
      expect(errors[0]!.kind).toBe("unreadable-slot");
      expect(errors[0]!.error.message).toMatch(/could not be read/i);
    });

    // V5 · BR-9 — a worker folder that cannot be stat'd. `absent` and
    // `unreadable` stay apart here for the reason they do at every other level:
    // folded together, the folder is skipped in silence and its documents
    // disappear with `errors` empty for the caller's fatal check to look at.
    it("reports a worker folder it cannot stat rather than dropping its documents", async () => {
      const root = tree({
        ...HEALTHY,
        ...HEALTHY_WORKER,
        "teams/engineering/workers/scout/resources/runbook.md": HANDBOOK,
      });
      const locked = join(root, "teams/engineering/workers/scout");
      const real = fsp.lstat.bind(fsp);
      vi.spyOn(fsp, "lstat").mockImplementation(((target: Parameters<typeof real>[0]) => {
        if (String(target) === locked) {
          const err = new Error(`EACCES: permission denied, lstat '${locked}'`);
          (err as NodeJS.ErrnoException).code = "EACCES";
          return Promise.reject(err);
        }
        return real(target);
      }) as unknown as typeof fsp.lstat);

      const { documents, errors } = await readResourcesDirectory(root);

      expect(documents.map((d) => d.ref).sort()).toEqual(HEALTHY_REFS);
      expect(errors).toHaveLength(1);
      expect(errors[0]!.path).toBe("teams/engineering/workers/scout");
      expect(errors[0]!.kind).toBe("unreadable-slot");
      expect(errors[0]!.error.message).toMatch(/^Worker folder "scout" could not be read: /);
    });

    // V5 · BR-17 — the org parent's own structural report. `org/workers` is a
    // level the walk reaches under `org/` exactly as it does under a team, and
    // `org/resources/` must survive it.
    it("reports an unlistable `org/workers` under its own path, keeping org documents", async () => {
      const { documents, errors } = await readResourcesDirectory(
        tree({
          ...HEALTHY,
          "org/resources/code-of-conduct.md": HANDBOOK,
          "org/workers": "not a directory\n",
        }),
      );

      expect(documents.map((d) => d.ref).sort()).toEqual([
        "code-of-conduct",
        "teams/engineering/handbook",
      ]);
      expect(errors).toHaveLength(1);
      expect(errors[0]!.path).toBe("org/workers");
      expect(errors[0]!.kind).toBe("unreadable-slot");
      expect(errors[0]!.error.message).toMatch(/could not be read/i);
    });

    // V5 · BR-17 — the same refusal one level in, under the org parent.
    it("refuses a symlinked org worker folder, keeping org documents", async () => {
      const root = tree({
        "org/resources/code-of-conduct.md": HANDBOOK,
        "outside/infra/resources/runbook.md": HANDBOOK,
      });
      dir(root, "org/workers");
      symlinkSync(join(root, "outside/infra"), join(root, "org/workers/infra"));

      const { documents, errors } = await readResourcesDirectory(root);

      expect(documents.map((d) => d.ref)).toEqual(["code-of-conduct"]);
      expect(errors).toHaveLength(1);
      expect(errors[0]!.path).toBe("org/workers/infra");
      expect(errors[0]!.kind).toBe("unreadable-slot");
      expect(errors[0]!.error.message).toBe(
        'Symlinked worker folder "infra" — refused for safety',
      );
    });

    // V6 · BR-5, D3 — the readers are independent. This one answers a question
    // about a FILE; the missing seat is the roster reader's to report, and it
    // still does, separately. The moment this reader consults `WORKER.md`, one
    // reader is running another's job.
    it("loads a worker folder's documents whether or not the folder holds a WORKER.md", async () => {
      const { documents, errors } = await readResourcesDirectory(
        tree({
          // No WORKER.md anywhere — a typo'd folder, or a seat not yet written.
          "teams/engineering/workers/recon/resources/runbook.md": HANDBOOK,
          "org/workers/infra/resources/runbook.md": HANDBOOK,
        }),
      );

      expect(errors).toEqual([]);
      expect(documents.map((d) => d.ref).sort()).toEqual([
        "teams/engineering/workers/recon/runbook",
        "workers/infra/runbook",
      ]);
    });

    // V6 · BR-6 — a file under `workers/` occupies no worker slot. The
    // inversion of this reader's own file-not-folder rule, and deliberately the
    // worker reader's rule instead: `workers/` holds folders.
    it("passes over a stray file in a `workers/` level in silence", async () => {
      const { documents, errors } = await readResourcesDirectory(
        tree({
          ...HEALTHY_WORKER,
          "teams/engineering/workers/README.md": "notes about this team's seats\n",
          "teams/engineering/workers/.DS_Store": "junk",
        }),
      );

      expect(errors).toEqual([]);
      expect(documents.map((d) => d.ref)).toEqual([
        "teams/engineering/workers/recon/runbook",
      ]);
    });

    // V7 · BR-14 — the byte-for-byte promise, in the form this suite can hold
    // it: a tree whose new levels are healthy and empty of documents loads
    // exactly what the same tree without those levels loads. The rest of BR-14
    // is the shipped suite above, which is unmodified.
    it("loads a tree with healthy but document-less worker levels exactly as the same tree without them", async () => {
      const before = await readResourcesDirectory(
        tree({
          "org/resources/code-of-conduct.md": HANDBOOK,
          "teams/engineering/resources/handbook.md": HANDBOOK,
          "teams/marketing/resources/handbook.md": HANDBOOK,
        }),
      );

      const withWorkerLevels = tree({
        "org/resources/code-of-conduct.md": HANDBOOK,
        "teams/engineering/resources/handbook.md": HANDBOOK,
        "teams/engineering/workers/recon/WORKER.md": WORKER_MD,
        "teams/marketing/resources/handbook.md": HANDBOOK,
        "org/workers/infra/WORKER.md": WORKER_MD,
      });
      const after = await readResourcesDirectory(withWorkerLevels);

      expect(after.errors).toEqual([]);
      expect(after.documents).toEqual(before.documents);
    });

    // V8 · BR-14a — BR-14's remainder, stated rather than hidden. A tree with
    // no worker documents but a SYMLINKED worker folder gains exactly one
    // report where today there is none, and loses no document. A refused folder
    // is refused unopened, so the reader cannot know whether it held documents;
    // reporting it has to be unconditional.
    it("adds exactly one report for a symlinked worker folder in a tree with no worker documents", async () => {
      const root = tree({
        "org/resources/code-of-conduct.md": HANDBOOK,
        "teams/engineering/resources/handbook.md": HANDBOOK,
        "outside/scout/WORKER.md": WORKER_MD,
      });
      dir(root, "teams/engineering/workers");
      symlinkSync(join(root, "outside/scout"), join(root, "teams/engineering/workers/scout"));

      const { documents, errors } = await readResourcesDirectory(root);

      expect(documents.map((d) => d.ref).sort()).toEqual([
        "code-of-conduct",
        "teams/engineering/handbook",
      ]);
      expect(errors).toHaveLength(1);
      expect(errors[0]!.path).toBe("teams/engineering/workers/scout");
    });
  });
});
