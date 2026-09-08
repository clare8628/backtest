-- Create portfolios table
CREATE TABLE IF NOT EXISTS portfolios (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  symbols TEXT NOT NULL,
  rangeYears INTEGER NOT NULL DEFAULT 5,
  startValue INTEGER DEFAULT 1000,
  rangeFitted INTEGER DEFAULT 0,
  createdAt TEXT NOT NULL,
  updatedAt TEXT NOT NULL
);

-- Create index for faster queries
CREATE INDEX IF NOT EXISTS idx_portfolios_createdAt ON portfolios(createdAt DESC);
