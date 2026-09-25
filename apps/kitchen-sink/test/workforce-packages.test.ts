/**
 * The kitchen-sink hire's package wiring: the generated `packageBlocks` reach
 * the hire, and a package the loader refused stops start.
 *
 * Every package problem is a start-time refusal, so a refused `PACKAGE.md` must
 * not boot the app with the worker quietly short that package. The loader's
 * `packageErrors` is the only place a refused instructions-only package shows,
 * which is why the app has to read it.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

const loader = vi.hoisted(() => ({ packageErrors: [] as Array<{ path: string; error: Error; kind: string }> }));
const hired = vi.hoisted(() => ({ options: [] as unknown[] }));

vi.mock("@flow-state-dev/workforce/loader", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@flow-state-dev/workforce/loader")>();
  return {
    ...actual,
    readWorkforce: async (root: string) => {
      const result = await actual.readWorkforce(root);
      return { ...result, packageErrors: [...result.packageErrors, ...loader.packageErrors] };
    },
  };
});

vi.mock("@flow-state-dev/workforce", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@flow-state-dev/workforce")>();
  return {
    ...actual,
    hireWorkforce: (...args: Parameters<typeof actual.hireWorkforce>) => {
      hired.options.push(args[1]);
      return actual.hireWorkforce(...args);
    },
  };
});

const { hireKitchenSinkWorkforce } = await import("../workforce/hire");
const { packageBlocks } = await import("../workforce/workforce.gen");

afterEach(() => {
  loader.packageErrors = [];
  hired.options = [];
});

describe("the kitchen-sink hire and packages", () => {
  it("passes the generated packageBlocks to the hire", async () => {
    await hireKitchenSinkWorkforce();
    expect(hired.options.length).toBeGreaterThan(0);
    expect((hired.options[0] as { packageBlocks?: unknown }).packageBlocks).toBe(packageBlocks);
  });

  it("does not start when the loader refused a package, naming its folder", async () => {
    const at = "teams/support/workers/iris/packages/refunds";
    loader.packageErrors = [{ path: at, error: new Error("no PACKAGE.md"), kind: "package-load-failed" }];
    await expect(hireKitchenSinkWorkforce()).rejects.toThrow(at);
    expect(hired.options).toEqual([]);
  });
});
