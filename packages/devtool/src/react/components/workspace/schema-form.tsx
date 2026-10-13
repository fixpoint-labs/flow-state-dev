import type { ActionInputSchema, ActionFieldSchema } from "@flow-state-dev/client";
import { Input } from "../ui/input";
import { Label } from "../ui/label";

type SchemaFormProps = {
  schema: ActionInputSchema;
  values: Record<string, unknown>;
  onChange: (values: Record<string, unknown>) => void;
  disabled?: boolean;
  onSubmit?: () => void;
  /**
   * Fields whose value is fixed by the caller: drawn with that value and not
   * editable. The Tasks tab fixes a row action's `taskId` to the row's task.
   */
  locked?: Record<string, unknown>;
};

export function SchemaForm({ schema, values, onChange, disabled, onSubmit, locked }: SchemaFormProps) {
  if (schema.type !== "object") return null;

  const fields = Object.entries(schema.fields);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      onSubmit?.();
    }
  };

  return (
    <div className="flex flex-wrap gap-2.5" onKeyDown={handleKeyDown}>
      {fields.map(([name, field]) =>
        locked !== undefined && Object.hasOwn(locked, name) ? (
          <LockedField key={name} name={name} value={locked[name]} />
        ) : (
          <FieldInput
            key={name}
            name={name}
            field={field}
            value={values[name]}
            onChange={(val) => onChange({ ...values, [name]: val })}
            disabled={disabled}
          />
        )
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Per-field renderer
// ---------------------------------------------------------------------------

/** A field the caller fixed: shown, never edited. */
function LockedField({ name, value }: { name: string; value: unknown }) {
  return (
    <div className="flex min-w-[180px] flex-1 flex-col gap-1" data-field={name}>
      <Label className="gap-1.5 truncate">
        {name}
        <span className="normal-case tracking-normal text-fs-ink4">(this task)</span>
      </Label>
      <Input
        className="h-8 bg-fs-paper text-fs-ink2"
        type="text"
        value={typeof value === "string" ? value : JSON.stringify(value)}
        readOnly
        aria-readonly
      />
    </div>
  );
}

type FieldInputProps = {
  name: string;
  field: ActionFieldSchema;
  value: unknown;
  onChange: (value: unknown) => void;
  disabled?: boolean;
};

function FieldInput({ name, field, value, onChange, disabled }: FieldInputProps) {
  const label = name;
  const placeholder = field.description ?? formatPlaceholder(name, field);

  return (
    <div className="flex min-w-[180px] flex-1 flex-col gap-1" data-field={name}>
      <Label className="gap-1.5 truncate">
        {label}
        {!field.required && <span className="normal-case tracking-normal text-fs-ink4">(optional)</span>}
      </Label>
      {renderInput(field, value, onChange, disabled, placeholder)}
    </div>
  );
}

function renderInput(
  field: ActionFieldSchema,
  value: unknown,
  onChange: (value: unknown) => void,
  disabled?: boolean,
  placeholder?: string
): React.ReactNode {
  switch (field.type) {
    case "string":
      return (
        <Input
          className="h-8"
          type="text"
          value={typeof value === "string" ? value : ""}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          disabled={disabled}
        />
      );

    case "number":
      return (
        <Input
          className="h-8"
          type="number"
          value={value !== undefined && value !== null ? String(value) : ""}
          onChange={(e) => {
            const v = e.target.value;
            onChange(v === "" ? undefined : Number(v));
          }}
          placeholder={placeholder}
          min={field.min}
          max={field.max}
          disabled={disabled}
        />
      );

    case "boolean":
      return (
        <label className="flex h-8 items-center gap-2 cursor-pointer">
          <input
            type="checkbox"
            className="size-3.5 rounded-none accent-[var(--fs-blue)] outline-none focus-visible:ring-2 focus-visible:ring-fs-blue/40"
            checked={!!value}
            onChange={(e) => onChange(e.target.checked)}
            disabled={disabled}
          />
          <span className="font-fs-mono text-xs text-fs-ink3">{value ? "true" : "false"}</span>
        </label>
      );

    case "enum":
      return (
        <select
          className="h-8 w-full px-2 rounded-none border border-fs-ink/35 bg-fs-card text-fs-ink font-fs-mono text-xs focus:border-fs-blue focus:ring-2 focus:ring-fs-blue/20 outline-none"
          value={typeof value === "string" ? value : ""}
          onChange={(e) => onChange(e.target.value)}
          disabled={disabled}
        >
          {!field.required && !field.default && <option value="">—</option>}
          {field.enumValues?.map((v) => (
            <option key={v} value={v}>{v}</option>
          ))}
        </select>
      );

    case "array":
    case "unknown":
    default:
      return (
        <textarea
          className="h-16 w-full resize-y px-2.5 py-1.5 leading-[1.55] placeholder:text-fs-ink4 rounded-none border border-fs-ink/35 bg-fs-card text-fs-ink font-fs-mono text-xs focus:border-fs-blue focus:ring-2 focus:ring-fs-blue/20 outline-none"
          value={typeof value === "string" ? value : (value !== undefined ? JSON.stringify(value, null, 2) : "")}
          onChange={(e) => {
            try {
              onChange(JSON.parse(e.target.value));
            } catch {
              onChange(e.target.value);
            }
          }}
          placeholder={placeholder ?? "JSON..."}
          disabled={disabled}
        />
      );
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatPlaceholder(name: string, field: ActionFieldSchema): string {
  const label = name.replace(/([A-Z])/g, " $1").toLowerCase().trim();
  if (field.default !== undefined) return `${String(field.default)}`;
  return `${label.charAt(0).toUpperCase() + label.slice(1)}...`;
}
