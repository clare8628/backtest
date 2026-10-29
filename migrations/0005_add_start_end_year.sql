-- Adds startYear and endYear columns to portfolios for custom interval backtesting.
-- Handled lazily at runtime by ensureSchema in app/api/portfolios/route.ts,
-- this file is for manual migration via wrangler d1 execute when desired.

ALTER TABLE portfolios ADD COLUMN startYear INTEGER;
ALTER TABLE portfolios ADD COLUMN endYear INTEGER;
