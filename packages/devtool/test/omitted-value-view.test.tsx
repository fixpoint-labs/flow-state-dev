/**
 * A value the record left out (over the record limit) renders as omitted, with
 * its size and preview, through one renderer for both a block output and a
 * tool result. A reader must never take the preview for the whole value.
 */
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import React from "react";

import { BlockValueView, OmittedValueView } from "../src/react/components/shared/block-value-view";

describe("an omitted recorded value", () => {
  it("renders a block output placeholder as omitted, with its size and preview", () => {
    render(<BlockValueView value={{ kind: "omitted", bytes: 1258291, preview: '{"files":[' }} />);
    expect(screen.getByText(/omitted/i)).toBeInTheDocument();
    expect(screen.getByText(/1,258,291 bytes/)).toBeInTheDocument();
    expect(screen.getByText(/\{"files":\[/)).toBeInTheDocument();
  });

  it("says when the value could not be serialized", () => {
    render(<OmittedValueView value={{ bytes: null, preview: "" }} />);
    expect(screen.getByText(/could not be serialized/)).toBeInTheDocument();
  });
});
