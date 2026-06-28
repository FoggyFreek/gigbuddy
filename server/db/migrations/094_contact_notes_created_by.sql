ALTER TABLE contact_notes
  ADD COLUMN created_by_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL;
