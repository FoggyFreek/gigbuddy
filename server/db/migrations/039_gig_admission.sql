ALTER TABLE gigs
  ADD COLUMN admission TEXT NOT NULL DEFAULT 'free',
  ADD COLUMN ticket_link TEXT;
