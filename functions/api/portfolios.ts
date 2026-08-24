import { ComparisonGroup } from "../../lib/types";

interface D1Database {
  prepare(query: string): D1PreparedStatement;
}

interface D1PreparedStatement {
  bind(...params: any[]): D1PreparedStatement;
  first<T = Record<string, unknown>>(): Promise<T | undefined>;
  all<T = Record<string, unknown>>(): Promise<{ results: T[]; success: boolean }>;
  run(): Promise<{ success: boolean }>;
}

interface Env {
  DB: D1Database;
}

export async function onRequestGet(context: { env: Env }) {
  try {
    const db = context.env.DB;
    if (!db) {
      return new Response(JSON.stringify({ groups: [] }), {
        headers: { "Content-Type": "application/json" },
      });
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

    return new Response(JSON.stringify({ groups }), {
      headers: { "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("Failed to fetch portfolios:", error);
    return new Response(JSON.stringify({ groups: [] }), {
      headers: { "Content-Type": "application/json" },
      status: 200,
    });
  }
}

export async function onRequestPost(context: { request: Request; env: Env }) {
  try {
    const db = context.env.DB;
    const body = await context.request.json();
    const { id, title, symbols, rangeYears, startValue, createdAt } = body as ComparisonGroup;

    if (!id || !title || !symbols || rangeYears === undefined) {
      return new Response(JSON.stringify({ error: "Missing required fields" }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }

    if (!db) {
      return new Response(JSON.stringify({ success: true, id }), {
        headers: { "Content-Type": "application/json" },
      });
    }

    const now = new Date().toISOString();
    const symbolsJson = JSON.stringify(symbols);

    // Check if already exists
    const existing = await db
      .prepare("SELECT id FROM portfolios WHERE id = ?")
      .bind(id)
      .first();

    if (existing) {
      // Update
      await db
        .prepare(
          "UPDATE portfolios SET title = ?, symbols = ?, rangeYears = ?, startValue = ?, updatedAt = ? WHERE id = ?"
        )
        .bind(title, symbolsJson, rangeYears, startValue || 1000, now, id)
        .run();
    } else {
      // Insert
      await db
        .prepare(
          "INSERT INTO portfolios (id, title, symbols, rangeYears, startValue, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, ?, ?)"
        )
        .bind(id, title, symbolsJson, rangeYears, startValue || 1000, createdAt || now, now)
        .run();
    }

    return new Response(JSON.stringify({ success: true, id }), {
      headers: { "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("Failed to save portfolio:", error);
    return new Response(JSON.stringify({ success: true }), {
      headers: { "Content-Type": "application/json" },
    });
  }
}

export async function onRequestDelete(context: { request: Request; env: Env }) {
  try {
    const db = context.env.DB;
    const url = new URL(context.request.url);
    const id = url.searchParams.get("id");

    if (!id) {
      return new Response(JSON.stringify({ error: "Missing id parameter" }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }

    if (db) {
      await db.prepare("DELETE FROM portfolios WHERE id = ?").bind(id).run();
    }

    return new Response(JSON.stringify({ success: true }), {
      headers: { "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("Failed to delete portfolio:", error);
    return new Response(JSON.stringify({ success: true }), {
      headers: { "Content-Type": "application/json" },
    });
  }
}
