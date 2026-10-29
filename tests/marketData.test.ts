import { describe, it, expect, vi, afterEach } from "vitest";
import { fetchDailyPrices } from "@/lib/marketData";

function yahooChartResponse(symbol: string) {
  const timestamp = [1700000000, 1700086400, 1700172800];
  const close = [100, 101, 102];
  return {
    chart: {
      result: [
        {
          meta: { symbol },
          timestamp,
          indicators: { quote: [{ close }] },
          events: {},
        },
      ],
    },
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("fetchDailyPrices underlying-fetch dedup", () => {
  it("coalesces concurrent requests for the same base ticker into one fetch", async () => {
    const calls: string[] = [];
    const fetchMock = vi.fn(async (url: string) => {
      calls.push(url);
      return {
        ok: true,
        json: async () => yahooChartResponse("TQQQ"),
      } as Response;
    });
    vi.stubGlobal("fetch", fetchMock);

    // Two different @alo ratios of the same base ticker, fetched concurrently —
    // this is exactly the "compare several allocation variants at once" case.
    const [a, b] = await Promise.all([
      fetchDailyPrices("TQQQ@alo(60:40)", 1),
      fetchDailyPrices("TQQQ@alo(80:20)", 1),
    ]);

    expect(a.symbol).toBe("TQQQ@alo(60:40)");
    expect(b.symbol).toBe("TQQQ@alo(80:20)");

    const underlyingCalls = calls.filter((u) => u.includes("/TQQQ?"));
    expect(underlyingCalls.length).toBe(1);
  });

  it("fetches again for a later, non-concurrent request", async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => yahooChartResponse("TQQQ"),
    } as Response));
    vi.stubGlobal("fetch", fetchMock);

    await fetchDailyPrices("TQQQ@alo(60:40)", 1);
    await fetchDailyPrices("TQQQ@alo(80:20)", 1);

    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
