-- Additive, safe for existing accounts and memories. No data is removed.
ALTER TABLE memories ADD COLUMN IF NOT EXISTS transcript text;