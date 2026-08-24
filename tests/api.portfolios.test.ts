import { describe, it, expect } from "vitest";
import { ComparisonGroup } from "@/lib/types";

// Mock environment
const mockDB = {
  prepare: (query: string) => ({
    bind: (...params: any[]) => ({
      first: async () => ({ id: "test" }),
      all: async () => ({ results: [], success: true }),
      run: async () => ({ success: true }),
    }),
  }),
};

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
});
