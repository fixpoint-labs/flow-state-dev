import type { ActionInputSchema, ActionFieldSchema } from "@flow-state-dev/client";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

type SchemaFormProps = {
  schema: ActionInputSchema;
  values: Record<string, unknown>;
  onChange: (values: Record<string, unknown>) => void;
  disabled?: boolean;
  onSubmit?: () => void;
};

export function SchemaForm({ schema, values, onChange, disabled, onSubmit }: SchemaFormProps) {
  if (schema.type !== "object") return null;

  const fields = Object.entries(schema.fields);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      onSubmit?.();
    }
  };

  return (
    <div className="flex flex-wrap gap-x-3 gap-y-2 pt-2" onKeyDown={handleKeyDown}>
      {fields.map(([name, field]) => (
        <FieldInput
          key={name}
          name={name}
          field={field}
          value={values[name]}
          onChange={(val) => onChange({ ...values, [name]: val })}
          disabled={disabled}
        />
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Per-field renderer
// ---------------------------------------------------------------------------

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
    <div className="min-w-[180px] flex-1 space-y-1">
      <Label className="text-[10px] uppercase text-slate-500">
        {label}
        {!field.required && <span className="ml-1 normal-case text-slate-600">(optional)</span>}
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
          className="h-8 text-xs"
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
          className="h-8 text-xs"
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
            className="h-4 w-4 rounded border-slate-700 bg-slate-900 accent-sky-500"
            checked={!!value}
            onChange={(e) => onChange(e.target.checked)}
            disabled={disabled}
          />
          <span className="text-xs text-slate-400">{value ? "true" : "false"}</span>
        </label>
      );

    case "enum":
      return (
        <select
          className="h-8 w-full rounded border border-slate-800 bg-slate-950 px-2 text-xs text-slate-300 outline-none"
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
          className="h-16 w-full resize-y rounded border border-slate-800 bg-slate-950 px-2 py-1 font-mono text-xs text-slate-300 outline-none placeholder:text-slate-600"
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
