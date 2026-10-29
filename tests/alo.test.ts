import { describe, it, expect } from "vitest";
import {
  isSimulatedSymbol,
  parseAllocation,
  simulateAllocation,
  stripSimSuffix,
  withAllocationRatio,
  withVariantOf,
} from "@/lib/leverageSim";
import { searchCatalog, symbolLabel } from "@/lib/symbolCatalog";

describe("@alo allocation variants", () => {
  it("parses ratio, with and without @sim, and strips it for lookups", () => {
    expect(parseAllocation("TQQQ@alo(60:40)")).toEqual({ risk: 60, cash: 40, valid: true });
    expect(parseAllocation("tqqq@sim@alo(80:20)")?.risk).toBe(80);
    expect(parseAllocation("TQQQ@alo")?.risk).toBe(60);
    expect(parseAllocation("TQQQ")).toBeNull();
    expect(parseAllocation("TQQQ@alo(70:40)")?.valid).toBe(false);
    expect(stripSimSuffix("TQQQ@sim@alo(80:20)")).toBe("TQQQ");
    expect(isSimulatedSymbol("TQQQ@sim@alo(80:20)")).toBe(true);
    expect(isSimulatedSymbol("TQQQ@alo(80:20)")).toBe(false);
    expect(withVariantOf("tqqq@sim@alo(80:20)", "TQQQ")).toBe("TQQQ@sim@alo(80:20)");
  });

  it("rebalances to the target split on the first trading day on/after 11/1", () => {
    const prices = [
      { date: "2020-10-30", close: 100 },
      { date: "2020-11-02", close: 200 }, // asset doubles; rebalance happens here
      { date: "2020-11-03", close: 200 },
      { date: "2020-12-01", close: 100 },
    ];
    const out = simulateAllocation(prices, { risk: 50, cash: 50 });
    expect(out[0].close).toBe(100);
    expect(out[1].close).toBeCloseTo(150); // 0.5*200 + 50
    // after rebalance: 75 asset + 75 cash; asset halves -> 37.5 + 75
    expect(out[3].close).toBeCloseTo(112.5);
  });

  it("does not rebalance outside 11/1", () => {
    const prices = [
      { date: "2020-01-02", close: 100 },
      { date: "2020-06-01", close: 200 },
      { date: "2020-07-01", close: 100 },
    ];
    const out = simulateAllocation(prices, { risk: 50, cash: 50 });
    // drift untouched: 0.5 share asset + 50 cash
    expect(out[1].close).toBeCloseTo(150);
    expect(out[2].close).toBeCloseTo(100);
  });

  it("rewrites the ratio for an adjustable allocation control", () => {
    expect(withAllocationRatio("TQQQ@alo", 70)).toBe("TQQQ@alo(70:30)");
    expect(withAllocationRatio("TQQQ@alo(60:40)", 80)).toBe("TQQQ@alo(80:20)");
    expect(withAllocationRatio("TQQQ@sim@alo(60:40)", 90)).toBe("TQQQ@sim@alo(90:10)");
    expect(withAllocationRatio("TQQQ@alo", 150)).toBe("TQQQ@alo(100:0)");
    expect(withAllocationRatio("TQQQ@alo", 0)).toBe("TQQQ@alo(1:99)");
  });

  it("lists @alo variants in suggestions and labels them", () => {
    const syms = searchCatalog("TQQQ").map((e) => e.symbol);
    expect(syms).toEqual(
      expect.arrayContaining(["TQQQ", "TQQQ@alo", "TQQQ@sim", "TQQQ@sim@alo"])
    );
    expect(symbolLabel("TQQQ@sim@alo(80:20)").code).toBe("TQQQ@sim@alo(80:20)");
  });
});
