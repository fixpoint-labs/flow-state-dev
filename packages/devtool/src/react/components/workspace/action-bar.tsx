import { useState, useCallback, useEffect, useRef } from "react";
import { Loader2 } from "lucide-react";
import type { ActionInputSchema } from "@flow-state-dev/client";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Tabs, TabsList, TabsTrigger } from "../ui/tabs";
import { useDebug } from "../../context/debug-context";
import { readLastAction, writeLastAction } from "../../config";
import { SchemaForm } from "./schema-form";

type ActionBarProps = {
  /**
   * The exact instance the dispatch is addressed to, and the key the
   * last-used action is remembered under. Two copies of a kind declare the same
   * actions but run different code, so remembering per kind would carry one
   * copy's choice onto the other.
   */
  flowId: string | null;
  sessionId: string | null;
  availableActions: string[];
  actionSchemas?: Record<string, ActionInputSchema>;
  onSendAction: (action: string, input: unknown) => Promise<unknown>;
  isSending: boolean;
};

/** Each field's default, or an enum's first value, as the form starts. */
export function getDefaults(schema: ActionInputSchema | undefined): Record<string, unknown> {
  if (!schema || schema.type !== "object") return {};
  const defaults: Record<string, unknown> = {};
  for (const [key, field] of Object.entries(schema.fields)) {
    if (field.default !== undefined) {
      defaults[key] = field.default;
    } else if (field.type === "enum" && field.required && field.enumValues?.length) {
      // Only a required choice starts on its first value. An optional one
      // starts on the form's "—" and is left out unless picked: an action that
      // refuses a field alongside another (an answer sent with a status) must
      // not be sent one nobody chose.
      defaults[key] = field.enumValues[0];
    }
  }
  return defaults;
}

/** Whether a schema has fields a form can draw. */
export function isRenderable(schema: ActionInputSchema | undefined): boolean {
  return schema !== undefined && schema.type === "object" && Object.keys(schema.fields).length > 0;
}

/** The action input a filled form stands for; empty optional fields are left out. */
export function buildInputFromForm(
  schema: ActionInputSchema,
  values: Record<string, unknown>
): unknown {
  if (schema.type !== "object") return values;
  const result: Record<string, unknown> = {};
  for (const [key, field] of Object.entries(schema.fields)) {
    const val = values[key];
    // Omit undefined optional fields
    if (val === undefined || val === "") {
      if (!field.required && field.default === undefined) continue;
      // Include empty string for required string fields (server will validate)
      if (field.type === "string" && val === "") {
        result[key] = val;
        continue;
      }
      if (field.default !== undefined) continue; // let server apply default
      continue;
    }
    result[key] = val;
  }
  return result;
}

export function ActionBar({
  flowId,
  sessionId,
  availableActions,
  actionSchemas,
  onSendAction,
  isSending
}: ActionBarProps) {
  const { isDebugMode, toggleDebugMode } = useDebug();

  const [selectedAction, setSelectedAction] = useState<string>("");
  const [jsonInput, setJsonInput] = useState("{}");
  const [jsonError, setJsonError] = useState<string | null>(null);
  const [formValues, setFormValues] = useState<Record<string, unknown>>({});
  const [inputMode, setInputMode] = useState<"form" | "json">("json");

  // Sync selectedAction when availableActions arrive or flow changes
  useEffect(() => {
    if (availableActions.length === 0) {
      setSelectedAction((prev) => prev === "" ? prev : "");
      return;
    }
    const persisted = flowId ? readLastAction(flowId) : null;
    const target = persisted && availableActions.includes(persisted)
      ? persisted
      : availableActions[0];
    setSelectedAction((prev) => prev === target ? prev : target);
  }, [availableActions, flowId]);

  // Derive current schema reactively
  const currentSchema = actionSchemas?.[selectedAction];
  const hasForm = isRenderable(currentSchema);

  // Track what we last initialized for to avoid re-running on object reference changes.
  const initializedRef = useRef("");
  useEffect(() => {
    if (!selectedAction) return;
    const schema = actionSchemas?.[selectedAction];
    const key = selectedAction + ":" + (schema ? JSON.stringify(schema) : "null");
    if (key === initializedRef.current) return;
    initializedRef.current = key;
    const renderable = isRenderable(schema);
    const defaults = getDefaults(schema);
    setFormValues(defaults);
    setInputMode(renderable ? "form" : "json");
    setJsonInput(renderable ? JSON.stringify(defaults, null, 2) : "{}");
  }, [selectedAction, actionSchemas]);

  // Sync form ↔ JSON when toggling modes
  const handleModeChange = useCallback((mode: string) => {
    if (mode === "json" && inputMode === "form") {
      const input = buildInputFromForm(currentSchema!, formValues);
      setJsonInput(JSON.stringify(input, null, 2));
    } else if (mode === "form" && inputMode === "json") {
      try {
        const parsed = JSON.parse(jsonInput);
        if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) {
          setFormValues({ ...getDefaults(currentSchema), ...parsed });
        }
      } catch {
        // Keep existing form values on parse failure
      }
    }
    setInputMode(mode as "form" | "json");
  }, [inputMode, formValues, jsonInput, currentSchema]);

  const handleActionChange = (action: string) => {
    initializedRef.current = "";
    setSelectedAction(action);
    if (flowId) writeLastAction(flowId, action);
  };

  const handleSend = useCallback(async () => {
    if (!selectedAction || !flowId || !sessionId) return;
    // Remember which field is focused so we can restore it after reset.
    const activeEl = document.activeElement as HTMLElement | null;
    const focusedField = activeEl?.closest("[data-field]")?.getAttribute("data-field");
    try {
      let input: unknown;
      if (inputMode === "json") {
        input = JSON.parse(jsonInput);
      } else {
        input = buildInputFromForm(currentSchema!, formValues);
      }
      setJsonError(null);
      await onSendAction(selectedAction, input);
      // Reset fields to defaults — clears text inputs but preserves defaults/enums.
      const defaults = getDefaults(currentSchema);
      setFormValues(defaults);
      setJsonInput(isRenderable(currentSchema) ? JSON.stringify(defaults, null, 2) : "{}");
      // Restore focus to the same field after React re-renders.
      if (focusedField) {
        requestAnimationFrame(() => {
          const container = document.querySelector(`[data-field="${focusedField}"]`);
          const input = container?.querySelector("input, textarea, select") as HTMLElement | null;
          input?.focus();
        });
      }
    } catch (err) {
      if (err instanceof SyntaxError) {
        setJsonError(err.message);
      }
    }
  }, [selectedAction, flowId, sessionId, inputMode, jsonInput, formValues, currentSchema, onSendAction]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey && !isSending) {
      e.preventDefault();
      void handleSend();
    }
  };

  const disabled = !flowId || !sessionId || isSending;

  return (
    // The panel frames the composer (top hairline, inspector ground, padding),
    // so this root adds none of its own.
    <div className="flex flex-col gap-2.5">
      {/* Row 1: Action selector + Form/JSON toggle + Debug + Send */}
      <div className="flex min-w-0 flex-wrap items-center gap-2.5">
        <span className="font-fs-mono text-[10px] font-medium uppercase tracking-[.14em] whitespace-nowrap text-fs-ink3">
          Action
        </span>
        <select
          className="h-7 min-w-[120px] px-2 rounded-none border border-fs-ink/35 bg-fs-card text-fs-ink font-fs-mono text-xs focus:border-fs-blue focus:ring-2 focus:ring-fs-blue/20 outline-none disabled:opacity-50"
          value={selectedAction}
          onChange={(e) => handleActionChange(e.target.value)}
          disabled={disabled}
        >
          {availableActions.length === 0 && <option value="">No actions</option>}
          {availableActions.map((a) => (
            <option key={a} value={a}>{a}</option>
          ))}
        </select>

        {hasForm && (
          <Tabs value={inputMode} onValueChange={handleModeChange} className="flex-none">
            <TabsList className="items-stretch gap-0 border border-fs-ink/45">
              <TabsTrigger value="form" className={SEGMENT}>Form</TabsTrigger>
              <TabsTrigger value="json" className={`${SEGMENT} border-l border-l-fs-ink/45`}>JSON</TabsTrigger>
            </TabsList>
          </Tabs>
        )}

        <div className="flex-1" />

        {/* The form and the JSON field both send on Enter (Shift+Enter does not). */}
        <span className="font-fs-mono text-[10.5px] whitespace-nowrap text-fs-ink4">↵ send</span>

        <button
          type="button"
          onClick={toggleDebugMode}
          title="Debug Mode"
          aria-pressed={isDebugMode}
          className={`h-7 flex-none border px-2.5 font-fs-mono text-[11.5px] font-medium whitespace-nowrap outline-none hover:border-fs-ink focus-visible:ring-2 focus-visible:ring-fs-blue/40 ${
            isDebugMode ? "border-fs-blue text-fs-blue" : "border-fs-ink/35 text-fs-ink2"
          }`}
        >
          debug {isDebugMode ? "on" : "off"}
        </button>

        <Button
          className="h-7 flex-none px-3.5"
          onClick={handleSend}
          disabled={disabled}
          aria-label="Send action"
        >
          {isSending && <Loader2 className="size-3.5 animate-spin" aria-hidden />}
          <span>Send action →</span>
        </Button>
      </div>

      {/* Row 2: Input area */}
      {inputMode === "json" ? (
        <div className="relative">
          <Input
            className={`h-8 ${jsonError ? "border-fs-red" : ""}`}
            value={jsonInput}
            onChange={(e) => { setJsonInput(e.target.value); setJsonError(null); }}
            onKeyDown={handleKeyDown}
            placeholder='{"key": "value"}'
            disabled={disabled}
          />
          {jsonError && (
            <div className="absolute left-0 top-full z-20 mt-1 border border-fs-red bg-fs-card px-2 py-1 font-fs-mono text-[10.5px] text-fs-red">
              {jsonError}
            </div>
          )}
        </div>
      ) : currentSchema ? (
        <SchemaForm
          schema={currentSchema}
          values={formValues}
          onChange={setFormValues}
          disabled={disabled}
          onSubmit={handleSend}
        />
      ) : null}
    </div>
  );
}

/** One half of the Form/JSON switch; the active half is ink-filled. */
const SEGMENT =
  "border-b-0 px-2.5 pt-[5px] pb-[5px] text-[11px] text-fs-ink data-[state=active]:border-fs-ink/45 data-[state=active]:bg-fs-ink data-[state=active]:text-fs-paper data-[state=active]:hover:text-fs-paper";
