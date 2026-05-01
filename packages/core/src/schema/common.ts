import type { ZodTypeAny } from "zod";

export type MaybePromise<T> = T | Promise<T>;

export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonObject | JsonValue[];
export type JsonObject = { [key: string]: JsonValue };

export type SchemaInput<TSchema> = TSchema extends ZodTypeAny ? TSchema["_input"] : never;
export type SchemaOutput<TSchema> = TSchema extends ZodTypeAny ? TSchema["_output"] : never;
