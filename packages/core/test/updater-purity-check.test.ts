import { describe, expect, it } from "vitest";
// @ts-expect-error — root check script, plain .mjs with no type declarations.
import { analyzeSources, exemptFiles } from "../../../scripts/validate-updater-purity.mjs";

type Finding = {
  file: string;
  line: number;
  binding: string;
  form: string;
  detail: string;
};

const analyze = (code: string, path = "/fixture.ts"): Finding[] =>
  (analyzeSources as (s: Array<{ path: string; code: string }>) => Finding[])([{ path, code }]);

describe("updater-purity check — the three write forms Decision 4 names", () => {
  it("flags assignment to an outer binding", () => {
    // The shape at working-memory-helpers.ts `evict`.
    const findings = analyze(`
      async function evict(ref: any, id: string) {
        let found = false
        await ref.updateState((s: any) => {
          const idx = s.entries.findIndex((e: any) => e.id === id)
          if (idx < 0) return s
          found = true
          return { ...s, entries: [] }
        })
        return found
      }
    `);

    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({ binding: "found", form: "assignment" });
  });

  it("flags a mutating call whose receiver is an outer binding", () => {
    // Round 1's regression case: `culled.push(id)` assigns to nothing, so an
    // assignment-only rule passes it — and it is one of the three accumulators
    // whose stale output the spec's POC printed.
    const findings = analyze(`
      async function cullByTTL(ref: any) {
        const culled: string[] = []
        await ref.updateState((s: any) => {
          for (const ep of s.episodes) culled.push(ep.id)
          return s
        })
        return culled
      }
    `);

    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({ binding: "culled", form: "mutating-call" });
  });

  it("flags property assignment through an outer binding", () => {
    // The shape at sequencer-backed.ts `reclaim` — neither an assignment to
    // the binding nor a method call.
    const findings = analyze(`
      async function reclaim(casWrite: any) {
        const reclaimed: any[] = []
        await casWrite((tasks: any) => {
          reclaimed.length = 0
          return tasks
        })
        return reclaimed.length
      }
    `);

    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({ binding: "reclaimed", form: "property-assignment" });
  });

  it("flags compound assignment and increment through an outer binding", () => {
    const findings = analyze(`
      async function count(ref: any) {
        let total = 0
        let seen = 0
        await ref.updateState((s: any) => {
          total += s.n
          seen++
          return s
        })
        return total + seen
      }
    `);

    expect(findings.map((f) => f.form).sort()).toEqual(["assignment", "increment"]);
  });
});

describe("updater-purity check — writes hidden behind type-only wrappers", () => {
  // These are the shapes a developer reaches for when the compiler complains
  // about writing through a captured binding. They carry no runtime meaning, so
  // stopping at the wrapper reports nothing while the write still happens.
  const cases: Array<[string, string]> = [
    ["an `as` assertion", "(captured as any).value = next"],
    ["an angle-bracket assertion", "(<any>captured).value = next"],
    ["a `satisfies` expression", "(captured satisfies any).value = next"],
    ["a non-null assertion", "captured!.value = next"],
    ["redundant parentheses", "((captured)).value = next"],
  ];

  it.each(cases)("flags a property assignment through %s", (_name, write) => {
    const findings = analyze(`
      async function patch(ref: any, next: any) {
        const captured: any = {}
        await ref.updateState((s: any) => {
          ${write}
          return s
        })
        return captured
      }
    `);

    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({ binding: "captured", form: "property-assignment" });
  });

  it("flags a mutating call whose receiver is an asserted outer binding", () => {
    const findings = analyze(`
      async function cull(ref: any) {
        const culled: string[] = []
        await ref.updateState((s: any) => {
          (culled as any).push(s.id)
          return s
        })
        return culled
      }
    `);

    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({ binding: "culled", form: "mutating-call" });
  });

  it("flags a direct assignment to an asserted outer binding", () => {
    const findings = analyze(`
      async function evict(ref: any) {
        let found = false
        await ref.updateState((s: any) => {
          (found as any) = true
          return s
        })
        return found
      }
    `);

    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({ binding: "found" });
  });
});

describe("updater-purity check — the wrapper registry", () => {
  it("sees a callback reached only through a wrapper (casWrite)", () => {
    // A direct-argument check inspects only `casWrite`'s internal closure and
    // never sees the caller's callback. Without the registry this is green.
    const findings = analyze(`
      async function transitionTo(casWrite: any, id: string) {
        let captured: any
        await casWrite((tasks: any) => {
          captured = tasks[id]
          return tasks
        })
        return captured
      }
    `);

    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({ binding: "captured", form: "assignment" });
  });

  it("sees a callback passed to atomicState and to the outcome helper itself", () => {
    const findings = analyze(`
      async function twoRunners(sequencer: any, run: any) {
        let a: any
        let b: any
        await sequencer.atomicState((s: any) => { a = s.x; return {} })
        await withOutcome(run, (s: any) => { b = s.y; return { state: s, result: 1 } })
        return [a, b]
      }
      declare function withOutcome(run: any, updater: any): Promise<any>
    `);

    expect(findings.map((f) => f.binding).sort()).toEqual(["a", "b"]);
  });
});

describe("updater-purity check — callbacks that are not written inline", () => {
  it("flags a callback extracted to a const before being passed", () => {
    // Extract-to-variable is a one-line refactor. If the check only inspects
    // inline function expressions, this shape walks straight through it and
    // reintroduces the defect the script exists to reject.
    const findings = analyze(`
      async function evict(ref: any, id: string) {
        let found = false
        const updater = (s: any) => {
          found = true
          return s
        }
        await ref.updateState(updater)
        return found
      }
    `);

    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({ binding: "found", form: "assignment" });
  });

  it("flags a callback extracted to a function declaration", () => {
    const findings = analyze(`
      async function cull(ref: any) {
        const culled: string[] = []
        function updater(s: any) {
          for (const x of s.items) culled.push(x.id)
          return s
        }
        await ref.updateState(updater)
        return culled
      }
    `);

    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({ binding: "culled", form: "mutating-call" });
  });

  it("flags a named callback passed through a wrapper (casWrite)", () => {
    const findings = analyze(`
      async function reclaim(casWrite: any) {
        const reclaimed: any[] = []
        const mutate = (tasks: any) => {
          reclaimed.length = 0
          return tasks
        }
        await casWrite(mutate)
        return reclaimed.length
      }
    `);

    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({ binding: "reclaimed", form: "property-assignment" });
  });

  it("does NOT flag a named callback that writes nothing outward", () => {
    // The negative half: resolving identifiers must not start flagging the
    // safe extracted callbacks that already exist.
    const findings = analyze(`
      async function advance(ref: any, decay: number) {
        const updater = (s: any) => {
          const entries = s.entries.map((e: any) => ({ ...e, salience: e.salience * decay }))
          entries.sort()
          return { ...s, entries }
        }
        await ref.updateState(updater)
      }
    `);

    expect(findings).toEqual([]);
  });
});

describe("updater-purity check — the negative space that keeps it usable", () => {
  it("does NOT flag `assertWithinCaps(next)` — a factory-scoped pure validator", () => {
    // Round 2's regression case, in the form that actually exercises the
    // narrowed call rule. Declared as a `const` arrow it IS a variable binding
    // in the enclosing factory, so the imports/globals carve-out does not
    // excuse it and the `isBinding` filter does not skip it — the only thing
    // keeping it green is that rule (b) requires a KNOWN-MUTATING method on
    // the receiver. Widen (b) to "any call rooted at an outer binding" (round
    // 1's proposal) and this fixture red-lights safe code in `pnpm typecheck`.
    const findings = analyze(`
      function createCollection(options: any) {
        const assertWithinCaps = (next: any): void => {
          if (Object.keys(next).length > 10) throw new Error("cap")
        }
        const helpers = { assertTransitionAllowed: (a: any) => a }
        async function addTask(casWrite: any, task: any) {
          await casWrite((tasks: any) => {
            const next = { ...tasks, [task.id]: task }
            assertWithinCaps(next)
            helpers.assertTransitionAllowed(next)
            return next
          })
        }
        return { addTask }
      }
    `);

    expect(findings).toEqual([]);
  });

  it("does NOT flag a factory-scoped validator declared as a function declaration", () => {
    // The form the real `sequencer-backed.ts` uses for `assertWithinCaps`.
    const findings = analyze(`
      function createCollection(options: any) {
        function assertWithinCaps(next: any): void {
          if (Object.keys(next).length > 10) throw new Error("cap")
        }
        async function addTask(casWrite: any, task: any) {
          await casWrite((tasks: any) => {
            const next = { ...tasks, [task.id]: task }
            assertWithinCaps(next)
            return next
          })
        }
        return { addTask }
      }
    `);

    expect(findings).toEqual([]);
  });

  it("does NOT flag a binding the callback declares itself", () => {
    const findings = analyze(`
      async function safe(ref: any) {
        await ref.updateState((s: any) => {
          const entries = [...s.entries]
          entries.push({ id: "x" })
          let local = 0
          local += 1
          return { ...s, entries, local }
        })
      }
    `);

    expect(findings).toEqual([]);
  });

  it("does NOT flag module imports or globals", () => {
    const findings = analyze(`
      import { logger } from "./logger"
      const CACHE = new Map<string, number>()
      async function safe(ref: any) {
        await ref.updateState((s: any) => {
          logger.push("hi")
          CACHE.set("k", 1)
          Object.defineProperty(s, "x", { value: 1 })
          return s
        })
      }
    `);

    expect(findings).toEqual([]);
  });

  it("does NOT flag a pure spread updater — the shape of the safe sites", () => {
    const findings = analyze(`
      async function advance(ref: any, resolved: any) {
        await ref.updateState((s: any) => {
          const newTurn = s.currentTurn + 1
          return { entries: s.entries.map((e: any) => ({ ...e, turn: newTurn })), currentTurn: newTurn }
        })
      }
    `);

    expect(findings).toEqual([]);
  });

  it("does NOT flag reads of an outer binding", () => {
    const findings = analyze(`
      async function safe(ref: any, resolved: any) {
        const limit = resolved.capacity
        await ref.updateState((s: any) => {
          if (s.entries.length >= limit) return s
          return { ...s, ok: true }
        })
      }
    `);

    expect(findings).toEqual([]);
  });
});

describe("updater-purity check — the exemption", () => {
  it("holds exactly one entry, so it cannot be broadened into a no-op", () => {
    expect(exemptFiles).toEqual(["packages/core/src/helpers/update-state-with.ts"]);
  });
});
