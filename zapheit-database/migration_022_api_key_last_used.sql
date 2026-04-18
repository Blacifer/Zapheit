-- Migration 022: Add last_used column to api_keys
-- The middleware already writes to this column; the live DB was missing it.
ALTER TABLE api_keys
  ADD COLUMN IF NOT EXISTS last_used TIMESTAMP WITH TIME ZONE;
