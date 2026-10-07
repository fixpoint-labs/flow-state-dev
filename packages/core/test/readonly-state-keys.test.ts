/**
 * `getReadonlyStateKeys`: which top-level session-state fields are fixed for a
 * session's life. Read from zod 3 and zod 4 schemas alike, since an app may
 * hand the framework either.
 */
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { z as z4 } from "zod/v4";
import { getReadonlyStateKeys } from "../src/helpers";

describe("getReadonlyStateKeys", () => {
  it("finds top-level readonly fields, through default, optional and nullable either side", () => {
    const schema = z.object({
      projectId: z.string().readonly(),
      region: z.string().readonly().default("eu"),
      owner: z.string().default("me").readonly(),
      maybe: z.string().readonly().optional(),
      note: z.string(),
      nested: z.object({ inner: z.string().readonly() })
    });
    expect(getReadonlyStateKeys(schema)).toEqual(["projectId", "region", "owner", "maybe"]);
  });

  it("reads a zod 4 schema the same way", () => {
    const schema = z4.object({
      projectId: z4.string().readonly(),
      region: z4.string().readonly().default("eu"),
      note: z4.string()
    });
    expect(getReadonlyStateKeys(schema as never)).toEqual(["projectId", "region"]);
  });

  it("finds none in anything but a plain object at the top", () => {
    expect(getReadonlyStateKeys(undefined)).toEqual([]);
    expect(getReadonlyStateKeys(z.object({ a: z.string().readonly() }).default({ a: "x" }))).toEqual([]);
    expect(
      getReadonlyStateKeys(z.union([z.object({ a: z.string().readonly() }), z.object({ b: z.string() })]))
    ).toEqual([]);
    expect(getReadonlyStateKeys(z.lazy(() => z.object({ a: z.string().readonly() })))).toEqual([]);
  });
});
