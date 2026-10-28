import { describe, it, expect } from "vitest";
import {
  getLeverageSpec,
  parseSymbolVariant,
  realVariantSymbol,
  simulatePrefix,
  stripRealSuffix,
  stripSimSuffix,
} from "@/lib/leverageSim";
import { symbolLabel } from "@/lib/symbolCatalog";

const spec = { underlying: "QQQ", leverage: 3, expenseRatio: 0, financingRate: 0 };

describe("simulatePrefix", () => {
  it("returns [] when the underlying has nothing earlier", () => {
    const u = [{ date: "2020-01-02", close: 100 }];
    expect(simulatePrefix({ date: "2020-01-02", close: 10 }, u, spec)).toEqual([]);
  });

  it("applies 3x daily return and joins the real first price", () => {
    const u = [
      { date: "2020-01-01", close: 100 },
      { date: "2020-01-02", close: 90 }, // -10% => -30% for 3x
      { date: "2020-01-03", close: 99 },
    ];
    const out = simulatePrefix({ date: "2020-01-02", close: 7 }, u, spec);
    expect(out).toHaveLength(1);
    // 7 = prev * 0.7  => prev = 10
    expect(out[0].date).toBe("2020-01-01");
    expect(out[0].close).toBeCloseTo(10, 6);
  });

  it("costs reduce the simulated growth", () => {
    const u = [
      { date: "2020-01-01", close: 100 },
      { date: "2020-01-02", close: 100 },
    ];
    const out = simulatePrefix(
      { date: "2020-01-02", close: 10 },
      u,
      { ...spec, expenseRatio: 2.52 }
    );
    expect(out[0].close).toBeGreaterThan(10); // flat market, fees => earlier price higher
  });
});

describe("leverage specs & labels", () => {
  it("maps TQQQ/SPXL/00631L to their underlyings", () => {
    expect(getLeverageSpec("tqqq")?.underlying).toBe("QQQ");
    expect(getLeverageSpec("SPXL")?.underlying).toBe("SPY");
    expect(getLeverageSpec("00631L.TW")?.underlying).toBe("0050.TW");
    expect(getLeverageSpec("QQQ")).toBeNull();
  });

  it("appends @sim to the label", () => {
    expect(symbolLabel("TQQQ", "zh", true).code).toBe("TQQQ@sim");
    expect(symbolLabel("00631L.TW", "zh", true).code).toBe("00631L@sim");
    expect(symbolLabel("TQQQ").code).toBe("TQQQ");
  });
});

describe("stripSimSuffix", () => {
  it("strips a trailing @sim suffix typed by the user, case-insensitively", () => {
    expect(stripSimSuffix("TQQQ@sim")).toBe("TQQQ");
    expect(stripSimSuffix("TQQQ@SIM")).toBe("TQQQ");
    expect(stripSimSuffix(" tqqq@Sim ")).toBe("tqqq");
  });

  it("leaves symbols without the suffix untouched", () => {
    expect(stripSimSuffix("TQQQ")).toBe("TQQQ");
    expect(stripSimSuffix("00631L.TW")).toBe("00631L.TW");
  });
});

describe("stripRealSuffix", () => {
  it("strips a trailing @real suffix, case-insensitively", () => {
    expect(stripRealSuffix("TQQQ@real")).toBe("TQQQ");
    expect(stripRealSuffix("TQQQ@REAL")).toBe("TQQQ");
    expect(stripRealSuffix(" tqqq@Real ")).toBe("tqqq");
  });

  it("leaves symbols without the suffix untouched", () => {
    expect(stripRealSuffix("TQQQ")).toBe("TQQQ");
    expect(stripRealSuffix("TQQQ@sim")).toBe("TQQQ@sim");
  });
});

describe("parseSymbolVariant", () => {
  it("detects an explicit @real request and strips it from the base", () => {
    expect(parseSymbolVariant("TQQQ@real")).toEqual({ base: "TQQQ", forceReal: true });
    expect(parseSymbolVariant("tqqq@REAL")).toEqual({ base: "tqqq", forceReal: true });
  });

  it("treats @sim and bare symbols as the default (non-forced) variant", () => {
    expect(parseSymbolVariant("TQQQ@sim")).toEqual({ base: "TQQQ", forceReal: false });
    expect(parseSymbolVariant("TQQQ")).toEqual({ base: "TQQQ", forceReal: false });
  });
});

describe("realVariantSymbol", () => {
  it("builds the canonical @real-tagged storage key", () => {
    expect(realVariantSymbol("tqqq")).toBe("TQQQ@real");
    expect(realVariantSymbol("00631L.TW")).toBe("00631L.TW@real");
  });
});

describe("symbolLabel with an @real-tagged symbol", () => {
  it("shows @real instead of @sim, regardless of the simulated flag", () => {
    expect(symbolLabel("TQQQ@real", "zh", true).code).toBe("TQQQ@real");
    expect(symbolLabel("TQQQ@real", "zh", false).code).toBe("TQQQ@real");
  });

  it("still resolves the Taiwan fund name under the @real tag", () => {
    const { code, name } = symbolLabel("00631L.TW@real", "zh");
    expect(code).toBe("00631L@real");
    expect(name).toBeTruthy();
  });
});
