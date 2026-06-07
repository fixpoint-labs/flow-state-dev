import { describe, expect, it } from "vitest";
import { section, list, keyValues, table, entries, codeBlock, join, when } from "../src/prompt";

describe("prompt formatters", () => {
  describe("section", () => {
    it("creates a titled section with content", () => {
      expect(section("Research", "topic1", "topic2")).toBe(
        "## Research\ntopic1\ntopic2"
      );
    });

    it("returns only the header when no content", () => {
      expect(section("Empty")).toBe("## Empty");
    });

    it("filters out falsy content", () => {
      expect(section("Mixed", "a", undefined, null, false, "", "b")).toBe(
        "## Mixed\na\nb"
      );
    });

    it("returns only header when all content is falsy", () => {
      expect(section("All Falsy", undefined, null, false, "")).toBe(
        "## All Falsy"
      );
    });

    it("defaults a string title to a level-2 heading", () => {
      expect(section("Top", "body")).toBe("## Top\nbody");
    });

    it("uses the options form to set a nested heading level", () => {
      expect(section({ title: "Sub", level: 3 }, "body")).toBe("### Sub\nbody");
    });

    it("clamps the heading level to 1–6", () => {
      expect(section({ title: "Lo", level: 0 }, "x")).toBe("# Lo\nx");
      expect(section({ title: "Hi", level: 9 }, "x")).toBe("###### Hi\nx");
    });

    it("supports the options form with no content", () => {
      expect(section({ title: "Sub", level: 4 })).toBe("#### Sub");
    });
  });

  describe("table", () => {
    it("renders an array of records as a Markdown table", () => {
      expect(
        table([
          { ticker: "AAPL", qty: 10 },
          { ticker: "JPM", qty: 5 }
        ])
      ).toBe("| ticker | qty |\n| --- | --- |\n| AAPL | 10 |\n| JPM | 5 |");
    });

    it("takes the union of keys in first-seen order, empty for missing cells", () => {
      expect(table([{ a: 1 }, { b: 2 }])).toBe(
        "| a | b |\n| --- | --- |\n| 1 |  |\n|  | 2 |"
      );
    });

    it("honors an explicit column list and order", () => {
      expect(
        table([{ a: 1, b: 2, c: 3 }], { columns: ["c", "a"] })
      ).toBe("| c | a |\n| --- | --- |\n| 3 | 1 |");
    });

    it("escapes pipes and flattens newlines in cells", () => {
      expect(table([{ note: "a|b\nc" }])).toBe(
        "| note |\n| --- |\n| a\\|b c |"
      );
    });

    it("returns an empty string for empty input", () => {
      expect(table([])).toBe("");
    });
  });

  describe("list", () => {
    it("creates a bulleted list", () => {
      expect(list(["apples", "bananas", "cherries"])).toBe(
        "- apples\n- bananas\n- cherries"
      );
    });

    it("creates a numbered list when ordered", () => {
      expect(list(["first", "second", "third"], { ordered: true })).toBe(
        "1. first\n2. second\n3. third"
      );
    });

    it("uses custom bullet character", () => {
      expect(list(["a", "b"], { bullet: "*" })).toBe("* a\n* b");
    });

    it("filters out falsy items", () => {
      expect(list(["a", undefined, "b", null, "", "c"])).toBe(
        "- a\n- b\n- c"
      );
    });

    it("returns empty string for empty array", () => {
      expect(list([])).toBe("");
    });

    it("returns empty string when all items are falsy", () => {
      expect(list([undefined, null, false, ""])).toBe("");
    });
  });

  describe("keyValues", () => {
    it("formats key-value pairs", () => {
      expect(keyValues({ name: "Alice", role: "admin", score: 42 })).toBe(
        "name: Alice\nrole: admin\nscore: 42"
      );
    });

    it("filters out null and undefined values", () => {
      expect(keyValues({ a: "yes", b: null, c: undefined, d: "no" })).toBe(
        "a: yes\nd: no"
      );
    });

    it("handles boolean values", () => {
      expect(keyValues({ active: true, deleted: false })).toBe(
        "active: true\ndeleted: false"
      );
    });

    it("returns empty string for empty record", () => {
      expect(keyValues({})).toBe("");
    });
  });

  describe("entries", () => {
    it("formats record entries with custom formatter", () => {
      const data = { doc1: { title: "Intro" }, doc2: { title: "Conclusion" } };
      expect(
        entries(data, (id, art) => `[${id}] ${art.title}`)
      ).toBe("[doc1] Intro\n[doc2] Conclusion");
    });

    it("filters out falsy formatter results", () => {
      const data = { a: 1, b: 2, c: 3 };
      expect(
        entries(data, (key, val) => (val > 1 ? `${key}=${val}` : undefined))
      ).toBe("b=2\nc=3");
    });

    it("returns empty string for empty record", () => {
      expect(entries({}, (k, v) => `${k}:${v}`)).toBe("");
    });
  });

  describe("codeBlock", () => {
    it("wraps code in fenced block with language", () => {
      expect(codeBlock("const x = 1;", "ts")).toBe(
        "```ts\nconst x = 1;\n```"
      );
    });

    it("works without language", () => {
      expect(codeBlock("plain text")).toBe("```\nplain text\n```");
    });

    it("preserves multiline content", () => {
      expect(codeBlock("line1\nline2\nline3", "js")).toBe(
        "```js\nline1\nline2\nline3\n```"
      );
    });
  });

  describe("join", () => {
    it("joins parts with double newlines", () => {
      expect(join("part1", "part2", "part3")).toBe(
        "part1\n\npart2\n\npart3"
      );
    });

    it("filters out falsy parts", () => {
      expect(join("a", undefined, "b", null, false, "", "c")).toBe(
        "a\n\nb\n\nc"
      );
    });

    it("returns empty string when all parts are falsy", () => {
      expect(join(undefined, null, false, "")).toBe("");
    });
  });

  describe("when", () => {
    it("returns content string when condition is true", () => {
      expect(when(true, "show this")).toBe("show this");
    });

    it("returns undefined when condition is false", () => {
      expect(when(false, "hide this")).toBeUndefined();
    });

    it("evaluates lazy function only when condition is true", () => {
      let called = false;
      const result = when(true, () => {
        called = true;
        return "lazy result";
      });
      expect(called).toBe(true);
      expect(result).toBe("lazy result");
    });

    it("does NOT evaluate lazy function when condition is false", () => {
      let called = false;
      const result = when(false, () => {
        called = true;
        return "should not run";
      });
      expect(called).toBe(false);
      expect(result).toBeUndefined();
    });
  });

  describe("composition", () => {
    it("composes formatters naturally for LLM context", () => {
      const topics = ["neural networks", "transformers"];
      const hasHistory = true;
      const history = ["searched for papers", "found 3 results"];

      const result = join(
        section("Research Topics", list(topics)),
        when(hasHistory, () => section("History", list(history))),
        section("Task", "Analyze the current research landscape")
      );

      expect(result).toBe(
        "## Research Topics\n- neural networks\n- transformers\n\n" +
        "## History\n- searched for papers\n- found 3 results\n\n" +
        "## Task\nAnalyze the current research landscape"
      );
    });

    it("composes with conditional sections removed", () => {
      const result = join(
        section("Always", "visible"),
        when(false, () => section("Never", "shown")),
        section("Also", "visible")
      );

      expect(result).toBe(
        "## Always\nvisible\n\n## Also\nvisible"
      );
    });
  });
});
