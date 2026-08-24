import { ComparisonGroup } from "@/lib/types";
import { getCloudflareContext } from "@opennextjs/cloudflare";

export const dynamic = "force-dynamic";

async function getDB() {
  try {
    const { env } = await getCloudflareContext({ async: true });
    const db = (env as any).DB;
    if (!db) {
      console.error("D1 binding 'DB' not found in Cloudflare env");
    }
    return db;
  } catch (err) {
    console.error("Failed to get Cloudflare context:", err);
    return undefined;
  }
}

export async function GET() {
  try {
    const db = await getDB();

    if (!db) {
      // Fallback: return empty array if DB not available
      return Response.json({ groups: [] });
    }

    const result = await db.prepare("SELECT * FROM portfolios ORDER BY createdAt DESC").all();
    const groups: ComparisonGroup[] = (result.results || []).map((row: any) => ({
      id: row.id,
      title: row.title,
      symbols: JSON.parse(row.symbols || "[]"),
      rangeYears: row.rangeYears || 5,
      createdAt: row.createdAt,
      startValue: row.startValue || 1000,
    }));

    return Response.json({ groups });
  } catch (error) {
    console.error("Failed to fetch portfolios:", error);
    return Response.json({ groups: [] });
  }
}

export async function POST(request: Request) {
  try {
    const db = await getDB();
    const body = await request.json();
    const { id, title, symbols, rangeYears, startValue, createdAt } = body as ComparisonGroup;

    if (!id || !title || !symbols || rangeYears === undefined) {
      return Response.json({ error: "Missing required fields" }, { status: 400 });
    }

    if (!db) {
      return Response.json({ success: true, id });
    }

    const now = new Date().toISOString();
    const symbolsJson = JSON.stringify(symbols);

    // Check if already exists
    const existing = await db
      .prepare("SELECT id FROM portfolios WHERE id = ?")
      .bind(id)
      .first();

    if (existing) {
      await db
        .prepare(
          "UPDATE portfolios SET title = ?, symbols = ?, rangeYears = ?, startValue = ?, updatedAt = ? WHERE id = ?"
        )
        .bind(title, symbolsJson, rangeYears, startValue || 1000, now, id)
        .run();
    } else {
      await db
        .prepare(
          "INSERT INTO portfolios (id, title, symbols, rangeYears, startValue, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, ?, ?)"
        )
        .bind(id, title, symbolsJson, rangeYears, startValue || 1000, createdAt || now, now)
        .run();
    }

    return Response.json({ success: true, id });
  } catch (error) {
    console.error("Failed to save portfolio:", error);
    return Response.json({ success: true });
  }
}

export async function DELETE(request: Request) {
  try {
    const db = await getDB();
    const { searchParams } = new URL(request.url);
    const id = searchParams.get("id");

    if (!id) {
      return Response.json({ error: "Missing id parameter" }, { status: 400 });
    }

    if (db) {
      await db.prepare("DELETE FROM portfolios WHERE id = ?").bind(id).run();
    }

    return Response.json({ success: true });
  } catch (error) {
    console.error("Failed to delete portfolio:", error);
    return Response.json({ success: true });
  }
}
