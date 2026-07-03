-- Bandsintown numeric artist id used by the API integration
-- (GET /artists/id_{artist_id}); complements the display-oriented
-- bandsintown_artist_name added in 040.
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS bandsintown_artist_id TEXT;
