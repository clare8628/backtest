import { describe, it, expect } from "vitest";
import { ComparisonGroup } from "@/lib/types";

describe("Portfolio API", () => {
  it("should create portfolio object correctly", () => {
    const portfolio: ComparisonGroup = {
      id: "grp_123_abc",
      title: "Tech Stocks",
      symbols: ["AAPL", "MSFT", "NVDA"],
      rangeYears: 5,
      createdAt: new Date().toISOString(),
    };

    expect(portfolio.id).toBe("grp_123_abc");
    expect(portfolio.symbols).toHaveLength(3);
    expect(portfolio.title).toBe("Tech Stocks");
  });

  it("should validate required portfolio fields", () => {
    const portfolio: ComparisonGroup = {
      id: "grp_123_abc",
      title: "Mixed",
      symbols: ["SPY", "QQQ"],
      rangeYears: 3,
      createdAt: new Date().toISOString(),
    };

    const isValid = portfolio.id && portfolio.title && portfolio.symbols.length > 0 && portfolio.rangeYears > 0;
    expect(isValid).toBe(true);
  });

  it("should handle empty portfolio symbols", () => {
    const portfolio: ComparisonGroup = {
      id: "grp_123_abc",
      title: "Empty",
      symbols: [],
      rangeYears: 1,
      createdAt: new Date().toISOString(),
    };

    expect(portfolio.symbols).toHaveLength(0);
  });

  it("should parse symbols JSON correctly", () => {
    const symbols = ["VOO", "VTI", "BND"];
    const json = JSON.stringify(symbols);
    const parsed = JSON.parse(json);

    expect(parsed).toEqual(symbols);
    expect(parsed).toHaveLength(3);
  });

  it("should support optional sortOrder field", () => {
    const portfolio: ComparisonGroup = {
      id: "grp_123_abc",
      title: "Sorted Group",
      symbols: ["VOO"],
      rangeYears: 5,
      createdAt: new Date().toISOString(),
      sortOrder: 2,
    };

    expect(portfolio.sortOrder).toBe(2);
  });

  it("should support optional startYear and endYear fields for custom interval", () => {
    const portfolio: ComparisonGroup = {
      id: "grp_interval",
      title: "Custom Interval",
      symbols: ["VOO", "SPY"],
      rangeYears: 7,
      startYear: 2015,
      endYear: 2022,
      createdAt: new Date().toISOString(),
    };

    expect(portfolio.startYear).toBe(2015);
    expect(portfolio.endYear).toBe(2022);
    expect(portfolio.rangeYears).toBe(7);
  });
});

describe("Inception age sorting (BAC-19)", () => {
  it("sorts targets by maxBacktestYears ascending from shortest to longest", () => {
    const metrics = [
      { symbol: "SPY", maxBacktestYears: 33.7, firstDate: "1993-01-29" },
      { symbol: "QQQI", maxBacktestYears: 1.5, firstDate: "2024-10-25" },
      { symbol: "0050.TW", maxBacktestYears: 23.3, firstDate: "2003-06-30" },
      { symbol: "SPMO", maxBacktestYears: 8.8, firstDate: "2015-10-15" },
    ];

    const sorted = [...metrics].sort((a, b) => {
      const ya = typeof a.maxBacktestYears === "number" ? a.maxBacktestYears : 0;
      const yb = typeof b.maxBacktestYears === "number" ? b.maxBacktestYears : 0;
      if (ya !== yb) return ya - yb;
      return a.symbol.localeCompare(b.symbol);
    });

    expect(sorted.map((m) => m.symbol)).toEqual(["QQQI", "SPMO", "0050.TW", "SPY"]);
    expect(sorted[0].maxBacktestYears).toBe(1.5);
    expect(sorted[1].maxBacktestYears).toBe(8.8);
    expect(sorted[2].maxBacktestYears).toBe(23.3);
    expect(sorted[3].maxBacktestYears).toBe(33.7);
  });
});

describe("reorderArray", () => {
  // Direct test of reordering logic
  function reorderArray<T>(list: T[], sourceIndex: number, targetIndex: number, placeAfter: boolean): T[] {
    if (sourceIndex === targetIndex) return list;
    const item = list[sourceIndex];
    const without = list.filter((_, i) => i !== sourceIndex);
    const targetItem = list[targetIndex];
    const newTargetIndex = without.indexOf(targetItem);
    const insertIndex = placeAfter ? newTargetIndex + 1 : newTargetIndex;
    const result = [...without];
    result.splice(insertIndex, 0, item);
    return result;
  }

  it("returns unchanged list when source and target indices are equal", () => {
    const list = ["A", "B", "C"];
    expect(reorderArray(list, 1, 1, false)).toEqual(["A", "B", "C"]);
    expect(reorderArray(list, 1, 1, true)).toEqual(["A", "B", "C"]);
  });

  it("moves item forward and places before target", () => {
    const list = ["A", "B", "C", "D"];
    // Move A (0) to C (2), place before C
    expect(reorderArray(list, 0, 2, false)).toEqual(["B", "A", "C", "D"]);
  });

  it("moves item forward and places after target", () => {
    const list = ["A", "B", "C", "D"];
    // Move A (0) to C (2), place after C
    expect(reorderArray(list, 0, 2, true)).toEqual(["B", "C", "A", "D"]);
  });

  it("moves item backward and places before target", () => {
    const list = ["A", "B", "C", "D"];
    // Move D (3) to B (1), place before B
    expect(reorderArray(list, 3, 1, false)).toEqual(["A", "D", "B", "C"]);
  });

  it("moves item backward and places after target", () => {
    const list = ["A", "B", "C", "D"];
    // Move D (3) to B (1), place after B
    expect(reorderArray(list, 3, 1, true)).toEqual(["A", "B", "D", "C"]);
  });
});

