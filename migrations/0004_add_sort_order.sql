-- Adds the sortOrder column for drag-and-drop position adjustment.
--
-- Portfolios can be reordered by mouse dragging in the gallery grid.
-- Without this column every UPDATE/INSERT with sortOrder or reorder request
-- would fail on an existing database that predates it.
--
-- Fresh databases create the column directly via 0001_create_portfolios.sql.
ALTER TABLE portfolios ADD COLUMN sortOrder INTEGER DEFAULT 0;
