import { describe, it, expect } from "vitest";
import { renderHook, act } from "@testing-library/react";
import React from "react";

import { SelectionProvider, useSelection } from "@/context/selection-context";
import { DebugProvider, useDebug } from "@/context/debug-context";

import type { OutputItem } from "@flow-state-dev/core/items";

// ── SelectionContext ──────────────────────────────────────────

describe("SelectionContext", () => {
  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <SelectionProvider>{children}</SelectionProvider>
  );

  it("starts with no selection", () => {
    const { result } = renderHook(() => useSelection(), { wrapper });

    expect(result.current.selectedItemId).toBeNull();
    expect(result.current.selectedItem).toBeNull();
  });

  it("selects an item", () => {
    const { result } = renderHook(() => useSelection(), { wrapper });

    const item = { id: "item-1", type: "message" } as OutputItem;
    act(() => result.current.selectItem("item-1", item));

    expect(result.current.selectedItemId).toBe("item-1");
    expect(result.current.selectedItem).toBe(item);
  });

  it("clears selection", () => {
    const { result } = renderHook(() => useSelection(), { wrapper });

    const item = { id: "item-1", type: "message" } as OutputItem;
    act(() => result.current.selectItem("item-1", item));
    act(() => result.current.clearSelection());

    expect(result.current.selectedItemId).toBeNull();
    expect(result.current.selectedItem).toBeNull();
  });

  it("throws when used outside provider", () => {
    expect(() => {
      renderHook(() => useSelection());
    }).toThrow("useSelection must be used within SelectionProvider");
  });
});

// ── DebugContext ──────────────────────────────────────────────

describe("DebugContext", () => {
  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <DebugProvider>{children}</DebugProvider>
  );

  it("starts with debug mode off", () => {
    const { result } = renderHook(() => useDebug(), { wrapper });
    expect(result.current.isDebugMode).toBe(false);
  });

  it("toggles debug mode on and off", () => {
    const { result } = renderHook(() => useDebug(), { wrapper });

    act(() => result.current.toggleDebugMode());
    expect(result.current.isDebugMode).toBe(true);

    act(() => result.current.toggleDebugMode());
    expect(result.current.isDebugMode).toBe(false);
  });

  it("persists debug mode to localStorage", () => {
    const { result } = renderHook(() => useDebug(), { wrapper });

    act(() => result.current.toggleDebugMode());
    expect(localStorage.getItem("fsd.devtool.debugMode")).toBe("true");

    act(() => result.current.toggleDebugMode());
    expect(localStorage.getItem("fsd.devtool.debugMode")).toBe("false");
  });

  it("reads initial state from localStorage", () => {
    localStorage.setItem("fsd.devtool.debugMode", "true");
    const { result } = renderHook(() => useDebug(), { wrapper });
    expect(result.current.isDebugMode).toBe(true);
  });

  it("throws when used outside provider", () => {
    expect(() => {
      renderHook(() => useDebug());
    }).toThrow("useDebug must be used within DebugProvider");
  });
});
