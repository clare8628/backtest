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

/**
 * There is no migration runner in front of this D1 binding, so the one
 * additive column added since the table was created (`rangeFitted`, see
 * migrations/0003) is applied lazily on first use. SQLite has no
 * "ADD COLUMN IF NOT EXISTS", so an already-migrated database answers with
 * "duplicate column name" — that is the success signal here and is swallowed.
 * The promise is cached per isolate: one statement per cold start, not per
 * request. A genuine failure clears the cache so the next request retries.
 */
let schemaReady: Promise<void> | null = null;
function ensureSchema(db: any): Promise<void> {
  if (!schemaReady) {
    schemaReady = Promise.resolve(
      db.prepare("ALTER TABLE portfolios ADD COLUMN rangeFitted INTEGER DEFAULT 0").run()
    )
      .then(() => undefined)
      .catch((e: unknown) => {
        const msg = e instanceof Error ? e.message : String(e);
        if (/duplicate column name/i.test(msg)) return; // already applied
        schemaReady = null;
        throw e;
      });
  }
  return schemaReady;
}

/**
 * Every response carries whether the write actually reached D1.
 *
 * Without it these endpoints are indistinguishable from a working database
 * that happens to be empty: `next dev` has no D1 binding, so GET answered
 * `{groups: []}` and POST answered `{success: true}` while storing nothing,
 * and the client — which only falls back to localStorage when a request
 * *fails* — believed it. Comparisons vanished on every reload with no error
 * anywhere. The flag lets the client keep its own copy when, and only when,
 * the server admits it is not keeping one.
 */

export async function GET() {
  try {
    const db = await getDB();

    if (!db) {
      return Response.json({ groups: [], persisted: false });
    }

    // Non-fatal for reads: SELECT * is fine whether or not the column landed.
    await ensureSchema(db).catch((e) => console.error("ensureSchema (GET):", e));

    const result = await db.prepare("SELECT * FROM portfolios ORDER BY createdAt DESC").all();
    const groups: ComparisonGroup[] = (result.results || []).map((row: any) => ({
      id: row.id,
      title: row.title,
      symbols: JSON.parse(row.symbols || "[]"),
      rangeYears: row.rangeYears || 5,
      createdAt: row.createdAt,
      startValue: row.startValue || 1000,
      // Rows that predate this column read back as 0, so on first load every
      // existing group gets auto-fitted to its shortest symbol's history — the
      // behaviour asked for. After that the client sets this (auto-fit ran, or
      // the slider was moved) and the group is left alone.
      rangeFitted: !!row.rangeFitted,
    }));

    return Response.json({ groups, persisted: true });
  } catch (error) {
    console.error("Failed to fetch portfolios:", error);
    return Response.json({ groups: [], persisted: false });
  }
}

export async function POST(request: Request) {
  try {
    const db = await getDB();
    const body = await request.json();
    const { id, title, symbols, rangeYears, startValue, rangeFitted, createdAt } =
      body as ComparisonGroup;

    if (!id || !title || !symbols || rangeYears === undefined) {
      return Response.json({ error: "Missing required fields" }, { status: 400 });
    }

    if (!db) {
      return Response.json({ success: true, id, persisted: false });
    }

    // The UPDATE/INSERT below write rangeFitted, so the column has to exist
    // first. A failure here falls through to the catch → persisted:false, and
    // the client keeps its localStorage copy until the next successful write.
    await ensureSchema(db);

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
          "UPDATE portfolios SET title = ?, symbols = ?, rangeYears = ?, startValue = ?, rangeFitted = ?, updatedAt = ? WHERE id = ?"
        )
        .bind(title, symbolsJson, rangeYears, startValue || 1000, rangeFitted ? 1 : 0, now, id)
        .run();
    } else {
      await db
        .prepare(
          "INSERT INTO portfolios (id, title, symbols, rangeYears, startValue, rangeFitted, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
        )
        .bind(
          id,
          title,
          symbolsJson,
          rangeYears,
          startValue || 1000,
          rangeFitted ? 1 : 0,
          createdAt || now,
          now
        )
        .run();
    }

    return Response.json({ success: true, id, persisted: true });
  } catch (error) {
    console.error("Failed to save portfolio:", error);
    return Response.json({ success: false, persisted: false }, { status: 503 });
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

    if (!db) {
      return Response.json({ success: true, persisted: false });
    }

    await db.prepare("DELETE FROM portfolios WHERE id = ?").bind(id).run();

    return Response.json({ success: true, persisted: true });
  } catch (error) {
    console.error("Failed to delete portfolio:", error);
    return Response.json({ success: false, persisted: false }, { status: 503 });
  }
}
