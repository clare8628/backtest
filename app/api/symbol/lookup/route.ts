import { NextRequest, NextResponse } from "next/server";
import { lookupSymbol } from "@/lib/marketData";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const symbol: string = typeof body?.symbol === "string" ? body.symbol.trim() : "";
    if (!symbol) {
      return NextResponse.json(
        { success: false, error: "symbol is required" },
        { status: 400 }
      );
    }

    const result = await lookupSymbol(symbol);
    return NextResponse.json({
      success: result.found,
      ...result,
    });
  } catch (e) {
    return NextResponse.json(
      { success: false, error: e instanceof Error ? e.message : "Unknown error" },
      { status: 500 }
    );
  }
}

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const symbol = searchParams.get("symbol")?.trim() || "";
    if (!symbol) {
      return NextResponse.json(
        { success: false, error: "symbol is required" },
        { status: 400 }
      );
    }

    const result = await lookupSymbol(symbol);
    return NextResponse.json({
      success: result.found,
      ...result,
    });
  } catch (e) {
    return NextResponse.json(
      { success: false, error: e instanceof Error ? e.message : "Unknown error" },
      { status: 500 }
    );
  }
}
